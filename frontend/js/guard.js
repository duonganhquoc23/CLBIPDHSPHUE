/**
 * guard.js — Gác cửa phiên đăng nhập phía client (độc lập, không phụ thuộc file js khác)
 * =====================================================================================
 * Cách dùng: <script src="/frontend/js/guard.js" data-roles="ADMIN,BCN"></script>
 * Đặt NGAY SAU thẻ <head> mở để chạy trước mọi nội dung trang.
 *
 * Nhiệm vụ:
 *  1. Chưa có token            → đá về login.html?next=<trang hiện tại>, dừng tải trang.
 *  2. Token hết hạn (exp)      → xóa 3 key clbip_* → login.html?expired=1&next=...
 *  3. Sai vai trò (data-roles) → chuyển về trang nhà đúng vai trò.
 *  4. Monkey-patch window.fetch: tự gắn Authorization cho mọi request cùng origin
 *     bắt đầu bằng /api/ (trừ /api/v1/auth/) — KHÔNG đụng Content-Type (an toàn multipart).
 *  5. Export window.PageGuard.getUser() để trang đọc thông tin user từ localStorage.
 *
 * LƯU Ý: JWT chỉ được decode (base64url) để ĐỌC exp + role, KHÔNG verify chữ ký —
 * việc verify thật nằm ở server (middleware bearerAuth bảo vệ mọi endpoint /api/*).
 */
(function () {
  'use strict';

  // Trang login thì guard tự thoát
  if (location.pathname === '/frontend/login.html') return;

  var LOGIN_PATH = '/frontend/login.html';
  var ROLE_HOME = {
    ADMIN: '/trang_chu.html',
    BCN: '/trang_chu.html',
    MEMBER: '/thanhvien/trang_chu_tv.html'
  };
  var SESSION_KEYS = ['clbip_access_token', 'clbip_refresh_token', 'clbip_user_info'];

  /** Danh sách vai trò được phép của trang (từ data-roles của thẻ script hiện tại) */
  var allowed = [];
  try {
    var attr = document.currentScript && document.currentScript.getAttribute('data-roles');
    if (attr) {
      allowed = attr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
  } catch (e) { /* không có data-roles → chỉ yêu cầu đăng nhập */ }

  function getToken() {
    try { return localStorage.getItem('clbip_access_token'); } catch (e) { return null; }
  }

  function clearSession() {
    SESSION_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* bỏ qua */ }
    });
  }

  /** Dừng hẳn trang hiện tại rồi chuyển hướng (xóa DOM + window.stop) */
  function hardRedirect(url) {
    try {
      document.documentElement.innerHTML = '';
      window.stop();
    } catch (e) { /* bỏ qua */ }
    window.location.href = url;
  }

  function goLogin(extraQuery) {
    var next = encodeURIComponent(location.pathname + (location.search || ''));
    hardRedirect(LOGIN_PATH + (extraQuery ? '?' + extraQuery + '&' : '?') + 'next=' + next);
  }

  /** Decode payload JWT (base64url → JSON), KHÔNG verify chữ ký — chỉ đọc exp + role */
  function decodeJwtPayload(token) {
    try {
      var base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = decodeURIComponent(
        atob(base64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  // ---------- 1. Bắt buộc đã đăng nhập ----------
  var token = getToken();
  if (!token) {
    goLogin('');
    return;
  }

  // ---------- 2. Kiểm tra hạn token (exp) ----------
  var payload = decodeJwtPayload(token);
  if (!payload || !payload.exp || payload.exp * 1000 <= Date.now()) {
    clearSession();
    goLogin('expired=1');
    return;
  }

  // ---------- 3. Kiểm tra vai trò được phép ----------
  if (allowed.length > 0 && (!payload.role || allowed.indexOf(payload.role) === -1)) {
    // Đúng người, sai cửa → về trang nhà theo vai trò
    var home = ROLE_HOME[payload.role] || LOGIN_PATH;
    hardRedirect(home);
    return;
  }

  // ---------- 4. Monkey-patch fetch: tự gắn Bearer token cho /api/* cùng origin ----------
  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var isSameOriginApi = url.indexOf('/api/') === 0 && url.indexOf('/api/v1/auth/') !== 0;
        if (isSameOriginApi) {
          init = init || {};
          // Gộp headers có sẵn (Request hoặc init), KHÔNG đụng Content-Type (an toàn multipart)
          var headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has('Authorization')) {
            var t = getToken();
            if (t) headers.set('Authorization', 'Bearer ' + t);
          }
          init.headers = headers;
        }
      } catch (e) { /* lỗi gắn header không được chặn request gốc */ }
      return originalFetch(input, init);
    };
  }

  // ---------- 5. Export tiện đọc thông tin user ----------
  window.PageGuard = {
    /** Thông tin user đã cache lúc đăng nhập (parsed từ clbip_user_info) */
    getUser: function () {
      try {
        return JSON.parse(localStorage.getItem('clbip_user_info') || 'null');
      } catch (e) {
        return null;
      }
    }
  };
})();
