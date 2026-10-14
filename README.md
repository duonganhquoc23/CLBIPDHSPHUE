# CLBIPDHSPHUE — Hệ thống quản lý CLB IP ĐHSP Huế

Hệ thống quản lý câu lạc bộ Tin học & Sư phạm (CLB IP), Trường Đại học Sư phạm, Đại học Huế, viết bằng **Node.js (Express 5) + MySQL (TiDB Cloud)** — tương thích cả Aiven MySQL, MariaDB, MySQL thường.

## Chức năng chính

- **Landing page công khai** (`/`) giới thiệu câu lạc bộ.
- **Đăng nhập** (`/frontend/login.html`) bằng **Email hoặc MSSV** — JWT access 30 phút + refresh 7 ngày, mật khẩu băm bcrypt, rate-limit chống dò mật khẩu.
- **Dashboard Ban chủ nhiệm** (`/trang_chu.html` + 6 trang trong `bcn/`): quản lý thành viên, ban chủ nhiệm, điểm danh GPS, kế hoạch sinh hoạt, quỹ club, tài liệu, bảng tin, hòm thư góp ý, kế hoạch truyền thông.
- **Cổng thành viên** (3 trang trong `thanhvien/`): xem bảng tin, điểm danh, tải tài liệu.
- **API** gồm 37 endpoint `/api/*` cũ (được bảo vệ bằng Bearer JWT) + nhóm auth mới `/api/v1/auth/*` (đăng nhập, refresh, hồ sơ, quên mật khẩu qua OTP).
- **Health check** `GET /api/health` phục vụ deploy trên Render.

## Cấu trúc thư mục

```
CLBIPDHSPHUE/
├── server.js            # App Express: middleware, static, 37 API cũ, health check
├── auth.js              # API xác thực /api/v1/auth/* + middleware bảo vệ /api/* + auto-migrate
├── schema.js            # Tự tạo toàn bộ bảng lõi lúc boot (rỗng DB cũng chạy ngay)
├── db.js                # Pool MySQL2 đọc từ env — hỗ trợ TiDB Cloud / Aiven / MySQL
├── ca.pem               # Chứng chỉ SSL Aiven (chỉ cần khi dùng Aiven — không được public qua HTTP)
├── backend/             # Schema SQL: clb_ip_db.sql (gốc) + clb_ip_db_tidb.sql (TiDB-safe)
├── render.yaml          # Render Blueprint — deploy 1 click
├── trang_chu.html       # Dashboard BCN (yêu cầu vai trò ADMIN/BCN)
├── bcn/                 # 6 trang quản lý của Ban chủ nhiệm (ADMIN/BCN)
├── thanhvien/           # 3 trang cổng thành viên (ADMIN/BCN/MEMBER)
├── frontend/            # UI mới port từ dự án clbIP: landing, login, redirect
│   ├── landing.html     # Trang chủ công khai
│   ├── login.html       # Trang đăng nhập
│   ├── index.html       # Trang chuyển hướng theo vai trò
│   ├── css/             # 7 file CSS (variables, base, components, glassmorphism, member, responsive, landing)
│   ├── js/              # api.js, auth.js, toast.js, utils.js, icons.js, guard.js
│   └── assets/          # Logo, favicon, ảnh landing (hero, gallery, leaders)
├── hinhanh/             # Ảnh của câu lạc bộ (logo, ảnh bìa)
└── uploads/             # File thành viên upload (tài liệu, ảnh bảng tin)
```

## Chạy trên máy local

1. Cài Node.js ≥ 18, rồi:

   ```bash
   npm install
   ```

2. Tạo file `.env` cùng cấp `server.js` (ví dụ với TiDB Cloud):

   ```env
   PORT=3000
   DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
   DB_PORT=4000
   DB_USER=3PfaEGhDjfKZbPG.root
   DB_PASSWORD=mật-khẩu-tidb
   DB_NAME=test
   JWT_SECRET=chuỗi-ngẫu-dài-bất-kỳ
   BOOTSTRAP_ADMIN_EMAIL=admin@clb.vn
   BOOTSTRAP_ADMIN_PASSWORD=mật-khẩu-admin
   ```

   - `DB_*`: lấy từ dialog **Connect** của cluster trên tidbcloud.com (host dạng `gateway01.<region>.prod.aws.tidbcloud.com`, user dạng `<prefix>.root`). TLS được bật mặc định, không cần file CA.
   - Dùng Aiven MySQL? Điền host/port/user của Aiven và thêm `DB_SSL_CA=ca.pem` (file đã có sẵn trong repo).
   - `JWT_SECRET`: khóa ký JWT — bắt buộc khi chạy thật.
   - `BOOTSTRAP_ADMIN_*`: (khuyến nghị) lúc khởi động, hệ thống tự tạo/cập nhật tài khoản ADMIN với email + mật khẩu này.

3. Chạy và mở trình duyệt:

   ```bash
   npm start
   # mở http://127.0.0.1:3000
   ```

Lần đầu khởi động, hệ thống **tự tạo toàn bộ schema** (12 bảng lõi + cột `mat_khau`, `vai_tro` + bảng `dat_lai_mat_khau`, `cai_dat_he_thong`) — database trống cũng chạy được ngay, không cần chạy SQL tay.

## Deploy lên Render bằng Blueprint

1. Push repo này lên GitHub (đã có sẵn `render.yaml` ở gốc).
2. Trên Render dashboard, nhấn **New +** → **Blueprint**.
3. Chọn repository (nếu chưa thấy, nhấn **Configure account** để cấp quyền truy cập repo).
4. Render đọc `render.yaml` và hiện dialog các biến môi trường. Điền 5 ô:
   - **DB_HOST**: host TiDB Cloud — copy từ dialog **Connect** của cluster (vd `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`).
   - **DB_USER**: user TiDB Cloud (vd `3PfaEGhDjfKZbPG.root`).
   - **DB_PASSWORD**: mật khẩu TiDB Cloud đã đặt khi tạo cluster.
   - **BOOTSTRAP_ADMIN_EMAIL** và **BOOTSTRAP_ADMIN_PASSWORD**: khuyến nghị điền ngay để có tài khoản quản trị đầu tiên.
   - `DB_PORT` (4000), `DB_NAME` (test), `DB_SSL` (true) đã điền sẵn; `JWT_SECRET` tự sinh.
5. Nhấn **Apply**. Render chạy `npm ci` rồi `npm start`; server tự tạo bảng trong database lúc boot; service chỉ được coi là sống khi `GET /api/health` trả 200 (kiểm tra log có dòng `[Schema] Schema lõi sẵn sàng...` và `⚡ Kết nối Database thành công!`).
6. Sau khi deploy xong, vào `https://<tên-service>.onrender.com/` → đăng nhập bằng tài khoản admin đã cấu hình.

### Chuyển database sang TiDB Cloud (hoặc từ Aiven cũ)

- **TiDB Cloud**: tạo cluster tại [tidbcloud.com](https://tidbcloud.com) (gói Starter miễn phí, chọn region gần nhất vd Singapore). Vào cluster → **Connect** → *Connect with: Node.js / General* để lấy host, user, password. Database dùng luôn `test` hoặc tạo database riêng rồi đặt `DB_NAME` theo.
- **Mang dữ liệu cũ từ Aiven sang**: xuất dữ liệu từ Aiven (mysqldump chỉ `INSERT` hoặc qua phpMyAdmin/Workbench), rồi nạp vào TiDB bằng SQL Editor hoặc **Import** của cluster. Vì server đã tự tạo bảng, chỉ cần nạp `INSERT` dữ liệu — không chạy lại `CREATE TABLE` của dump cũ (dump cũ có trigger, TiDB không hỗ trợ).
- **Quay lại Aiven**: giữ nguyên mọi thứ, chỉ đổi `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` về giá trị Aiven và thêm biến `DB_SSL_CA=ca.pem`.

## Bảng biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `PORT` | không | Cổng HTTP (Render tự gán; mặc định 3000 khi chạy local) |
| `DB_HOST` | có | Host database — TiDB Cloud: `gateway01.<region>.prod.aws.tidbcloud.com` |
| `DB_PORT` | có | Port database — TiDB Cloud: `4000` (Aiven: `19088`) — được ép kiểu số khi đọc |
| `DB_USER` | có | User database — TiDB Cloud: `<prefix>.root` (Aiven: `avnadmin`) |
| `DB_PASSWORD` | có | Mật khẩu database — **không commit vào repo** (`sync: false` trên Render) |
| `DB_NAME` | có | Tên database — TiDB Cloud: `test` (mặc định, app tự tạo bảng) |
| `DB_SSL` | không | Bật TLS (mặc định `true` — TiDB Cloud bắt buộc TLS) |
| `DB_SSL_CA` | không | Đường dẫn file CA riêng (chỉ cần cho Aiven: `ca.pem`) |
| `JWT_SECRET` | có trên production | Khóa ký JWT — Render tự sinh qua Blueprint |
| `BOOTSTRAP_ADMIN_EMAIL` | khuyến nghị | Email tài khoản ADMIN tạo lúc boot |
| `BOOTSTRAP_ADMIN_PASSWORD` | khuyến nghị | Mật khẩu tài khoản ADMIN tạo lúc boot |

## Phân quyền & bảo mật

- Client: `frontend/js/guard.js` gác mỗi trang (đọc JWT, kiểm tra hạn + vai trò qua `data-roles`), tự gắn header `Authorization: Bearer ...` cho mọi fetch `/api/*`.
- Server: middleware `bearerAuth` trong `auth.js` bảo vệ **toàn bộ `/api/*`** (trừ `/api/health` và `/api/v1/auth/*`), từ chối 401 với envelope chuẩn nếu thiếu/sai token.
- Vai trò: `ADMIN`, `BCN`, `MEMBER` — tự suy từ bảng `ban_chu_nhiem` nếu thành viên chưa có cột `vai_tro` và được lưu ngược vào DB.
- Thư mục static được mount **chọn lọc** (`/frontend`, `/bcn`, `/thanhvien`, `/hinhanh`, `/uploads`) — file nhạy cảm ở gốc (`server.js`, `ca.pem`, `.env`, `backend/*.sql`) không bao giờ được serve.

## Hạn chế hiện tại

- **Thư mục `uploads/` trên Render free là ephemeral**: mất khi service restart. Nếu cần lưu trữ bền, hãy gắn Render Disk và đổi đường dẫn upload sang disk mount.
- **Quên mật khẩu chưa có email thật (SMTP)**: mã OTP được in ra log của service (`[OTP] email=... mã ...`) — Ban chủ nhiệm cần chuyển tiếp thủ công cho thành viên, hoặc nâng cấp gửi email sau.
- **CORS đang mở `*`** để tránh vỡ các trang cũ; khi đã có domain Render chính thức, nên thay bằng whitelist origin.
- Nên **đổi mật khẩu admin** sau lần đăng nhập đầu tiên (đặt `BOOTSTRAP_ADMIN_*` một lần rồi gỡ env này khỏi service).
