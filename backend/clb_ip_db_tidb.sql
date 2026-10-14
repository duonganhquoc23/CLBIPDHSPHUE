-- ============================================================================
-- CLB IP ĐHSP Huế — Schema tương thích TiDB Cloud (bản 2.0, 2026-10)
-- ----------------------------------------------------------------------------
-- KHÁC BIỆT với clb_ip_db.sql (bản MySQL/Aiven):
--   * KHÔNG có CREATE DATABASE / USE (chạy trực tiếp trong database đã chọn,
--     phù hợp cả SQL Editor lẫn tính năng Import của TiDB Cloud)
--   * KHÔNG có FOREIGN KEY + TRIGGER (TiDB Cloud Starter không hỗ trợ trigger;
--     ứng dụng tự quản lý quan hệ. Dashboard tự tính số dư quỹ bằng SUM)
--   * Dùng CREATE TABLE IF NOT EXISTS — chạy lại nhiều lần không lỗi
--
-- LƯU Ý: KHÔNG BẮT BUỘC import file này! Server tự tạo toàn bộ bảng lúc boot.
-- File này chỉ dành cho ai muốn tạo schema tay hoặc nạp dữ liệu thủ công.
-- ============================================================================

-- ============ NHÓM THÀNH VIÊN & QUỸ ============
CREATE TABLE IF NOT EXISTS thanh_vien (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_tv VARCHAR(20) UNIQUE NOT NULL,
    ho_ten VARCHAR(100) NOT NULL,
    ngay_sinh DATE NULL,
    gioi_tinh ENUM('Nam', 'Nữ') DEFAULT 'Nam',
    mssv VARCHAR(20) UNIQUE NOT NULL,
    lop VARCHAR(50) NULL,
    sdt VARCHAR(15) NULL,
    email VARCHAR(100) NULL,
    trang_thai_hd VARCHAR(50) DEFAULT 'Đang hoạt động'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quy_clb (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_gd VARCHAR(20) UNIQUE NOT NULL,
    ngay_gd DATE NOT NULL,
    loai_gd ENUM('Thu', 'Chi') NOT NULL,
    noi_dung TEXT NOT NULL,
    so_tien DECIMAL(15,2) NOT NULL,
    nguoi_thuc_hien VARCHAR(100) NULL,
    chung_tu_url VARCHAR(255) NULL,
    ghi_chu TEXT NULL,
    so_du_hien_tai DECIMAL(15,2) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tai_lieu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nhom ENUM('Chuyên môn', 'Nghiệp vụ', 'Kỹ năng') NOT NULL,
    ten_tai_lieu VARCHAR(255) NOT NULL,
    mo_ta TEXT NULL,
    file_path VARCHAR(255) NOT NULL,
    ngay_tao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ban_chu_nhiem (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nhiem_ky VARCHAR(50) NOT NULL,
    thanh_vien_id INT NULL,
    chuc_vu VARCHAR(100) NOT NULL,
    ban_phu_trach VARCHAR(100) NULL,
    trang_thai VARCHAR(50) DEFAULT 'Hoạt động'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ NHÓM BẢNG TIN ============
CREATE TABLE IF NOT EXISTS bai_dang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    noi_dung TEXT NOT NULL,
    hinh_anh_url VARCHAR(255) NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    ngay_dang TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lich_su_bai_dang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bai_dang_id INT NULL,
    nguoi_thao_tac VARCHAR(100) NOT NULL,
    hanh_dong VARCHAR(50) NOT NULL,
    noi_dung TEXT NULL,
    thoi_gian TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gop_y (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nguoi_gui VARCHAR(100) DEFAULT 'Thành viên ẩn danh',
    noi_dung TEXT NOT NULL,
    ngay_gui TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ NHÓM KẾ HOẠCH & SỰ KIỆN ============
CREATE TABLE IF NOT EXISTS ke_hoach_sinh_hoat (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_hd VARCHAR(20) UNIQUE NOT NULL,
    ten_hoat_dong VARCHAR(255) NOT NULL,
    thoi_gian DATETIME NULL,
    dia_diem VARCHAR(255) NULL,
    noi_dung TEXT NULL,
    ban_phu_trach VARCHAR(100) NULL,
    tong_kinh_phi DECIMAL(15,2) DEFAULT 0,
    trang_thai_khoa TINYINT(1) DEFAULT 0,
    ngay_tao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chi_tiet_du_tru (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ke_hoach_id INT NULL,
    noi_dung_chi VARCHAR(255) NOT NULL,
    so_luong INT DEFAULT 1,
    don_gia DECIMAL(15,2) DEFAULT 0,
    thanh_tien DECIMAL(15,2) DEFAULT 0,
    ghi_chu TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thanh_vien_tham_gia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ke_hoach_id INT NULL,
    mssv VARCHAR(20) NOT NULL,
    vai_tro VARCHAR(100) NULL,
    ghi_chu TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ NHÓM ĐIỂM DANH GPS ============
CREATE TABLE IF NOT EXISTS dot_diem_danh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_hoat_dong VARCHAR(255) NOT NULL,
    thoi_gian DATETIME NULL,
    ban_kinh INT DEFAULT 50,
    vi_do DECIMAL(10, 8) NULL,
    kinh_do DECIMAL(11, 8) NULL,
    trang_thai ENUM('Đang mở', 'Đã đóng') DEFAULT 'Đang mở',
    ngay_tao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chi_tiet_diem_danh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dot_id INT NULL,
    mssv VARCHAR(20) NOT NULL,
    gio_checkin TIME NULL,
    trang_thai ENUM('Có mặt', 'Vắng', 'Có phép', 'Đi muộn') DEFAULT 'Vắng'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
