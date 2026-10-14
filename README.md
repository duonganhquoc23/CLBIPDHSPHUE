# CLBIPDHSPHUE — Hệ thống quản lý CLB IP ĐHSP Huế

Hệ thống quản lý câu lạc bộ Tin học & Sư phạm (CLB IP), Trường Đại học Sư phạm, Đại học Huế, viết bằng **Node.js (Express 5) + MySQL (Aiven)**.

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
├── db.js                # (không dùng bởi server.js) cấu hình pool mẫu
├── ca.pem               # Chứng chỉ SSL kết nối MySQL Aiven (không được public qua HTTP)
├── backend/             # Schema SQL gốc (clb_ip_db.sql) — chỉ tham khảo
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

2. Tạo file `.env` cùng cấp `server.js`:

   ```env
   PORT=3000
   DB_HOST=mysql-xxxx-xxxx.aivencloud.com
   DB_PORT=19088
   DB_USER=avnadmin
   DB_PASSWORD=mật-khẩu-aiven
   DB_NAME=clb_ip_db
   JWT_SECRET=chuỗi-ngẫu-dài-bất-kỳ
   BOOTSTRAP_ADMIN_EMAIL=admin@clb.vn
   BOOTSTRAP_ADMIN_PASSWORD=mật-khẩu-admin
   ```

   - `DB_*`: thông tin kết nối MySQL Aiven (file `ca.pem` phải nằm cạnh `server.js`).
   - `JWT_SECRET`: khóa ký JWT — bắt buộc khi chạy thật.
   - `BOOTSTRAP_ADMIN_*`: (khuyến nghị) lúc khởi động, hệ thống tự tạo/cập nhật tài khoản ADMIN với email + mật khẩu này.

3. Chạy và mở trình duyệt:

   ```bash
   npm start
   # mở http://127.0.0.1:3000
   ```

Lần đầu khởi động, hệ thống **tự migrate** (thêm cột `mat_khau`, `vai_tro` vào `thanh_vien`, tạo bảng `dat_lai_mat_khau`, `cai_dat_he_thong`) — không cần chạy SQL tay.

## Deploy lên Render bằng Blueprint

1. Push repo này lên GitHub (đã có sẵn `render.yaml` ở gốc).
2. Trên Render dashboard, nhấn **New +** → **Blueprint**.
3. Chọn repository (nếu chưa thấy, nhấn **Configure account** để cấp quyền truy cập repo).
4. Render đọc `render.yaml` và hiện dialog các biến môi trường. Điền:
   - **DB_PASSWORD**: mật khẩu user `avnadmin` của Aiven (bắt buộc).
   - **BOOTSTRAP_ADMIN_EMAIL** và **BOOTSTRAP_ADMIN_PASSWORD**: khuyến nghị điền ngay để có tài khoản quản trị đầu tiên.
   - `JWT_SECRET` tự sinh; các biến còn lại đã điền sẵn.
5. Nhấn **Apply**. Render chạy `npm ci` rồi `npm start`; service chỉ được coi là sống khi `GET /api/health` trả 200.
6. Sau khi deploy xong, vào `https://<tên-service>.onrender.com/` → đăng nhập bằng tài khoản admin đã cấu hình.

## Bảng biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `PORT` | không | Cổng HTTP (Render tự gán; mặc định 3000 khi chạy local) |
| `DB_HOST` | có | Host MySQL Aiven |
| `DB_PORT` | có | Port MySQL Aiven (được ép kiểu số khi đọc) |
| `DB_USER` | có | User MySQL (thường `avnadmin`) |
| `DB_PASSWORD` | có | Mật khẩu MySQL — **không commit vào repo** (`sync: false` trên Render) |
| `DB_NAME` | có | Tên database (`clb_ip_db`) |
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
