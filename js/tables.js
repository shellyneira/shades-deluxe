// Price Tables editor — the "database" screen. Fully editable width×length price grids.
import { el, mount, toast } from './dom.js';
import { getState, save } from './store.js';

let active = null;

export function renderTables() {
  const s = getState();
  const names = Object.keys(s.tables);
  if (!active || !names.includes(active)) active = names[0];

  const tabs = el('div', { class: 'subtabs' }, names.map((n) =>
    el('button', { class: 'subtab' + (n === active ? ' active' : ''), onclick: () => { active = n; renderTables(); } }, [n])));

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'section-head' }, [
        el('h2', {}, ['Price Tables']),
        el('span', { class: 'muted' }, ['Edit any price, add lengths (rows) or widths (columns). Saves automatically.']),
      ]),
      tabs,
      gridEditor(active),
    ]),
  ]));
}

function gridEditor(name) {
  const s = getState();
  const table = s.tables[name];

  const numInput = (value, onChange, cls = '') => {
    const i = el('input', { type: 'number', value: value ?? '', class: cls, oninput: (e) => { onChange(e.target.value === '' ? null : Number(e.target.value)); save(); } });
    return i;
  };

  // header row: corner + width columns (each editable + delete)
  const headCells = [el('th', { class: 'corner' }, ['L \\ W'])];
  table.widths.forEach((w, ci) => {
    headCells.push(el('th', {}, [
      numInput(w, (v) => (table.widths[ci] = v)),
      el('div', { class: 'delcol', title: 'Delete this width column', onclick: () => { table.widths.splice(ci, 1); table.rows.forEach((r) => r.prices.splice(ci, 1)); save(); renderTables(); } }, ['✕']),
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

  const controls = el('div', { class: 'row', style: 'margin-top:16px' }, [
    el('button', { class: 'btn small', onclick: () => { table.rows.push({ length: null, prices: table.widths.map(() => null) }); save(); renderTables(); } }, ['+ Add length (row)']),
    el('button', { class: 'btn small', onclick: () => { table.widths.push(null); table.rows.forEach((r) => r.prices.push(null)); save(); renderTables(); } }, ['+ Add width (column)']),
    el('div', { class: 'spacer' }),
    el('label', { class: 'field' }, [
      'Minimum price ($)',
      el('input', { type: 'number', value: s.minPrice[name] ?? 0, style: 'width:120px', oninput: (e) => { s.minPrice[name] = Number(e.target.value) || 0; save(); toast('Saved'); } }),
    ]),
  ]);

  return el('div', {}, [
    el('div', { class: 'scroll' }, [grid]),
    el('p', { class: 'muted', style: 'margin:8px 0 0' }, ['Widths run left→right, lengths top→bottom. A shade uses the first width ≥ its size and the first length ≥ its size. Minimum price is the floor for any shade on this table (set 0 to disable).']),
    controls,
  ]);
}
