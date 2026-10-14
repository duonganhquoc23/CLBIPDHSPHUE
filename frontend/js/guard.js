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
 *  6. Tự chèn nút ĐĂNG XUẤT vào trang: ưu tiên cuối sidebar admin (.sidebar-menu),
 *     thanh nav thành viên (.nav-actions), nếu không có → nút nổi góc phải dưới.
 *     Đăng xuất = xóa 3 key clbip_* (JWT stateless, không có session phía server cần thu hồi)
 *     → về login.html kèm ?next= trang hiện tại.
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

  // ---------- 6. Tự chèn nút ĐĂNG XUẤT ----------
  var LOGOUT_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
    '<polyline points="16 17 21 12 16 7"></polyline>' +
    '<line x1="21" y1="12" x2="9" y2="12"></line></svg>';

  function doLogout(e) {
    if (e && e.preventDefault) e.preventDefault();
    clearSession();
    hardRedirect(LOGIN_PATH + '?next=' + encodeURIComponent(location.pathname + (location.search || '')));
  }

  function makeLogoutEl() {
    var el = document.createElement('a');
    el.id = 'clbip-logout-btn';
    el.href = '#';
    el.setAttribute('role', 'button');
    el.title = 'Đăng xuất khỏi hệ thống';
    el.innerHTML = LOGOUT_ICON + '<span>Đăng xuất</span>';
    el.addEventListener('click', doLogout);
    return el;
  }

  function injectLogoutButton() {
    if (document.getElementById('clbip-logout-btn')) return;

    // (a) Sidebar các trang admin: mục cuối trong .sidebar-menu, cùng phong cách menu
    var sidebarMenu = document.querySelector('.sidebar .sidebar-menu') || document.querySelector('.sidebar-menu');
    if (sidebarMenu) {
      var item = makeLogoutEl();
      item.setAttribute('style',
        'display:flex;align-items:center;gap:12px;padding:13px 20px;margin-top:6px;' +
        'border-radius:10px;color:#475569;font-size:15px;font-weight:500;cursor:pointer;' +
        'text-decoration:none;transition:background .18s,color .18s;');
      item.addEventListener('mouseenter', function () {
        item.style.background = '#14509b'; item.style.color = '#fff';
      });
      item.addEventListener('mouseleave', function () {
        item.style.background = 'transparent'; item.style.color = '#475569';
      });
      sidebarMenu.appendChild(item);
      return;
    }

    // (b) Thanh điều hướng các trang thành viên: nút Outline trong .nav-actions
    var navActions = document.querySelector('.nav-actions');
    if (navActions) {
      var btn = makeLogoutEl();
      btn.setAttribute('style',
        'display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border:1.5px solid #e2e8f0;' +
        'border-radius:10px;background:#fff;color:#334155;font-size:14px;font-weight:600;cursor:pointer;' +
        'text-decoration:none;transition:background .18s,color .18s,border-color .18s;');
      btn.addEventListener('mouseenter', function () {
        btn.style.background = '#fee2e2'; btn.style.color = '#b91c1c'; btn.style.borderColor = '#fecaca';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.background = '#fff'; btn.style.color = '#334155'; btn.style.borderColor = '#e2e8f0';
      });
      navActions.appendChild(btn);
      return;
    }

    // (c) Dự phòng: nút nổi góc phải dưới cho layout lạ
    var float = makeLogoutEl();
    float.setAttribute('style',
      'position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;' +
      'padding:12px 22px;border-radius:999px;background:#dc2626;color:#fff;font-size:14px;font-weight:600;' +
      'box-shadow:0 8px 24px rgba(220,38,38,.35);cursor:pointer;text-decoration:none;');
    document.body.appendChild(float);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLogoutButton);
  } else {
    injectLogoutButton();
  }
})();
