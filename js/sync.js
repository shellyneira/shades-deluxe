// Document sync engine. Pure logic — no DOM, no fetch, no timers of its own — so the
// whole thing can be driven by a deterministic simulator (test/sync.test.js).
//
// The model, in one paragraph. Every synced document (quote, price table, list,
// settings) has a server-assigned, strictly increasing `rev`. This device remembers
// the last server version it has seen for each document (`base`). Local edits are
// never overwritten by anything inbound: an inbound version is three-way merged
// (base, local, remote) so only fields the user did NOT touch since `base` change.
// Writes are compare-and-swap on `rev`, one in flight per document. Because every
// version is totally ordered, a stale echo, a late poll or a duplicate delivery is
// recognised as such (`rev <= base.rev`) and dropped — there is nothing to time out
// or guess. Our own writes are recognised by a per-write `op` id, not by comparing
// content.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

// Structural equality; key order is irrelevant (Postgres jsonb reorders keys) and a
// key holding undefined is the same as an absent key.
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

const keyed = (arr) => Array.isArray(arr) && arr.every((x) => isObj(x) && typeof x.id === 'string');

// Arrays of {id, ...} (quote lines) merge per element, so two people adding or editing
// different lines never conflict, and a line deleted on one side stays deleted.
// Deleted vs edited resolves in favour of THIS device's screen: what is on it is never
// taken away by a merge, and a line the user removed does not come back.
function mergeKeyed(base, local, remote) {
  const B = new Map((base || []).map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const value = (id) => {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) return merge3(b, l, r);
    if (l) return b && deepEqual(l, b) ? undefined : l; // gone remotely: keep only if edited here
    return b ? undefined : r;                            // gone locally: stays gone; else new remotely
  };
  const order = remote.map((x) => x.id);
  const at = new Set(order);
  let prev = -1;
  for (const { id } of local) {
    if (at.has(id)) { prev = order.indexOf(id); continue; }
    order.splice(prev + 1, 0, id);
    at.add(id);
    prev++;
  }
  return order.map(value).filter((v) => v !== undefined);
}

// Three-way merge. Returns what the document should become on this device.
export function merge3(base, local, remote) {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(local, base)) return remote;   // untouched here: adopt theirs
  if (deepEqual(remote, base)) return local;   // untouched there: keep ours
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const v = merge3(b[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (keyed(local) && keyed(remote) && (base === undefined || keyed(base))) return mergeKeyed(base, local, remote);
  return local; // same scalar edited on both sides: the person typing wins, the other side converges to it
}

const MAX_RETRIES = 4;

export class SyncEngine {
  // adapters[kind] = { ids(): string[], get(id): doc|undefined, set(id, doc), remove(id) }
  // transport      = { write(kind, id, {baseRev, data, op}) -> {rev} | {conflict: true, row: {rev,data,op}|null},
  //                    readAll(kind) -> [{id, rev, data, op}], remove(kind, id) }
  constructor({ adapters, transport, schedule, newOp, onRemote = () => {}, onState = () => {}, flushDelay = 400 }) {
    this.adapters = adapters;
    this.transport = transport;
    this.schedule = schedule;
    this.newOp = newOp;
    this.onRemote = onRemote;
    this.onState = onState;
    this.flushDelay = flushDelay;
    this.recs = new Map();        // "kind/id" -> { kind, id, baseRev, baseData, inflight, ackClock }
    this.tombstones = new Set();  // deleted here this session: inbound copies of these are ignored
    this.deletes = new Map();     // "kind/id" -> {kind,id} still to be told to the server
    this.version = 0;             // bumps on any change that can alter a document's dirtiness; memoises dirty()
    this.clock = 0;               // bumps on every acknowledged write
    this.ready = false;           // true after the first successful full read
    this.timer = null;
    this.retries = 0;
    this.failed = false;
  }

  key(kind, id) { return kind + '/' + id; }

  /* ---- boot ---- */

  // Restore what was unsent when the page last closed: the base each dirty document was
  // edited from (so those edits merge instead of being overwritten) and deletes the
  // server has not heard about yet.
  restore(meta) {
    for (const [k, v] of Object.entries(meta?.pending || {})) {
      const [kind, ...rest] = k.split('/');
      this.recs.set(k, { kind, id: rest.join('/'), baseRev: v.rev, baseData: v.data, inflight: null, ackClock: 0 });
    }
    for (const d of meta?.deletes || []) {
      this.deletes.set(this.key(d.kind, d.id), d);
      this.tombstones.add(this.key(d.kind, d.id));
    }
  }

  // Local documents with no remembered base were clean when the page closed. Assume
  // their content IS the server's, at an unknown rev — the first read replaces it.
  adopt() {
    for (const [kind, a] of Object.entries(this.adapters)) {
      for (const id of a.ids()) {
        const k = this.key(kind, id);
        if (!this.recs.has(k) && !this.tombstones.has(k)) this.recs.set(k, { kind, id, baseRev: 0, baseData: clone(a.get(id)), inflight: null, ackClock: 0, assumed: true });
      }
    }
    for (const d of this.deletes.values()) this.sendDelete(d);
  }

  meta() {
    const pending = {};
    for (const rec of this.recs.values()) {
      if (rec.baseRev > 0 && this.dirty(rec)) pending[this.key(rec.kind, rec.id)] = { rev: rec.baseRev, data: rec.baseData };
    }
    return { pending, deletes: [...this.deletes.values()] };
  }

  /* ---- local changes ---- */

  // Memoised per version: a keystroke would otherwise re-compare every document
  // several times (scan, status, persistence) when only one of them can have changed.
  dirty(rec) {
    if (rec.dv === this.version) return rec.d;
    const local = this.adapters[rec.kind].get(rec.id);
    rec.dv = this.version;
    return (rec.d = local !== undefined && !deepEqual(local, rec.baseData));
  }

  // Call after any local mutation. Finds documents that now differ from their base.
  scan() {
    this.version++;
    let any = false;
    for (const [kind, a] of Object.entries(this.adapters)) {
      for (const id of a.ids()) {
        const k = this.key(kind, id);
        if (this.tombstones.has(k)) continue;
        let rec = this.recs.get(k);
        if (!rec) { rec = { kind, id, baseRev: 0, baseData: undefined, inflight: null, ackClock: 0 }; this.recs.set(k, rec); }
        if (this.dirty(rec)) any = true;
      }
    }
    if (any) this.flushSoon();
    this.emitState();
  }

  remove(kind, id) {
    this.version++;
    const k = this.key(kind, id);
    this.recs.delete(k);
    this.tombstones.add(k);
    const d = { kind, id };
    this.deletes.set(k, d);
    this.sendDelete(d);
  }

  sendDelete(d) {
    Promise.resolve(this.transport.remove(d.kind, d.id)).then(
      () => this.deletes.delete(this.key(d.kind, d.id)),
      () => { this.failed = true; this.emitState(); },
    );
  }

  /* ---- outbound ---- */

  flushSoon() {
    if (this.timer) return;
    this.timer = this.schedule(() => { this.timer = null; this.flush(); }, this.flushDelay);
  }

  // Everything dirty and idle goes out, one write in flight per document. Resolves when
  // those writes have settled; anything dirtied meanwhile is picked up by the next pass.
  async flush() {
    if (!this.ready) return;
    const jobs = [];
    for (const rec of this.recs.values()) {
      if (rec.inflight || !this.dirty(rec)) continue;
      jobs.push(this.send(rec));
    }
    await Promise.all(jobs);
    this.emitState();
  }

  async send(rec) {
    const data = clone(this.adapters[rec.kind].get(rec.id));
    const op = this.newOp();
    rec.inflight = { op, data };
    this.emitState();
    let res;
    try {
      res = await this.transport.write(rec.kind, rec.id, { baseRev: rec.baseRev, data, op });
    } catch {
      if (rec.inflight?.op === op) rec.inflight = null;
      this.retry();
      return;
    }
    if (rec.inflight?.op !== op) return; // already settled by the echo of this very write
    if (res.conflict) {
      rec.inflight = null;
      if (res.row) this.inbound(rec.kind, rec.id, res.row);
      else this.inbound(rec.kind, rec.id, null);
      this.retries = 0;
      this.flushSoon();
      return;
    }
    this.ack(rec, op, res.rev);
    this.retries = 0;
    this.failed = false;
    if (this.dirty(rec)) this.flushSoon();
  }

  ack(rec, op, rev) {
    if (rec.inflight?.op !== op) return;
    this.version++;
    if (rev > rec.baseRev) {
      rec.baseRev = rev;
      rec.baseData = rec.inflight.data;
      rec.ackClock = ++this.clock;
      rec.assumed = false;
    }
    rec.inflight = null;
  }

  // Bounded: a client that retries forever is a denial of service against its own
  // backend. Any real event (an edit, focus, reconnect) calls resume() for a fresh budget.
  retry() {
    this.failed = true;
    this.emitState();
    if (this.retries >= MAX_RETRIES) return;
    const delay = Math.min(5000 * 2 ** this.retries++, 40_000);
    if (this.timer) return;
    this.timer = this.schedule(() => { this.timer = null; this.flush(); }, delay);
  }

  resume() {
    this.retries = 0;
    this.flushSoon();
  }

  /* ---- inbound ---- */

  // One document version from anywhere — realtime event, poll, or a conflict reply.
  // row === null means the document no longer exists on the server.
  inbound(kind, id, row) {
    this.version++;
    const k = this.key(kind, id);
    if (this.tombstones.has(k)) return false;
    const a = this.adapters[kind];
    const rec = this.recs.get(k);

    if (!row) {
      if (!rec) return false;
      if (this.dirty(rec)) { rec.baseRev = 0; rec.baseData = undefined; rec.assumed = false; this.version++; this.flushSoon(); return false; } // unsent edits outlive a remote delete
      this.recs.delete(k);
      a.remove(id);
      this.onRemote();
      return true;
    }

    if (!rec) {
      this.recs.set(k, { kind, id, baseRev: row.rev, baseData: clone(row.data), inflight: null, ackClock: 0 });
      a.set(id, clone(row.data));
      this.onRemote();
      return true;
    }
    if (rec.inflight && row.op && row.op === rec.inflight.op) {
      this.ack(rec, row.op, row.rev);
      if (this.dirty(rec)) this.flushSoon();
      return false;
    }
    if (row.rev <= rec.baseRev) return false;

    const local = a.get(id);
    const merged = local === undefined ? clone(row.data) : merge3(rec.baseData, local, row.data);
    rec.baseRev = row.rev;
    rec.baseData = clone(row.data);
    rec.assumed = false;
    const unchanged = local !== undefined && deepEqual(merged, local);
    if (!unchanged) a.set(id, merged);
    this.version++;
    if (this.dirty(rec)) this.flushSoon();
    if (unchanged) return false;
    this.onRemote();
    return true;
  }

  // Full read of everything, to catch whatever the live channel missed.
  async pull() {
    const startClock = this.clock;
    const all = {};
    for (const kind of Object.keys(this.adapters)) all[kind] = await this.transport.readAll(kind);
    let changed = false;
    for (const [kind, rows] of Object.entries(all)) {
      const here = new Set(rows.map((r) => r.id));
      for (const r of rows) changed = this.inbound(kind, r.id, r) || changed;
      for (const rec of [...this.recs.values()]) {
        if (rec.kind !== kind || here.has(rec.id) || rec.inflight) continue;
        if (rec.baseRev > 0) {
          // Absent from a read that began after we last heard of it: deleted by someone else.
          // A read that predates our own write simply has not seen it yet.
          if (rec.ackClock <= startClock) changed = this.inbound(kind, rec.id, null) || changed;
        } else if (rec.assumed) {
          rec.baseData = undefined; // never reached the server: it needs inserting
          rec.assumed = false;
        }
      }
    }
    this.ready = true;
    this.version++;
    this.flushSoon();
    this.emitState();
    return changed;
  }

  /* ---- status ---- */

  state() {
    if (this.failed) return 'error';
    for (const rec of this.recs.values()) if (rec.inflight || this.dirty(rec)) return 'saving';
    return this.deletes.size ? 'saving' : 'saved';
  }

  emitState() { this.onState(this.state()); }
}
