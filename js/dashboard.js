// Dashboard — what the shop actually needs to know: what is still a quote, what is
// invoiced, what has been collected, and what is still owed.
//
// It reads the quote lifecycle (q.stage) that the rest of the app writes. It used to
// read q.status — draft/sent/won/lost — which nothing has written since the stage
// migration, so every quote fell back to "draft": won revenue, profit and win rate
// were permanently zero while fully paid invoices sat in "open pipeline".
//
// No chart library: bars are divs, the rings are inline SVG.
import { el, mount } from './dom.js';
import { getState } from './store.js';
import { quoteTotals, computeLine, money, money0 } from './pricing.js';

const STAGES = ['Quote', 'Accepted', '50% Paid', '100% Paid'];
const stagePct = (st) => (st === '100% Paid' ? 1 : st === '50% Paid' ? 0.5 : 0);
const isInvoice = (st) => st !== 'Quote';

// One muted, low-chroma family for the whole board. Saturated primaries next to this
// warm paper read as alarms; data that is merely *different* should not shout.
const STAGE_COLOR = { Quote: '#9a9086', Accepted: '#4a6d8c', '50% Paid': '#c99a3f', '100% Paid': '#5e8c6a' };
const SERIES = ['#b9552f', '#4a6d8c', '#5e8c6a', '#c99a3f', '#8a6a9e', '#4a8c8c'];

function metrics(s) {
  // Practice quotes are excluded from every number on this board — that is the
  // whole point of marking one.
  const real = s.quotes.filter((q) => !q.isTest);
  // Everything here is quantity-weighted. Revenue always was (quoteTotals multiplies
  // by qty), but cost and the per-product totals were not — so a line of 9 shades
  // counted its full price once and its cost once, and the margin came out fantasy.
  const qty = (it) => Number(it.qty) || 1;
  const rows = real.map((q) => {
    const total = quoteTotals(q, s).total;
    const cost = q.items.reduce((c, it) => c + (computeLine(it, s).cost || 0) * qty(it), 0);
    const stage = q.stage || 'Quote';
    return { q, total, cost, profit: total - cost, stage, month: (q.date || '').slice(0, 7) };
  });
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const invoiced = rows.filter((r) => isInvoice(r.stage));
  const open = rows.filter((r) => !isInvoice(r.stage));
  const invoicedTotal = sum(invoiced, 'total');
  const collected = invoiced.reduce((a, r) => a + r.total * stagePct(r.stage), 0);

  // Revenue by month, split so quoted money is never mistaken for earned money.
  const months = {};
  for (const r of rows) {
    if (!r.month) continue;
    const m = (months[r.month] ||= { invoiced: 0, open: 0 });
    m[isInvoice(r.stage) ? 'invoiced' : 'open'] += r.total;
  }
  const monthly = Object.entries(months).sort().slice(-6)
    .map(([k, v]) => ({ key: k, label: k.slice(5) + '/' + k.slice(2, 4), ...v, value: v.invoiced + v.open }));

  const prod = {};
  for (const r of rows) for (const it of r.q.items) {
    const u = (computeLine(it, s).unit || 0) * qty(it);
    if (it.product) prod[it.product] = (prod[it.product] || 0) + u;
  }
  const topProducts = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

  // Every category the shop actually sells, rather than a Roller/other guess — under
  // the old split, Drapery was silently counted as Zebra.
  const cats = {};
  for (const r of rows) for (const it of r.q.items) {
    const cat = s.tables[it.table]?.category || 'Other';
    cats[cat] = (cats[cat] || 0) + (computeLine(it, s).unit || 0) * qty(it);
  }
  const mix = Object.entries(cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: SERIES[i % SERIES.length] }));

  const byStage = STAGES.map((st) => {
    const g = rows.filter((r) => r.stage === st);
    return { label: st, value: g.length, amount: sum(g, 'total'), color: STAGE_COLOR[st] };
  });

  const recent = [...rows].sort((a, b) => (b.q.date || '').localeCompare(a.q.date || '')).slice(0, 6);

  // A line whose size falls outside its price table has no price at all, and every
  // total treats that as zero — so a quote can go out with a shade on it nobody
  // charged for. The worksheet shows a dash, but the document the client sees
  // prints $0.00, which is easy to miss and expensive to miss.
  const unpriced = [];
  for (const r of rows) {
    const n = r.q.items.filter((it) => computeLine(it, s).unit == null).length;
    if (n) unpriced.push({ number: r.q.number, name: r.q.client?.name || 'Untitled client', lines: n });
  }

  return {
    pipeline: sum(open, 'total'), invoiced: invoicedTotal,
    collected, outstanding: invoicedTotal - collected,
    profit: sum(invoiced, 'profit'),
    margin: invoicedTotal ? Math.round((sum(invoiced, 'profit') / invoicedTotal) * 100) : 0,
    conversion: rows.length ? Math.round((invoiced.length / rows.length) * 100) : 0,
    count: rows.length, openCount: open.length, invoicedCount: invoiced.length,
    testCount: s.quotes.length - real.length,
    monthly, topProducts, mix, byStage, recent, unpriced,
  };
}

/* ---------------- pieces ---------------- */

const tile = (label, value, sub, accent) => el('div', { class: 'kpi', style: `--accent:${accent}` }, [
  el('div', { class: 'kpi-label' }, [label]),
  el('div', { class: 'kpi-value' }, [value]),
  el('div', { class: 'kpi-sub' }, [sub]),
]);

const legendRow = (color, name, right, amount) => el('div', { class: 'legend-row' }, [
  el('span', { class: 'sw', style: `background:${color}` }, []),
  el('span', { class: 'legend-name' }, [name]),
  el('span', { class: 'legend-count' }, [right]),
  el('span', { class: 'legend-amt' }, [amount]),
]);

// One bar, full width, each stage in proportion — it reads as "where the money sits"
// at a glance, which four near-empty bars never did.
function stageBar(byStage) {
  const total = byStage.reduce((a, s) => a + s.amount, 0);
  return el('div', {}, [
    el('div', { class: 'stack' }, total
      ? byStage.filter((s) => s.amount > 0).map((s) => el('div', {
        class: 'stack-seg', title: `${s.label} — ${money(s.amount)}`,
        style: `width:${(s.amount / total) * 100}%;background:${s.color}`,
      }, []))
      : [el('div', { class: 'stack-seg empty', style: 'width:100%' }, [])]),
    el('div', { class: 'legend-rows' }, byStage.map((s) => legendRow(s.color, s.label, String(s.value), money(s.amount)))),
  ]);
}

// A round step (1 / 2 / 2.5 / 5 × 10ⁿ) so the axis reads 0 · 2k · 4k, never 0 · 1,697 · 3,394.
function niceStep(max) {
  const rough = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  return ([1, 2, 2.5, 5, 10].find((f) => mag * f >= rough) || 10) * mag;
}

// Columns against a real axis. Quoted money stacks under invoiced money in the same
// column, so a good-looking month is never just a pile of unsigned quotes.
function monthChart(monthly) {
  if (!monthly.length) return el('div', { class: 'empty-sm' }, ['No dated quotes yet']);
  const max = Math.max(...monthly.map((m) => m.value));
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = top; v >= -1e-9; v -= step) ticks.push(v);

  return el('div', { class: 'chart' }, [
    el('div', { class: 'chart-plot' }, [
      el('div', { class: 'grid-lines' }, ticks.map((v) => el('div', { class: 'grid-line' }, [el('span', { class: 'tick' }, [money0(v)])]))),
      el('div', { class: 'cols' }, monthly.map((m) => el('div', {
        class: 'col', title: `${m.label} — invoiced ${money(m.invoiced)} · quoted ${money(m.open)}`,
      }, [
        el('div', { class: 'col-stack' }, [
          m.open ? el('div', { class: 'col-seg open', style: `height:${(m.open / top) * 100}%` }, []) : null,
          m.invoiced ? el('div', { class: 'col-seg inv', style: `height:${(m.invoiced / top) * 100}%` }, []) : null,
        ]),
      ]))),
    ]),
    el('div', { class: 'cols axis-x' }, monthly.map((m) => el('div', { class: 'col-label' }, [m.label]))),
    el('div', { class: 'legend-inline' }, [
      el('span', { class: 'sw', style: 'background:#5e8c6a' }, []), 'Invoiced',
      el('span', { class: 'sw', style: 'background:#cfc7ba;margin-left:16px' }, []), 'Still quoted',
    ]),
  ]);
}

// Ranked bars in one hue, fading down the order: position already carries the
// ranking, so colour only has to keep them legible.
function ranked(items, fmt) {
  if (!items.length) return el('div', { class: 'empty-sm' }, ['No data yet']);
  const max = Math.max(...items.map((i) => i.value));
  return el('div', { class: 'hbars' }, items.map((i, idx) => el('div', { class: 'hbar-row' }, [
    el('div', { class: 'hbar-label', title: i.label }, [i.label]),
    el('div', { class: 'hbar-track' }, [el('div', {
      class: 'hbar-fill',
      style: `width:${(i.value / max) * 100}%;background:color-mix(in srgb, var(--brand) ${100 - idx * 14}%, #d8d0c3)`,
    }, [])]),
    el('div', { class: 'hbar-val' }, [fmt(i)]),
  ])));
}

function donut(mix) {
  const total = mix.reduce((a, m) => a + m.value, 0);
  if (!total) return el('div', { class: 'empty-sm' }, ['No items priced yet']);
  const C = 2 * Math.PI * 52;
  let offset = 0;
  const segs = mix.map((m) => {
    const len = C * (m.value / total);
    const s = `<circle cx="70" cy="70" r="52" fill="none" stroke="${m.color}" stroke-width="18" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${m.label}</title></circle>`;
    offset += len;
    return s;
  }).join('');
  const wrap = el('div', { class: 'donut-wrap' }, []);
  wrap.innerHTML = `<svg viewBox="0 0 140 140" width="128" height="128">`
    + `<circle cx="70" cy="70" r="52" fill="none" stroke="#efe9df" stroke-width="18"/>${segs}`
    + `<text x="70" y="67" text-anchor="middle" font-size="14" font-weight="800" fill="#211d18">${money0(total)}</text>`
    + `<text x="70" y="83" text-anchor="middle" font-size="8.5" letter-spacing="1" fill="#8c8579">TOTAL</text></svg>`;
  return el('div', { class: 'donut' }, [
    wrap,
    el('div', { class: 'legend-rows grow' }, mix.map((m) =>
      legendRow(m.color, m.label, Math.round((m.value / total) * 100) + '%', money(m.value)))),
  ]);
}

// How much of what has been invoiced is actually in the bank.
function collection(m) {
  // With nothing invoiced there is nothing owed either — the proportional reading
  // would otherwise announce "100% still owed" over a balance of zero.
  if (!m.invoiced) return el('div', { class: 'empty-sm' }, ['Nothing invoiced yet']);
  const pct = (m.collected / m.invoiced) * 100;
  return el('div', {}, [
    el('div', { class: 'stack tall' }, [
      el('div', { class: 'stack-seg', style: `width:${pct}%;background:#5e8c6a`, title: 'Collected ' + money(m.collected) }, []),
      el('div', { class: 'stack-seg', style: `width:${100 - pct}%;background:#e0d6c6`, title: 'Outstanding ' + money(m.outstanding) }, []),
    ]),
    el('div', { class: 'legend-rows' }, [
      legendRow('#5e8c6a', 'Collected', Math.round(pct) + '%', money(m.collected)),
      legendRow('#e0d6c6', 'Still owed', Math.round(100 - pct) + '%', money(m.outstanding)),
    ]),
  ]);
}

function recentList(recent) {
  if (!recent.length) return el('div', { class: 'empty-sm' }, ['No quotes yet']);
  return el('div', { class: 'recent' }, recent.map((r) => el('div', { class: 'recent-row' }, [
    el('span', { class: 'dot', style: `background:${STAGE_COLOR[r.stage]}`, title: r.stage }, []),
    el('span', { class: 'recent-name' }, [r.q.client?.name || 'Untitled client']),
    el('span', { class: 'recent-date' }, [r.q.date || '—']),
    el('span', { class: 'recent-amt' }, [money(r.total)]),
  ])));
}

// The one thing on this board worth interrupting someone for.
function unpricedWarning(unpriced) {
  if (!unpriced.length) return null;
  const lines = unpriced.reduce((a, u) => a + u.lines, 0);
  const who = unpriced.slice(0, 4).map((u) => `#${u.number} ${u.name}`).join(', ');
  return el('div', { class: 'alert' }, [
    el('span', { class: 'alert-mark' }, ['!']),
    el('div', {}, [
      el('strong', {}, [`${lines} line${lines > 1 ? 's' : ''} on ${unpriced.length} quote${unpriced.length > 1 ? 's' : ''} ${lines > 1 ? 'have' : 'has'} no price`]),
      el('div', { class: 'alert-sub' }, [`The size falls outside its price table, so it counts as $0 here — and prints as $0.00 on the client's quote. ${who}${unpriced.length > 4 ? '…' : ''}`]),
    ]),
  ]);
}

const card = (title, note, body, wide) => el('div', { class: 'panel dash-card' + (wide ? ' wide' : '') }, [
  el('div', { class: 'dash-card-head' }, [el('h3', {}, [title]), note ? el('span', { class: 'card-note' }, [note]) : null]),
  body,
]);

export function renderDashboard() {
  const s = getState();
  const m = metrics(s);

  mount(el('div', {}, [
    el('div', { class: 'section-head' }, [
      el('div', {}, [
        el('h2', {}, ['Dashboard']),
        el('div', { class: 'hint' }, [`${m.count} quote(s) · ${m.openCount} open · ${m.invoicedCount} invoiced`
          + (m.testCount ? ` · ${m.testCount} test quote${m.testCount > 1 ? 's' : ''} excluded` : '')
          + ' · profit uses your cost factor (Settings → Rates)']),
      ]),
    ]),
    unpricedWarning(m.unpriced),
    el('div', { class: 'kpi-row' }, [
      tile('Open pipeline', money(m.pipeline), `${m.openCount} not yet accepted`, '#4a6d8c'),
      tile('Invoiced', money(m.invoiced), `Est. profit ${money(m.profit)} · ${m.margin}% margin`, '#5e8c6a'),
      tile('Collected', money(m.collected), `${m.conversion}% of quotes became invoices`, '#b9552f'),
      tile('Outstanding', money(m.outstanding), 'Invoiced, not yet paid', '#c99a3f'),
    ]),
    el('div', { class: 'dash-grid' }, [
      card('Where the money sits', 'by stage', stageBar(m.byStage), true),
      card('Revenue by month', 'by quote date · last 6', monthChart(m.monthly), true),
      card('Collection', 'of invoiced', collection(m)),
      card('Top products', 'by value', ranked(m.topProducts, (i) => money(i.value))),
      card('Product mix', 'by category', donut(m.mix)),
      card('Recent quotes', 'newest first', recentList(m.recent)),
    ]),
  ]));
}
