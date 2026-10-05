// Bootstrap + tab router + login gate.
import { el, onAfterMount } from './dom.js';
import { pathSegments, pathFor } from './url.js';
import { initTheme, themeToggle } from './theme.js';
import { initUI } from './ui.js';
import { initCloud, startLiveSync, onStateChange } from './store.js';
import { authRequired, ensureSession, login, logout, userEmail } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderQuotes, quoteRoute, applyQuoteRoute, dropMissingQuote } from './quotes.js';
import { renderTables, tablesRoute, applyTablesRoute, dropMissingTable } from './tables.js';
import { renderLists } from './lists.js';
import { renderSettings } from './settings.js';
import { initPresence } from './presence.js';

const VIEWS = { dashboard: renderDashboard, quotes: renderQuotes, tables: renderTables, lists: renderLists, settings: renderSettings };

// The URL path is the source of truth for where you are: /view/part/part. Views that
// have a place inside them (an open quote, a price table) expose it as route parts,
// so a reload or a shared link lands on the same screen.
const ROUTES = {
  quotes: { get: quoteRoute, set: applyQuoteRoute },
  tables: { get: tablesRoute, set: applyTablesRoute },
};

let current = 'dashboard';

const splitUrl = () => {
  const [view, ...parts] = pathSegments();
  return [view || 'dashboard', parts];
};
const segmentsFor = (view) => (view === 'dashboard' ? [] : [view, ...(ROUTES[view]?.get() || [])]);

// pushState doesn't fire popstate, and each in-app navigation still gets its own
// history entry, so Back works. Fixing up a URL we were handed (empty, malformed, a
// vanished quote) must replace instead, or Back would land on the bad URL and
// re-push forever.
let canonicalizing = false;
function syncUrl() {
  // Preparing a quote gets the whole window, like a spreadsheet; documents keep their page width.
  document.body.classList.toggle('wide-sheet', current === 'quotes' && quoteRoute().length === 1);
  const next = pathFor(segmentsFor(current));
  if (location.pathname === next || decodeURI(location.pathname) === decodeURI(next)) return;
  history[canonicalizing ? 'replaceState' : 'pushState'](null, '', next);
}
// Bookmarks from the #view/... era: rewrite to the path form before routing.
function migrateLegacyHash() {
  if (location.hash.length < 2) return;
  const [view, ...rest] = location.hash.slice(1).split('/').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const parts = view === 'quotes' && (rest[0] === 'edit' || rest[0] === 'invoice')
    ? [rest[1], ...(rest[0] === 'invoice' ? ['invoice'] : [])].filter(Boolean) : rest;
  history.replaceState(null, '', pathFor(view && view !== 'dashboard' ? [view, ...parts] : []));
}
function fromUrl(fn) {
  canonicalizing = true;
  try { fn(); } finally { canonicalizing = false; }
}

// `parts` is null for a tab click: the tab keeps whatever it was showing.
// Every render, including in-view navigation like opening a quote, re-syncs the URL.
onAfterMount(syncUrl);

function go(view, parts = null) {
  if (!VIEWS[view]) { view = 'dashboard'; parts = []; }
  current = view;
  if (parts) ROUTES[view]?.set(parts);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  VIEWS[view]();
}

// Someone else's edit landed. Redraw whatever is on screen — every view reads
// straight from the store, and mount() puts the caret and scroll back where they
// were, so a redraw is invisible to whoever is typing here.
let redrawPending = false;
function redraw() {
  if (redrawPending) return;
  redrawPending = true;
  requestAnimationFrame(() => {
    redrawPending = false;
    fromUrl(() => { dropMissingQuote(); dropMissingTable(); VIEWS[current](); });
  });
}

function renderLogin() {
  document.querySelector('.topbar').style.display = 'none';
  const err = el('div', { class: 'login-err' }, []);
  const email = el('input', { type: 'email', placeholder: 'Email', class: 'login-input', autocomplete: 'username' });
  const pass = el('input', { type: 'password', placeholder: 'Password', class: 'login-input', autocomplete: 'current-password' });
  const btn = el('button', { class: 'btn primary', style: 'width:100%', onclick: submit }, ['Log in']);
  async function submit() {
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    try { await login(email.value.trim(), pass.value); location.reload(); }
    catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Log in'; }
  }
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('app').replaceChildren(
    el('div', { class: 'login-wrap' }, [
      el('div', { class: 'login-card' }, [
        el('img', { class: 'login-logo', src: 'assets/logo.png', alt: 'Shades Deluxe' }),
        el('h2', {}, ['Sign in']),
        el('p', { class: 'muted', style: 'margin:0 0 18px' }, ['Shades Deluxe — Quotes']),
        email, pass, btn, err,
      ]),
    ]),
  );
  setTimeout(() => email.focus(), 50);
}

function addLogout() {
  if (!authRequired() || document.querySelector('.logout-btn')) return;
  const bar = document.querySelector('.topbar');
  bar.append(el('button', {
    class: 'btn ghost small logout-btn', style: 'margin-left:12px', title: userEmail(),
    onclick: logout,
  }, ['Log out']));
}

function addThemeToggle() {
  const bar = document.querySelector('.topbar');
  const logout = bar.querySelector('.logout-btn');
  const btn = themeToggle();
  if (logout) logout.before(btn); else bar.append(btn);
}

function startApp() {
  addLogout();
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.view)));
  window.addEventListener('popstate', () => fromUrl(() => { go(...splitUrl()); dropMissingQuote(); dropMissingTable(); VIEWS[current](); }));
  onStateChange((reason) => { if (reason === 'remote') redraw(); });
  migrateLegacyHash();
  fromUrl(() => go(...splitUrl()));
  initPresence();
  addThemeToggle(); // after presence, so it sits right beside Log out
  initCloud().then(() => { startLiveSync(); redraw(); });
}

async function boot() {
  initTheme();
  initUI();
  if (authRequired() && !(await ensureSession())) { renderLogin(); return; }
  startApp();
}

boot();
