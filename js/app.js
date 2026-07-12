// Bootstrap + tab router + login gate.
import { el } from './dom.js';
import { initCloud } from './store.js';
import { authRequired, ensureSession, login, logout, userEmail } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderQuotes } from './quotes.js';
import { renderTables } from './tables.js';
import { renderLists } from './lists.js';
import { renderSettings } from './settings.js';

const VIEWS = { dashboard: renderDashboard, quotes: renderQuotes, tables: renderTables, lists: renderLists, settings: renderSettings };

function go(view) {
  if (!VIEWS[view]) view = 'dashboard';
  location.hash = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  VIEWS[view]();
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
    class: 'btn ghost small logout-btn', style: 'margin-left:auto', title: userEmail(),
    onclick: logout,
  }, ['Log out']));
}

function startApp() {
  addLogout();
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.view)));
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  go(location.hash.slice(1) || 'dashboard');
  initCloud().then((replaced) => { if (replaced) go(location.hash.slice(1) || 'dashboard'); });
}

async function boot() {
  if (authRequired() && !(await ensureSession())) { renderLogin(); return; }
  startApp();
}

boot();
