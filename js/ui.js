// The app's component kit. Anything a person clicks, picks or reads as a control lives
// here — dropdown, date picker, multi-select, confirm dialog, tooltip — built once,
// styled only from css/tokens.css, and used by every screen. The browser's own
// <select> menu and date popup can't be themed, so none of them are used.
import { el } from './dom.js';

const svg = (inner, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const icon = (inner, size) => { const s = el('span', { class: 'ico' }, []); s.innerHTML = svg(inner, size); return s; };
const ICON = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  prev: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  undo: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  chat: '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 5.5L20 8"/>',
  clipboard: '<rect x="6" y="5" width="12" height="16" rx="2.5"/><path d="M9 5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V5"/>',
  printer: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2.5"/><path d="M7 14h10v6H7z"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  window: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M12 3.5v17M4 12h16"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18z"/><path d="m9.5 13 2 2 3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};
export { svg as iconSvg, ICON };

// Icon + text, for a button's label: labeled('plus', 'New quote').
export function labeled(name, text, size = 16) {
  const i = el('span', { class: 'ico' }, []);
  i.innerHTML = svg(ICON[name], size);
  return [i, text];
}

// A square icon-only button. `kind` tints the hover: '' neutral, 'danger', 'ok'.
export function iconButton(name, title, kind, onclick, size = 17) {
  const b = el('button', { class: ('row-act ' + (kind || '')).trim(), type: 'button', title, 'aria-label': title, onclick }, []);
  b.innerHTML = svg(ICON[name], size);
  return b;
}

/* ------------------------------------------------------------------ popover */

let openPop = null;

export function closePopover() {
  if (!openPop) return;
  const { node, anchor, onClose, restoreFocus, off } = openPop;
  openPop = null;
  off();
  node.remove();
  anchor.setAttribute?.('aria-expanded', 'false');
  onClose?.();
  if (restoreFocus) anchor.focus?.({ preventScroll: true });
}

// A floating panel pinned to `anchor`. Fixed, not absolute, so a scrolling sheet can't
// clip it; it closes on outside click, Escape, resize and scroll rather than float
// away from what it belongs to. One at a time.
export function popover(anchor, node, { onClose, minWidth = true } = {}) {
  closePopover();
  node.classList.add('pop');
  document.body.append(node);
  anchor.setAttribute?.('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect();
  if (minWidth) node.style.minWidth = r.width + 'px';
  const w = node.offsetWidth, h = node.offsetHeight;
  const below = innerHeight - r.bottom;
  node.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  node.style.top = (below < h + 12 && r.top > h + 12 ? r.top - h - 6 : r.bottom + 6) + 'px';

  const away = (e) => { if (!node.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const onScroll = (e) => { if (!node.contains(e.target)) closePopover(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (openPop) openPop.restoreFocus = true; closePopover(); } };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', esc, true);
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', closePopover);
  const off = () => {
    document.removeEventListener('mousedown', away, true);
    document.removeEventListener('keydown', esc, true);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', closePopover);
  };
  openPop = { node, anchor, onClose, restoreFocus: false, off };
  return { close: closePopover };
}

/* ----------------------------------------------------------------- dropdown */

// options: [{ value, label, group?, hint? }]. Returns a button; the list opens in a
// popover with full keyboard control (arrows, Home/End, Enter, Esc, type-to-jump).
export function dropdown({ options, value, onChange, placeholder = '—', className = '', style = '', label }) {
  let current = value;
  const text = el('span', { class: 'dd-text' }, []);
  const btn = el('button', {
    type: 'button', class: ('dd ' + className).trim(), style: style || null,
    'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label || null,
  }, [text, icon(ICON.chevron, 14)]);
  btn.querySelector('.ico').classList.add('dd-chev');

  const find = (v) => options.find((o) => String(o.value) === String(v));
  const paint = () => {
    const o = find(current);
    text.textContent = o ? o.label : placeholder;
    btn.classList.toggle('empty', !o || o.value === '' || o.value == null);
  };
  paint();

  const open = () => {
    const list = el('div', { class: 'dd-list', role: 'listbox', tabindex: '-1' }, []);
    const items = [];
    let lastGroup;
    for (const o of options) {
      if (o.group && o.group !== lastGroup) list.append(el('div', { class: 'dd-group' }, [o.group]));
      lastGroup = o.group;
      const row = el('div', { class: 'dd-opt', role: 'option', 'aria-selected': String(String(o.value) === String(current)) }, [
        el('span', { class: 'dd-mark' }, []),
        el('span', { class: 'dd-label' + (o.label ? '' : ' none') }, [o.label || 'None']),
        o.hint ? el('em', {}, [o.hint]) : null,
      ]);
      if (String(o.value) === String(current)) row.querySelector('.dd-mark').append(icon(ICON.check, 14));
      row.onmousedown = (e) => e.preventDefault();
      row.onclick = () => choose(o);
      row.onmousemove = () => setActive(items.indexOf(row), false);
      items.push(row);
      list.append(row);
    }
    if (!options.length) list.append(el('div', { class: 'dd-empty' }, ['Nothing to choose yet']));

    let active = Math.max(0, options.findIndex((o) => String(o.value) === String(current)));
    const setActive = (i, scroll = true) => {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach((n, k) => n.classList.toggle('active', k === active));
      if (scroll) items[active].scrollIntoView({ block: 'nearest' });
    };
    const choose = (o) => {
      current = o.value; paint();
      closePopover(); btn.focus({ preventScroll: true });
      onChange(o.value);
    };
    let typed = '', typedAt = 0;
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) choose(options[active]); }
      else if (e.key === 'Tab') closePopover();
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        const now = Date.now();
        typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = now;
        const hit = options.findIndex((o) => String(o.label).toLowerCase().startsWith(typed));
        if (hit >= 0) setActive(hit);
      }
    });

    popover(btn, list);
    setActive(active);
    list.focus({ preventScroll: true });
  };

  btn.addEventListener('click', () => { if (openPop?.anchor === btn) closePopover(); else open(); });
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); }
  });
  return btn;
}

// A labelled field wrapping a dropdown — the form-style replacement for <select>.
export function selectField(labelText, options, value, onChange, extraClass = '') {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  return el('label', { class: 'field ' + extraClass }, [labelText, dropdown({ options: opts, value, onChange })]);
}

/* ------------------------------------------------------------ multi-dropdown */

// Pick any number of {name, price} options; `onChange` gets the picked names in the
// list's own order, so what prints doesn't depend on the order of clicks.
export function multiDropdown({ options, values, onChange, emptyHint, style = '', money }) {
  let picked = new Set(values || []);
  const btn = el('button', { type: 'button', class: 'dd multi', style: style || null, 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, []);
  const text = el('span', { class: 'dd-text' }, []);
  btn.append(text, icon(ICON.chevron, 14));
  btn.querySelector('.ico').classList.add('dd-chev');
  const paint = () => {
    const names = options.map((o) => o.name).filter((n) => picked.has(n));
    text.textContent = names.length === 0 ? '—' : names.length === 1 ? names[0] : `${names.length} selected`;
    btn.classList.toggle('empty', names.length === 0);
    btn.dataset.tip = names.length ? names.join(', ') : 'None selected';
  };
  paint();
  btn.addEventListener('click', () => {
    if (openPop?.anchor === btn) { closePopover(); return; }
    const list = el('div', { class: 'dd-list multi' }, []);
    if (!options.length) list.append(el('div', { class: 'dd-empty' }, [emptyHint || 'Nothing to choose yet']));
    for (const o of options) {
      const box = el('input', { type: 'checkbox' });
      box.checked = picked.has(o.name);
      box.onchange = () => {
        if (box.checked) picked.add(o.name); else picked.delete(o.name);
        paint();
        onChange(options.map((x) => x.name).filter((n) => picked.has(n)));
      };
      list.append(el('label', { class: 'dd-opt' }, [box, el('span', { class: 'dd-label' }, [o.name]), o.price > 0 && money ? el('em', {}, [money(o.price)]) : null]));
    }
    popover(btn, list);
  });
  return btn;
}

/* --------------------------------------------------------------- date picker */

const pad = (n) => String(n).padStart(2, '0');
const toIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fromIso = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const validDate = (y, m, d) => { const t = new Date(y, m, d); return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d; };
const display = (iso) => { const p = fromIso(iso); return p ? `${pad(p.m + 1)}/${pad(p.d)}/${p.y}` : ''; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Value is an ISO "YYYY-MM-DD" string (or ''), exactly what <input type=date> held,
// so stored quotes don't change. Type it (digits only; slashes appear on their own)
// or pick it from the calendar.
export function datePicker({ value, onChange, placeholder = 'mm/dd/yyyy' }) {
  let iso = value || '';
  const input = el('input', { type: 'text', class: 'dp-input', inputmode: 'numeric', placeholder, maxlength: '10', autocomplete: 'off' }, []);
  const btn = el('button', { type: 'button', class: 'dp-btn', title: 'Open calendar', 'aria-label': 'Open calendar', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [icon(ICON.calendar, 17)]);
  const wrap = el('div', { class: 'dp' }, [input, btn]);
  const paint = () => { input.value = display(iso); };
  const commit = (next) => { if (next !== iso) { iso = next; onChange(iso); } paint(); };
  paint();

  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    input.value = digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
      : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    if (digits.length === 8) {
      const [m, d, y] = [+digits.slice(0, 2) - 1, +digits.slice(2, 4), +digits.slice(4)];
      input.classList.toggle('invalid', !validDate(y, m, d));
      if (validDate(y, m, d)) commit(toIso(y, m, d));
    } else input.classList.remove('invalid');
  });
  input.addEventListener('blur', () => {
    if (!input.value) { input.classList.remove('invalid'); commit(''); return; }
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.value);
    if (!m || !validDate(+m[3], +m[1] - 1, +m[2])) { input.classList.remove('invalid'); paint(); } // half-typed or impossible: put the saved date back
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openCalendar(); } });

  function openCalendar() {
    const today = new Date();
    const sel = fromIso(iso);
    let view = { y: (sel || { y: today.getFullYear() }).y, m: (sel || { m: today.getMonth() }).m };
    let focus = sel ? { ...sel } : { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
    const root = el('div', { class: 'cal', role: 'dialog', 'aria-label': 'Choose a date' }, []);

    const render = () => {
      const first = new Date(view.y, view.m, 1);
      const start = new Date(view.y, view.m, 1 - first.getDay());
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const y = dt.getFullYear(), m = dt.getMonth(), d = dt.getDate();
        const isSel = sel && sel.y === y && sel.m === m && sel.d === d;
        const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
        const isFocus = focus.y === y && focus.m === m && focus.d === d;
        cells.push(el('button', {
          type: 'button', class: 'cal-day' + (m !== view.m ? ' out' : '') + (isSel ? ' sel' : '') + (isToday ? ' today' : ''),
          tabindex: isFocus ? '0' : '-1', 'data-d': toIso(y, m, d),
          onclick: () => { closePopover(); input.classList.remove('invalid'); commit(toIso(y, m, d)); input.focus({ preventScroll: true }); },
        }, [String(d)]));
      }
      const step = (dm, dy = 0) => { view = { y: view.y + dy + Math.floor((view.m + dm) / 12), m: (((view.m + dm) % 12) + 12) % 12 }; focus = { y: view.y, m: view.m, d: Math.min(focus.d, new Date(view.y, view.m + 1, 0).getDate()) }; render(); root.querySelector('[tabindex="0"]')?.focus(); };
      root.replaceChildren(
        el('div', { class: 'cal-head' }, [
          el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Previous month', onclick: () => step(-1) }, [icon(ICON.prev, 16)]),
          el('div', { class: 'cal-title' }, [`${MONTHS[view.m]} ${view.y}`]),
          el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Next month', onclick: () => step(1) }, [icon(ICON.next, 16)]),
        ]),
        el('div', { class: 'cal-week' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => el('span', {}, [d]))),
        el('div', { class: 'cal-grid' }, cells),
        el('div', { class: 'cal-foot' }, [
          el('button', { type: 'button', class: 'cal-link', onclick: () => { closePopover(); commit(''); input.focus({ preventScroll: true }); } }, ['Clear']),
          el('button', { type: 'button', class: 'cal-link', onclick: () => { closePopover(); commit(toIso(today.getFullYear(), today.getMonth(), today.getDate())); input.focus({ preventScroll: true }); } }, ['Today']),
        ]),
      );
      root.onkeydown = (e) => {
        const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (move) {
          e.preventDefault();
          const dt = new Date(focus.y, focus.m, focus.d + move);
          focus = { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
          view = { y: focus.y, m: focus.m };
          render(); root.querySelector('[tabindex="0"]')?.focus();
        } else if (e.key === 'PageUp') { e.preventDefault(); step(e.shiftKey ? -12 : -1); }
        else if (e.key === 'PageDown') { e.preventDefault(); step(e.shiftKey ? 12 : 1); }
      };
    };
    render();
    popover(btn, root, { minWidth: false, onClose: () => { input.classList.remove('invalid'); } });
    root.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => { if (openPop?.anchor === btn) closePopover(); else openCalendar(); });
  return wrap;
}

export function dateField(labelText, value, onChange, extraClass = '') {
  return el('label', { class: 'field ' + extraClass }, [labelText, datePicker({ value, onChange })]);
}

/* ------------------------------------------------------------ confirm dialog */

// A destructive action asks in the app's own dialog, with the dangerous button named
// for what it does. Resolves true only on an explicit confirm; Escape, the backdrop
// and Cancel all mean no, and Cancel is what has focus, so a stray Enter is safe.
export function confirmAction(message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const done = (ok) => { overlay.remove(); previous?.focus?.(); resolve(ok); };
    const cancel = el('button', { class: 'btn', type: 'button', onclick: () => done(false) }, ['Cancel']);
    const confirm = el('button', { class: 'btn danger', type: 'button', onclick: () => done(true) }, [confirmLabel]);
    const overlay = el('div', {
      class: 'modal-overlay', role: 'alertdialog', 'aria-modal': 'true',
      onmousedown: (e) => { if (e.target === overlay) done(false); },
      onkeydown: (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === cancel ? confirm : cancel).focus(); }
      },
    }, [el('div', { class: 'modal-card confirm-card' }, [
      el('p', { class: 'confirm-msg' }, [message]),
      el('div', { class: 'confirm-actions' }, [cancel, confirm]),
    ])]);
    document.body.append(overlay);
    cancel.focus();
  });
}

/* ------------------------------------------------------- global behaviours */

// Installed once at boot.
export function initUI() {
  // Tooltips. The browser's own `title` bubble is slow, flaky on cells and gone the
  // moment the pointer twitches, so every title in the app is lifted into one fast,
  // fixed-position tip (fixed, so a scrolling sheet can't clip it).
  let tipEl = null, tipOwner = null;
  const hideTip = () => { tipOwner = null; if (tipEl) tipEl.hidden = true; };
  document.addEventListener('mouseover', (e) => {
    const host = e.target.closest?.('[title],[data-tip]');
    if (!host) return;
    if (host.hasAttribute('title')) { // takeover once; a re-render builds a fresh node anyway
      if (host.title) host.dataset.tip = host.title;
      host.removeAttribute('title');
    }
    const text = host.dataset.tip;
    if (!text || host === tipOwner) return;
    tipOwner = host;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.append(tipEl); }
    tipEl.textContent = text;
    tipEl.hidden = false;
    const r = host.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    tipEl.style.top = (r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
  });
  document.addEventListener('mouseout', (e) => { if (tipOwner && !tipOwner.contains(e.relatedTarget)) hideTip(); });
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('mousedown', hideTip, true);

  // Number fields take digits (and a decimal point) only. type=number still lets "e",
  // "+" and "-" through, and a typed letter leaves the field holding text its value
  // reports as empty. Filter before the character lands, whichever way it arrives:
  // key press, IME/insertText, or paste.
  const isNumberField = (t) => t.matches?.('input[type=number]');
  const HAS_NON_NUMERIC = /[^0-9.]/;
  const insertDigitsOnly = (text) => {
    const clean = text.replace(/[^0-9.]/g, '');
    if (clean) document.execCommand('insertText', false, clean);
  };
  document.addEventListener('beforeinput', (e) => {
    if (!isNumberField(e.target) || !e.inputType.startsWith('insert') || e.data == null || !HAS_NON_NUMERIC.test(e.data)) return;
    e.preventDefault();
    insertDigitsOnly(e.data);
  });
  document.addEventListener('paste', (e) => {
    if (!isNumberField(e.target)) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!HAS_NON_NUMERIC.test(text)) return;
    e.preventDefault();
    insertDigitsOnly(text);
  });
  document.addEventListener('keydown', (e) => {
    if (isNumberField(e.target) && /^[eE+-]$/.test(e.key)) e.preventDefault();
  });
}
