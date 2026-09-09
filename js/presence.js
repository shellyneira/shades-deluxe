// Who else is in the app, and where. Presence metadata rides the same Realtime
// channel as the data (see realtime.js); this module is only the UI for it:
//   • a live avatar stack + connection pill in the top bar
//   • a coloured ring, with a name tag, around the exact field someone else has
//     focused — the same path trick that keeps our own caret alive across renders
//   • per-quote markers in the list and a banner inside a shared quote
import { el, nodePath, nodeAtPath, onAfterMount } from './dom.js';
import { trackPresence, onPresence, onStatus, getPeers, myColor } from './realtime.js';
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

// Two letters, so a team of single-word names (Shelly, Sarkis) does not collapse
// into a row of identical "S" circles.
function initials(name) {
  const words = name.split(/[.\s_-]+/).filter(Boolean);
  if (!words.length) return '?';
  const raw = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return raw.toUpperCase();
}
const shorten = (t) => (t.length > 34 ? t.slice(0, 33) + '…' : t);

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

function avatar(p, size = 28) {
  return el('span', {
    class: 'avatar',
    style: `--who:${p.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`,
    title: `${p.name} · ${p.label || ''}${p.fieldLabel ? ' · editing ' + p.fieldLabel : ''}`,
  }, [initials(p.name)]);
}

function renderBar() {
  if (!bar) return;
  const me = { name: displayName(), color: myColor(), label: 'You', email: userEmail() };
  // replaceChildren() turns a null into a literal "null" text node — filter first.
  bar.replaceChildren(...[
    ...peers.slice(0, 5).map((p) => avatar(p)),
    peers.length > 5 ? el('span', { class: 'avatar more' }, ['+' + (peers.length - 5)]) : null,
    avatar(me, 26),
    pill,
  ].filter(Boolean));
}

const STATUS_TEXT = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

// The pill answers one question: is my work safe? A failed write outranks the
// socket state — the channel being up is no comfort if nothing is being saved.
let connection = 'connecting';
let saving = 'saved';
function renderPill() {
  if (!pill) return;
  const bad = saving === 'error';
  pill.className = 'sync-pill ' + (bad ? 'error' : connection);
  pill.title = bad
    ? 'Could not save to the cloud — retrying. Do not close this tab.'
    : 'Live sync status';
  pill.lastChild.textContent = bad ? 'Not saved' : (saving === 'saving' && connection === 'live' ? 'Saving…' : STATUS_TEXT[connection] || connection);
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

  layer.replaceChildren(...[...marks, banner(here)].filter(Boolean));
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

  onStatus((s) => { connection = s; renderPill(); });
  onSyncState((s) => { saving = s; renderPill(); });
  onPresence((list) => {
    peers = list;
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
