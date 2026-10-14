const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { setupAuthApi, ensureAuthSchema, bootstrapAdmin, bootstrapExtraAdmins } = require('./auth');
const { ensureCoreSchema } = require('./schema');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Tin tưởng 1 lớp proxy (Render) để lấy đúng IP client cho rate-limit
app.set('trust proxy', 1);

// Lưu ý: HEALTH CHECK, FRONTEND TĨNH và AUTH API được đăng ký phía dưới,
// ngay sau khi tạo pool (cần pool cho /api/health + middleware bảo vệ /api/*).

// ================= KẾT NỐI DATABASE (TiDB Cloud / Aiven / MySQL) =================
// Cấu hình đọc từ env trong db.js: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL, DB_SSL_CA
// - TiDB Cloud: TLS chuẩn (không cần CA riêng), port 4000 — xem render.yaml + README
// - Aiven MySQL: đặt thêm DB_SSL_CA=ca.pem
const pool = require('./db');
// =================================================================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static('uploads'));

// ================= HEALTH CHECK (cho Render) =================
// Luôn trả 200 với envelope chuẩn; trạng thái DB kiểm tra có timeout để không treo request
app.get('/api/health', async (req, res) => {
    let dbStatus = 'error';
    try {
        await Promise.race([
            pool.query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000))
        ]);
        dbStatus = 'connected';
    } catch (error) {
        dbStatus = 'error';
    }
    res.status(200).json({
        success: true,
        data: { status: 'ok', db: dbStatus, time: new Date().toISOString() },
        message: 'Hệ thống hoạt động'
    });
});

// ================= FRONTEND TĨNH (mount chọn lọc — KHÔNG serve root để không lộ server.js/ca.pem/.env) =================
const frontendDir = path.join(__dirname, 'frontend');

// Trang landing tại "/" + favicon gốc
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(frontendDir, 'assets', 'favicon.ico')));

// /frontend: css, js, assets — đặt no-cache giống Django để luôn lấy bản mới
app.use('/frontend', express.static(frontendDir, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));
// Các thư mục HTML cũ + ảnh club (static thường)
app.use('/bcn', express.static(path.join(__dirname, 'bcn')));
app.use('/thanhvien', express.static(path.join(__dirname, 'thanhvien')));
app.use('/hinhanh', express.static(path.join(__dirname, 'hinhanh')));

// Route tiện: dashboard BCN ở gốc + link ngắn
app.get('/trang_chu.html', (req, res) => res.sendFile(path.join(__dirname, 'trang_chu.html')));
app.get('/login', (req, res) => res.redirect('/frontend/login.html'));
app.get('/admin', (req, res) => res.redirect('/trang_chu.html'));

// ================= AUTH API /api/v1/auth/* + middleware bảo vệ /api/* =================
// Đăng ký auth routes TRƯỚC, sau đó cài bearerAuth bảo vệ mọi endpoint /api/* cũ bên dưới
setupAuthApi(app, pool);

// ================= 0. API CÀI ĐẶT HỆ THỐNG (Khóa quỹ) =================
app.get('/api/settings/:khoa', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT gia_tri FROM cai_dat_he_thong WHERE khoa = ?', [req.params.khoa]);
        if(rows.length > 0) res.json({ gia_tri: rows[0].gia_tri });
        else res.json({ gia_tri: '[]' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/settings/:khoa', async (req, res) => {
    try {
        const { gia_tri } = req.body;
        await pool.query('INSERT INTO cai_dat_he_thong (khoa, gia_tri) VALUES (?, ?) ON DUPLICATE KEY UPDATE gia_tri = ?', [req.params.khoa, gia_tri, gia_tri]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 1. API DASHBOARD =================
app.get('/api/dashboard', async (req, res) => {
    try {
        const [tv] = await pool.query('SELECT COUNT(*) as total_tv FROM thanh_vien');
        const [tl] = await pool.query('SELECT COUNT(*) as total_tl FROM tai_lieu');
        
        const [thu] = await pool.query('SELECT SUM(so_tien) as total FROM quy_clb WHERE loai_gd = "Thu"');
        const [chi] = await pool.query('SELECT SUM(so_tien) as total FROM quy_clb WHERE loai_gd = "Chi"');
        const [kh] = await pool.query('SELECT SUM(tong_kinh_phi) as total FROM ke_hoach_sinh_hoat');
        
        const totalThu = parseFloat(thu[0].total || 0);
        const totalChi = parseFloat(chi[0].total || 0) + parseFloat(kh[0].total || 0);
        const soDuQuy = totalThu - totalChi;

        res.json({ tongThanhVien: tv[0].total_tv, soDuQuy: soDuQuy, tongTaiLieu: tl[0].total_tl });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/analytics', async (req, res) => {
    try {
        const [gender] = await pool.query('SELECT gioi_tinh, COUNT(*) as count FROM thanh_vien GROUP BY gioi_tinh');
        const [classes] = await pool.query('SELECT lop, COUNT(*) as count FROM thanh_vien GROUP BY lop ORDER BY count DESC LIMIT 5');
        const [attendance] = await pool.query('SELECT trang_thai, COUNT(*) as count FROM chi_tiet_diem_danh GROUP BY trang_thai');
        res.json({ gender, classes, attendance });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 2. API THÀNH VIÊN =================
app.get('/api/members', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM thanh_vien ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/members', async (req, res) => {
    const { ho_ten, ngay_sinh, gioi_tinh, mssv, lop, sdt, email, trang_thai_hd } = req.body;
    const ma_tv = 'IP' + Date.now().toString().slice(-6);
    try {
        await pool.query(
            'INSERT INTO thanh_vien (ma_tv, ho_ten, ngay_sinh, gioi_tinh, mssv, lop, sdt, email, trang_thai_hd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [ma_tv, ho_ten, ngay_sinh, gioi_tinh, mssv, lop, sdt, email, trang_thai_hd || 'Đang hoạt động']
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/members/:id', async (req, res) => {
    const { ho_ten, mssv, lop, sdt, gioi_tinh, trang_thai_hd } = req.body;
    try {
        await pool.query(
            'UPDATE thanh_vien SET ho_ten=?, mssv=?, lop=?, sdt=?, gioi_tinh=?, trang_thai_hd=? WHERE id=?',
            [ho_ten, mssv, lop, sdt, gioi_tinh, trang_thai_hd, req.params.id]
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/members/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM thanh_vien WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 3. API QUỸ CLB =================
app.get('/api/funds', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM quy_clb ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/funds', async (req, res) => {
    const { ngay_gd, loai_gd, noi_dung, so_tien, nguoi_thuc_hien, ghi_chu } = req.body;
    const ma_gd = (loai_gd === 'Thu' ? 'PT' : 'PC') + Date.now().toString().slice(-5);
    try {
        await pool.query(
            'INSERT INTO quy_clb (ma_gd, ngay_gd, loai_gd, noi_dung, so_tien, nguoi_thuc_hien, ghi_chu) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [ma_gd, ngay_gd, loai_gd, noi_dung, so_tien, nguoi_thuc_hien, ghi_chu]
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/funds/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM quy_clb WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 4. API TÀI LIỆU =================
app.get('/api/documents', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tai_lieu ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/documents', upload.single('file'), async (req, res) => {
    const { nhom, ten_tai_lieu, mo_ta } = req.body;
    const file_path = req.file ? `/uploads/${req.file.filename}` : '';
    try {
        await pool.query('INSERT INTO tai_lieu (nhom, ten_tai_lieu, mo_ta, file_path) VALUES (?, ?, ?, ?)', [nhom, ten_tai_lieu, mo_ta, file_path]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/documents/:id', upload.single('file'), async (req, res) => {
    const { nhom, ten_tai_lieu, mo_ta } = req.body;
    try {
        if (req.file) {
            await pool.query('UPDATE tai_lieu SET nhom=?, ten_tai_lieu=?, mo_ta=?, file_path=? WHERE id=?', [nhom, ten_tai_lieu, mo_ta, `/uploads/${req.file.filename}`, req.params.id]);
        } else {
            await pool.query('UPDATE tai_lieu SET nhom=?, ten_tai_lieu=?, mo_ta=? WHERE id=?', [nhom, ten_tai_lieu, mo_ta, req.params.id]);
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/documents/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM tai_lieu WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 5. API BAN CHỦ NHIỆM =================
app.get('/api/board', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT b.*, t.ho_ten, t.mssv FROM ban_chu_nhiem b LEFT JOIN thanh_vien t ON b.thanh_vien_id = t.id ORDER BY b.nhiem_ky DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/board', async (req, res) => {
    const { nhiem_ky, thanh_vien_id, chuc_vu, ban_phu_trach } = req.body;
    try {
        await pool.query('INSERT INTO ban_chu_nhiem (nhiem_ky, thanh_vien_id, chuc_vu, ban_phu_trach) VALUES (?, ?, ?, ?)', [nhiem_ky, thanh_vien_id, chuc_vu, ban_phu_trach]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/board/:id', async (req, res) => {
    const { nhiem_ky, thanh_vien_id, chuc_vu, ban_phu_trach } = req.body;
    try {
        await pool.query('UPDATE ban_chu_nhiem SET nhiem_ky=?, thanh_vien_id=?, chuc_vu=?, ban_phu_trach=? WHERE id=?', [nhiem_ky, thanh_vien_id, chuc_vu, ban_phu_trach, req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/board/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ban_chu_nhiem WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 6. API KẾ HOẠCH & SỰ KIỆN =================
app.get('/api/plans', async (req, res) => {
    try {
        const [plans] = await pool.query('SELECT * FROM ke_hoach_sinh_hoat ORDER BY thoi_gian DESC');
        for (let plan of plans) {
            const [items] = await pool.query('SELECT * FROM chi_tiet_du_tru WHERE ke_hoach_id = ?', [plan.id]);
            plan.items = items;
            const [members] = await pool.query('SELECT tvtg.*, tv.ho_ten FROM thanh_vien_tham_gia tvtg LEFT JOIN thanh_vien tv ON tvtg.mssv = tv.mssv WHERE tvtg.ke_hoach_id = ?', [plan.id]);
            plan.members = members;
        }
        res.json(plans);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/plans', async (req, res) => {
    let { ten_hoat_dong, thoi_gian, dia_diem, noi_dung, ban_phu_trach, tong_kinh_phi, items, members } = req.body;
    if (!thoi_gian || thoi_gian.trim() === '') thoi_gian = null; 
    const ma_hd = 'HD' + Date.now().toString().slice(-5);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [planResult] = await connection.query('INSERT INTO ke_hoach_sinh_hoat (ma_hd, ten_hoat_dong, thoi_gian, dia_diem, noi_dung, ban_phu_trach, tong_kinh_phi) VALUES (?, ?, ?, ?, ?, ?, ?)', [ma_hd, ten_hoat_dong, thoi_gian, dia_diem, noi_dung, ban_phu_trach, tong_kinh_phi || 0]);
        if (items && items.length > 0) {
            for (let item of items) await connection.query('INSERT INTO chi_tiet_du_tru (ke_hoach_id, noi_dung_chi, so_luong, don_gia, thanh_tien, ghi_chu) VALUES (?, ?, ?, ?, ?, ?)', [planResult.insertId, item.noi_dung_chi, item.so_luong, item.don_gia, Number(item.so_luong) * Number(item.don_gia), item.ghi_chu]);
        }
        if (members && members.length > 0) {
            for (let mem of members) await connection.query('INSERT INTO thanh_vien_tham_gia (ke_hoach_id, mssv, vai_tro, ghi_chu) VALUES (?, ?, ?, ?)', [planResult.insertId, mem.mssv, mem.vai_tro, mem.ghi_chu]);
        }
        await connection.commit(); res.json({ success: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); } finally { connection.release(); }
});

app.put('/api/plans/:id', async (req, res) => {
    let { ten_hoat_dong, thoi_gian, dia_diem, noi_dung, ban_phu_trach, tong_kinh_phi, items, members } = req.body;
    const planId = req.params.id;
    if (!thoi_gian || thoi_gian.trim() === '') thoi_gian = null; 
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('UPDATE ke_hoach_sinh_hoat SET ten_hoat_dong=?, thoi_gian=?, dia_diem=?, noi_dung=?, ban_phu_trach=?, tong_kinh_phi=? WHERE id=?', [ten_hoat_dong, thoi_gian, dia_diem, noi_dung, ban_phu_trach, tong_kinh_phi || 0, planId]);
        await connection.query('DELETE FROM chi_tiet_du_tru WHERE ke_hoach_id = ?', [planId]);
        await connection.query('DELETE FROM thanh_vien_tham_gia WHERE ke_hoach_id = ?', [planId]);
        if (items && items.length > 0) {
            for (let item of items) await connection.query('INSERT INTO chi_tiet_du_tru (ke_hoach_id, noi_dung_chi, so_luong, don_gia, thanh_tien, ghi_chu) VALUES (?, ?, ?, ?, ?, ?)', [planId, item.noi_dung_chi, item.so_luong, item.don_gia, Number(item.so_luong) * Number(item.don_gia), item.ghi_chu]);
        }
        if (members && members.length > 0) {
            for (let mem of members) await connection.query('INSERT INTO thanh_vien_tham_gia (ke_hoach_id, mssv, vai_tro, ghi_chu) VALUES (?, ?, ?, ?)', [planId, mem.mssv, mem.vai_tro, mem.ghi_chu]);
        }
        await connection.commit(); res.json({ success: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); } finally { connection.release(); }
});

app.delete('/api/plans/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ke_hoach_sinh_hoat WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 7. API ĐIỂM DANH GPS =================
app.get('/api/attendance', async (req, res) => {
    try {
        const sql = `SELECT d.*, (SELECT COUNT(*) FROM chi_tiet_diem_danh c WHERE c.dot_id = d.id AND c.trang_thai = 'Có mặt') as so_luong_co_mat, (SELECT COUNT(*) FROM chi_tiet_diem_danh c WHERE c.dot_id = d.id) as tong_so FROM dot_diem_danh d ORDER BY d.thoi_gian DESC`;
        const [rows] = await pool.query(sql);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/attendance/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT c.*, t.ho_ten FROM chi_tiet_diem_danh c LEFT JOIN thanh_vien t ON c.mssv = t.mssv WHERE c.dot_id = ?', [req.params.id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/attendance', async (req, res) => {
    const { ten_hoat_dong, thoi_gian, ban_kinh, vi_do, kinh_do } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [dot] = await connection.query('INSERT INTO dot_diem_danh (ten_hoat_dong, thoi_gian, ban_kinh, vi_do, kinh_do, trang_thai) VALUES (?, ?, ?, ?, ?, "Đang mở")', [ten_hoat_dong, thoi_gian, ban_kinh, vi_do, kinh_do]);
        
        const [members] = await connection.query('SELECT mssv FROM thanh_vien WHERE trang_thai_hd = "Đang hoạt động"');
        if (members.length > 0) {
            const values = members.map(m => [dot.insertId, m.mssv, 'Vắng']);
            await connection.query('INSERT INTO chi_tiet_diem_danh (dot_id, mssv, trang_thai) VALUES ?', [values]);
        }
        await connection.commit();
        res.json({ success: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); } finally { connection.release(); }
});

app.put('/api/attendance/:id/bulk', async (req, res) => {
    const { records } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        for (let rec of records) {
            if (rec.trang_thai === 'Có mặt' || rec.trang_thai === 'Đi muộn') {
                await connection.query(
                    'UPDATE chi_tiet_diem_danh SET trang_thai = ?, gio_checkin = IFNULL(gio_checkin, NOW()) WHERE dot_id = ? AND mssv = ?', 
                    [rec.trang_thai, req.params.id, rec.mssv]
                );
            } else {
                await connection.query(
                    'UPDATE chi_tiet_diem_danh SET trang_thai = ?, gio_checkin = NULL WHERE dot_id = ? AND mssv = ?', 
                    [rec.trang_thai, req.params.id, rec.mssv]
                );
            }
        }
        await connection.commit();
        res.json({ success: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); } finally { connection.release(); }
});

app.put('/api/attendance/:id/status', async (req, res) => {
    try {
        await pool.query('UPDATE dot_diem_danh SET trang_thai = ? WHERE id = ?', [req.body.trang_thai, req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/attendance/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM dot_diem_danh WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 8. API BẢNG TIN =================
app.get('/api/posts', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT *, hinh_anh_url AS tep_url FROM bai_dang ORDER BY is_pinned DESC, ngay_dang DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/posts', upload.single('tep_dinh_kem'), async (req, res) => {
    const { noi_dung, nguoi_thao_tac } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO bai_dang (noi_dung, hinh_anh_url) VALUES (?, ?)', [noi_dung, req.file ? `/uploads/${req.file.filename}` : '']);
        if (nguoi_thao_tac) await pool.query('INSERT INTO lich_su_bai_dang (bai_dang_id, nguoi_thao_tac, hanh_dong, noi_dung) VALUES (?, ?, ?, ?)', [result.insertId, nguoi_thao_tac, 'Thêm', noi_dung]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/posts/:id', async (req, res) => {
    const { noi_dung, nguoi_thao_tac } = req.body;
    try {
        await pool.query('UPDATE bai_dang SET noi_dung = ? WHERE id = ?', [noi_dung, req.params.id]);
        if (nguoi_thao_tac) await pool.query('INSERT INTO lich_su_bai_dang (bai_dang_id, nguoi_thao_tac, hanh_dong, noi_dung) VALUES (?, ?, ?, ?)', [req.params.id, nguoi_thao_tac, 'Sửa', noi_dung]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/posts/:id/pin', async (req, res) => {
    try {
        await pool.query('UPDATE bai_dang SET is_pinned = NOT is_pinned WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const [post] = await pool.query('SELECT noi_dung FROM bai_dang WHERE id = ?', [req.params.id]);
        await pool.query('DELETE FROM bai_dang WHERE id = ?', [req.params.id]);
        if (req.query.nguoi_thao_tac) await pool.query('INSERT INTO lich_su_bai_dang (bai_dang_id, nguoi_thao_tac, hanh_dong, noi_dung) VALUES (?, ?, ?, ?)', [req.params.id, req.query.nguoi_thao_tac, 'Xóa', post.length > 0 ? post[0].noi_dung : 'Đã bị xóa']);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/posts/history', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM lich_su_bai_dang ORDER BY thoi_gian DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 9. API HÒM THƯ GÓP Ý =================
app.get('/api/suggestions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM gop_y ORDER BY ngay_gui DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/suggestions', async (req, res) => {
    try {
        await pool.query('INSERT INTO gop_y (nguoi_gui, noi_dung) VALUES (?, ?)', [req.body.nguoi_gui || 'Thành viên ẩn danh', req.body.noi_dung]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= 10. API KẾ HOẠCH TRUYỀN THÔNG =================
app.get('/api/communications', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT kht.*, kh.ten_hoat_dong, kh.ma_hd
            FROM ke_hoach_truyen_thong kht
            LEFT JOIN ke_hoach_sinh_hoat kh ON kht.ke_hoach_id = kh.id
            ORDER BY kht.id DESC
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/communications', async (req, res) => {
    const { ke_hoach_id, noi_dung_tt, loai_noi_dung, kenh_truyen_thong, nguoi_phu_trach, han_dang, trang_thai, link_bai_viet, ghi_chu } = req.body;
    try {
        await pool.query(
            'INSERT INTO ke_hoach_truyen_thong (ke_hoach_id, noi_dung_tt, loai_noi_dung, kenh_truyen_thong, nguoi_phu_trach, han_dang, trang_thai, link_bai_viet, ghi_chu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [ke_hoach_id || null, noi_dung_tt, loai_noi_dung, kenh_truyen_thong, nguoi_phu_trach, han_dang || null, trang_thai, link_bai_viet, ghi_chu]
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/communications/:id', async (req, res) => {
    const { ke_hoach_id, noi_dung_tt, loai_noi_dung, kenh_truyen_thong, nguoi_phu_trach, han_dang, trang_thai, link_bai_viet, ghi_chu } = req.body;
    try {
        await pool.query(
            'UPDATE ke_hoach_truyen_thong SET ke_hoach_id=?, noi_dung_tt=?, loai_noi_dung=?, kenh_truyen_thong=?, nguoi_phu_trach=?, han_dang=?, trang_thai=?, link_bai_viet=?, ghi_chu=? WHERE id=?',
            [ke_hoach_id || null, noi_dung_tt, loai_noi_dung, kenh_truyen_thong, nguoi_phu_trach, han_dang || null, trang_thai, link_bai_viet, ghi_chu, req.params.id]
        );
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/communications/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ke_hoach_truyen_thong WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================= AUTO-MIGRATE + BOOTSTRAP ADMIN LÚC BOOT =================
// Chạy nền ngay trước app.listen; mỗi bước tự try/catch — lỗi DB chỉ log, KHÔNG crash process
(async () => {
    // 1. Tạo schema lõi nếu database trống (deploy TiDB lần đầu chạy được ngay)
    try { await ensureCoreSchema(pool); } catch (e) { console.error('[Boot] Lỗi tạo schema lõi:', e.message); }
    // 2. Migrate các cột/bảng phục vụ đăng nhập
    try { await ensureAuthSchema(pool); } catch (e) { console.error('[Boot] Lỗi migrate schema:', e.message); }
    // 3. Tạo/cập nhật tài khoản ADMIN đầu tiên từ env
    try { await bootstrapAdmin(pool); } catch (e) { console.error('[Boot] Lỗi bootstrap admin:', e.message); }
    // 4. Tạo/cập nhật CÁC tài khoản ADMIN bổ sung từ BOOTSTRAP_ADMINS (nếu có)
    try { await bootstrapExtraAdmins(pool); } catch (e) { console.error('[Boot] Lỗi bootstrap admin bổ sung:', e.message); }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Backend CLB IP đang chạy tại port ${PORT}`));