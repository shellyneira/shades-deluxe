// Lists editor — the dropdown option lists. Products and Fabrics are shown split
// into Roller vs Zebra (anything containing "Zebra" is a zebra option), matching
// how the quote form filters them.
import { el, mount, toast } from './dom.js';
import { getState, save } from './store.js';

const LABELS = {
  locations: 'Locations', wdNumbers: 'Window / Door #', products: 'Products',
  fabrics: 'Fabrics / Descriptions', colors: 'Colors', controls: 'Controls',
  systems: 'Systems', styles: 'Styles', headrails: 'Headrails / Bottom rails',
};
const SPLIT = { products: true, fabrics: true }; // shown grouped by Roller/Zebra
const isZebra = (v) => /zebra/i.test(v);

export function renderLists() {
  const s = getState();
  const keys = Object.keys(LABELS).filter((k) => s.options[k]);

  const chip = (items, i) => el('span', { class: 'pill', style: 'display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 12px' }, [
    String(items[i]),
    el('button', { class: 'icon', style: 'padding:0 4px;font-size:13px', title: 'Remove', onclick: () => { items.splice(i, 1); save(); renderLists(); } }, ['✕']),
  ]);

  const panels = keys.map((key) => {
    const items = s.options[key];
    const addRow = () => {
      const box = el('input', { type: 'text', placeholder: 'Add ' + LABELS[key].toLowerCase() + '…', style: 'min-width:220px' });
      const add = () => {
        const v = box.value.trim(); if (!v) return;
        items.push(v); save();
        if (SPLIT[key]) toast(isZebra(v) ? 'Added to Zebra' : 'Added to Roller');
        renderLists();
      };
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      return el('div', { class: 'row', style: 'margin-top:14px' }, [
        el('label', { class: 'field' }, [' ', box]),
        el('button', { class: 'btn small', onclick: add }, ['＋ Add']),
      ]);
    };

    let body;
    if (SPLIT[key]) {
      const group = (title, cls, filterFn) => {
        const idxs = items.map((v, i) => i).filter((i) => filterFn(items[i]));
        return el('div', { class: 'list-group' }, [
          el('div', { class: 'list-group-head ' + cls }, [el('span', { class: 'dot' }, []), title, el('span', { class: 'count' }, [String(idxs.length)])]),
          idxs.length ? el('div', { class: 'row', style: 'gap:8px' }, idxs.map((i) => chip(items, i)))
            : el('div', { class: 'muted', style: 'font-size:13px' }, ['(none)']),
        ]);
      };
      body = el('div', { class: 'list-split' }, [
        group('Roller', 'roller', (v) => !isZebra(v)),
        group('Zebra', 'zebra', (v) => isZebra(v)),
      ]);
    } else {
      body = items.length
        ? el('div', { class: 'row', style: 'gap:8px' }, items.map((_, i) => chip(items, i)))
        : el('div', { class: 'muted' }, ['(empty)']);
    }

    return el('div', { class: 'panel' }, [
      el('div', { class: 'section-head', style: 'margin-bottom:12px' }, [
        el('h3', { style: 'margin:0' }, [LABELS[key]]),
        SPLIT[key] ? el('span', { class: 'hint' }, ['Contains “Zebra” → Zebra, otherwise Roller']) : null,
      ]),
      body,
      addRow(),
    ]);
  });

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', {}, ['Lists']),
      el('div', { class: 'hint' }, ['These fill the dropdowns in the quote form. Products & fabrics auto-sort into Roller / Zebra by name. Everything here saves to the cloud.']),
    ]),
    ...panels,
  ]));
}
