// Clients — one card per person, built from the quotes themselves (no separate record
// to keep in sync): quotes sharing an email, phone number or name are the same client.
// Details are editable here and written to every one of that client's quotes; editing a
// quote's client changes what shows here, so the two can never disagree.
import { el, mount, toast } from './dom.js';
import { getState, newQuote, save, payPct, isInvoiceStage } from './store.js';
import { quoteTotals, money, money0 } from './pricing.js';
import { openQuote, stageBadgeClass } from './quotes.js';
import { labeled, iconSvg, ICON } from './ui.js';

let active = null; // any identity key of the open client
let query = '';

export const clientsRoute = () => (active ? [active] : []);
export function applyClientsRoute([key] = []) { active = key || null; }
export function dropMissingClient() { if (active && !findClient(buildClients(getState()), active)) active = null; }

const digits = (s) => String(s || '').replace(/\D/g, '');
const keysOf = (c) => [
  c.email?.trim() && 'e:' + c.email.trim().toLowerCase(),
  digits(c.phone).length >= 7 && 'p:' + digits(c.phone).slice(-10),
  c.name?.trim() && 'n:' + c.name.trim().toLowerCase().replace(/\s+/g, ' '),
].filter(Boolean);

// Union-find over identity keys: a quote typed with the email only and another with
// the same email + a phone end up as one client, and the phone then links a third.
function buildClients(s) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const quotes = s.quotes.filter((q) => !q.isTest && q.client && keysOf(q.client).length);
  for (const q of quotes) {
    const ks = keysOf(q.client);
    ks.forEach((k) => { if (!parent.has(k)) parent.set(k, k); });
    ks.slice(1).forEach((k) => parent.set(find(k), find(ks[0])));
  }
  const groups = new Map();
  for (const q of quotes) {
    const root = find(keysOf(q.client)[0]);
    (groups.get(root) || groups.set(root, []).get(root)).push(q);
  }
  return [...groups.values()].map((qs) => {
    qs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.number - a.number);
    const pick = (f) => qs.map((q) => q.client[f]).find((v) => v && v.trim()) || '';
    const rows = qs.map((q) => {
      const net = quoteTotals(q, s).net, total = quoteTotals(q, s).total, stage = q.stage || 'Quote';
      return { q, total, stage, paid: total * payPct(q), net };
    });
    const invoiced = rows.filter((r) => isInvoiceStage(r.stage));
    const invoicedTotal = invoiced.reduce((a, r) => a + r.total, 0);
    const collected = invoiced.reduce((a, r) => a + r.paid, 0);
    return {
      name: pick('name'), phone: pick('phone'), email: pick('email'), address: pick('address'),
      keys: [...new Set(qs.flatMap((q) => keysOf(q.client)))], rows,
      invoicedTotal, collected, owed: invoicedTotal - collected,
      last: qs[0].date || '',
    };
  }).sort((a, b) => b.last.localeCompare(a.last) || (a.name || '').localeCompare(b.name || ''));
}
// The open client is identified by one of its quote ids, not by name/phone/email: those
// are exactly what gets edited here, so they can't be what keeps the screen on the same person.
const findClient = (clients, id) => clients.find((c) => c.rows.some((r) => r.q.id === id));
const routeKey = (c) => c.rows[0].q.id;

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const mapsUrl = (a) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a);

// wa.me wants the full international number with no + or spaces; a bare 10-digit number is a US one.
const waNumber = (phone) => { const d = digits(phone); return phone.trim().startsWith('+') || d.length !== 10 ? d : '1' + d; };

function goToQuote(id) { openQuote(id); document.querySelector('.tab[data-view="quotes"]')?.click(); }

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + ' copied'); } catch { toast('Copy failed'); }
}

function action(icon, label, href, opts = {}) {
  const a = el('a', { class: 'btn client-act' + (href ? '' : ' disabled'), ...(href ? { href, ...(opts.blank ? { target: '_blank', rel: 'noopener' } : {}) } : { 'aria-disabled': 'true' }), title: href ? opts.title || label : 'Nothing on file' }, labeled(icon, label));
  return a;
}

function detailRow(c, icon, label, field, type = 'text') {
  const value = c[field];
  const inp = el('input', {
    type, value, placeholder: 'Not on file', 'aria-label': label,
    oninput: (e) => {
      for (const r of c.rows) r.q.client[field] = e.target.value;
      save();
      renderClients();
    },
  });
  const row = el('div', { class: 'client-row' }, [
    el('span', { class: 'client-row-ico' }, labeled(icon, '', 16)),
    el('label', { class: 'client-row-main' }, [el('div', { class: 'client-row-label' }, [label]), inp]),
    el('button', { class: 'row-act', type: 'button', title: 'Copy', 'aria-label': 'Copy ' + label, onclick: () => value && copy(value, label) }, []),
  ]);
  row.querySelector('button').innerHTML = iconSvg(ICON.copy, 15);
  return row;
}

function detail(c) {
  const tel = digits(c.phone);
  const stat = (label, value, tone = '') => el('div', { class: 'client-stat ' + tone }, [el('div', { class: 'client-stat-v' }, [value]), el('div', { class: 'client-stat-l' }, [label])]);

  const head = el('div', { class: 'client-head' }, [
    el('div', { class: 'client-avatar' }, [initials(c.name)]),
    el('div', { class: 'client-head-main' }, [
      el('h2', {}, [c.name || 'Unnamed client']),
      el('div', { class: 'hint' }, [`${c.rows.length} quote${c.rows.length === 1 ? '' : 's'} & invoices · last ${c.last || '—'}`]),
    ]),
    el('button', {
      class: 'btn primary', onclick: () => {
        const q = newQuote();
        q.client = { name: c.name, phone: c.phone, email: c.email, address: c.address };
        goToQuote(q.id);
      },
    }, labeled('plus', 'New quote')),
  ]);

  const actions = el('div', { class: 'client-actions' }, [
    action('phone', 'Call', tel ? 'tel:' + (c.phone.trim().startsWith('+') ? '+' : '') + tel : null),
    action('chat', 'Text', tel ? 'sms:' + tel : null),
    action('chat', 'WhatsApp', tel ? 'https://wa.me/' + waNumber(c.phone) : null, { blank: true }),
    action('mail', 'Email', c.email ? 'mailto:' + c.email.trim() : null),
    action('pin', 'Directions', c.address ? mapsUrl(c.address) : null, { blank: true }),
  ]);

  const info = el('div', { class: 'client-info' }, [
    detailRow(c, 'user', 'Name', 'name'),
    detailRow(c, 'phone', 'Phone', 'phone', 'tel'),
    detailRow(c, 'mail', 'Email', 'email', 'email'),
    detailRow(c, 'pin', 'Address', 'address'),
  ]);

  const stats = el('div', { class: 'client-stats' }, [
    stat('Invoiced', money0(c.invoicedTotal)),
    stat('Collected', money0(c.collected), 'ok'),
    stat('Still owed', money0(c.owed), c.owed > 0.5 ? 'warn' : ''),
  ]);

  const history = el('div', { class: 'client-history' }, c.rows.map((r) => {
    const inv = isInvoiceStage(r.stage) && r.q.invoiceNumber;
    return el('button', { class: 'client-hist-row', type: 'button', onclick: () => goToQuote(r.q.id) }, [
      el('div', { class: 'client-hist-num' }, [inv ? 'INV #' + r.q.invoiceNumber : 'Q #' + r.q.number]),
      el('div', { class: 'client-hist-meta' }, [
        el('span', { class: 'badge ' + stageBadgeClass(r.stage) }, [r.stage]),
        payPct(r.q) > 0 ? el('span', { class: 'badge paid' }, [r.q.payment]) : null,
        el('span', { class: 'muted' }, [`${r.q.date || '—'} · ${r.q.items.length} item${r.q.items.length === 1 ? '' : 's'}`]),
      ]),
      el('div', { class: 'client-hist-amt' }, [money(r.total)]),
    ]);
  }));

  return el('div', { class: 'client-detail' }, [head, actions, info, stats, el('h3', {}, ['Quotes & invoices']), history]);
}

function listPane(clients) {
  const q = query.trim().toLowerCase();
  const shown = q ? clients.filter((c) => [c.name, c.phone, c.email, c.address].some((v) => (v || '').toLowerCase().includes(q)) || digits(c.phone).includes(digits(q) || '\0')) : clients;
  const open = active && findClient(clients, active);
  const rows = shown.map((c) => el('button', {
    class: 'client-item' + (c === open ? ' active' : ''), type: 'button',
    onclick: () => { active = routeKey(c); renderClients(); },
  }, [
    el('div', { class: 'client-avatar sm' }, [initials(c.name)]),
    el('div', { class: 'client-item-main' }, [
      el('div', { class: 'client-item-name' }, [c.name || 'Unnamed client']),
      el('div', { class: 'client-item-sub' }, [c.phone || c.email || c.address || '—']),
    ]),
    el('div', { class: 'client-item-n' }, [String(c.rows.length)]),
  ]));
  return rows.length ? rows : [el('div', { class: 'empty-sm' }, [clients.length ? 'No client matches.' : 'Clients appear here once a quote has a name, phone or email.'])];
}

export function renderClients() {
  const clients = buildClients(getState());
  const open = active && findClient(clients, active);
  const list = el('div', { class: 'client-list' }, listPane(clients));
  const search = el('label', { class: 'client-search' }, [
    ...labeled('search', '', 16),
    el('input', {
      type: 'search', placeholder: 'Search name, phone, email, address', value: query,
      oninput: (e) => { query = e.target.value; list.replaceChildren(...listPane(clients)); },
    }),
  ]);
  const right = open ? detail(open)
    : el('div', { class: 'empty' }, [el('div', { class: 'big' }, labeled('user', '', 40)), clients.length ? 'Pick a client to see their details and history.' : 'No clients yet.']);

  mount(el('div', { class: 'panel' }, [
    el('div', { class: 'section-head' }, [el('div', {}, [el('h2', {}, ['Clients']), el('div', { class: 'hint' }, [clients.length + ' total'])])]),
    el('div', { class: 'clients-layout' + (open ? ' has-open' : '') }, [
      el('div', { class: 'clients-side' }, [search, list]),
      el('div', { class: 'clients-main' }, [
        open ? el('button', { class: 'btn ghost client-back', onclick: () => { active = null; renderClients(); } }, labeled('arrowLeft', 'All clients')) : null,
        right,
      ]),
    ]),
  ]));
}
