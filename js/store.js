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

function freshState() {
  return {
    company: { ...DEFAULT_COMPANY },
    tables: structuredClone(SEED.tables),
    minPrice: { ...SEED.minPrice },
    options: structuredClone(SEED.options),
    quotes: [],
    nextQuoteNumber: 1001,
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    return { ...freshState(), ...JSON.parse(raw) };
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
      state = { ...freshState(), ...remote };
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
  state = { ...freshState(), ...parsed };
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
