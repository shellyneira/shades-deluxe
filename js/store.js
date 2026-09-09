// Single source of truth. State lives in localStorage (instant), syncs to Supabase
// (durable, shared across devices) and is kept live over a Realtime channel so a
// change made on one screen shows up on every other screen within a second.
import { SEED } from './seed-data.js';
import { DRAPERY_STYLES, DEFAULT_TRACK_RATES } from './pricing.js';
import {
  dbEnabled, pullState, pushState,
  pullQuotes, pushQuotes, deleteQuoteRow,
  pullTables, pushTables, deleteTableRow,
  pullLists, pushLists, NotSignedIn,
} from './db.js';
import { connectRealtime, broadcastPatch, onPatch, onDbChange, onStatus, clientId } from './realtime.js';
import { ensureSession } from './auth.js';

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

// Which fields land in each document's Description column (Settings → Documents).
const DEFAULT_DOC_CONFIG = {
  // Client quote: no dimensions, shown with prices.
  client: { table: false, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: false, bottomRail: true, reverse: false, fascia: true, cassette: true, sideChannel: true, brackets: true, lining: true, track: true },
  // Work order: every build detail, dimensions shown, no prices. Shade Type off —
  // that's an internal price-tier name, not something to reveal (Product/Fabric
  // already say what it is, and the client shouldn't be able to shop the exact tier
  // elsewhere).
  work: { table: false, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: true, bottomRail: true, reverse: true, fascia: true, cassette: true, sideChannel: true, brackets: true, lining: true, track: true },
  // DYMO sticker: short — product shown separately, so description = fabric + control.
  label: { table: false, product: false, fabric: true, color: false, control: true, system: false, style: false, headrail: false, bottomRail: false, reverse: false, fascia: false, cassette: false, sideChannel: false, brackets: false, lining: false, track: false },
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
const FLAT_PRICED_LISTS = ['locations', 'wdNumbers', 'colors', 'controls', 'systems', 'styles', 'headrails'];

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
  for (const key of FLAT_PRICED_LISTS) state.options[key] = toPriced(state.options[key]);
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


  state.customLists = (state.customLists || []).map((l) => ({ name: l.name, items: toPriced(l.items) }));
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
        : q.status === 'won' ? 'Accepted' : 'Quote';
    }
    // Rename earlier stage labels to the current, simpler set.
    q.stage = { Sent: 'Quote', 'Deposit Paid': '50% Paid', Paid: '100% Paid' }[q.stage] || q.stage;
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

/* ---------------- sync engine ----------------
   Local writes are the fast path: localStorage first, then two outbound channels.
     1. broadcast  — fires immediately, so the other screen updates in well under a
                     second (this is what makes it feel like a shared document).
     2. Postgres   — debounced, the durable copy that survives a closed tab.
   Inbound, either channel can deliver a row; both funnel through applyRows(), which
   is idempotent, so a broadcast and its postgres_changes echo cost nothing.
   Only rows THIS device changed are ever sent — another user's untouched rows are
   never rewritten, so nobody's work gets clobbered by someone else pressing save. */

let syncTimer;
let broadcastTimer;
// Retries are bounded and then STOP. A timer that keeps firing forever is how a
// failing client turns into a denial of service against its own backend — and it
// never fixed anything a later real event would not have fixed anyway. Nothing is
// lost when we give up: the rows stay marked unsent, the pill stays red, and the
// next genuine event (an edit, the tab being refocused, the network returning, the
// live channel reconnecting) picks them straight back up.
const MAX_RETRIES = 4;
let retryDelay = 5000;
let retriesLeft = MAX_RETRIES;
let applyingRemote = false;
// id -> JSON snapshot of what we last pushed/broadcast, so a sync only sends rows
// THIS device actually changed.
let lastPushedQuote = {};
let lastPushedTable = {};
let lastPushedList = {};
let lastSentQuote = {};
let lastSentTable = {};
let lastSentList = {};
let lastSentConfig = '';
// Quote id -> when this device last touched it. A remote copy of a quote someone is
// actively typing into is held back for a moment instead of yanking the row out from
// under them; once they pause, the newest write wins and both screens converge.
const localTouch = {};
const EDIT_GRACE = 1500;
const pendingRemote = new Map();
let pendingTimer;

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

// Price tables/minPrice and options/customLists are split into per-row payloads
// ({id, data}) so each table/list is its own database row (see db.js).
function tableRows(s) {
  return Object.entries(s.tables).map(([id, grid]) => ({ id, data: { grid, minPrice: s.minPrice[id] ?? 0 } }));
}
function listRows(s) {
  return [...Object.entries(s.options).map(([id, data]) => ({ id, data })), { id: 'customLists', data: s.customLists }];
}
function configOf(s) {
  const { quotes, tables, minPrice, options, customLists, ...config } = s;
  return config;
}

function changedSince(seen, rows, key = (r) => r.id, val = (r) => r.data) {
  return rows.filter((r) => JSON.stringify(val(r)) !== seen[key(r)]);
}

function scheduleSync() {
  if (!dbEnabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const config = configOf(state);
    const changedQuotes = state.quotes.filter((q) => JSON.stringify(q) !== lastPushedQuote[q.id]);
    const changedTables = changedSince(lastPushedTable, tableRows(state));
    const changedLists = changedSince(lastPushedList, listRows(state));
    setSyncState('saving');
    Promise.all([
      pushState({ ...config, quotes: [], tables: {}, minPrice: {}, options: {}, customLists: [] }),
      pushQuotes(changedQuotes),
      pushTables(changedTables),
      pushLists(changedLists),
    ])
      .then(() => {
        changedQuotes.forEach((q) => { lastPushedQuote[q.id] = JSON.stringify(q); });
        changedTables.forEach((r) => { lastPushedTable[r.id] = JSON.stringify(r.data); });
        changedLists.forEach((r) => { lastPushedList[r.id] = JSON.stringify(r.data); });
        setSyncState('saved');
        retryDelay = 5000;
        retriesLeft = MAX_RETRIES;
      })
      .catch((e) => {
        setSyncState('error');
        console.warn('cloud sync failed', e);
        clearTimeout(syncTimer);
        // A signed-out browser gets no retries at all — asking again cannot help.
        if (e instanceof NotSignedIn || retriesLeft <= 0) { retriesLeft = 0; return; }
        retriesLeft--;
        retryDelay = Math.min(retryDelay * 2, 40_000);
        syncTimer = setTimeout(scheduleSync, retryDelay);
      });
  }, 600);
}

// The instant path. Coalesced over one frame-ish window so a burst of keystrokes is
// one message on the wire, not one per character. Nothing is marked as sent unless
// the socket actually took it — otherwise an edit made while offline would be
// skipped as "already broadcast" once the connection came back.
let pendingBroadcast = null;
function scheduleBroadcast() {
  if (!dbEnabled() || !pendingBroadcast) return;
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const patch = pendingBroadcast;
    pendingBroadcast = null;
    if (!broadcastPatch(patch)) return;
    patch.quotes.forEach((q) => { lastSentQuote[q.id] = JSON.stringify(q); });
    patch.tables.forEach((r) => { lastSentTable[r.id] = JSON.stringify(r.data); });
    patch.lists.forEach((r) => { lastSentList[r.id] = JSON.stringify(r.data); });
    if (patch.config) lastSentConfig = JSON.stringify(configOf(state));
  }, 120);
}

// Something changed for the better — a new edit, the tab coming back, the network
// returning. Any of those earns a fresh attempt (and a fresh budget); none of them
// is a timer.
function resumeSync() {
  retriesLeft = MAX_RETRIES;
  retryDelay = 5000;
  scheduleSync();
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (!applyingRemote) {
    retriesLeft = MAX_RETRIES;
    retryDelay = 5000;
    // One change scan per save, shared by both outbound channels. It also stamps
    // each touched quote so an inbound copy of a row being typed into right now is
    // held back rather than overwriting the caret.
    const now = Date.now();
    const quotes = state.quotes.filter((q) => JSON.stringify(q) !== lastSentQuote[q.id]);
    quotes.forEach((q) => { localTouch[q.id] = now; });
    const config = configOf(state);
    const configChanged = JSON.stringify(config) !== lastSentConfig;
    pendingBroadcast = {
      quotes,
      tables: changedSince(lastSentTable, tableRows(state)),
      lists: changedSince(lastSentList, listRows(state)),
      config: configChanged ? { ...config, quotes: [], tables: {}, minPrice: {}, options: {}, customLists: [] } : null,
    };
    if (quotes.length || pendingBroadcast.tables.length || pendingBroadcast.lists.length || configChanged) scheduleBroadcast();
    else pendingBroadcast = null;
    scheduleSync();
  }
  notify(applyingRemote ? 'remote' : 'local');
}

/* ---------------- inbound ---------------- */

// Merge rows that arrived from someone else. Everything inbound goes through here,
// whichever channel carried it.
function applyRows({ quotes = [], tables = [], lists = [], deletedQuotes = [], config = null }) {
  let changed = false;
  const now = Date.now();

  for (const q of quotes) {
    if (!q?.id) continue;
    const mine = state.quotes.find((x) => x.id === q.id);
    if (mine && JSON.stringify(mine) === JSON.stringify(q)) continue;
    if (now - (localTouch[q.id] || 0) < EDIT_GRACE) { hold(q.id, q); continue; }
    if (mine) Object.assign(mine, q);
    else state.quotes.unshift(q);
    changed = true;
  }
  for (const id of deletedQuotes) {
    if (!state.quotes.some((q) => q.id === id)) continue;
    state.quotes = state.quotes.filter((q) => q.id !== id);
    changed = true;
  }
  for (const r of tables) {
    if (!r?.id || !r.data) continue;
    if (JSON.stringify({ grid: state.tables[r.id], minPrice: state.minPrice[r.id] ?? 0 }) === JSON.stringify(r.data)) continue;
    state.tables[r.id] = r.data.grid;
    state.minPrice[r.id] = r.data.minPrice || 0;
    changed = true;
  }
  for (const r of lists) {
    if (!r?.id || r.data == null) continue;
    const current = r.id === 'customLists' ? state.customLists : state.options[r.id];
    if (JSON.stringify(current) === JSON.stringify(r.data)) continue;
    if (r.id === 'customLists') state.customLists = r.data; else state.options[r.id] = r.data;
    changed = true;
  }
  if (config) {
    const { quotes: _q, tables: _t, minPrice: _m, options: _o, customLists: _c, ...rest } = config;
    if (JSON.stringify(configOf(state)) !== JSON.stringify(rest)) { Object.assign(state, rest); changed = true; }
  }
  if (!changed) return;

  // Mark everything we just took as already-known, so the merge doesn't bounce
  // straight back out as a "local change".
  quotes.forEach((q) => { lastSentQuote[q.id] = lastPushedQuote[q.id] = JSON.stringify(q); });
  tables.forEach((r) => { lastSentTable[r.id] = lastPushedTable[r.id] = JSON.stringify(r.data); });
  lists.forEach((r) => { lastSentList[r.id] = lastPushedList[r.id] = JSON.stringify(r.data); });

  applyingRemote = true;
  try { state = normalize(state); save(); } finally { applyingRemote = false; }
}

// Someone else's version of a quote arrived while it was being typed into here.
// Park it and retry once this device goes quiet.
function hold(id, quote) {
  pendingRemote.set(id, quote);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const rows = [...pendingRemote.values()];
    pendingRemote.clear();
    if (rows.length) applyRows({ quotes: rows });
  }, EDIT_GRACE + 100);
}

// A patch broadcast by another tab — the fast path, arrives before the DB write.
export function applyRemotePatch(p) {
  if (!p || p.from === clientId()) return;
  applyRows(p);
}

// A postgres_changes row — the durable net (covers anything the broadcast missed).
export function applyDbChange(ev) {
  if (!ev?.table) return;
  const row = ev.record || ev.old_record || {};
  const del = ev.type === 'DELETE';
  if (ev.table === 'quotes') applyRows(del ? { deletedQuotes: [row.id] } : { quotes: [row.data] });
  else if (ev.table === 'price_tables') applyRows(del ? {} : { tables: [{ id: row.id, data: row.data }] });
  else if (ev.table === 'option_lists') applyRows(del ? {} : { lists: [{ id: row.id, data: row.data }] });
  else if (ev.table === 'app_state' && !del) applyRows({ config: row.data });
}

/* ---------------- pull ---------------- */

export function deletePriceTableCloudRow(name) {
  deleteTableRow(name).catch((e) => console.warn('cloud delete failed', e));
}

// Full refresh from the cloud. Runs at startup and again whenever the connection
// comes back or the tab is refocused, so a device that was asleep catches up even
// if it missed every live message.
export async function pullAll() {
  if (!dbEnabled()) return false;
  // An expired token turns every request into a silent 401, which looks exactly
  // like "sync just stopped working". Refresh first, always.
  if (!(await ensureSession())) return false;
  const [remote, remoteQuotes, remoteTables, remoteLists] = await Promise.all([pullState(), pullQuotes(), pullTables(), pullLists()]);
  const hasRemote = remote || remoteQuotes?.length || remoteTables?.length || remoteLists?.length;
  if (!hasRemote) return false;

  // Prefer each row-based source; fall back to the old embedded blob (one-time migration).
  const quotes = (remoteQuotes && remoteQuotes.length) ? remoteQuotes : (remote?.quotes || []);
  const tables = (remoteTables || []).map((r) => ({ id: r.id, data: r.data }));
  const lists = (remoteLists || []).map((r) => ({ id: r.id, data: r.data }));
  if (!tables.length && remote?.tables) {
    for (const [id, grid] of Object.entries(remote.tables)) tables.push({ id, data: { grid, minPrice: remote.minPrice?.[id] || 0 } });
  }
  if (!lists.length && remote?.options) {
    for (const [id, data] of Object.entries(remote.options)) lists.push({ id, data });
    if (remote.customLists) lists.push({ id: 'customLists', data: remote.customLists });
  }
  // A quote missing from the cloud was deleted by someone else — drop it here too,
  // unless it was created on this device and has not been pushed yet.
  const cloudIds = new Set(quotes.map((q) => q.id));
  const deletedQuotes = state.quotes.filter((q) => !cloudIds.has(q.id) && lastPushedQuote[q.id]).map((q) => q.id);
  applyRows({ quotes, tables, lists, deletedQuotes, config: remote });
  return true;
}

// Startup: adopt the shared cloud copy, or seed the cloud from this device if it is
// still empty. Returns true if remote data landed.
export async function initCloud() {
  if (!dbEnabled()) return false;
  try {
    if (await pullAll()) { reconcileUpwards(); return true; }
    const { quotes, ...config } = state;
    await Promise.all([
      pushState({ ...config, quotes: [], tables: {}, minPrice: {}, options: {}, customLists: [] }),
      pushQuotes(quotes),
      pushTables(tableRows(state)),
      pushLists(listRows(state)),
    ]); // seed cloud from local
  } catch (e) {
    console.warn('cloud init failed, using local data', e);
  }
  return false;
}

// Anything on this device that the cloud has never seen goes up now. Quotes written
// while the access token was expired only ever reached localStorage; without this
// they would sit in one browser forever, since nothing else re-sends a row that was
// never acknowledged.
function reconcileUpwards() {
  const unsent = state.quotes.filter((q) => !lastPushedQuote[q.id]).length
    + changedSince(lastPushedTable, tableRows(state)).length
    + changedSince(lastPushedList, listRows(state)).length;
  if (unsent) scheduleSync();
}

// Wire the live channel into the store. Safe to call once at startup; it is a no-op
// without a configured Supabase project.
export function startLiveSync() {
  if (!dbEnabled()) return;
  onPatch(applyRemotePatch);
  onDbChange(applyDbChange);
  onStatus((s) => { if (s === 'live') { resumeSync(); pullAll().catch(() => {}); } });
  connectRealtime();
  // Belt and braces: a tab that was in the background (phone locked, laptop asleep)
  // can miss live messages entirely — reconcile the moment it comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { resumeSync(); pullAll().catch(() => {}); } });
  window.addEventListener('online', () => { connectRealtime(); resumeSync(); pullAll().catch(() => {}); });
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
    stage: 'Quote',      // Quote → Sent → Accepted → Deposit Paid → Paid
    isTest: false,       // a practice quote: kept out of every business number
    invoiceNumber: null, // assigned when it first becomes an invoice (Accepted+)
    items: [],
  };
  state.quotes.unshift(q);
  save();
  return q;
}

export function getQuote(id) {
  return state.quotes.find((q) => q.id === id);
}

export function deleteQuote(id) {
  state.quotes = state.quotes.filter((q) => q.id !== id);
  save();
  deleteQuoteRow(id).catch((e) => console.warn('cloud delete failed', e));
}
