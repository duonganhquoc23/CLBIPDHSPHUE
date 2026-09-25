CREATE DATABASE IF NOT EXISTS clb_ip_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE clb_ip_db;

CREATE TABLE thanh_vien (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_tv VARCHAR(20) UNIQUE NOT NULL,
    ho_ten VARCHAR(100) NOT NULL,
    ngay_sinh DATE,
    gioi_tinh ENUM('Nam', 'Nữ') DEFAULT 'Nam',
    mssv VARCHAR(20) UNIQUE NOT NULL,
    lop VARCHAR(50),
    sdt VARCHAR(15),
    email VARCHAR(100),
    trang_thai_hd VARCHAR(50) DEFAULT 'Đang hoạt động'
);

CREATE TABLE quy_clb (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_gd VARCHAR(20) UNIQUE NOT NULL,
    ngay_gd DATE NOT NULL,
    loai_gd ENUM('Thu', 'Chi') NOT NULL,
    noi_dung TEXT NOT NULL,
    so_tien DECIMAL(15,2) NOT NULL,
    nguoi_thuc_hien VARCHAR(100),
    chung_tu_url VARCHAR(255),
    ghi_chu TEXT,
    so_du_hien_tai DECIMAL(15,2) DEFAULT 0
);

CREATE TABLE tai_lieu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nhom ENUM('Chuyên môn', 'Nghiệp vụ', 'Kỹ năng') NOT NULL,
    ten_tai_lieu VARCHAR(255) NOT NULL,
    mo_ta TEXT,
    file_path VARCHAR(255) NOT NULL,
    ngay_tao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ban_chu_nhiem (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nhiem_ky VARCHAR(50) NOT NULL,
    thanh_vien_id INT,
    chuc_vu VARCHAR(100) NOT NULL,
    ban_phu_trach VARCHAR(100),
    trang_thai VARCHAR(50) DEFAULT 'Hoạt động',
    FOREIGN KEY (thanh_vien_id) REFERENCES thanh_vien(id) ON DELETE SET NULL
);

CREATE TABLE bai_dang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    noi_dung TEXT NOT NULL,
    hinh_anh_url VARCHAR(255),
    is_pinned BOOLEAN DEFAULT FALSE,
    ngay_dang TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lich_su_bai_dang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bai_dang_id INT,
    nguoi_thao_tac VARCHAR(100) NOT NULL,
    hanh_dong VARCHAR(50) NOT NULL,
    noi_dung TEXT,
    thoi_gian TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gop_y (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nguoi_gui VARCHAR(100) DEFAULT 'Thành viên ẩn danh',
    noi_dung TEXT NOT NULL,
    ngay_gui TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================= CÁC BẢNG LIÊN QUAN KẾ HOẠCH & SỰ KIỆN =================
CREATE TABLE ke_hoach_sinh_hoat (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_hd VARCHAR(20) UNIQUE NOT NULL,
    ten_hoat_dong VARCHAR(255) NOT NULL,
    thoi_gian DATETIME,
    dia_diem VARCHAR(255),
    noi_dung TEXT,
    ban_phu_trach VARCHAR(100),
    tong_kinh_phi DECIMAL(15,2) DEFAULT 0,
    trang_thai_khoa TINYINT(1) DEFAULT 0,
    ngay_tao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chi_tiet_du_tru (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ke_hoach_id INT,
    noi_dung_chi VARCHAR(255) NOT NULL,
    so_luong INT DEFAULT 1,
    don_gia DECIMAL(15,2) DEFAULT 0,
    thanh_tien DECIMAL(15,2) DEFAULT 0,
    ghi_chu TEXT,
    FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_sinh_hoat(id) ON DELETE CASCADE
);

CREATE TABLE thanh_vien_tham_gia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ke_hoach_id INT,
    mssv VARCHAR(20) NOT NULL,
    vai_tro VARCHAR(100),
    ghi_chu TEXT,
    FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_sinh_hoat(id) ON DELETE CASCADE,
    FOREIGN KEY (mssv) REFERENCES thanh_vien(mssv) ON DELETE CASCADE
);

-- ================= CÁC BẢNG LIÊN QUAN ĐIỂM DANH GPS =================
CREATE TABLE dot_diem_danh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_hoat_dong VARCHAR(255) NOT NULL,
    thoi_gian DATETIME,
    ban_kinh INT DEFAULT 50,
    vi_do DECIMAL(10, 8),
    kinh_do DECIMAL(11, 8),
    trang_thai ENUM('Đang mở', 'Đã đóng') DEFAULT 'Đang mở',
    ngay_tao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chi_tiet_diem_danh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dot_id INT,
    mssv VARCHAR(20) NOT NULL,
    gio_checkin TIME,
    trang_thai ENUM('Có mặt', 'Vắng', 'Có phép', 'Đi muộn') DEFAULT 'Vắng',
    FOREIGN KEY (dot_id) REFERENCES dot_diem_danh(id) ON DELETE CASCADE,
    FOREIGN KEY (mssv) REFERENCES thanh_vien(mssv) ON DELETE CASCADE
);

-- Trigger để tự động tính số dư quỹ khi có giao dịch mới
DELIMITER //
CREATE TRIGGER before_insert_quy_clb
BEFORE INSERT ON quy_clb
FOR EACH ROW
BEGIN
    DECLARE last_balance DECIMAL(15,2);
    SELECT so_du_hien_tai INTO last_balance FROM quy_clb ORDER BY id DESC LIMIT 1;
    IF last_balance IS NULL THEN SET last_balance = 0; END IF;
    
    IF NEW.loai_gd = 'Thu' THEN
        SET NEW.so_du_hien_tai = last_balance + NEW.so_tien;
    ELSE
        SET NEW.so_du_hien_tai = last_balance - NEW.so_tien;
    END IF;
END //
DELIMITER ;