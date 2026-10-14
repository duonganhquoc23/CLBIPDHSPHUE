/**
 * auth.js — API xác thực /api/v1/auth/* cho hệ thống CLBIPDHSPHUE
 * ================================================================
 * Đúng contract của frontend clbIP (envelope {success, data, message, errors}):
 *  - POST /api/v1/auth/token/            Đăng nhập bằng Email HOẶC MSSV (bcrypt)
 *  - POST /api/v1/auth/token/refresh/    Đổi refresh token lấy access mới (không rotate)
 *  - GET  /api/v1/auth/me/               Hồ sơ user đang đăng nhập (Bearer access)
 *  - POST /api/v1/auth/password-reset/request|verify|confirm/  Quên mật khẩu qua OTP
 *
 * Sau khi đăng ký các route trên, hàm này cài middleware bearerAuth bảo vệ
 * TOÀN BỘ /api/* (trừ /api/health và /api/v1/auth/* đã đăng ký trước đó).
 * Các trang HTML cũ đã được chèn frontend/js/guard.js với fetch-patch tự gắn
 * header Authorization cho mọi request /api/* cùng origin.
 *
 * Token: JWT (jsonwebtoken) — access 30 phút, refresh 7 ngày, reset 10 phút.
 * Mật khẩu: bcrypt (bcryptjs).
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');

// Định dạng lỗi DB gồm cả code (ECONNREFUSED, ETIMEDOUT, ER_ACCESS_DENIED_ERROR...)
// để dễ chẩn đoán cấu hình DB trên log Render
function dbErr(e) {
  return e && e.code ? `${e.code}: ${e.message}` : String((e && e.message) || e);
}

// ===== Secret & thời hạn token =====
// JWT_SECRET bắt buộc trên production (Render env). Fallback dev chỉ để chạy thử local.
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[Auth] CẢNH BÁO: chưa đặt JWT_SECRET — đang dùng secret phát triển, KHÔNG dùng trên production!');
  return 'dev-secret-clbipdhsphue-change-me';
})();
const ACCESS_TTL = '30m';
const REFRESH_TTL = '7d';
const RESET_TTL = '10m';

// ===== Helpers envelope chuẩn =====
function ok(res, data, message) {
  res.json({ success: true, data: data === undefined ? null : data, message: message || '' });
}
function fail(res, status, message, errors) {
  res.status(status).json({ success: false, data: null, message: message || 'Có lỗi xảy ra.', errors: errors || null });
}

/** Trích & verify access token từ header Bearer (hoặc ?token= cho link tải trực tiếp) */
function verifyAccess(req) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // Fallback query ?token= — cho link tải trực tiếp (img/pdf) không đặt được header
  if (!token && req.query && typeof req.query.token === 'string') token = req.query.token.trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

/** Middleware bảo vệ /api/*: thiếu/sai token → 401 envelope */
function bearerAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next(); // cho preflight CORS đi qua
  const payload = verifyAccess(req);
  if (!payload) return fail(res, 401, 'Yêu cầu đăng nhập.');
  req.user = payload;
  next();
}

/** Rate limit đăng nhập: 5 lần/phút/IP */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => fail(res, 429, 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 1 phút.')
});

/** Rate limit quên mật khẩu: 3 lần/giờ/IP (áp cho cả 3 endpoint reset) */
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => fail(res, 429, 'Bạn đã thực hiện quá nhiều lần. Vui lòng thử lại sau ít phút.')
});

/** SELECT thông tin đăng nhập của user theo email hoặc mssv */
async function findUserByIdentifier(pool, identifier) {
  const isEmail = identifier.includes('@');
  const col = isEmail ? 'email' : 'mssv';
  const [rows] = await pool.query(
    `SELECT id, ma_tv, ho_ten, email, mssv, lop, sdt, trang_thai_hd, mat_khau, vai_tro
     FROM thanh_vien WHERE ${col} = ? LIMIT 1`,
    [identifier]
  );
  return rows.length ? rows[0] : null;
}

/** Tìm user theo id (dùng cho /me/ và refresh) */
async function findUserById(pool, id) {
  const [rows] = await pool.query(
    `SELECT id, ma_tv, ho_ten, email, mssv, lop, sdt, trang_thai_hd, mat_khau, vai_tro
     FROM thanh_vien WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Quyết định vai trò: cột vai_tro nếu có → JOIN ban_chu_nhiem → mặc định MEMBER.
 * Kết quả được UPDATE ngược vào DB (tự lành dữ liệu cũ chưa có vai_tro).
 */
async function resolveRole(pool, user) {
  if (user.vai_tro) return user.vai_tro;
  let role = 'MEMBER';
  try {
    const [rows] = await pool.query('SELECT id FROM ban_chu_nhiem WHERE thanh_vien_id = ? LIMIT 1', [user.id]);
    if (rows.length) role = 'BCN';
    await pool.query('UPDATE thanh_vien SET vai_tro = ? WHERE id = ?', [role, user.id]);
  } catch (e) {
    console.error('[Auth] Lỗi resolve vai trò:', dbErr(e));
  }
  return role;
}

/** Đối tượng user trả về cho frontend (đúng contract clbIP) */
function publicUser(user, role) {
  return {
    id: user.id,
    email: user.email,
    mssv: user.mssv,
    role: role,
    is_superuser: role === 'ADMIN',
    ho_ten: user.ho_ten,
    lop: user.lop,
    sdt: user.sdt,
    avatar: null
  };
}

/** Ký cặp access + refresh token */
function signTokens(user, role) {
  const access = jwt.sign(
    { sub: user.id, role: role, email: user.email, mssv: user.mssv },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
  const refresh = jwt.sign({ sub: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TTL });
  return { access, refresh };
}

/** Kiểm tra mật khẩu an toàn (bcrypt.compare có thể ném lỗi nếu hash hỏng) */
async function passwordMatches(plainText, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(plainText, hash); } catch (e) { return false; }
}

/**
 * Cài đặt toàn bộ API auth lên app. PHẢI gọi TRƯỚC khi đăng ký 37 endpoint /api/* cũ,
 * để middleware bearerAuth (được cài cuối hàm này) đứng trước chúng.
 */
function setupAuthApi(app, pool) {

  // ---------- ĐĂNG NHẬP ----------
  app.post('/api/v1/auth/token/', loginLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const identifier = String(body.email || '').trim();
      const password = String(body.password || '');
      if (!identifier || !password) {
        return fail(res, 400, 'Vui lòng nhập email/MSSV và mật khẩu.');
      }

      // Identifier chứa '@' → tra theo email, ngược lại tra theo MSSV
      const user = await findUserByIdentifier(pool, identifier);
      if (!user) return fail(res, 401, 'Email hoặc mật khẩu không chính xác.');

      // Chỉ thành viên đang hoạt động được đăng nhập
      if (user.trang_thai_hd !== 'Đang hoạt động') {
        return fail(res, 403, 'Tài khoản đã ngừng hoạt động.');
      }

      if (!(await passwordMatches(password, user.mat_khau))) {
        return fail(res, 401, 'Email hoặc mật khẩu không chính xác.');
      }

      const role = await resolveRole(pool, user);
      const tokens = signTokens(user, role);
      return ok(res, { ...tokens, user: publicUser(user, role) }, 'Đăng nhập thành công.');
    } catch (error) {
      console.error('[Auth] Lỗi đăng nhập:', error.message);
      return fail(res, 500, 'Lỗi máy chủ khi đăng nhập. Vui lòng thử lại sau.');
    }
  });

  // ---------- LÀM MỚI ACCESS TOKEN ----------
  app.post('/api/v1/auth/token/refresh/', async (req, res) => {
    try {
      const refresh = String((req.body || {}).refresh || '').trim();
      if (!refresh) return fail(res, 400, 'Thiếu refresh token.');
      let payload;
      try {
        payload = jwt.verify(refresh, JWT_SECRET);
      } catch (e) {
        return fail(res, 401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
      }
      if (payload.type !== 'refresh') return fail(res, 401, 'Token không hợp lệ.');

      const user = await findUserById(pool, payload.sub);
      if (!user) return fail(res, 401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
      const role = await resolveRole(pool, user);
      const access = jwt.sign(
        { sub: user.id, role: role, email: user.email, mssv: user.mssv },
        JWT_SECRET,
        { expiresIn: ACCESS_TTL }
      );
      // Giữ nguyên refresh cũ (không rotate) — frontend tự lưu lại
      return ok(res, { access }, 'Làm mới phiên đăng nhập thành công.');
    } catch (error) {
      console.error('[Auth] Lỗi refresh token:', error.message);
      return fail(res, 500, 'Lỗi máy chủ khi làm mới phiên đăng nhập.');
    }
  });

  // ---------- HỒ SƠ ĐANG ĐĂNG NHẬP ----------
  app.get('/api/v1/auth/me/', async (req, res) => {
    try {
      const payload = verifyAccess(req);
      if (!payload) return fail(res, 401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
      const user = await findUserById(pool, payload.sub);
      if (!user) return fail(res, 401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
      const role = await resolveRole(pool, user);
      return ok(res, publicUser(user, role));
    } catch (error) {
      console.error('[Auth] Lỗi /me/:', error.message);
      return fail(res, 500, 'Lỗi máy chủ khi lấy hồ sơ.');
    }
  });

  // ---------- QUÊN MẬT KHẨU (3 bước: request → verify → confirm) ----------
  // Bước 1: yêu cầu mã OTP. Luôn trả success để chống dò email.
  app.post('/api/v1/auth/password-reset/request/', resetLimiter, async (req, res) => {
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      if (email) {
        const [users] = await pool.query('SELECT id, email FROM thanh_vien WHERE email = ? LIMIT 1', [email]);
        if (users.length) {
          const otp = String(Math.floor(100000 + Math.random() * 900000)); // OTP 6 số
          const otpHash = await bcrypt.hash(otp, 10);
          // Vô hiệu các OTP cũ chưa dùng của email này, rồi lưu OTP mới (hạn 10 phút)
          await pool.query('UPDATE dat_lai_mat_khau SET da_dung = 1 WHERE email = ? AND da_dung = 0', [email]);
          await pool.query(
            'INSERT INTO dat_lai_mat_khau (email, otp_hash, het_han, da_dung) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0)',
            [email, otpHash]
          );
          // CHƯA có SMTP → tạm in OTP ra log server để BCN chuyển tiếp thủ công
          console.log(`[OTP] email=${email} mã OTP=${otp} (hết hạn sau 10 phút)`);
        }
      }
      return ok(res, null, 'Nếu email tồn tại, mã OTP đã được gửi');
    } catch (error) {
      console.error('[Auth] Lỗi password-reset/request:', error.message);
      return fail(res, 500, 'Không gửi được mã OTP. Vui lòng thử lại sau.');
    }
  });

  // Bước 2: xác minh OTP → trả reset_token (JWT 10 phút, type 'reset')
  app.post('/api/v1/auth/password-reset/verify/', resetLimiter, async (req, res) => {
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      const otp = String((req.body || {}).otp || '').trim();
      if (!email || !/^\d{6}$/.test(otp)) {
        return fail(res, 400, 'Mã OTP không đúng hoặc đã hết hạn.');
      }
      const [rows] = await pool.query(
        'SELECT id, otp_hash FROM dat_lai_mat_khau WHERE email = ? AND da_dung = 0 AND het_han > NOW() ORDER BY id DESC LIMIT 1',
        [email]
      );
      if (!rows.length) return fail(res, 400, 'Mã OTP không đúng hoặc đã hết hạn.');
      const matched = await passwordMatches(otp, rows[0].otp_hash);
      if (!matched) return fail(res, 400, 'Mã OTP không đúng hoặc đã hết hạn.');

      const [users] = await pool.query('SELECT id FROM thanh_vien WHERE email = ? LIMIT 1', [email]);
      if (!users.length) return fail(res, 400, 'Mã OTP không đúng hoặc đã hết hạn.');

      const resetToken = jwt.sign({ sub: users[0].id, email: email, type: 'reset' }, JWT_SECRET, { expiresIn: RESET_TTL });
      return ok(res, { reset_token: resetToken }, 'Xác minh OTP thành công.');
    } catch (error) {
      console.error('[Auth] Lỗi password-reset/verify:', error.message);
      return fail(res, 500, 'Không xác minh được mã OTP. Vui lòng thử lại sau.');
    }
  });

  // Bước 3: đặt mật khẩu mới bằng reset_token
  app.post('/api/v1/auth/password-reset/confirm/', resetLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const resetToken = String(body.reset_token || '').trim();
      const newPassword = String(body.new_password || '');
      const confirmPassword = String(body.confirm_password || '');

      let payload;
      try {
        payload = jwt.verify(resetToken, JWT_SECRET);
      } catch (e) {
        return fail(res, 401, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
      }
      if (payload.type !== 'reset') {
        return fail(res, 401, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
      }
      if (newPassword.length < 6) {
        return fail(res, 400, 'Mật khẩu phải có tối thiểu 6 ký tự.', { new_password: ['Mật khẩu phải có tối thiểu 6 ký tự.'] });
      }
      if (newPassword !== confirmPassword) {
        return fail(res, 400, 'Mật khẩu nhập lại không khớp.', { confirm_password: ['Mật khẩu nhập lại không khớp.'] });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      const [result] = await pool.query('UPDATE thanh_vien SET mat_khau = ? WHERE id = ?', [hash, payload.sub]);
      if (!result.affectedRows) {
        return fail(res, 400, 'Không tìm thấy tài khoản để đặt lại mật khẩu.');
      }
      // Đánh dấu mọi OTP của email này đã dùng
      if (payload.email) {
        await pool.query('UPDATE dat_lai_mat_khau SET da_dung = 1 WHERE email = ?', [payload.email]);
      }
      return ok(res, null, 'Đổi mật khẩu thành công. Mời bạn đăng nhập bằng mật khẩu mới.');
    } catch (error) {
      console.error('[Auth] Lỗi password-reset/confirm:', error.message);
      return fail(res, 500, 'Không đổi được mật khẩu. Vui lòng thử lại sau.');
    }
  });

  // ---------- MIDDLEWARE BẢO VỆ TOÀN BỘ /api/* ----------
  // Đặt SAU các route /api/v1/auth/* (và /api/health đăng ký trước đó trong server.js),
  // TRƯỚC 37 endpoint /api/* cũ. Trang cũ đã có guard.js + fetch-patch tự gắn header.
  app.use('/api', bearerAuth);
}

/**
 * Auto-migrate schema phục vụ đăng nhập lúc boot (idempotent).
 * Lỗi DB chỉ console.error — KHÔNG để process crash.
 */
async function ensureAuthSchema(pool) {
  // 1. Đảm bảo cột mat_khau + vai_tro trên bảng thanh_vien
  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'thanh_vien'"
    );
    const names = new Set(cols.map((r) => String(r.name).toLowerCase()));
    if (!names.has('mat_khau')) {
      await pool.query("ALTER TABLE thanh_vien ADD COLUMN mat_khau VARCHAR(255) NULL");
      console.log('[Migrate] Đã thêm cột thanh_vien.mat_khau');
    }
    if (!names.has('vai_tro')) {
      await pool.query("ALTER TABLE thanh_vien ADD COLUMN vai_tro ENUM('ADMIN','BCN','MEMBER') NULL");
      console.log('[Migrate] Đã thêm cột thanh_vien.vai_tro');
    }
  } catch (e) {
    console.error('[Migrate] Lỗi kiểm tra/thêm cột thanh_vien:', dbErr(e));
  }

  // 2. Bảng lưu OTP đặt lại mật khẩu
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS dat_lai_mat_khau (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255),
      otp_hash VARCHAR(255),
      het_han DATETIME,
      da_dung TINYINT DEFAULT 0,
      tao_luc DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    console.error('[Migrate] Lỗi tạo bảng dat_lai_mat_khau:', dbErr(e));
  }

  // 3. Bảng cài đặt hệ thống (khóa quỹ...) — có thể đã tồn tại trên Aiven
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS cai_dat_he_thong (
      khoa VARCHAR(64) PRIMARY KEY,
      gia_tri TEXT
    )`);
  } catch (e) {
    console.error('[Migrate] Lỗi tạo bảng cai_dat_he_thong:', dbErr(e));
  }
}

/**
 * Bootstrap tài khoản quản trị từ env BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD.
 * Có user theo email → cấp lại mật khẩu + vai trò ADMIN. Không → tạo mới.
 */
async function bootstrapAdmin(pool) {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email || !password) return; // không bật → bỏ qua im lặng

  try {
    const hash = await bcrypt.hash(password, 10);
    const [rows] = await pool.query('SELECT id FROM thanh_vien WHERE email = ? LIMIT 1', [email]);
    if (rows.length) {
      await pool.query("UPDATE thanh_vien SET mat_khau = ?, vai_tro = 'ADMIN' WHERE id = ?", [hash, rows[0].id]);
      console.log(`[Bootstrap] Đã cấp quyền ADMIN + cập nhật mật khẩu cho tài khoản: ${email}`);
    } else {
      const maTv = 'IP' + String(Date.now()).slice(-6);
      await pool.query(
        "INSERT INTO thanh_vien (ma_tv, ho_ten, email, vai_tro, trang_thai_hd, mat_khau) VALUES (?, 'Quản trị viên', ?, 'ADMIN', 'Đang hoạt động', ?)",
        [maTv, email, hash]
      );
      console.log(`[Bootstrap] Đã tạo tài khoản quản trị mới: ${email} (ma_tv=${maTv})`);
    }
  } catch (e) {
    console.error('[Bootstrap] Lỗi tạo/cập nhật tài khoản quản trị:', dbErr(e));
  }
}

module.exports = { setupAuthApi, ensureAuthSchema, bootstrapAdmin, bearerAuth };
