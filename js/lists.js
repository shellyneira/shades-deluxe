// Lists editor — the dropdown option lists. Products and Fabrics are stored per shade
// type ({roller, zebra}) with their own Add box each, so membership is explicit.
import { el, mount, confirmAction, toast } from './dom.js';
import { getState, save } from './store.js';

const LABELS = {
  locations: 'Locations', wdNumbers: 'Window / Door #', products: 'Products',
  fabrics: 'Fabrics / Descriptions', colors: 'Colors', controls: 'Controls',
  systems: 'Systems', styles: 'Styles', headrails: 'Headrails / Bottom rails',
};
const GROUPED = { products: true, fabrics: true }; // stored as {roller, zebra}

export function renderLists() {
  const s = getState();
  const keys = Object.keys(LABELS).filter((k) => s.options[k]);

  const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const chip = (arr, i) => {
    const it = arr[i];
    return el('span', { class: 'pill', style: 'display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 12px' }, [
      it.name,
      it.price > 0 ? el('span', { class: 'price-tag' }, [money(it.price)]) : null,
      el('button', { class: 'icon', style: 'padding:0 4px;font-size:13px', title: 'Remove', onclick: () => { if (confirmAction(`Remove “${it.name}” from the list?`)) { arr.splice(i, 1); save(); renderLists(); } } }, ['✕']),
    ]);
  };

  const addBox = (arr, label) => {
    const name = el('input', { type: 'text', placeholder: 'Add ' + label + '…', style: 'min-width:180px' });
    const price = el('input', { type: 'number', min: '0', step: '0.01', placeholder: '$ (optional)', style: 'width:120px' });
    const add = () => { const v = name.value.trim(); if (!v) return; arr.push({ name: v, price: Number(price.value) || 0 }); name.value = ''; price.value = ''; save(); renderLists(); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') price.focus(); });
    price.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('label', { class: 'field' }, [' ', name]),
      el('label', { class: 'field' }, [' ', price]),
      el('button', { class: 'btn small', onclick: add }, ['＋ Add']),
    ]);
  };

  const flatList = (arr) => arr.length
    ? el('div', { class: 'row', style: 'gap:8px' }, arr.map((_, i) => chip(arr, i)))
    : el('div', { class: 'muted' }, ['(empty)']);

  const groupCol = (arr, title, cls) => el('div', { class: 'list-group' }, [
    el('div', { class: 'list-group-head ' + cls }, [el('span', { class: 'dot' }, []), title, el('span', { class: 'count' }, [String(arr.length)])]),
    arr.length ? el('div', { class: 'row', style: 'gap:8px' }, arr.map((_, i) => chip(arr, i))) : el('div', { class: 'muted', style: 'font-size:13px' }, ['(none)']),
    addBox(arr, title.toLowerCase()),
  ]);

  const panels = keys.map((key) => {
    const val = s.options[key];
    const body = GROUPED[key]
      ? el('div', { class: 'list-split' }, [groupCol(val.roller, 'Roller', 'roller'), groupCol(val.zebra, 'Zebra', 'zebra')])
      : el('div', {}, [flatList(val), addBox(val, LABELS[key].toLowerCase())]);

    return el('div', { class: 'panel' }, [
      el('div', { class: 'section-head', style: 'margin-bottom:12px' }, [
        el('h3', { style: 'margin:0' }, [LABELS[key]]),
        GROUPED[key] ? el('span', { class: 'hint' }, ['Each type has its own list — add to the right column']) : null,
      ]),
      body,
    ]);
  });

  // Custom user-defined lists (reference lists you maintain yourself).
  const custom = (s.customLists || []).map((list, li) => el('div', { class: 'panel' }, [
    el('div', { class: 'section-head', style: 'margin-bottom:12px' }, [
      el('h3', { style: 'margin:0' }, [list.name]),
      el('div', { class: 'row', style: 'gap:8px' }, [
        el('button', { class: 'btn small', onclick: () => { const nn = prompt('Rename list:', list.name); if (nn) { list.name = nn; save(); renderLists(); } } }, ['✎ Rename']),
        el('button', { class: 'btn small', style: 'color:var(--danger)', onclick: () => { if (confirmAction(`Delete the “${list.name}” list?`)) { s.customLists.splice(li, 1); save(); renderLists(); } } }, ['🗑 Delete']),
      ]),
    ]),
    flatList(list.items),
    addBox(list.items, list.name.toLowerCase()),
  ]));

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'section-head' }, [
        el('div', {}, [el('h2', {}, ['Lists']), el('div', { class: 'hint' }, ['Fill the dropdowns in the quote form. Products & fabrics are per type (Roller / Zebra); colors are shared. Saves to the cloud.'])]),
        el('button', { class: 'btn', onclick: () => { const name = prompt('Name of the new list:'); if (!name) return; (s.customLists = s.customLists || []).push({ name, items: [] }); save(); renderLists(); toast('List created'); } }, ['＋ New list']),
      ]),
    ]),
    ...panels,
    ...custom,
  ]));
}
