// Nhúng file cấu hình kết nối bạn vừa làm
const pool = require('./db');

async function getData() {
    try {
        // Lệnh SQL lấy dữ liệu. Hãy thay 'ten_bang_cua_ban' bằng tên một bảng thực tế trong clb_ip_db
        const [rows] = await pool.query('SELECT * FROM thanh_vien');

        console.log("Dữ liệu lấy được từ Aiven:");
        console.log(rows); // In mảng dữ liệu ra màn hình terminal
    } catch (error) {
        console.error("Lỗi khi truy vấn:", error);
    } finally {
        // Tắt tiến trình sau khi in xong kết quả
        process.exit(); 
    }
}

// Chạy hàm
getData();