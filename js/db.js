// Thin Supabase (PostgREST) client over fetch — no SDK, no build step.
// Company info and rates live in one shared row (app_state.id = 'main'); quotes,
// price tables and lists are each their own row. Every row is versioned and written
// compare-and-swap — the merge rules live in sync.js.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { accessToken, ensureSession } from './auth.js';

export function dbEnabled() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Raised when there is no usable session. Callers back off on this instead of
// retrying, since no amount of retrying will fix a signed-out browser.
export class NotSignedIn extends Error {
  constructor() { super('not signed in'); this.name = 'NotSignedIn'; }
}

// The access token expires about hourly. A tab left open all day would otherwise
// keep sending a dead token, and PostgREST answers 401 — so every write silently
// vanished while the app still looked like it had saved (localStorage had it).
// That is how quotes went missing. Refresh before every request instead, and if the
// session cannot be refreshed, do not fire the request at all: an unauthenticated
// write can only ever be a 401, and retrying one on a timer is just a storm.
async function headers(extra = {}) {
  if (!(await ensureSession())) throw new NotSignedIn();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + accessToken(),
    'Content-Type': 'application/json',
    ...extra,
  };
}

// One transport for every synced document kind. Writes are compare-and-swap on `rev`
// (maintained by a trigger, see supabase/schema.sql): an update only lands if the row is
// still at the version the writer last saw, and otherwise the caller gets the current row
// back to merge with.
const TABLE = { quotes: 'quotes', tables: 'price_tables', lists: 'option_lists', config: 'app_state' };
const endpoint = (kind) => `${SUPABASE_URL}/rest/v1/${TABLE[kind]}`;
const asRow = (r) => ({ id: r.id, rev: r.rev, op: r.op, data: r.data });

function rowFor(kind, data, op) {
  const row = { data, op, updated_at: new Date().toISOString() };
  if (kind === 'quotes') Object.assign(row, { number: data.number, client_name: data.client?.name || '', status: data.status || 'draft' });
  return row;
}

export async function readAll(kind) {
  const r = await fetch(`${endpoint(kind)}?select=id,rev,op,data`, { headers: await headers() });
  if (!r.ok) throw new Error(`read ${kind} ${r.status}`);
  return (await r.json()).map(asRow);
}

async function readOne(kind, id) {
  const r = await fetch(`${endpoint(kind)}?id=eq.${encodeURIComponent(id)}&select=id,rev,op,data`, { headers: await headers() });
  if (!r.ok) throw new Error(`read ${kind} ${r.status}`);
  const rows = await r.json();
  return rows[0] ? asRow(rows[0]) : null;
}

// baseRev 0 means "insert". Resolves {rev} on success or {conflict, row} when someone
// else got there first (row is null if it was deleted).
export async function writeDoc(kind, id, { baseRev, data, op }) {
  const body = rowFor(kind, data, op);
  const pick = { Prefer: 'return=representation' };
  const r = baseRev === 0
    ? await fetch(endpoint(kind), { method: 'POST', headers: await headers(pick), body: JSON.stringify({ id, ...body }) })
    : await fetch(`${endpoint(kind)}?id=eq.${encodeURIComponent(id)}&rev=eq.${baseRev}`, { method: 'PATCH', headers: await headers(pick), body: JSON.stringify(body) });
  if (r.status === 409) return { conflict: true, row: await readOne(kind, id) };
  if (!r.ok) throw new Error(`write ${kind} ${r.status}`);
  const rows = await r.json();
  if (!rows.length) return { conflict: true, row: await readOne(kind, id) };
  return { rev: rows[0].rev };
}

export async function deleteDoc(kind, id) {
  const r = await fetch(`${endpoint(kind)}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: await headers() });
  if (!r.ok) throw new Error(`delete ${kind} ${r.status}`);
}
