// Single source of truth. State lives in localStorage (instant) and syncs to
// Supabase when configured (survives device loss, shared across devices).
import { SEED } from './seed-data.js';
import { DRAPERY_STYLES, DEFAULT_TRACK_RATES } from './pricing.js';
import {
  dbEnabled, pullState, pushState,
  pullQuotes, pushQuotes, deleteQuoteRow,
  pullTables, pushTables, deleteTableRow,
  pullLists, pushLists,
} from './db.js';

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
  client: { table: false, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: false, bottomRail: true, fascia: true, cassette: true, sideChannel: true, brackets: true, lining: true, track: true },
  // Work order: every build detail, dimensions shown, no prices.
  work: { table: true, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: true, bottomRail: true, fascia: true, cassette: true, sideChannel: true, brackets: true, lining: true, track: true },
  // DYMO sticker: short — product shown separately, so description = fabric + control.
  label: { table: false, product: false, fabric: true, color: false, control: true, system: false, style: false, headrail: false, bottomRail: false, fascia: false, cassette: false, sideChannel: false, brackets: false, lining: false, track: false },
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
  });
  return state;
}

// Invoice numbers are their own sequence, assigned once a quote becomes an invoice.
export function assignInvoiceNumber(q) {
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

let syncTimer;
// id -> JSON snapshot of what we last pushed, so a sync only sends rows THIS
// device actually changed — another device's untouched rows are left alone.
let lastPushedQuote = {};
let lastPushedTable = {};
let lastPushedList = {};

// Price tables/minPrice and options/customLists are split into per-row payloads
// ({id, data}) so each table/list is its own database row (see db.js).
function tableRows(s) {
  return Object.entries(s.tables).map(([id, grid]) => ({ id, data: { grid, minPrice: s.minPrice[id] ?? 0 } }));
}
function listRows(s) {
  return [...Object.entries(s.options).map(([id, data]) => ({ id, data })), { id: 'customLists', data: s.customLists }];
}

function scheduleSync() {
  if (!dbEnabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const { quotes, tables, minPrice, options, customLists, ...config } = state;
    // Only push rows that actually changed here — never overwrite another user's work.
    const changedQuotes = quotes.filter((q) => JSON.stringify(q) !== lastPushedQuote[q.id]);
    const changedTables = tableRows(state).filter((r) => JSON.stringify(r.data) !== lastPushedTable[r.id]);
    const changedLists = listRows(state).filter((r) => JSON.stringify(r.data) !== lastPushedList[r.id]);
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
      })
      .catch((e) => console.warn('cloud sync failed', e));
  }, 700);
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  scheduleSync();
}

// A price table was renamed or deleted locally — remove its old row so it doesn't
// keep reappearing on the next pull.
export function deletePriceTableCloudRow(name) {
  deleteTableRow(name).catch((e) => console.warn('cloud delete failed', e));
}

// Pull the shared cloud copy at startup. Returns true if remote data replaced local.
export async function initCloud() {
  if (!dbEnabled()) return false;
  try {
    const [remote, remoteQuotes, remoteTables, remoteLists] = await Promise.all([pullState(), pullQuotes(), pullTables(), pullLists()]);
    if (remote || (remoteQuotes && remoteQuotes.length) || (remoteTables && remoteTables.length) || (remoteLists && remoteLists.length)) {
      // Prefer each row-based source; fall back to the old embedded blob (one-time migration).
      const quotes = (remoteQuotes && remoteQuotes.length) ? remoteQuotes : (remote?.quotes || []);
      let tables = remote?.tables, minPrice = remote?.minPrice;
      if (remoteTables && remoteTables.length) {
        tables = {}; minPrice = {};
        remoteTables.forEach((r) => { tables[r.id] = r.data.grid; minPrice[r.id] = r.data.minPrice || 0; });
      }
      let options = remote?.options, customLists = remote?.customLists;
      if (remoteLists && remoteLists.length) {
        options = {}; customLists = [];
        remoteLists.forEach((r) => { if (r.id === 'customLists') customLists = r.data; else options[r.id] = r.data; });
      }
      state = normalize({
        ...freshState(), ...(remote || {}), quotes,
        ...(tables ? { tables } : {}), ...(minPrice ? { minPrice } : {}),
        ...(options ? { options } : {}), ...(customLists ? { customLists } : {}),
      });
      localStorage.setItem(KEY, JSON.stringify(state));
      // These rows are already synced — don't re-push them as "changed" on the next save.
      (remoteQuotes || []).forEach((q) => { lastPushedQuote[q.id] = JSON.stringify(q); });
      (remoteTables || []).forEach((r) => { lastPushedTable[r.id] = JSON.stringify(r.data); });
      (remoteLists || []).forEach((r) => { lastPushedList[r.id] = JSON.stringify(r.data); });
      scheduleSync(); // push only whatever was migrated from the old blob
      return true;
    }
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
    client: { name: '', address: '', phone: '', email: '' },
    discount: 0,
    stage: 'Quote',      // Quote → Sent → Accepted → Deposit Paid → Paid
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
