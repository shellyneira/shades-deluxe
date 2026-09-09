// Live collaboration transport — one Supabase Realtime channel over a plain
// WebSocket (Phoenix protocol), no SDK, so the app stays build-free.
//
// Three things ride on the same channel:
//   • broadcast        — instant row patches between open tabs (~50ms, independent
//                        of how fast the row lands in Postgres)
//   • presence         — who is online, which view / quote / field they are on
//   • postgres_changes — the durable net: anything written while you were offline,
//                        or by a client whose broadcast you missed, still arrives
//
// The channel is private, so joining requires a logged-in user (RLS on
// realtime.messages — see supabase/schema.sql).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { accessToken, ensureSession, getSession } from './auth.js';

const TOPIC = 'realtime:shades-deluxe';
const TABLES = ['app_state', 'quotes', 'price_tables', 'option_lists'];

// Stable per-tab identity: two tabs of the same person are two cursors.
const CLIENT_ID = Math.random().toString(36).slice(2, 10);

const COLORS = ['#3a6ea5', '#b9552f', '#3f7d5f', '#8e44ad', '#c99a3f', '#c0392b', '#16a085', '#d9713c'];
// Same person -> same color on every screen, so "the blue one is Maria" holds.
function colorFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

let ws = null;
let ref = 0;
let joined = false;
let heartbeat;
let reconnectTimer;
let tokenTimer;
let attempts = 0;
let status = 'offline';       // offline | connecting | live
let myMeta = {};
let peers = [];               // [{ id, email, name, color, view, quoteId, field, self }]
const handlers = { patch: [], db: [], presence: [], status: [] };

const nextRef = () => String(++ref);
const emit = (kind, arg) => handlers[kind].forEach((fn) => { try { fn(arg); } catch (e) { console.warn(e); } });

export function realtimeStatus() { return status; }
export function clientId() { return CLIENT_ID; }
export function myColor() { return colorFor(CLIENT_ID); }
export function getPeers() { return peers.filter((p) => !p.self); }

export function onPatch(fn) { handlers.patch.push(fn); }
export function onDbChange(fn) { handlers.db.push(fn); }
export function onPresence(fn) { handlers.presence.push(fn); }
export function onStatus(fn) { handlers.status.push(fn); fn(status); }

function setStatus(s) {
  if (s === status) return;
  status = s;
  emit('status', s);
}

function send(event, payload, topic = TOPIC) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ topic, event, payload, ref: nextRef() }));
  return true;
}

/* ---------------- connection ---------------- */

export function connectRealtime() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(reconnectTimer);
  setStatus('connecting');

  const url = SUPABASE_URL.replace(/^http/, 'ws') +
    `/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;

  try { ws = new WebSocket(url); } catch { return scheduleReconnect(); }

  ws.onopen = () => {
    joined = false;
    send('phx_join', {
      config: {
        private: true,
        broadcast: { self: false, ack: false },
        presence: { key: CLIENT_ID },
        postgres_changes: TABLES.map((table) => ({ event: '*', schema: 'public', table })),
      },
      access_token: accessToken(),
    });
    clearInterval(heartbeat);
    heartbeat = setInterval(() => send('heartbeat', {}, 'phoenix'), 25_000);
    // The JWT expires roughly hourly; hand the socket a fresh one before it does,
    // otherwise the server drops us mid-session with no obvious cause.
    clearInterval(tokenTimer);
    tokenTimer = setInterval(async () => {
      if (await ensureSession()) send('access_token', { access_token: accessToken() });
    }, 10 * 60_000);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const { event, payload } = msg;

    if (event === 'phx_reply' && msg.topic === TOPIC) {
      if (payload?.status === 'error') {
        console.warn('realtime join rejected', payload.response);
        // Almost always the missing realtime.messages policy — run supabase/schema.sql.
        setStatus('offline');
        ws.close();
        return;
      }
      if (!joined) {
        joined = true;
        attempts = 0;
        setStatus('live');
        trackPresence(myMeta);
      }
      return;
    }
    if (event === 'broadcast') emit('patch', payload?.payload ?? payload);
    else if (event === 'postgres_changes') emit('db', payload?.data);
    else if (event === 'presence_state') { peers = fromState(payload); emit('presence', getPeers()); }
    else if (event === 'presence_diff') { peers = applyDiff(peers, payload); emit('presence', getPeers()); }
    else if (event === 'phx_error' || event === 'phx_close') ws.close();
  };

  ws.onclose = () => { joined = false; setStatus('offline'); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
}

function scheduleReconnect() {
  clearInterval(heartbeat);
  clearInterval(tokenTimer);
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * 2 ** attempts++, 15_000);
  reconnectTimer = setTimeout(connectRealtime, delay);
}

/* ---------------- presence ---------------- */

function metaToPeer(key, meta) {
  return {
    id: key,
    email: meta.email || '',
    name: meta.name || (meta.email || '').split('@')[0] || 'Someone',
    color: colorFor(key),
    view: meta.view || '',
    scope: meta.scope || '',
    quoteId: meta.quoteId || null,
    field: meta.field || null,
    label: meta.label || '',
    at: meta.at || 0,
    self: key === CLIENT_ID,
  };
}

function fromState(state) {
  return Object.entries(state || {}).map(([key, v]) => metaToPeer(key, v.metas?.[0] || {}));
}

function applyDiff(list, diff) {
  const left = new Set(Object.keys(diff?.leaves || {}));
  const kept = list.filter((p) => !left.has(p.id));
  const joins = fromState(diff?.joins);
  const byId = new Map(kept.map((p) => [p.id, p]));
  joins.forEach((p) => byId.set(p.id, p));
  return [...byId.values()];
}

// Where this user is right now. Called on every navigation/focus change; cheap
// enough to send unthrottled since it is one small frame per user action.
export function trackPresence(meta) {
  myMeta = { ...meta, email: getSession()?.user?.email || '', at: Date.now() };
  send('presence', { type: 'presence', event: 'track', payload: myMeta });
}

/* ---------------- broadcast ---------------- */

// Returns false when the socket is not up, so the caller can keep the change queued
// instead of assuming it went out.
export function broadcastPatch(payload) {
  return joined && send('broadcast', { type: 'broadcast', event: 'patch', payload: { from: CLIENT_ID, ...payload } });
}
