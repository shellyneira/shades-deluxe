// Thin Supabase (PostgREST) client over fetch — no SDK, no build step.
// The entire app state lives in one row (app_state.id = 'main'); we pull it on
// startup and push a debounced copy on every change. Last write wins, which is
// the right trade-off for a single small business editing one thing at a time.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { accessToken } from './auth.js';

export function dbEnabled() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + accessToken(),
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function pullState() {
  if (!dbEnabled()) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/app_state?id=eq.main&select=data`, { headers: headers() });
  if (!r.ok) throw new Error('pull ' + r.status);
  const rows = await r.json();
  return rows[0]?.data ?? null;
}

export async function pushState(data) {
  if (!dbEnabled()) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/app_state?on_conflict=id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ id: 'main', data, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error('push ' + r.status);
}

// Quotes are their own rows (id per quote) so devices don't clobber each other's work.
export async function pullQuotes() {
  if (!dbEnabled()) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/quotes?select=data&order=number.desc`, { headers: headers() });
  if (!r.ok) throw new Error('pullq ' + r.status);
  return (await r.json()).map((row) => row.data);
}

export async function pushQuotes(quotes) {
  if (!dbEnabled() || !quotes.length) return;
  const rows = quotes.map((q) => ({ id: q.id, number: q.number, client_name: q.client?.name || '', status: q.status || 'draft', data: q, updated_at: new Date().toISOString() }));
  const r = await fetch(`${SUPABASE_URL}/rest/v1/quotes?on_conflict=id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error('pushq ' + r.status);
}

export async function deleteQuoteRow(id) {
  if (!dbEnabled()) return;
  await fetch(`${SUPABASE_URL}/rest/v1/quotes?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
}
