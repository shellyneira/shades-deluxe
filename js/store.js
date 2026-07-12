// Single source of truth. State lives in localStorage (instant) and syncs to
// Supabase when configured (survives device loss, shared across devices).
import { SEED } from './seed-data.js';
import { dbEnabled, pullState, pushState } from './db.js';

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
  client: { table: false, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: false, bottomRail: true, fascia: true, sideChannel: true, brackets: true },
  // Work order: every build detail, dimensions shown, no prices.
  work: { table: true, product: true, fabric: true, color: true, control: true, system: true, style: true, headrail: true, bottomRail: true, fascia: true, sideChannel: true, brackets: true },
};

// Editable pricing rates (Settings → Rates) so nothing is hard-coded in the engine.
const DEFAULT_RATES = { fascia: 4.5, sideChannel: 4.5, costFactor: 0.43 };

function freshState() {
  return normalize({
    company: { ...DEFAULT_COMPANY },
    tables: structuredClone(SEED.tables),
    minPrice: { ...SEED.minPrice },
    options: structuredClone(SEED.options),
    docConfig: structuredClone(DEFAULT_DOC_CONFIG),
    rates: { ...DEFAULT_RATES },
    customLists: [],
    quotes: [],
    nextQuoteNumber: 1001,
  });
}

// Option list items carry an optional price: stored as { name, price }. Strings from
// older data (or the seed) migrate to { name, price: 0 }.
const toPriced = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { name: x, price: 0 } : { name: x.name, price: Number(x.price) || 0 }));
const FLAT_PRICED_LISTS = ['locations', 'wdNumbers', 'colors', 'controls', 'systems', 'styles', 'headrails'];

// Products and Fabrics are stored per shade type ({roller, zebra}) so membership is
// explicit rather than guessed from the name. Migrate any legacy flat arrays.
function normalize(state) {
  for (const key of ['products', 'fabrics']) {
    const v = state.options[key];
    if (Array.isArray(v)) {
      state.options[key] = { roller: v.filter((x) => !/zebra/i.test(typeof x === 'string' ? x : x.name)), zebra: v.filter((x) => /zebra/i.test(typeof x === 'string' ? x : x.name)) };
    } else if (v && typeof v === 'object') {
      v.roller = v.roller || []; v.zebra = v.zebra || [];
    } else {
      state.options[key] = { roller: [], zebra: [] };
    }
    state.options[key].roller = toPriced(state.options[key].roller);
    state.options[key].zebra = toPriced(state.options[key].zebra);
  }
  for (const key of FLAT_PRICED_LISTS) state.options[key] = toPriced(state.options[key]);
  state.rates = { ...DEFAULT_RATES, ...(state.rates || {}) };
  // Backfill document config + custom lists for states saved before they existed.
  state.docConfig = state.docConfig || structuredClone(DEFAULT_DOC_CONFIG);
  for (const doc of ['client', 'work']) {
    state.docConfig[doc] = { ...DEFAULT_DOC_CONFIG[doc], ...(state.docConfig[doc] || {}) };
  }
  state.customLists = (state.customLists || []).map((l) => ({ name: l.name, items: toPriced(l.items) }));
  return state;
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
function scheduleSync() {
  if (!dbEnabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { pushState(state).catch((e) => console.warn('cloud sync failed', e)); }, 700);
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  scheduleSync();
}

// Pull the shared cloud copy at startup. Returns true if remote data replaced local.
export async function initCloud() {
  if (!dbEnabled()) return false;
  try {
    const remote = await pullState();
    if (remote) {
      state = normalize({ ...freshState(), ...remote });
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    }
    await pushState(state); // first run — seed the cloud from local
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
    status: 'draft',
    payment: 'Unpaid',
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
}
