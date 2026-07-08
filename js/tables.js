// Price Tables editor — the "database" screen. Create, rename, duplicate, delete
// tables, and edit each width×length price grid. New tables appear in the quote
// dropdown automatically.
import { el, mount, toast } from './dom.js';
import { getState, save } from './store.js';

let active = null;

export function renderTables() {
  const s = getState();
  const names = Object.keys(s.tables);
  if (!active || !names.includes(active)) active = names[0] || null;

  const tabs = el('div', { class: 'subtabs' }, [
    ...names.map((n) =>
      el('button', { class: 'subtab' + (n === active ? ' active' : ''), onclick: () => { active = n; renderTables(); } }, [n])),
    el('button', { class: 'subtab', style: 'border-style:dashed;color:var(--brand)', onclick: createTable }, ['＋ New table']),
  ]);

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'section-head' }, [
        el('div', {}, [el('h2', {}, ['Price Tables']), el('div', { class: 'hint' }, ['Your pricing database. Edit any price, add lengths (rows) or widths (columns) — it saves as you type.'])]),
      ]),
      tabs,
      active ? gridEditor(active) : el('div', { class: 'empty' }, [el('div', { class: 'big' }, ['📊']), 'No price tables yet. Click “＋ New table”.']),
    ]),
  ]));
}

function createTable() {
  const s = getState();
  const name = prompt('Name for the new price table (e.g. "Sheer #3"):');
  if (!name) return;
  if (s.tables[name]) return toast('A table with that name already exists');
  // seed with a small starter grid so it's usable immediately
  s.tables[name] = { widths: [36, 48, 60, 72], rows: [30, 48, 60, 72, 84].map((l) => ({ length: l, prices: [null, null, null, null] })) };
  s.minPrice[name] = 0;
  save();
  active = name;
  renderTables();
  toast('Table created');
}

function tableActions(name) {
  const s = getState();
  return el('div', { class: 'row', style: 'gap:8px' }, [
    el('button', { class: 'btn small', onclick: () => {
      const nn = prompt('Rename table:', name);
      if (!nn || nn === name) return;
      if (s.tables[nn]) return toast('Name already used');
      // preserve order while renaming the key
      const entries = Object.entries(s.tables).map(([k, v]) => [k === name ? nn : k, v]);
      s.tables = Object.fromEntries(entries);
      s.minPrice[nn] = s.minPrice[name]; delete s.minPrice[name];
      // repoint any quote lines using the old name
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
      el('div', { class: 'delcol', title: 'Delete this width column', onclick: () => { table.widths.splice(ci, 1); table.rows.forEach((r) => r.prices.splice(ci, 1)); save(); renderTables(); } }, ['✕ col']),
    ]));
  });
  headCells.push(el('th', { class: 'corner' }, ['']));

  const bodyRows = table.rows.map((row, ri) => {
    const cells = [el('td', { class: 'rowhead' }, [numInput(row.length, (v) => (row.length = v))])];
    row.prices.forEach((p, ci) => cells.push(el('td', {}, [numInput(p, (v) => (row.prices[ci] = v))])));
    cells.push(el('td', {}, [el('button', { class: 'icon', title: 'Delete this length row', onclick: () => { table.rows.splice(ri, 1); save(); renderTables(); } }, ['✕'])]));
    return el('tr', {}, cells);
  });

  const grid = el('table', { class: 'grid' }, [el('thead', {}, [el('tr', {}, headCells)]), el('tbody', {}, bodyRows)]);

  const controls = el('div', { class: 'row', style: 'margin-top:16px;align-items:flex-end' }, [
    el('button', { class: 'btn small', onclick: () => { table.rows.push({ length: null, prices: table.widths.map(() => null) }); save(); renderTables(); } }, ['＋ Add length (row)']),
    el('button', { class: 'btn small', onclick: () => { table.widths.push(null); table.rows.forEach((r) => r.prices.push(null)); save(); renderTables(); } }, ['＋ Add width (column)']),
    el('div', { class: 'spacer' }),
    el('label', { class: 'field' }, [
      'Minimum price ($)',
      el('input', { type: 'number', value: s.minPrice[name] ?? 0, style: 'width:130px', oninput: (e) => { s.minPrice[name] = Number(e.target.value) || 0; save(); toast('Saved'); } }),
    ]),
  ]);

  return el('div', {}, [
    el('div', { class: 'section-head' }, [
      el('h3', { style: 'margin:0' }, [name]),
      tableActions(name),
    ]),
    el('div', { class: 'scroll' }, [grid]),
    el('p', { class: 'hint', style: 'margin:10px 0 0' }, ['Widths run left→right, lengths top→bottom. A shade uses the first width ≥ its size and the first length ≥ its size. Minimum price is the floor for any shade on this table (set 0 to disable).']),
    controls,
  ]);
}
