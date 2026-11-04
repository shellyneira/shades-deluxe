// The real store.js + db.js against a fake PostgREST server that enforces the same
// compare-and-swap and rev trigger as supabase/schema.sql. Proves the wiring (what a
// "document" is, line ids, in-place merge, reload safety), not just the engine.
// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

function fakeServer() {
  const tables = { quotes: new Map(), price_tables: new Map(), option_lists: new Map(), app_state: new Map() };
  const log = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!m || !tables[m[1]]) return send(404, {});
    const t = tables[m[1]];
    let body = '';
    for await (const c of req) body += c;
    const id = u.searchParams.get('id')?.replace('eq.', '');
    const rev = u.searchParams.get('rev')?.replace('eq.', '');
    log.push(`${req.method} ${m[1]} ${id ?? ''}${rev ? ' rev=' + rev : ''}`);
    if (req.method === 'GET') return send(200, [...t].filter(([k]) => !id || k === id).map(([k, v]) => ({ id: k, ...v })));
    if (req.method === 'POST') {
      const row = JSON.parse(body);
      if (t.has(row.id)) return send(409, { code: '23505' });
      t.set(row.id, { ...row, rev: 1 });
      return send(201, [{ ...row, rev: 1 }]);
    }
    if (req.method === 'PATCH') {
      const cur = t.get(id);
      if (!cur || cur.rev !== Number(rev)) return send(200, []);
      const next = { ...cur, ...JSON.parse(body), rev: cur.rev + 1 };
      t.set(id, next);
      return send(200, [next]);
    }
    if (req.method === 'DELETE') { t.delete(id); return send(204, {}); }
    return send(405, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, tables, log, port: server.address().port })));
}

function shims(store) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.window = { addEventListener() {} };
  store.set('shades-deluxe-auth', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 't@test' } }));
}

let copy = 0;
function loadStore(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')) + `/js${copy++}`;
  fs.cpSync(root, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.js'), `export const SUPABASE_URL='http://127.0.0.1:${port}'; export const SUPABASE_ANON_KEY='k';`);
  return import(path.join(dir, 'store.js'));
}

const settle = () => new Promise((r) => setTimeout(r, 700));

test('first boot seeds the cloud; typing syncs one write per pause; reload keeps unsent edits safe', async () => {
  const { tables, log, server, port } = await fakeServer();
  const ls = new Map();
  shims(ls);
  const s1 = await loadStore(port);
  await s1.initCloud();
  await settle();
  assert.ok(tables.price_tables.size > 0 && tables.option_lists.size > 0 && tables.app_state.has('main'), 'seeded');

  const q = s1.newQuote();
  q.client.address = '2727 aventon lake';
  q.items.push({ table: 'Zebra #3', qty: 1 });
  s1.save();
  await settle();
  const row = tables.quotes.get(q.id);
  assert.equal(row.data.client.address, '2727 aventon lake');
  assert.match(row.data.items[0].id, /\S/, 'lines get ids');
  assert.equal(row.rev, 1);

  // Someone else edits a different field and adds a line while we type.
  q.client.address += ' conway';
  s1.save();
  const theirs = structuredClone(tables.quotes.get(q.id));
  theirs.data.client.phone = '555';
  theirs.data.items.push({ id: 'theirs', table: 'Roller #3', qty: 2 });
  theirs.rev += 1; theirs.op = 'other:1';
  tables.quotes.set(q.id, theirs);
  await settle();
  await s1.initCloud(); // a poll
  await settle();
  const live = s1.getQuote(q.id);
  assert.equal(live, q, 'same object: screens holding it stay valid');
  assert.equal(live.client.address, '2727 aventon lake conway');
  assert.equal(live.client.phone, '555');
  assert.equal(live.items.length, 2);
  const stored = tables.quotes.get(q.id);
  assert.equal(stored.data.client.address, '2727 aventon lake conway', 'our typing survived and reached the server');
  assert.equal(stored.data.client.phone, '555', "their edit was not clobbered by ours");
  assert.ok(stored.rev >= 3);

  // Offline edit survives a reload and then merges instead of overwriting.
  const failing = log.length;
  q.client.address += ' fl';
  server.close(); server.closeAllConnections?.();
  s1.save();
  await settle();
  const keep = new Map(ls);
  assert.ok(JSON.parse(keep.get('shades-deluxe-v1:sync')).pending['quotes/' + q.id], 'unsent base is persisted');
  assert.ok(log.length >= failing);

  const revived = await fakeServer();
  for (const k of Object.keys(tables)) for (const [id, v] of tables[k]) revived.tables[k].set(id, v);
  const bumped = structuredClone(revived.tables.quotes.get(q.id));
  bumped.data.client.email = 'a@b.c'; bumped.rev += 1; bumped.op = 'other:2';
  revived.tables.quotes.set(q.id, bumped);
  shims(new Map(keep));
  const s2 = await loadStore(revived.port);
  await s2.initCloud();
  await settle();
  const after = revived.tables.quotes.get(q.id).data;
  assert.equal(after.client.address, '2727 aventon lake conway fl', 'offline typing kept');
  assert.equal(after.client.email, 'a@b.c', 'their edit kept');
  revived.server.close(); revived.server.closeAllConnections?.();
});
