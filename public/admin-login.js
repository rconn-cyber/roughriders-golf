// admin-login.js  — drop into the same folder as admin.html
// Replaces the old hardcoded-password prompt with a server-verified token flow.
//
// USAGE in admin.html:
//   1. Remove the old inline password check block entirely.
//   2. Add this at the TOP of your <script> section (before any admin UI code):
//        import { requireAdminAuth, getAdminToken } from './admin-login.js';
//        await requireAdminAuth();          // redirects to login if not authed
//   3. When calling Netlify functions that need auth, pass the token:
//        const token = getAdminToken();
//        fetch('/.netlify/functions/some-fn', {
//          headers: { 'x-admin-token': token }
//        });

const TOKEN_KEY = 'rr_golf_admin_token';
const AUTH_FUNCTION = '/.netlify/functions/admin-auth';

/**
 * Returns the stored token, or null if not present / expired.
 * Token format: "<expiresTimestamp>.<hmacSig>"
 */
export function getAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY) || null;
}

function isTokenExpired(token) {
  if (!token) return true;
  const expires = Number(token.split('.')[0]);
  return Date.now() > expires;
}

/**
 * Call at the top of admin page JS.
 * If the user has a valid stored token → resolves immediately.
 * Otherwise → shows the login overlay, resolves after successful login.
 */
export async function requireAdminAuth() {
  const stored = getAdminToken();
  if (stored && !isTokenExpired(stored)) return; // already authed

  sessionStorage.removeItem(TOKEN_KEY);
  return new Promise((resolve) => {
    showLoginOverlay(async (password) => {
      const result = await attemptLogin(password);
      if (result.ok) {
        sessionStorage.setItem(TOKEN_KEY, result.token);
        hideLoginOverlay();
        resolve();
      } else {
        showLoginError(result.error);
      }
    });
  });
}

/**
 * Call on "Log out" button.
 */
export function adminLogout() {
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
}

async function attemptLogin(password) {
  try {
    const res = await fetch(AUTH_FUNCTION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, token: data.token };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || 'Incorrect password. Try again.' };
  } catch {
    return { ok: false, error: 'Connection error. Check your network.' };
  }
}

// ── Login overlay UI ────────────────────────────────────────────────────────

function showLoginOverlay(onSubmit) {
  if (document.getElementById('admin-login-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'admin-login-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.7);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;font-family:system-ui,sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:10px;padding:2rem 2.5rem;width:340px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="text-align:center;margin-bottom:1.5rem">
        <span style="font-size:2rem">⛳</span>
        <h1 style="font-size:1.1rem;font-weight:600;margin:.5rem 0 .25rem">RR Golf Admin</h1>
        <p style="font-size:.85rem;color:#666;margin:0">Enter your admin password to continue.</p>
      </div>
      <input
        id="admin-pw-input"
        type="password"
        placeholder="Admin password"
        autocomplete="current-password"
        style="width:100%;box-sizing:border-box;padding:.6rem .8rem;border:1px solid #ccc;border-radius:6px;font-size:1rem;margin-bottom:.75rem;outline:none"
      />
      <div id="admin-login-error" style="display:none;color:#c0392b;font-size:.82rem;margin-bottom:.6rem;text-align:center"></div>
      <button
        id="admin-login-btn"
        style="width:100%;padding:.65rem;background:#2d6a4f;color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer"
      >Enter Dashboard</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#admin-pw-input');
  const btn = overlay.querySelector('#admin-login-btn');

  async function submit() {
    const pw = input.value;
    if (!pw) { input.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Checking…';
    await onSubmit(pw);
    btn.disabled = false;
    btn.textContent = 'Enter Dashboard';
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 50);
}

function hideLoginOverlay() {
  document.getElementById('admin-login-overlay')?.remove();
}

function showLoginError(msg) {
  const el = document.getElementById('admin-login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  document.getElementById('admin-pw-input')?.focus();
}
