// Lists editor — the dropdown option lists. Products and Fabrics are stored per shade
// type ({roller, zebra}) with their own Add box each, so membership is explicit.
import { el, mount, confirmAction } from './dom.js';
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

  const chip = (arr, i) => el('span', { class: 'pill', style: 'display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 12px' }, [
    String(arr[i]),
    el('button', { class: 'icon', style: 'padding:0 4px;font-size:13px', title: 'Remove', onclick: () => { if (confirmAction(`Remove “${arr[i]}” from the list?`)) { arr.splice(i, 1); save(); renderLists(); } } }, ['✕']),
  ]);

  const addBox = (arr, label) => {
    const box = el('input', { type: 'text', placeholder: 'Add ' + label + '…', style: 'min-width:200px' });
    const add = () => { const v = box.value.trim(); if (!v) return; arr.push(v); box.value = ''; save(); renderLists(); };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('label', { class: 'field' }, [' ', box]),
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

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', {}, ['Lists']),
      el('div', { class: 'hint' }, ['These fill the dropdowns in the quote form. Products & fabrics are kept per type (Roller / Zebra). Colors are shared — the chain/cassette colors are the same for both. Everything here saves to the cloud.']),
    ]),
    ...panels,
  ]));
}
