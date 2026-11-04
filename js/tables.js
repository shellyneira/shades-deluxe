// Price Tables editor — the pricing "database". Tables are grouped by an explicit
// category (Roller, Zebra, or whatever you name) — drag a table's chip onto another
// group to recategorize it. Create, rename, duplicate, delete tables and edit each
// width×length grid.
import { el, mount, toast } from './dom.js';
import { dropdown, confirmAction, labeled, iconButton } from './ui.js';
import { getState, save, deletePriceTableCloudRow } from './store.js';
import { DRAPERY_STYLES, DRAPERY_RATE_LABELS } from './pricing.js';

let active = null;

// Which price table is open — read by presence.js.
export const activeTable = () => {
  const names = Object.keys(getState().tables);
  return names.includes(active) ? active : names[0] || null;
};
export const tablesRoute = () => (active ? [active] : []);
export function applyTablesRoute([name] = []) { active = name || null; }
// A table named in the URL may not be in the store until the cloud pull lands, so
// renderTables falls back without forgetting it; this runs once data has settled.
export function dropMissingTable() { if (active && !getState().tables[active]) active = null; }

// Deterministic color per category so new ones (Drapery, Outdoor, ...) just work
// without editing CSS — index into a small fixed palette, not name-keyed classes.
const PALETTE = [2, 1, 3, 4, 5, 6, 7, 9].map((n) => `var(--id-${n})`);
export function categoryColor(cat) {
  const i = getState().categories.indexOf(cat);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

export function renderTables() {
  const s = getState();
  const names = Object.keys(s.tables);
  const shown = names.includes(active) ? active : names[0] || null;

  const chip = (n) => el('button', {
    class: 'ptab' + (n === shown ? ' active' : ''),
    style: `--cat-color:${categoryColor(s.tables[n].category)}`,
    draggable: true,
    ondragstart: (e) => e.dataTransfer.setData('text/plain', n),
    onclick: () => { active = n; renderTables(); },
  }, [el('span', { class: 'dot' }, []), n]);

  const groups = el('div', { class: 'ptabs' }, [
    ...s.categories.map((cat) => {
      const group = el('div', {
        class: 'ptab-group',
        style: `--cat-color:${categoryColor(cat)}`,
        ondragover: (e) => { e.preventDefault(); group.classList.add('dragover'); },
        ondragleave: () => group.classList.remove('dragover'),
        ondrop: (e) => {
          group.classList.remove('dragover');
          const n = e.dataTransfer.getData('text/plain');
          if (s.tables[n] && s.tables[n].category !== cat) { s.tables[n].category = cat; save(); renderTables(); toast(`Moved to ${cat}`); }
        },
      }, [el('span', { class: 'ptab-label' }, [cat]), ...names.filter((n) => s.tables[n].category === cat).map(chip)]);
      return group;
    }),
    el('button', { class: 'ptab new', onclick: openCreateModal }, labeled('plus', 'New table')),
  ]);

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'section-head' }, [
        el('div', {}, [el('h2', {}, ['Price Tables']), el('div', { class: 'hint' }, ['Each table keeps its own prices. Pick one, edit any cell — it saves as you type. Drag a chip onto another category to move it there.'])]),
      ]),
      groups,
      shown ? (s.tables[shown].kind === 'formula' ? formulaEditor(shown) : gridEditor(shown)) : el('div', { class: 'empty' }, [el('div', { class: 'big' }, labeled('chart', '', 40)), 'No price tables yet. Click “New table”.']),
    ]),
  ]));
}

function openCreateModal() {
  const s = getState();
  let addingNew = false;

  const nameInp = el('input', { type: 'text', placeholder: 'e.g. "Roller #7" or "Drapery"' });
  const err = el('div', { style: 'color:var(--danger);font-size:13px;display:none' }, []);
  const showErr = (msg) => { err.textContent = msg; err.style.display = ''; };

  const newCatInp = el('input', { type: 'text', placeholder: 'New category name', style: 'display:none;margin-top:8px' });
  let category = s.categories[0];
  const catSelect = dropdown({
    options: [...s.categories.map((c) => ({ value: c, label: c })), { value: '__new__', label: '+ Add new category…' }],
    value: category,
    onChange: (v) => { category = v; addingNew = v === '__new__'; newCatInp.style.display = addingNew ? '' : 'none'; },
  });

  const close = () => overlay.remove();
  const create = () => {
    err.style.display = 'none';
    const name = nameInp.value.trim();
    if (!name) return showErr('Enter a table name first');
    if (s.tables[name]) return showErr('A table with that name already exists');
    let cat = category;
    if (addingNew) {
      cat = newCatInp.value.trim();
      if (!cat) return showErr('Enter a category name');
      if (!s.categories.includes(cat)) s.categories.push(cat);
    }
    s.tables[name] = { category: cat, widths: [36, 48, 60, 72], rows: [30, 48, 60, 72, 84].map((l) => ({ length: l, prices: [null, null, null, null] })) };
    s.minPrice[name] = 0;
    save();
    active = name;
    close();
    renderTables();
    toast('Table created');
  };

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, [
    el('div', { class: 'modal-card' }, [
      el('h3', { style: 'margin:0 0 14px' }, ['New price table']),
      el('label', { class: 'field' }, ['Table name', nameInp]),
      el('label', { class: 'field', style: 'margin-top:10px' }, ['Category', catSelect]),
      newCatInp,
      err,
      el('div', { class: 'row', style: 'margin-top:16px;justify-content:flex-end;gap:8px' }, [
        el('button', { class: 'btn small', onclick: close }, ['Cancel']),
        el('button', { class: 'btn primary small', onclick: create }, ['Create']),
      ]),
    ]),
  ]);
  document.body.append(overlay);
  nameInp.focus();
}

function summary(name, table) {
  const nums = (a) => a.filter((x) => typeof x === 'number');
  const w = nums(table.widths), l = nums(table.rows.map((r) => r.length));
  const range = (a) => (a.length ? `${Math.min(...a)}–${Math.max(...a)}"` : '—');
  const stat = (label, val) => el('div', { class: 'stat' }, [el('span', { class: 'sv' }, [val]), el('span', { class: 'sl' }, [label])]);
  return el('div', { class: 'tbl-summary' }, [
    el('span', { class: 'type-badge', style: `--cat-color:${categoryColor(table.category)}` }, [table.category]),
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
      save(); deletePriceTableCloudRow(name); active = nn; renderTables(); toast('Renamed');
    } }, labeled('pencil', 'Rename')),
    el('button', { class: 'btn small', onclick: () => {
      let nn = name + ' copy'; let i = 2;
      while (s.tables[nn]) nn = name + ' copy ' + i++;
      s.tables[nn] = structuredClone(s.tables[name]);
      s.minPrice[nn] = s.minPrice[name] || 0;
      save(); active = nn; renderTables(); toast('Duplicated');
    } }, labeled('copy', 'Duplicate')),
    el('button', { class: 'btn small', style: 'color:var(--danger)', onclick: () => {
      if (!confirm(`Delete the "${name}" price table? Existing quotes keep their saved prices.`)) return;
      delete s.tables[name]; delete s.minPrice[name];
      save(); deletePriceTableCloudRow(name); active = null; renderTables(); toast('Deleted');
    } }, labeled('trash', 'Delete')),
  ]);
}

// Drapery tables aren't a width×length grid — they're priced by formula (see
// pricing.js), so this edits the style's rate constants instead of grid cells.
function formulaEditor(name) {
  const s = getState();
  const table = s.tables[name];
  const def = DRAPERY_STYLES[table.style];
  table.rates = table.rates || {};

  const fields = Object.keys(def.rates).map((key) => el('label', { class: 'field', style: 'flex:1 1 220px' }, [
    DRAPERY_RATE_LABELS[key] || key,
    el('input', {
      type: 'number', step: 'any', value: table.rates[key] ?? def.rates[key],
      oninput: (e) => { table.rates[key] = e.target.value === '' ? null : Number(e.target.value); save(); },
    }),
  ]));

  const priced = ['Width', 'Height', 'Fabric $/yd', def.hasLining && 'Lining', def.hasTrack && 'Track'].filter(Boolean).join(', ');

  return el('div', { class: 'tbl-card', style: `--cat-color:${categoryColor(table.category)}` }, [
    el('div', { class: 'section-head' }, [
      el('h3', { style: 'margin:0;font-size:17px;color:var(--ink);text-transform:none;letter-spacing:0' }, [name]),
      tableActions(name),
    ]),
    el('div', { class: 'tbl-summary' }, [
      el('span', { class: 'type-badge', style: `--cat-color:${categoryColor(table.category)}` }, [table.category]),
      el('span', { class: 'hint' }, [`Formula-based — ${def.label}`]),
    ]),
    el('div', { class: 'row', style: 'flex-wrap:wrap;gap:14px 20px;margin-top:6px' }, fields),
    el('p', { class: 'hint', style: 'margin-top:16px' }, [`Priced from ${priced} on the worksheet — not a width×length grid.`]),
  ]);
}

function gridEditor(name) {
  const s = getState();
  const table = s.tables[name];

  const numInput = (value, onChange, className = '') => el('input', {
    type: 'number', value: value ?? '', class: className, placeholder: className ? '—' : '',
    oninput: (e) => { onChange(e.target.value === '' ? null : Number(e.target.value)); save(); },
  });

  const headCells = [el('th', { class: 'corner' }, [el('span', {}, ['Width →']), el('span', {}, ['Length ↓'])])];
  table.widths.forEach((w, ci) => {
    headCells.push(el('th', {}, [
      numInput(w, (v) => (table.widths[ci] = v)),
      iconButton('x', 'Delete this width column', 'danger', async () => { if (await confirmAction(`Delete the ${w ?? ''}" width column and all its prices?`)) { table.widths.splice(ci, 1); table.rows.forEach((r) => r.prices.splice(ci, 1)); save(); renderTables(); } }, 13),
    ]));
  });
  headCells.push(el('th', {}, []));

  const bodyRows = table.rows.map((row, ri) => {
    const cells = [el('td', { class: 'rowhead' }, [numInput(row.length, (v) => (row.length = v))])];
    row.prices.forEach((p, ci) => cells.push(el('td', {}, [numInput(p, (v) => (row.prices[ci] = v), 'cell-price')])));
    cells.push(el('td', { class: 'del' }, [iconButton('x', 'Delete this length row', 'danger', async () => { if (await confirmAction(`Delete the ${row.length ?? ''}" length row and all its prices?`)) { table.rows.splice(ri, 1); save(); renderTables(); } }, 14)]));
    return el('tr', {}, cells);
  });

  const grid = el('table', { class: 'grid' }, [el('thead', {}, [el('tr', {}, headCells)]), el('tbody', {}, bodyRows)]);

  const controls = el('div', { class: 'row', style: 'margin-top:16px;align-items:flex-end' }, [
    el('button', { class: 'btn small', onclick: () => { table.rows.push({ length: null, prices: table.widths.map(() => null) }); save(); renderTables(); } }, labeled('plus', 'Add length (row)', 15)),
    el('button', { class: 'btn small', onclick: () => { table.widths.push(null); table.rows.forEach((r) => r.prices.push(null)); save(); renderTables(); } }, labeled('plus', 'Add width (column)', 15)),
  ]);

  return el('div', { class: 'tbl-card', style: `--cat-color:${categoryColor(table.category)}` }, [
    el('div', { class: 'section-head' }, [
      el('h3', { style: 'margin:0;font-size:17px;color:var(--ink);text-transform:none;letter-spacing:0' }, [name]),
      tableActions(name),
    ]),
    summary(name, table),
    el('div', { class: 'grid-wrap' }, [grid]),
    el('p', { class: 'hint', style: 'margin:10px 0 0' }, ['Widths run left→right, lengths top→bottom. A shade uses the first width ≥ its size and the first length ≥ its size.']),
    controls,
  ]);
}
