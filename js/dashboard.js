// Dashboard — a compact "what's happening" board: 4 KPI tiles + 4 charts built from
// the quotes data. No chart library; bars are divs, the split is a small inline SVG.
import { el, mount } from './dom.js';
import { getState } from './store.js';
import { quoteTotals, computeLine, money } from './pricing.js';

const STATUS_COLORS = { draft: '#8c8579', sent: '#3a6ea5', won: '#2f7d5f', lost: '#c04326' };

function metrics(s) {
  const rows = s.quotes.map((q) => {
    const total = quoteTotals(q, s).total;
    const cost = q.items.reduce((c, it) => c + (computeLine(it, s).cost || 0), 0);
    return { q, total, cost, profit: total - cost, status: q.status || 'draft', month: (q.date || '').slice(0, 7) };
  });
  const by = (st) => rows.filter((r) => r.status === st);
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);

  const won = by('won'), lost = by('lost');
  const open = rows.filter((r) => r.status === 'draft' || r.status === 'sent');

  // revenue by month (chronological)
  const months = {};
  for (const r of rows) if (r.month) months[r.month] = (months[r.month] || 0) + r.total;
  const monthly = Object.entries(months).sort().slice(-6).map(([m, v]) => ({ label: m.slice(5) + '/' + m.slice(2, 4), value: v }));

  // top products by value
  const prod = {};
  for (const r of rows) for (const it of r.q.items) {
    const u = computeLine(it, s).unit || 0;
    if (it.product) prod[it.product] = (prod[it.product] || 0) + u;
  }
  const topProducts = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

  // roller vs zebra revenue
  let roller = 0, zebra = 0;
  for (const r of rows) for (const it of r.q.items) {
    const u = computeLine(it, s).unit || 0;
    if (/zebra/i.test(it.table || '')) zebra += u; else roller += u;
  }

  const statusCounts = ['draft', 'sent', 'won', 'lost'].map((st) => ({ label: st, value: by(st).length, amount: sum(by(st), 'total') }));

  return {
    pipeline: sum(open, 'total'),
    wonRevenue: sum(won, 'total'),
    wonProfit: sum(won, 'profit'),
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
    count: rows.length,
    monthly, topProducts, roller, zebra, statusCounts,
  };
}

const tile = (label, value, sub, accent) => el('div', { class: 'kpi' }, [
  el('div', { class: 'kpi-label' }, [label]),
  el('div', { class: 'kpi-value', style: accent ? `color:${accent}` : '' }, [value]),
  sub ? el('div', { class: 'kpi-sub' }, [sub]) : null,
]);

function hbars(items, fmt, colorFor) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return el('div', { class: 'hbars' }, items.length ? items.map((i) => el('div', { class: 'hbar-row' }, [
    el('div', { class: 'hbar-label' }, [i.label]),
    el('div', { class: 'hbar-track' }, [el('div', { class: 'hbar-fill', style: `width:${(i.value / max) * 100}%;background:${colorFor ? colorFor(i) : 'var(--brand)'}` }, [])]),
    el('div', { class: 'hbar-val' }, [fmt(i)]),
  ])) : [el('div', { class: 'muted', style: 'padding:10px' }, ['No data yet'])]);
}

function vbars(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return el('div', { class: 'vbars' }, items.length ? items.map((i) => el('div', { class: 'vbar-col' }, [
    el('div', { class: 'vbar-val' }, [money(i.value)]),
    el('div', { class: 'vbar', style: `height:${Math.max(4, (i.value / max) * 130)}px` }, []),
    el('div', { class: 'vbar-label' }, [i.label]),
  ])) : [el('div', { class: 'muted', style: 'padding:10px' }, ['No dated quotes yet'])]);
}

function donut(roller, zebra) {
  const total = roller + zebra;
  const rPct = total ? roller / total : 0.5;
  const C = 2 * Math.PI * 52;
  const seg = (dash, color, offset) => `<circle cx="70" cy="70" r="52" fill="none" stroke="${color}" stroke-width="20" stroke-dasharray="${dash} ${C}" stroke-dashoffset="${offset}" transform="rotate(-90 70 70)"/>`;
  const svg = `<svg viewBox="0 0 140 140" width="140" height="140">${seg(C, '#eee', 0)}${seg(C * rPct, '#b9552f', 0)}${seg(C * (1 - rPct), '#3a6ea5', -C * rPct)}<text x="70" y="66" text-anchor="middle" font-size="13" font-weight="700" fill="#211d18">${money(total)}</text><text x="70" y="82" text-anchor="middle" font-size="9" fill="#8c8579">TOTAL</text></svg>`;
  const wrap = el('div', { class: 'donut-wrap' }, []);
  wrap.innerHTML = svg;
  return el('div', { class: 'donut', style: 'display:flex;align-items:center;gap:18px' }, [
    wrap,
    el('div', {}, [
      el('div', { class: 'legend' }, [el('span', { class: 'sw', style: 'background:#b9552f' }, []), `Roller — ${money(roller)}`]),
      el('div', { class: 'legend' }, [el('span', { class: 'sw', style: 'background:#3a6ea5' }, []), `Zebra — ${money(zebra)}`]),
    ]),
  ]);
}

const card = (title, body) => el('div', { class: 'panel dash-card' }, [el('h3', {}, [title]), body]);

export function renderDashboard() {
  const s = getState();
  const m = metrics(s);

  mount(el('div', {}, [
    el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', {}, ['Dashboard']), el('div', { class: 'hint' }, [m.count + ' quote(s) · profit uses your cost factor (Settings → Rates)'])]),
    ]),
    el('div', { class: 'kpi-row' }, [
      tile('Open pipeline', money(m.pipeline), 'Draft + sent', '#3a6ea5'),
      tile('Won revenue', money(m.wonRevenue), 'Closed deals', '#2f7d5f'),
      tile('Est. profit (won)', money(m.wonProfit), 'Revenue − material cost', '#b9552f'),
      tile('Win rate', m.winRate + '%', 'Won vs lost', '#c99a3f'),
    ]),
    el('div', { class: 'dash-grid' }, [
      card('Quotes by status', hbars(m.statusCounts, (i) => `${i.value} · ${money(i.amount)}`, (i) => STATUS_COLORS[i.label])),
      card('Revenue by month', vbars(m.monthly)),
      card('Top products (by value)', hbars(m.topProducts, (i) => money(i.value))),
      card('Roller vs Zebra', donut(m.roller, m.zebra)),
    ]),
  ]));
}
