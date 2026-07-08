// Lists editor — the dropdown option lists (locations, products, fabrics, colors, etc.).
import { el, mount } from './dom.js';
import { getState, save } from './store.js';

const LABELS = {
  locations: 'Locations', wdNumbers: 'Window / Door #', products: 'Products',
  fabrics: 'Fabrics / Descriptions', colors: 'Colors', controls: 'Controls',
  systems: 'Systems', styles: 'Styles', headrails: 'Headrails / Bottom rails',
};

export function renderLists() {
  const s = getState();
  const keys = Object.keys(LABELS).filter((k) => s.options[k]);

  const panels = keys.map((key) => {
    const items = s.options[key];
    const list = el('div', { class: 'row', style: 'gap:8px' }, items.map((val, i) =>
      el('span', { class: 'pill', style: 'display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 12px' }, [
        String(val),
        el('button', { class: 'icon', style: 'padding:0 4px;font-size:13px', title: 'Remove', onclick: () => { items.splice(i, 1); save(); renderLists(); } }, ['✕']),
      ])));

    const box = el('input', { type: 'text', placeholder: 'Add ' + LABELS[key].toLowerCase() + '…', style: 'min-width:220px' });
    const add = () => { const v = box.value.trim(); if (!v) return; items.push(v); box.value = ''; save(); renderLists(); };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    return el('div', { class: 'panel' }, [
      el('h3', {}, [LABELS[key]]),
      list.childNodes.length ? list : el('div', { class: 'muted', style: 'margin-bottom:10px' }, ['(empty)']),
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('label', { class: 'field' }, [' ', box]),
        el('button', { class: 'btn small', onclick: add }, ['+ Add']),
      ]),
    ]);
  });

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', {}, ['Lists']),
      el('span', { class: 'muted' }, ['These fill the dropdowns in the quote form. Fabrics and colors are the ones you’ll add to most.']),
    ]),
    ...panels,
  ]));
}
