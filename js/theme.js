// Light / dark. The choice is a per-device display preference (localStorage), and
// until it is made the OS setting wins. Colors live in css/tokens.css; this file only
// flips `data-theme` on <html>. index.html sets it once before first paint.
import { el } from './dom.js';
import { iconSvg, ICON } from './ui.js';

const KEY = 'sd-theme';
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');

const saved = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; } };
const current = () => root.dataset.theme || (media.matches ? 'dark' : 'light');

export function initTheme() {
  root.dataset.theme = saved() || (media.matches ? 'dark' : 'light');
  media.addEventListener('change', () => { if (!saved()) root.dataset.theme = media.matches ? 'dark' : 'light'; });
}

export function themeToggle() {
  const btn = el('button', { class: 'btn ghost small theme-toggle', type: 'button' }, []);
  const paint = () => {
    const dark = current() === 'dark';
    btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = iconSvg(dark ? ICON.sun : ICON.moon, 18);
  };
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    // Colors must jump, not fade: a fade passes through muddy in-between greys.
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just won't persist */ }
    paint();
  });
  media.addEventListener('change', paint);
  paint();
  return btn;
}
