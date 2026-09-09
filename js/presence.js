// Who else is in the app, and where. Presence metadata rides the same Realtime
// channel as the data (see realtime.js); this module is only the UI for it:
//   • a live avatar stack + connection pill in the top bar
//   • a coloured ring, with a name tag, around the exact field someone else has
//     focused — the same path trick that keeps our own caret alive across renders
//   • per-quote markers in the list and a banner inside a shared quote
import { el, nodePath, nodeAtPath, onAfterMount } from './dom.js';
import { trackPresence, onPresence, onStatus, onLive, broadcastLive, getPeers, myColor } from './realtime.js';
import { onSyncState } from './store.js';
import { userEmail, displayName, refreshUser } from './auth.js';
import { currentQuoteRef } from './quotes.js';
import { activeTable } from './tables.js';
import { getState } from './store.js';

let peers = [];
let ctx = {};
let layer;
let bar;
let pill;

// Initials have one job: tell two people apart at a glance. Two letters is the
// usual answer, but it fails on look-alike names ("Shelly" and an account still
// falling back to "shadesdeluxe2020" both start "SH"), so anyone whose initials
// clash with someone else on screen gets another letter until they don't.
function baseInitials(name, len = 2) {
  const words = name.split(/[.\s_@-]+/).filter(Boolean);
  if (!words.length) return '?';
  const joined = words.length > 1 ? words.map((w) => w[0]).join('') : words[0];
  return joined.slice(0, len).toUpperCase();
}

function labelInitials(name, others) {
  for (let len = 2; len <= 4; len++) {
    const mine = baseInitials(name, len);
    if (!others.some((o) => o !== name && baseInitials(o, len) === mine)) return mine;
  }
  return baseInitials(name, 4);
}

/* ---------------- context: which screen am I on ---------------- */

// `scope` is what two people must have in common for a field ring to mean anything:
// the same view is not enough, since two price tables render the same shape of grid
// and a ring would then land on the wrong cell.
function describe(view) {
  const q = currentQuoteRef();
  if (view === 'quotes' && q.quoteId) {
    const quote = getState().quotes.find((x) => x.id === q.quoteId);
    const who = quote?.client?.name ? ' — ' + quote.client.name : '';
    return { scope: q.view + ':' + q.quoteId, quoteId: q.quoteId, label: (q.view === 'invoice' ? 'Invoice #' : 'Quote #') + (quote?.number ?? '') + who };
  }
  if (view === 'tables') {
    const t = activeTable();
    return { scope: 'tables:' + (t || ''), quoteId: null, label: t ? 'Price table · ' + t : 'Price Tables' };
  }
  return { scope: view, quoteId: null, label: { dashboard: 'Dashboard', quotes: 'Quotes', lists: 'Lists', settings: 'Settings' }[view] || 'Dashboard' };
}

// Runs after every render, so navigating anywhere republishes where we are without
// each view having to remember to announce itself.
function updateContext() {
  const view = location.hash.slice(1) || 'dashboard';
  const next = { view, ...describe(view), field, fieldLabel, name: displayName() };
  if (JSON.stringify(next) === JSON.stringify(ctx)) return;
  ctx = next;
  trackPresence(next);
}

let field = null;
let fieldLabel = '';
function setField(f, label) {
  field = f;
  fieldLabel = f ? label : '';
  updateContext();
}

/* ---------------- top bar ---------------- */

let roster = [];
const activity = new Map(); // user id -> last time they did something
function avatar(p, size = 28, extraClass = '') {
  return el('span', {
    class: 'avatar ' + extraClass,
    'data-who': p.id || 'me',
    style: `--who:${p.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`,
    title: `${p.name} · ${p.label || ''}${p.fieldLabel ? ' · editing ' + p.fieldLabel : ''}`,
  }, [labelInitials(p.name, roster)]);
}

function renderBar() {
  if (!bar) return;
  const me = { id: 'me', name: displayName(), color: myColor(), label: 'You', email: userEmail() };
  roster = [...peers.map((p) => p.name), me.name];
  // replaceChildren() turns a null into a literal "null" text node — filter first.
  bar.replaceChildren(...[
    ...peers.slice(0, 5).map((p) => avatar(p)),
    peers.length > 5 ? el('span', { class: 'avatar more' }, ['+' + (peers.length - 5)]) : null,
    avatar(me, 26, 'me'),
    pill,
  ].filter(Boolean));
  renderStatus();
}

const STATUS_TEXT = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

// Presence is shown by the avatars themselves — a slow breathing halo means the
// channel is open and these people are here now. A chip that says "everything is
// fine" is just noise, so words appear only when something is actually wrong:
// disconnected, or a write that has not landed.
let connection = 'connecting';
let saving = 'saved';
const ACTIVE_FOR = 4000;
const isActive = (id) => Date.now() - (activity.get(id) || 0) < ACTIVE_FOR;

function renderStatus() {
  const bad = saving === 'error';
  const healthy = connection === 'live' && !bad;
  // The halo marks a person who is *doing* something right now — moving, typing,
  // saving. A halo that simply meant "connected" was on permanently and therefore
  // told you nothing.
  if (bar) bar.querySelectorAll('.avatar').forEach((a) => {
    a.classList.toggle('breathing', healthy && isActive(a.dataset.who));
    a.classList.toggle('idle', healthy && !isActive(a.dataset.who));
  });
  if (!pill) return;
  pill.hidden = healthy;
  pill.className = 'sync-pill ' + (bad ? 'error' : connection);
  pill.title = bad ? 'Could not save to the cloud — retrying. Do not close this tab.' : 'Live sync status';
  pill.lastChild.textContent = bad ? 'Not saved' : STATUS_TEXT[connection] || connection;
}

/* ---------------- live cursors ----------------
   Positions travel as fractions of the #app box, not pixels: the two screens are
   rarely the same size, and a fraction lands on the same *element* on both. The
   layer is fixed, so a cursor pointing at something you have scrolled past simply
   leaves the viewport, which is the honest answer. */

const cursors = new Map(); // user -> { x, y, scope, at, typing }
const CURSOR_TTL = 5000; // backstop only — a departure is normally seen via presence

function appBox() {
  const app = document.getElementById('app');
  return app ? app.getBoundingClientRect() : null;
}

// Cursor traffic is gated on somebody being on this exact screen to see it, because
// that is the only case where a cursor is ever drawn. Alone in the app, or both of
// you on different quotes, this sends nothing at all.
//
// That gate is what makes the feature affordable: Realtime is metered, and streaming
// a pointer whenever the other person merely happened to be online worked out at
// roughly twice the whole monthly allowance. Gated to a shared screen it is a small
// fraction of it, and it is exactly when a cursor is worth seeing.
const watchedHere = () => peers.some((p) => p.scope && p.scope === ctx.scope);

let lastSent = 0;
let lastPt = { x: -1, y: -1 };
function sendCursor(e) {
  if (!watchedHere()) return;
  const now = Date.now();
  if (now - lastSent < 100) return;
  const box = appBox();
  if (!box || !box.width || !box.height) return;
  const x = (e.clientX - box.left) / box.width;
  const y = (e.clientY - box.top) / box.height;
  if (Math.abs(x - lastPt.x) < 0.002 && Math.abs(y - lastPt.y) < 0.002) return;
  lastSent = now;
  lastPt = { x, y };
  broadcastLive({ scope: ctx.scope, x, y });
}

let lastPing = 0;
function sendTypingPing() {
  if (!peers.length) return; // a typing ping is one small message, worth it app-wide
  const now = Date.now();
  if (now - lastPing < 500) return;
  lastPing = now;
  broadcastLive({ scope: ctx.scope, typing: true });
}

// The pointer itself, drawn rather than imported — an SVG arrow with the person's
// name tucked under its tip, in the same colour as their avatar.
function cursorNode(peer, pt) {
  return el('div', { class: 'peer-cursor', style: `--who:${peer.color};left:${pt.left}px;top:${pt.top}px` }, [
    el('span', { class: 'cursor-arrow', html: '<svg width="18" height="20" viewBox="0 0 18 20"><path d="M2 1.5 15.5 11 9.4 12.1 6.6 18.2Z" fill="var(--who)" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>' }, []),
    el('span', { class: 'cursor-name' }, [peer.name]),
  ]);
}

function cursorMarks() {
  const box = appBox();
  if (!box) return [];
  const now = Date.now();
  const out = [];
  for (const p of peers) {
    const c = cursors.get(p.id);
    if (!c || now - c.at > CURSOR_TTL || c.scope !== ctx.scope) continue;
    out.push(cursorNode(p, { left: box.left + c.x * box.width, top: box.top + c.y * box.height }));
  }
  return out;
}

/* ---------------- field rings ---------------- */

function decorate() {
  if (!layer) return;
  const here = peers.filter((p) => p.scope && p.scope === ctx.scope);
  const marks = [];

  for (const p of here) {
    const node = p.field && nodeAtPath(p.field);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    marks.push(el('div', {
      class: 'peer-ring',
      style: `--who:${p.color};left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px`,
    }, [el('span', { class: 'peer-tag' }, [p.name])]));
  }

  // Quote cards / rows the others have open, so the list itself shows where the
  // work is happening without opening anything.
  const seen = new Set();
  for (const p of peers) {
    if (!p.quoteId || seen.has(p.quoteId + p.id)) continue;
    const card = document.querySelector(`[data-quote-id="${CSS.escape(p.quoteId)}"]`);
    if (!card) continue;
    seen.add(p.quoteId + p.id);
    const r = card.getBoundingClientRect();
    marks.push(el('div', { class: 'peer-ring soft', style: `--who:${p.color};left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px` }, [
      el('span', { class: 'peer-tag' }, [p.name]),
    ]));
  }

  layer.replaceChildren(...[...marks, ...cursorMarks(), banner(here)].filter(Boolean));
}

// Two people on the same screen: say so plainly, since the rings are easy to miss
// when the other person is scrolled out of view. It floats in the overlay rather
// than being inserted into the page — anything added to #app would shift every
// element index below it, and those indices are exactly what the field rings are
// addressed by.
function banner(here) {
  if (!here.length) return null;
  const names = here.map((p) => p.name);
  const what = ctx.quoteId ? 'this quote' : 'this page';
  const text = names.length === 1 ? `${names[0]} is on ${what} right now` : `${names.join(', ')} are on ${what} right now`;
  return el('div', { class: 'peer-banner', style: `--who:${here[0].color}` }, [el('span', { class: 'live-dot' }, []), el('span', {}, [text])]);
}

let statusPending = false;
function scheduleStatus() {
  if (statusPending) return;
  statusPending = true;
  requestAnimationFrame(() => { statusPending = false; renderStatus(); });
}

let rafPending = false;
function scheduleDecorate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; decorate(); });
}

/* ---------------- wiring ---------------- */

export function initPresence() {
  layer = el('div', { class: 'presence-layer no-print' }, []);
  document.body.append(layer);

  pill = el('span', { class: 'sync-pill', title: 'Live sync status' }, [el('span', { class: 'live-dot' }, []), 'Connecting…']);
  bar = el('div', { class: 'presence-bar no-print' }, []);
  const topbar = document.querySelector('.topbar');
  const logout = topbar.querySelector('.logout-btn');
  bar.style.marginLeft = 'auto';
  if (logout) topbar.insertBefore(bar, logout); else topbar.append(bar);

  onStatus((s) => { connection = s; renderStatus(); });
  onSyncState((s) => {
    saving = s;
    if (s === 'saving') { activity.set('me', Date.now()); scheduleStatus(); }
    renderStatus();
  });

  // Somebody else moved or typed.
  onLive((m) => {
    if (m.gone) cursors.delete(m.user);
    else if (m.x != null) cursors.set(m.user, { x: m.x, y: m.y, scope: m.scope, at: Date.now() });
    activity.set(m.user, Date.now());
    scheduleDecorate();
    renderStatus();
  });

  document.addEventListener('pointermove', (e) => { activity.set('me', Date.now()); sendCursor(e); }, { passive: true });
  document.addEventListener('input', () => { activity.set('me', Date.now()); sendTypingPing(); scheduleStatus(); });
  // Leaving the window should take the cursor with you, not strand it mid-screen.
  document.addEventListener('mouseleave', () => { if (watchedHere()) broadcastLive({ scope: ctx.scope, gone: true }); });
  // Halos have to switch themselves off when someone goes quiet; nothing else
  // would fire once the messages stop.
  setInterval(() => { renderStatus(); scheduleDecorate(); }, 1500);
  onPresence((list) => {
    peers = list;
    // Somebody who has moved to another screen must not leave their pointer behind
    // on this one. Their presence says where they are the moment they navigate, so
    // a stale cursor is dropped straight away rather than lingering until it times
    // out — and it costs nothing extra, since that presence update is already sent.
    for (const [id, c] of cursors) {
      const still = list.find((p) => p.id === id);
      if (!still || still.scope !== c.scope) cursors.delete(id);
    }
    renderBar();
    scheduleDecorate();
  });

  // Announce the field under the caret. Anyone on the same screen gets a ring
  // around it; anyone elsewhere just sees it in the avatar tooltip.
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    setField(nodePath(t), shorten(t.closest('label')?.textContent.trim() || t.placeholder || t.type));
  });
  document.addEventListener('focusout', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) setField(null);
  });

  onAfterMount(() => { updateContext(); scheduleDecorate(); });
  window.addEventListener('scroll', scheduleDecorate, { passive: true });
  window.addEventListener('resize', scheduleDecorate);
  document.addEventListener('input', scheduleDecorate);
  renderBar();
  updateContext();
  // Picks up a display name added after this browser last signed in.
  refreshUser().then((ok) => { if (ok) { renderBar(); updateContext(); } });
}
