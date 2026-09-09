// Supabase Auth (email + password). Login only — account creation is disabled in
// the Supabase project, so there is no sign-up path in the app.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SKEY = 'shades-deluxe-auth';

// Auth is only enforced once the project is configured (anon key present).
export function authRequired() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; }
}

export function userEmail() {
  return getSession()?.user?.email || '';
}

// The name shown on avatars and next to someone's cursor. Set per user in Supabase
// (Authentication → Users → user metadata `display_name`), never hardcoded here —
// the email local part is only a fallback for an account that has not been given one.
export function displayName() {
  const u = getSession()?.user;
  return u?.user_metadata?.display_name || u?.user_metadata?.full_name || (u?.email || 'you').split('@')[0];
}

// A session stored before the display name was set still carries the old metadata,
// and it would not refresh until the token expired. Ask the server for the current
// user once at startup so the right name shows immediately.
export async function refreshUser() {
  const s = getSession();
  if (!s?.access_token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token },
    });
    if (!r.ok) return false;
    const user = await r.json();
    localStorage.setItem(SKEY, JSON.stringify({ ...s, user }));
    return true;
  } catch { return false; }
}

// Token used for authenticated PostgREST calls (falls back to anon before login).
export function accessToken() {
  return getSession()?.access_token || SUPABASE_ANON_KEY;
}

export async function login(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.msg || data.error || 'Login failed');
  localStorage.setItem(SKEY, JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user,
  }));
}

export function logout() {
  localStorage.removeItem(SKEY);
  location.reload();
}

// True if we have a valid (or refreshable) session. Refreshes silently near expiry
// so the user isn't kicked out every hour.
export async function ensureSession() {
  if (!authRequired()) return true;
  const s = getSession();
  if (!s?.access_token) return false;
  if (s.expires_at * 1000 > Date.now() + 60_000) return true;
  if (s.refresh_token) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      const d = await r.json();
      if (r.ok) {
        localStorage.setItem(SKEY, JSON.stringify({
          access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at, user: d.user || s.user,
        }));
        return true;
      }
    } catch { /* fall through to re-login */ }
  }
  localStorage.removeItem(SKEY);
  return false;
}
