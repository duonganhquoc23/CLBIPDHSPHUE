const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Đọc file chứng chỉ SSL (file ca.pem phải nằm cùng thư mục với file db.js này)
const caCert = fs.readFileSync(path.join(__dirname, 'ca.pem'));

// Khởi tạo kết nối đến Aiven
const pool = mysql.createPool({
    host: 'mysql-297dc313-clbipkth-79ea.e.aivencloud.com',        // Dạng: mysql-xxxx-xxx.aivencloud.com
    port: 19088,                           // Port của bạn (thường là 19088 hoặc tương tự)
    user: 'avnadmin',
    password: '', // Lấy ở mục Connection information trên Aiven
    database: 'clb_ip_db',                 // Tên database bạn đã import
    ssl: {
        ca: caCert
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Chạy thử kiểm tra kết nối
pool.getConnection()
    .then(conn => {
        console.log("⚡ Kết nối Database Aiven thành công!");
        conn.release(); 
    })
    .catch(err => {
        console.error("❌ Lỗi kết nối Database:", err);
    });

module.exports = pool;