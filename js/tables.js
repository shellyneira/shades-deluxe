// Price Tables editor — the pricing "database". Tables are grouped by type
// (Roller / Zebra) so it's clear each product line carries its own values.
// Create, rename, duplicate, delete tables and edit each width×length grid.
import { el, mount, toast, confirmAction } from './dom.js';
import { getState, save } from './store.js';

let active = null;
const isZebra = (name) => /zebra/i.test(name);
const typeOf = (name) => (isZebra(name) ? 'zebra' : 'roller');

export function renderTables() {
  const s = getState();
  const names = Object.keys(s.tables);
  if (!active || !names.includes(active)) active = names[0] || null;

  const chip = (n) => el('button', { class: 'ptab' + (n === active ? ' active' : '') + ' ' + typeOf(n), onclick: () => { active = n; renderTables(); } }, [
    el('span', { class: 'dot' }, []), n,
  ]);

  const roller = names.filter((n) => !isZebra(n));
  const zebra = names.filter((n) => isZebra(n));

  const groups = el('div', { class: 'ptabs' }, [
    roller.length ? el('div', { class: 'ptab-group' }, [el('span', { class: 'ptab-label roller' }, ['Roller']), ...roller.map(chip)]) : null,
    zebra.length ? el('div', { class: 'ptab-group' }, [el('span', { class: 'ptab-label zebra' }, ['Zebra']), ...zebra.map(chip)]) : null,
    el('button', { class: 'ptab new', onclick: createTable }, ['＋ New table']),
  ]);

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'section-head' }, [
        el('div', {}, [el('h2', {}, ['Price Tables']), el('div', { class: 'hint' }, ['Each table keeps its own prices. Pick one, edit any cell — it saves as you type.'])]),
      ]),
      groups,
      active ? gridEditor(active) : el('div', { class: 'empty' }, [el('div', { class: 'big' }, ['📊']), 'No price tables yet. Click “＋ New table”.']),
    ]),
  ]));
}

function createTable() {
  const s = getState();
  const name = prompt('Name the new price table.\nInclude the word “Zebra” for a zebra table, otherwise it is treated as Roller.\n\ne.g. "Roller #7" or "Zebra #7":');
  if (!name) return;
  if (s.tables[name]) return toast('A table with that name already exists');
  s.tables[name] = { widths: [36, 48, 60, 72], rows: [30, 48, 60, 72, 84].map((l) => ({ length: l, prices: [null, null, null, null] })) };
  s.minPrice[name] = 0;
  save();
  active = name;
  renderTables();
  toast('Table created');
}

function summary(name, table) {
  const s = getState();
  const nums = (a) => a.filter((x) => typeof x === 'number');
  const w = nums(table.widths), l = nums(table.rows.map((r) => r.length));
  const range = (a) => (a.length ? `${Math.min(...a)}–${Math.max(...a)}"` : '—');
  const stat = (label, val) => el('div', { class: 'stat' }, [el('span', { class: 'sv' }, [val]), el('span', { class: 'sl' }, [label])]);
  return el('div', { class: 'tbl-summary' }, [
    el('span', { class: 'type-badge ' + typeOf(name) }, [typeOf(name)]),
    stat('Widths', range(w)),
    stat('Lengths', range(l)),
    stat('Cells', String(w.length * l.length)),
  ]);
}

function tableActions(name) {
  const s = getState();
  return el('div', { class: 'row', style: 'gap:8px' }, [
    el('button', { class: 'btn small', onclick: () => {
      const nn = prompt('Rename table:', name);
      if (!nn || nn === name) return;
      if (s.tables[nn]) return toast('Name already used');
      s.tables = Object.fromEntries(Object.entries(s.tables).map(([k, v]) => [k === name ? nn : k, v]));
      s.minPrice[nn] = s.minPrice[name]; delete s.minPrice[name];
      s.quotes.forEach((q) => q.items.forEach((it) => { if (it.table === name) it.table = nn; }));
      save(); active = nn; renderTables(); toast('Renamed');
    } }, ['✎ Rename']),
    el('button', { class: 'btn small', onclick: () => {
      let nn = name + ' copy'; let i = 2;
      while (s.tables[nn]) nn = name + ' copy ' + i++;
      s.tables[nn] = structuredClone(s.tables[name]);
      s.minPrice[nn] = s.minPrice[name] || 0;
      save(); active = nn; renderTables(); toast('Duplicated');
    } }, ['⧉ Duplicate']),
    el('button', { class: 'btn small', style: 'color:var(--danger)', onclick: () => {
      if (!confirm(`Delete the "${name}" price table? Existing quotes keep their saved prices.`)) return;
      delete s.tables[name]; delete s.minPrice[name];
      save(); active = null; renderTables(); toast('Deleted');
    } }, ['🗑 Delete']),
  ]);
}

function gridEditor(name) {
  const s = getState();
  const table = s.tables[name];

  const numInput = (value, onChange) => el('input', {
    type: 'number', value: value ?? '',
    oninput: (e) => { onChange(e.target.value === '' ? null : Number(e.target.value)); save(); },
  });

  const headCells = [el('th', { class: 'corner' }, ['L \\ W'])];
  table.widths.forEach((w, ci) => {
    headCells.push(el('th', {}, [
      numInput(w, (v) => (table.widths[ci] = v)),
      el('div', { class: 'delcol', title: 'Delete this width column', onclick: () => { if (confirmAction(`Delete the ${w ?? ''}" width column and all its prices?`)) { table.widths.splice(ci, 1); table.rows.forEach((r) => r.prices.splice(ci, 1)); save(); renderTables(); } } }, ['✕']),
    ]));
  });
  headCells.push(el('th', { class: 'corner' }, ['']));

  const bodyRows = table.rows.map((row, ri) => {
    const cells = [el('td', { class: 'rowhead' }, [numInput(row.length, (v) => (row.length = v))])];
    row.prices.forEach((p, ci) => cells.push(el('td', {}, [numInput(p, (v) => (row.prices[ci] = v))])));
    cells.push(el('td', {}, [el('button', { class: 'icon', title: 'Delete this length row', onclick: () => { if (confirmAction(`Delete the ${row.length ?? ''}" length row and all its prices?`)) { table.rows.splice(ri, 1); save(); renderTables(); } } }, ['✕'])]));
    return el('tr', {}, cells);
  });

  const grid = el('table', { class: 'grid ' + typeOf(name) }, [el('thead', {}, [el('tr', {}, headCells)]), el('tbody', {}, bodyRows)]);

  const controls = el('div', { class: 'row', style: 'margin-top:16px;align-items:flex-end' }, [
    el('button', { class: 'btn small', onclick: () => { table.rows.push({ length: null, prices: table.widths.map(() => null) }); save(); renderTables(); } }, ['＋ Add length (row)']),
    el('button', { class: 'btn small', onclick: () => { table.widths.push(null); table.rows.forEach((r) => r.prices.push(null)); save(); renderTables(); } }, ['＋ Add width (column)']),
  ]);

  return el('div', { class: 'tbl-card ' + typeOf(name) }, [
    el('div', { class: 'section-head' }, [
      el('h3', { style: 'margin:0;font-size:17px;color:var(--ink);text-transform:none;letter-spacing:0' }, [name]),
      tableActions(name),
    ]),
    summary(name, table),
    el('div', { class: 'scroll' }, [grid]),
    el('p', { class: 'hint', style: 'margin:10px 0 0' }, ['Widths run left→right, lengths top→bottom. A shade uses the first width ≥ its size and the first length ≥ its size.']),
    controls,
  ]);
}
