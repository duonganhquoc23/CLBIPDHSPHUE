const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// ====================================================================
// CẤU HÌNH KẾT NỐI DATABASE — đọc từ biến môi trường (env-first)
// Hỗ trợ: TiDB Cloud (mặc định), Aiven MySQL, hoặc MySQL thường.
//
//   TiDB Cloud (Starter/Serverless):
//     DB_HOST=gateway01.<region>.prod.aws.tidbcloud.com   (vd: gateway01.ap-southeast-1.prod.aws.tidbcloud.com)
//     DB_PORT=4000
//     DB_USER=<prefix>.root                                (vd: 3PfaEGhDjfKZbPG.root)
//     DB_PASSWORD=mật-khẩu-tidb
//     DB_NAME=test
//     (TLS bật mặc định — TiDB Cloud dùng chứng chỉ công khai, KHÔNG cần file CA riêng)
//
//   Aiven MySQL (cấu hình cũ):
//     DB_HOST=mysql-xxxx.aivencloud.com
//     DB_PORT=19088
//     DB_USER=avnadmin
//     DB_SSL_CA=ca.pem                                     (file nằm cạnh db.js)
// ====================================================================

/**
 * Xây cấu hình SSL từ env:
 * - DB_SSL=false            → tắt TLS (chỉ dùng cho MySQL local không SSL).
 * - DB_SSL_CA=<file>        → dùng chứng chỉ CA riêng (vd Aiven) nếu file tồn tại.
 * - Mặc định (TiDB Cloud)   → TLS chuẩn với CA công khai, min TLS 1.2.
 */
function buildSslConfig() {
    if (String(process.env.DB_SSL || 'true').trim().toLowerCase() === 'false') {
        return undefined;
    }
    const caPath = (process.env.DB_SSL_CA || '').trim();
    if (caPath) {
        const caFile = path.isAbsolute(caPath) ? caPath : path.join(__dirname, caPath);
        if (fs.existsSync(caFile)) {
            return { ca: fs.readFileSync(caFile), minVersion: 'TLSv1.2' };
        }
        console.warn(`[DB] Cảnh báo: DB_SSL_CA="${caPath}" nhưng file không tồn tại — fallback sang TLS chuẩn (CA công khai).`);
    }
    return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || '',
    port: Number(process.env.DB_PORT || 4000),          // TiDB Cloud dùng 4000 (Aiven thường 19088)
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'test',            // TiDB Starter mặc định có database "test"
    dateStrings: true,                                  // Trả DATE/DATETIME dạng chuỗi gốc — giữ tương thích UI cũ
    ssl: buildSslConfig(),
    waitForConnections: true,
    connectionLimit: 10,                                // TiDB Starter giới hạn kết nối — giữ mức an toàn
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

// Chạy thử kiểm tra kết nối (lỗi chỉ log — KHÔNG làm crash process)
pool.getConnection()
    .then(conn => {
        console.log("⚡ Kết nối Database thành công!");
        conn.release();
    })
    .catch(err => {
        console.error("❌ Lỗi kết nối Database:", err && err.code ? `${err.code}: ${err.message}` : err.message);
    });

module.exports = pool;
