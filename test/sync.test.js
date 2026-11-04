// Deterministic simulation of the sync engine against a hostile network: every message
// is delayed a random amount, so echoes overtake responses, polls return stale
// snapshots, and some deliveries are duplicated. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, merge3, deepEqual } from '../js/sync.js';

function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class World {
  constructor(seed, n, { maxLatency = 300, dupRate = 0.15 } = {}) {
    this.rand = prng(seed);
    this.now = 0;
    this.queue = [];
    this.seq = 0;
    this.maxLatency = maxLatency;
    this.dupRate = dupRate;
    this.rows = new Map(); // "kind/id" -> {rev,data,op}
    this.clients = [];
    this.opN = 0;
    for (let i = 0; i < n; i++) this.clients.push(this.makeClient(i));
  }

  at(ms, fn) { this.queue.push({ t: this.now + ms, n: this.seq++, fn }); }
  lat() { return 1 + Math.floor(this.rand() * this.maxLatency); }

  makeClient(i) {
    const w = this;
    const docs = new Map();
    const c = { i, docs, typed: {}, events: 0 };
    const adapters = { quotes: {
      ids: () => [...docs.keys()],
      get: (id) => docs.get(id),
      set: (id, d) => docs.set(id, d),
      remove: (id) => docs.delete(id),
    } };
    const transport = {
      write(kind, id, { baseRev, data, op }) {
        return new Promise((resolve) => {
          w.at(w.lat(), () => {
            const k = kind + '/' + id;
            const cur = w.rows.get(k);
            let out;
            if (baseRev === 0 && !cur) { w.rows.set(k, { rev: 1, data, op }); out = { rev: 1 }; }
            else if (cur && cur.rev === baseRev) { w.rows.set(k, { rev: cur.rev + 1, data, op }); out = { rev: cur.rev + 1 }; }
            else out = { conflict: true, row: cur ? { ...cur, data: structuredClone(cur.data) } : null };
            if (!out.conflict) w.broadcast(kind, id);
            w.at(w.lat(), () => resolve(out));
          });
        });
      },
      readAll(kind) {
        return new Promise((resolve) => {
          w.at(w.lat(), () => {
            const snap = [...w.rows].filter(([k]) => k.startsWith(kind + '/')).map(([k, v]) => ({ id: k.slice(kind.length + 1), rev: v.rev, op: v.op, data: structuredClone(v.data) }));
            w.at(w.lat(), () => resolve(snap)); // arrives later than it was taken: stale by then
          });
        });
      },
      remove() { return Promise.resolve(); },
    };
    c.engine = new SyncEngine({
      adapters, transport,
      schedule: (fn, ms) => { w.at(ms, fn); return 1; },
      newOp: () => `c${i}-${w.opN++}`,
      onRemote: () => { c.events++; },
    });
    c.adopt = () => c.engine.adopt();
    return c;
  }

  broadcast(kind, id) {
    const row = this.rows.get(kind + '/' + id);
    for (const c of this.clients) {
      const deliver = () => this.at(this.lat(), () => c.engine.inbound(kind, id, { ...row, data: structuredClone(row.data) }));
      deliver();
      if (this.rand() < this.dupRate) deliver();
    }
  }

  async run(until = Infinity) {
    for (let guard = 0; guard < 200000; guard++) {
      await new Promise((r) => setImmediate(r));
      if (!this.queue.length) return;
      this.queue.sort((a, b) => a.t - b.t || a.n - b.n);
      if (this.queue[0].t > until) return;
      const ev = this.queue.shift();
      this.now = ev.t;
      ev.fn();
      this.afterEvent?.();
    }
    throw new Error('simulation did not settle');
  }
}

const settle = async (w) => {
  for (let round = 0; round < 6; round++) {
    await Promise.all(w.clients.map(async (c) => { const p = c.engine.pull(); await w.run(); await p; }));
    await w.run();
  }
};

test('merge3: untouched side adopts the other', () => {
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 2 }), { a: 2, b: 2 });
});

test('merge3: same field edited on both sides, local wins', () => {
  assert.deepEqual(merge3({ a: 'x' }, { a: 'local' }, { a: 'remote' }), { a: 'local' });
});

test('merge3: lines merge by id, deletions hold', () => {
  const base = { items: [{ id: 'a', t: 1 }, { id: 'b', t: 1 }] };
  const local = { items: [{ id: 'a', t: 1 }, { id: 'b', t: 1 }, { id: 'n', t: 9 }] };               // we added n
  const remote = { items: [{ id: 'a', t: 7 }] };                                                     // they edited a, deleted b
  assert.deepEqual(merge3(base, local, remote), { items: [{ id: 'a', t: 7 }, { id: 'n', t: 9 }] });
});

test('merge3: a line deleted here stays deleted even if edited there', () => {
  const base = { items: [{ id: 'a', t: 1 }] };
  assert.deepEqual(merge3(base, { items: [] }, { items: [{ id: 'a', t: 2 }] }), { items: [] });
});

test('deepEqual ignores key order and undefined', () => {
  assert.ok(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1, z: undefined }));
});

test('regression: late echo of our own earlier write never rolls back newer typing', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const w = new World(seed, 1);
    const [c] = w.clients;
    c.docs.set('q1', { id: 'q1', addr: '' });
    c.adopt();
    { const p = c.engine.pull(); await w.run(); await p; }
    const text = '2727 aventon lake conway fl 32801';
    w.afterEvent = () => assert.equal(c.docs.get('q1').addr, c.typed.addr ?? '', `seed ${seed}: local text changed under the typist`);
    for (let i = 1; i <= text.length; i++) {
      c.typed.addr = text.slice(0, i);
      c.docs.get('q1').addr = c.typed.addr;
      c.engine.scan();
      await w.run(w.now + 40 + Math.floor(w.rand() * 120)); // type at human speed; pushes, echoes and polls land mid-word
      if (i % 9 === 0) c.engine.pull();
    }
    await w.run();
    assert.equal(c.docs.get('q1').addr, text);
    await settle(w);
    assert.equal(w.rows.get('quotes/q1').data.addr, text, `seed ${seed}: server did not converge to what was typed`);
  }
});

test('simulation: concurrent editors converge and keep every private edit', async () => {
  for (let seed = 1; seed <= 150; seed++) {
    const w = new World(seed, 3);
    w.clients[0].docs.set('q1', { id: 'q1', shared: '', items: [] });
    w.clients.forEach((c) => c.adopt());
    await Promise.all(w.clients.map((c) => c.engine.pull()).concat([w.run()]));
    await settle(w);

    const live = new Map(); // line id -> expected text (only the owner touches it)
    const dead = new Set();
    w.afterEvent = () => {
      for (const c of w.clients) {
        const q = c.docs.get('q1');
        if (!q) continue;
        // Nothing another client does may change a field this client is typing into.
        const mine = q['own' + c.i];
        assert.equal(mine ?? '', c.typed['own' + c.i] ?? '', `seed ${seed}: client ${c.i} field rewritten under it`);
      }
    };

    for (let step = 0; step < 120; step++) {
      const c = w.clients[Math.floor(w.rand() * 3)];
      const q = c.docs.get('q1');
      if (!q) continue;
      const r = w.rand();
      if (r < 0.45) { c.typed['own' + c.i] = (c.typed['own' + c.i] || '') + String.fromCharCode(97 + step % 26); q['own' + c.i] = c.typed['own' + c.i]; }
      else if (r < 0.6) { q.shared = `c${c.i}-${step}`; }
      else if (r < 0.8) { const id = `L${c.i}-${step}`; q.items.push({ id, owner: c.i, text: 'new' }); live.set(id, 'new'); }
      else if (r < 0.95) {
        const mine = q.items.filter((it) => it.owner === c.i);
        if (mine.length) { const it = mine[Math.floor(w.rand() * mine.length)]; it.text = 't' + step; live.set(it.id, it.text); }
      } else {
        const mine = q.items.filter((it) => it.owner === c.i);
        if (mine.length) { const it = mine[0]; q.items = q.items.filter((x) => x.id !== it.id); live.delete(it.id); dead.add(it.id); }
      }
      c.engine.scan();
      await w.run(w.now + Math.floor(w.rand() * 200));
      if (w.rand() < 0.05) c.engine.pull();
    }
    w.afterEvent = null;
    await w.run();
    await settle(w);

    const server = w.rows.get('quotes/q1').data;
    for (const c of w.clients) {
      const q = c.docs.get('q1');
      assert.ok(deepEqual(q, server), `seed ${seed}: client ${c.i} did not converge`);
      assert.equal(q['own' + c.i] ?? '', c.typed['own' + c.i] ?? '', `seed ${seed}: client ${c.i} lost typing`);
    }
    for (const [id, text] of live) {
      const it = server.items.find((x) => x.id === id);
      assert.ok(it, `seed ${seed}: line ${id} vanished`);
      assert.equal(it.text, text, `seed ${seed}: line ${id} lost its edit`);
    }
    for (const id of dead) assert.ok(!server.items.some((x) => x.id === id), `seed ${seed}: deleted line ${id} came back`);
    for (const c of w.clients) assert.equal(c.engine.state(), 'saved');
  }
});
