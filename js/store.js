// Single source of truth. State lives in localStorage (instant), syncs to Supabase
// (durable, shared across devices) and is kept live over a Realtime channel so a
// change made on one screen shows up on every other screen within a second.
import { SEED } from './seed-data.js';
import { DRAPERY_STYLES, DEFAULT_TRACK_RATES, DEFAULT_ABBREV, descFields } from './pricing.js';
import { dbEnabled, readAll, writeDoc, deleteDoc } from './db.js';
import { connectRealtime, onDbChange, onStatus } from './realtime.js';
import { ensureSession } from './auth.js';
import { SyncEngine } from './sync.js';

const KEY = 'shades-deluxe-v1';

const DEFAULT_COMPANY = {
  name: 'Shades Deluxe',
  address: '12470 NW 38th AVE. OPA-LOCKA FL 33054',
  email: 'ShadesDeluxe2020@gmail.com',
  phone: '786-374-9742',
  terms:
    '* Payments 50% upon signing the contract and the remainder 50% upon job completion.\n' +
    '* Any additional work shall be invoiced and billed separately - Delivery time 10 working days',
};

// Status = what the document is. Payment = how much of it has been collected; the
// dashboard's Collected / Still owed read Payment, nothing else.
export const STAGES = ['Quote', '50% Invoice', '100% Invoice'];
export const PAYMENTS = ['Not paid', '50% Paid', '100% Paid'];
export const isInvoiceStage = (st) => STAGES.indexOf(st) >= 1;
export const payPct = (q) => (isInvoiceStage(q.stage) ? (q.payment === '100% Paid' ? 1 : q.payment === '50% Paid' ? 0.5 : 0) : 0);

// Which fields land in each document's Description column (Settings → Documents).
const DEFAULT_DOC_CONFIG = {
  // Client quote: no dimensions, shown with prices. Mount is a build detail for the
  // maker, not the client.
  client: { table: false, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: false, bottomRail: true, reverse: false, fascia: true, cassette: true, sideChannel: true, brackets: true, lining: true, fabricWidth: false, track: true, mount: false },
  // Work order: every build detail, dimensions shown, no prices. Shade Type off —
  // that's an internal price-tier name, not something to reveal (Product/Fabric
  // already say what it is, and the client shouldn't be able to shop the exact tier
  // elsewhere). Mount ON — the maker needs to know Wall vs. Ceiling.
  work: { table: false, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: true, bottomRail: true, reverse: true, fascia: true, cassette: true, sideChannel: true, brackets: true, lining: true, fabricWidth: true, track: true, mount: true },
  // DYMO sticker: short — product shown separately, so description = fabric + control.
  label: { table: false, product: false, fabric: true, color: false, control: true, system: false, style: false, headrail: false, bottomRail: false, reverse: false, fascia: false, cassette: false, sideChannel: false, brackets: false, lining: false, fabricWidth: false, track: false, mount: false },
};

// Editable pricing rates (Settings → Rates) so nothing is hard-coded in the engine.
// Drapery track hardware (Motor/Manual) lives here too, not per drapery style —
// it's the same physical part regardless of which style it's attached to.
const DEFAULT_RATES = { fascia: 4.5, cassette: 4.5, sideChannel: 4.5, costFactor: 0.43, ...DEFAULT_TRACK_RATES };

// The six drapery styles ported from the client's Excel sheet — formula-priced (see
// pricing.js), so each is just a name + which style's compute function to use, seeded
// once and left alone after that (existing rate edits are never overwritten).
const DRAPERY_TABLE_NAMES = {
  heavyFabric: 'Heavy Fabric',
  sheer: 'Sheer',
  corniceSmall: 'Cornice (up to 12")',
  corniceLarge: 'Cornice (13"-24")',
  swagJabot: 'Swag and Jabot',
  grommetPanel: 'Grommet Panel',
};
const OLD_DRAPERY_PREFIX = 'Drapery — '; // dropped — the category chip already says "Drapery"
const round1 = (n) => Math.round(n * 10) / 10;

function seedDrapery(state) {
  if (!state.categories.includes('Drapery')) state.categories.push('Drapery');
  for (const [style, name] of Object.entries(DRAPERY_TABLE_NAMES)) {
    const oldName = OLD_DRAPERY_PREFIX + name;
    if (!state.tables[name] && state.tables[oldName]) {
      // One-time rename for tables already seeded under the old prefixed name.
      state.tables[name] = state.tables[oldName]; delete state.tables[oldName];
      state.minPrice[name] = state.minPrice[oldName]; delete state.minPrice[oldName];
      (state.quotes || []).forEach((q) => q.items.forEach((it) => { if (it.table === oldName) it.table = name; }));
      deleteTableRow(oldName).catch(() => {});
      continue;
    }
    if (state.tables[name]) continue;
    state.tables[name] = { category: 'Drapery', kind: 'formula', style, rates: {} };
    state.minPrice[name] = 0;
  }
  // One-time migrations for tables already created under older field names.
  for (const table of Object.values(state.tables)) {
    if (table.category !== 'Drapery' || !table.rates) continue;
    if (table.rates.sellMultiplier != null) {
      table.rates.markupPct = round1((table.rates.sellMultiplier - 1) * 100);
      delete table.rates.sellMultiplier;
    }
    // Track used to live per-style; fold any customized value into the shared
    // Settings rate (first one found wins) and drop the now-unused per-style copy.
    for (const [oldKey, newKey, isMarkup] of [
      ['trackMotorPerFoot', 'trackMotorPerFoot', false], ['trackMotorMarkup', 'trackMotorMarkupPct', true],
      ['trackManualPerFoot', 'trackManualPerFoot', false], ['trackManualMarkup', 'trackManualMarkupPct', true],
    ]) {
      if (table.rates[oldKey] == null) continue;
      if (state.rates[newKey] === DEFAULT_TRACK_RATES[newKey]) state.rates[newKey] = isMarkup ? round1((table.rates[oldKey] - 1) * 100) : table.rates[oldKey];
      delete table.rates[oldKey];
    }
  }
}

function freshState() {
  return normalize({
    company: { ...DEFAULT_COMPANY },
    categories: ['Roller', 'Zebra'],
    tables: structuredClone(SEED.tables),
    minPrice: { ...SEED.minPrice },
    options: structuredClone(SEED.options),
    docConfig: structuredClone(DEFAULT_DOC_CONFIG),
    docFieldOrder: [],
    docFieldLabel: { client: {}, work: {}, label: {} },
    abbrev: { ...DEFAULT_ABBREV },
    rates: { ...DEFAULT_RATES },
    minimumOrder: 0,
    defaultInstallation: 0,
    taxRate: 7,          // Miami-Dade, FL default (6% state + 1% county)
    showInstall: false,  // installation stays baked into the unit price (clients dislike a separate line)
    customLists: [],
    quotes: [],
    nextQuoteNumber: 1001,
    nextInvoiceNumber: 2001,
  });
}

// Option list items carry an optional price: stored as { name, price }. Strings from
// older data (or the seed) migrate to { name, price: 0 }.
const toPriced = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { name: x, price: 0 } : { name: x.name, price: Number(x.price) || 0 }));
const FLAT_PRICED_LISTS = ['locations', 'wdNumbers', 'colors', 'controls', 'systems', 'styles', 'headrails', 'accessories', 'services', 'mount'];

// Table category ("Roller"/"Zebra"/anything you name) used to be guessed from the
// table's name; it's now an explicit field on the table, and Products/Fabrics are
// stored per category so each one gets its own dropdown options.
function normalize(state) {
  state.categories = [...new Set(state.categories && state.categories.length ? state.categories : ['Roller', 'Zebra'])];
  for (const [name, t] of Object.entries(state.tables || {})) {
    if (!t.category) t.category = /zebra/i.test(name) ? 'Zebra' : 'Roller'; // one-time backfill for pre-category data
    if (!state.categories.includes(t.category)) state.categories.push(t.category);
  }
  state.rates = { ...DEFAULT_RATES, ...(state.rates || {}) };
  seedDrapery(state); // reads/writes state.rates for the track-rate migration below
  for (const key of ['products', 'fabrics']) {
    const v = state.options[key];
    const migrated = {};
    if (Array.isArray(v)) {
      migrated.Roller = v.filter((x) => !/zebra/i.test(typeof x === 'string' ? x : x.name));
      migrated.Zebra = v.filter((x) => /zebra/i.test(typeof x === 'string' ? x : x.name));
    } else {
      for (const [cat, arr] of Object.entries(v || {})) {
        const name = cat === 'roller' ? 'Roller' : cat === 'zebra' ? 'Zebra' : cat; // old lowercase keys
        migrated[name] = (migrated[name] || []).concat(arr || []);
      }
    }
    for (const cat of state.categories) migrated[cat] = toPriced(migrated[cat] || []);
    state.options[key] = migrated;
  }
  // Mount (Ceiling/Wall) was a hardcoded worksheet dropdown, not a Lists option like
  // every other one — the one the user found when auditing for exactly this. Seed the
  // two existing values once so nothing on file changes meaning, then it's editable.
  if (!state.options.mount || !state.options.mount.length) state.options.mount = ['Ceiling', 'Wall'];
  if (!state.options.services) state.options.services = [];
  for (const key of FLAT_PRICED_LISTS) state.options[key] = toPriced(state.options[key]);
  delete state.manufacturers;
  state.minimumOrder = Number(state.minimumOrder) || 0;
  state.defaultInstallation = Number(state.defaultInstallation) || 0;
  state.taxRate = state.taxRate == null ? 7 : Number(state.taxRate) || 0;
  state.showInstall = state.showInstall === true; // default OFF
  // Backfill document config + custom lists for states saved before they existed.
  state.docConfig = state.docConfig || structuredClone(DEFAULT_DOC_CONFIG);
  for (const doc of ['client', 'work', 'label']) {
    state.docConfig[doc] = { ...DEFAULT_DOC_CONFIG[doc], ...(state.docConfig[doc] || {}) };
  }
  state.docConfig.work.table = false; // one-time: Shade Type briefly defaulted on for Work Order — turn it back off
  state.docFieldOrder = Array.isArray(state.docFieldOrder) ? state.docFieldOrder : [];
  state.docFieldLabel = state.docFieldLabel || {};
  for (const doc of ['client', 'work', 'label']) state.docFieldLabel[doc] = state.docFieldLabel[doc] || {};
  state.abbrev = { ...DEFAULT_ABBREV, ...(state.abbrev || {}) };


  // Custom lists used to be a single flat, always-priced array (a plain reference
  // list). They can now also be "per product type" — one column per category, same
  // shape as Products/Fabrics — so a new attribute (e.g. Drapery's Pattern) can be
  // added from the Lists screen without a code change. `id` is assigned once and
  // kept forever: it's what a worksheet line's value is stored against, so renaming
  // the list must never orphan data already picked on a quote.
  state.customLists = (state.customLists || []).map((l, i) => {
    const id = l.id || `cl_${i}_${Math.random().toString(36).slice(2, 8)}`;
    const perCategory = !!l.perCategory;
    const priced = l.priced !== false; // legacy lists were always priced
    const items = perCategory
      ? Object.fromEntries(state.categories.map((cat) => [cat, toPriced((l.items && !Array.isArray(l.items) ? l.items[cat] : null) || [])]))
      : toPriced(Array.isArray(l.items) ? l.items : []);
    return { id, name: l.name, perCategory, priced, items };
  });
  // Seed once: Pattern, requested as the first of these per-category attributes —
  // one list per product type (Roller/Zebra/Drapery all use it, filled in separately
  // from Lists). No price for now — the user can turn pricing on later from Lists.
  if (!state.customLists.some((l) => l.name === 'Pattern' && l.perCategory)) {
    state.customLists.push({
      id: `cl_pattern_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Pattern', perCategory: true, priced: false,
      items: Object.fromEntries(state.categories.map((cat) => [cat, []])),
    });
  }
  // One-time defaults, preserving exactly what used to print before any of this was a
  // choice: Headrail/Bottom rail/Fabric width/Mount/Track used to ALWAYS bake a fixed
  // label (or suffix) into the text on every document that showed them — default each
  // document's checkbox on for these five so the change doesn't silently drop text
  // that was already printing. Work Order also starts with "Pattern: X"/"Color: X" per
  // the user's own request. Every other field's label prefix starts off, toggled on
  // per field per document in Settings.
  for (const doc of ['client', 'work', 'label']) {
    for (const k of ['headrail', 'bottomRail', 'fabricWidth', 'mount', 'track']) {
      if (state.docFieldLabel[doc][k] === undefined) state.docFieldLabel[doc][k] = true;
    }
  }
  if (state.docFieldLabel.work.color === undefined) state.docFieldLabel.work.color = true;
  const patternList = state.customLists.find((l) => l.name === 'Pattern' && l.perCategory);
  if (patternList && state.docFieldLabel.work['custom_' + patternList.id] === undefined) {
    state.docFieldLabel.work['custom_' + patternList.id] = true;
  }
  // Migration: a field that's new to the orderable set (this session turned every
  // worksheet column — Qty, Width, Motor $, Notes...) into one) but missing from an
  // ALREADY-SAVED drag order must NOT fall back to descFields()'s "append at the very
  // end" rule — for someone who dragged Pattern around weeks ago, that flung Width,
  // Height and everything after them to the back of the worksheet, reordering columns
  // nobody touched. Slot each missing field in next to its natural neighbor instead.
  if (state.docFieldOrder.length) {
    const natural = descFields({ ...state, docFieldOrder: [] }).map((f) => f.key);
    const missing = natural.filter((k) => !state.docFieldOrder.includes(k));
    if (missing.length) {
      const next = [...state.docFieldOrder];
      for (const key of missing) {
        const naturalIdx = natural.indexOf(key);
        let insertAt = next.length; // no placed predecessor found → goes at the end
        for (let i = naturalIdx - 1; i >= 0; i--) {
          const idx = next.indexOf(natural[i]);
          if (idx !== -1) { insertAt = idx + 1; break; }
        }
        next.splice(insertAt, 0, key);
      }
      state.docFieldOrder = next;
    }
  }
  state.nextInvoiceNumber = Number(state.nextInvoiceNumber) || 2001;
  // Migrate legacy status/payment into the single lifecycle stage.
  (state.quotes || []).forEach((q) => {
    // Bracket mount used to be an "Is Wall" checkbox — now a plain Ceiling/Wall dropdown.
    (q.items || []).forEach((it) => {
      if (it.isWall !== undefined && it.mount === undefined) it.mount = it.isWall ? 'Wall' : 'Ceiling';
      delete it.isWall;
      if (it.mount === undefined) it.mount = 'Ceiling';
    });
    if (!q.stage) {
      q.stage = q.payment === 'Paid' ? '100% Paid'
        : q.payment === '50% paid' ? '50% Paid'
        : q.status === 'won' ? '100% Invoice' : 'Quote';
    }
    // Earlier versions folded payment into the stage ('50% Paid', 'Deposit Paid'…). Status says
    // what the document is, Payment says how much has come in — split them apart.
    const legacy = { Accepted: ['100% Invoice', 'Not paid'], Sent: ['Quote', 'Not paid'], 'Deposit Paid': ['50% Invoice', '50% Paid'], '50% Paid': ['50% Invoice', '50% Paid'], Paid: ['100% Invoice', '100% Paid'], '100% Paid': ['100% Invoice', '100% Paid'] }[q.stage];
    if (legacy) { q.stage = legacy[0]; q.payment = legacy[1]; }
    if (!PAYMENTS.includes(q.payment)) q.payment = 'Not paid';
    q.isTest = q.isTest === true;
  });
  return state;
}

// Invoice numbers are their own sequence, assigned once a quote becomes an invoice.
// Test quotes never take a number out of the real invoice sequence — otherwise
// practising would leave permanent gaps in the numbering the business relies on.
export function assignInvoiceNumber(q) {
  if (q.isTest) return null;
  if (!q.invoiceNumber) { q.invoiceNumber = state.nextInvoiceNumber++; save(); }
  return q.invoiceNumber;
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    return normalize({ ...freshState(), ...JSON.parse(raw) });
  } catch {
    return freshState();
  }
}

/* ---------------- sync ----------------
   The rules live in sync.js (and are exercised by test/sync.test.js against a network
   that delays, reorders and duplicates everything). This file only says what a
   "document" is for each kind of data and when to run the engine:
     quotes -> one document each     tables -> one per price table
     lists  -> one per option list   config -> one shared settings document
   Local state is always what is on screen; the engine merges the cloud into it and
   pushes what changed, so nothing arriving from outside can overwrite typing. */

const META_KEY = KEY + ':sync';
const CONFIG_ID = 'main';
const HEAVY = ['quotes', 'tables', 'minPrice', 'options', 'customLists'];

function configOf(s) {
  const { quotes, tables, minPrice, options, customLists, ...config } = s;
  return config;
}

const adapters = {
  quotes: {
    ids: () => state.quotes.map((q) => q.id),
    get: (id) => state.quotes.find((q) => q.id === id),
    // In place, so a screen holding this quote keeps pointing at the live object.
    set(id, doc) {
      const q = state.quotes.find((x) => x.id === id);
      if (!q) { state.quotes.unshift(doc); return; }
      for (const k of Object.keys(q)) if (!(k in doc)) delete q[k];
      Object.assign(q, doc);
    },
    remove: (id) => { state.quotes = state.quotes.filter((q) => q.id !== id); },
  },
  tables: {
    ids: () => Object.keys(state.tables),
    get: (id) => (id in state.tables ? { grid: state.tables[id], minPrice: state.minPrice[id] ?? 0 } : undefined),
    set(id, doc) { state.tables[id] = doc.grid; state.minPrice[id] = doc.minPrice || 0; },
    remove(id) { delete state.tables[id]; delete state.minPrice[id]; },
  },
  lists: {
    ids: () => [...Object.keys(state.options), 'customLists'],
    get: (id) => (id === 'customLists' ? state.customLists : state.options[id]),
    set(id, doc) { if (id === 'customLists') state.customLists = doc; else state.options[id] = doc; },
    remove(id) { delete state.options[id]; },
  },
  config: {
    ids: () => [CONFIG_ID],
    get: () => configOf(state),
    set(_id, doc) { Object.assign(state, Object.fromEntries(Object.entries(doc).filter(([k]) => !HEAVY.includes(k)))); },
    remove() {},
  },
};

const listeners = [];
// reason: 'local' | 'remote' — views re-render on either, but only a remote change
// needs the focus-preserving path.
export function onStateChange(fn) { listeners.push(fn); }

// 'saved' | 'saving' | 'error'. A write that does not reach the database has to be
// visible on screen — silently keeping it in localStorage is what let a whole day's
// quotes disappear.
let syncState = 'saved';
const syncListeners = [];
export function onSyncState(fn) { syncListeners.push(fn); fn(syncState); }
function setSyncState(s) {
  if (s === syncState) return;
  syncState = s;
  syncListeners.forEach((fn) => { try { fn(s); } catch (e) { console.warn(e); } });
}
function notify(reason) { listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.warn(e); } }); }

let opCounter = 0;
const sessionTag = Math.random().toString(36).slice(2, 10);

// Many inbound documents in one pull are one redraw, not one each.
let remotePending = false;
function remoteApplied() {
  if (remotePending) return;
  remotePending = true;
  queueMicrotask(() => {
    remotePending = false;
    normalize(state);
    ensureLineIds();
    localStorage.setItem(KEY, JSON.stringify(state));
    engine.scan();
    persistMeta();
    notify('remote');
  });
}

const engine = new SyncEngine({
  adapters,
  transport: { write: writeDoc, readAll, remove: deleteDoc },
  schedule: (fn, ms) => setTimeout(fn, ms),
  newOp: () => `${sessionTag}:${++opCounter}`,
  onRemote: remoteApplied,
  onState: (s) => { setSyncState(s); persistMeta(); },
});

// What was unsent when this page closes — the base each dirty document was edited from
// and deletes the server has not heard about — so a reload cannot turn into an overwrite.
function persistMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(engine.meta())); } catch { /* quota: the next save retries */ }
}
try { engine.restore(JSON.parse(localStorage.getItem(META_KEY) || 'null')); } catch { /* unreadable: treated as clean */ }
engine.adopt();

// Line identity is what lets two people's edits to the same quote merge line by line.
// A line without one (new, or copied) gets a fresh random id, and so does the second of
// two lines sharing an id (a duplicate).
const newLineId = () => 'i_' + Math.random().toString(36).slice(2, 10);
function ensureLineIds() {
  for (const q of state.quotes) {
    const seen = new Set();
    for (const it of q.items || []) {
      if (typeof it.id !== 'string' || !it.id || seen.has(it.id)) it.id = newLineId();
      seen.add(it.id);
    }
  }
}

export function save() {
  ensureLineIds();
  localStorage.setItem(KEY, JSON.stringify(state));
  engine.scan();
  persistMeta();
  notify('local');
}

// A postgres_changes row — rows arrive in commit order and carry their version, so
// the engine can tell what is new. Covers anything a missed message would have lost.
const KIND = { quotes: 'quotes', price_tables: 'tables', option_lists: 'lists', app_state: 'config' };
export function applyDbChange(ev) {
  const kind = KIND[ev?.table];
  if (!kind) return;
  if (ev.type === 'DELETE') { if (kind !== 'config') engine.inbound(kind, ev.old_record?.id, null); return; }
  const r = ev.record;
  if (r?.id && typeof r.rev === 'number') engine.inbound(kind, r.id, { rev: r.rev, data: r.data, op: r.op });
}

export function deletePriceTableCloudRow(name) {
  engine.remove('tables', name);
}

// Full read of everything. Runs at startup and again whenever the connection comes
// back or the tab is refocused, so a device that was asleep catches up even if it
// missed every live message. Order of arrival cannot hurt: stale rows are dropped.
async function pullAll() {
  if (!dbEnabled()) return;
  // An expired token turns every request into a silent 401, which looks exactly
  // like "sync just stopped working". Refresh first, always.
  if (!(await ensureSession())) return;
  await engine.pull();
}

// Startup: adopt the shared cloud copy, and send up anything this device has that the
// cloud has never seen (the engine inserts those after the first read).
export async function initCloud() {
  if (!dbEnabled()) return false;
  try {
    await pullAll();
    return true;
  } catch (e) {
    console.warn('cloud init failed, using local data', e);
    return false;
  }
}

// Wire the live channel into the store. Safe to call once at startup; it is a no-op
// without a configured Supabase project.
export function startLiveSync() {
  if (!dbEnabled()) return;
  const catchUp = () => { engine.resume(); pullAll().catch(() => {}); };
  onDbChange(applyDbChange);
  onStatus((s) => { if (s === 'live') catchUp(); });
  connectRealtime();
  // A tab that was in the background (phone locked, laptop asleep) can miss live
  // messages entirely — reconcile the moment it comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
  window.addEventListener('online', () => { connectRealtime(); catchUp(); });
  setInterval(() => { if (!document.hidden) pullAll().catch(() => {}); }, 60_000);
}

export function getState() {
  return state;
}

export function resetToDefaults() {
  state = freshState();
  save();
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  state = normalize({ ...freshState(), ...parsed });
  save();
}

// ---- quotes ----
export function newQuote() {
  const q = {
    id: 'q_' + Date.now().toString(36),
    number: state.nextQuoteNumber++,
    date: new Date().toISOString().slice(0, 10),
    installDate: '',
    deliveryDate: '',
    client: { name: '', address: '', phone: '', email: '' },
    discount: 0,
    stage: 'Quote',      // Quote → 50% Invoice → 100% Invoice
    payment: 'Not paid',
    isTest: false,       // a practice quote: kept out of every business number
    invoiceNumber: null, // assigned when it first becomes an invoice (50%/100% Invoice)
    items: [],
  };
  state.quotes.unshift(q);
  save();
  return q;
}

export function duplicateQuote(id) {
  const src = getQuote(id);
  const q = {
    ...structuredClone(src),
    client: { ...structuredClone(src.client), name: src.client?.name ? `${src.client.name} Copy` : '' },
    id: 'q_' + Date.now().toString(36),
    number: state.nextQuoteNumber++,
    date: new Date().toISOString().slice(0, 10),
    installDate: '',
    deliveryDate: '',
    stage: 'Quote',
    payment: 'Not paid',
    invoiceNumber: null,
  };
  q.items.forEach((it) => { it.id = newLineId(); });
  state.quotes.unshift(q);
  save();
  return q;
}

export function getQuote(id) {
  return state.quotes.find((q) => q.id === id);
}

export function deleteQuote(id) {
  state.quotes = state.quotes.filter((q) => q.id !== id);
  engine.remove('quotes', id);
  save();
}
