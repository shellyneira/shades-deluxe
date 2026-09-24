// Lists editor — the dropdown option lists. Products, Fabrics and any category
// created here can be split one-list-per-product-type (Roller/Zebra/Drapery/...);
// everything else is one shared list.
import { el, mount, confirmAction, toast } from './dom.js';
import { getState, save } from './store.js';

const LABELS = {
  locations: 'Locations', wdNumbers: 'Window / Door #', products: 'Products',
  fabrics: 'Fabrics / Descriptions', colors: 'Colors', controls: 'Controls',
  systems: 'Systems', styles: 'Styles', headrails: 'Headrails / Bottom rails',
  accessories: 'Accessories',
};
const GROUPED = { products: true, fabrics: true }; // stored one array per category
// Only these add-ons carry a price. Products/fabrics get their price from the Price
// Tables; colors, locations, w/d and controls are plain labels.
const PRICEABLE = { systems: true, styles: true, headrails: true, accessories: true };
const PRICE_NOTE = {
  products: 'The price comes from Price Tables — adding one here costs nothing extra.',
  fabrics: 'The price comes from Price Tables — adding one here costs nothing extra.',
  accessories: 'Shared by every product type — pick any number of them on a worksheet line.',
};
const genId = () => 'cl_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);

// One option chip, used everywhere: a name, an optional editable price, a remove
// button. Every list in this screen looks and behaves the same way on purpose —
// the fewer shapes a low-effort reader has to learn, the fewer mistakes they make.
function chip(arr, i, priced, onChange) {
  const it = arr[i];
  const remove = el('button', {
    class: 'field-chip-x', title: `Remove “${it.name}”`, type: 'button',
    onclick: () => { if (confirmAction(`Remove “${it.name}”?`)) { arr.splice(i, 1); onChange(); } },
  }, ['✕']);
  if (!priced) return el('span', { class: 'field-chip' }, [it.name, remove]);
  const price = el('input', {
    type: 'number', min: '0', step: '0.01', value: it.price || 0, class: 'field-chip-price',
    title: `Extra charge when “${it.name}” is picked — 0 charges nothing`,
    onclick: (e) => e.stopPropagation(),
    oninput: (e) => { it.price = Number(e.target.value) || 0; save(); }, // blank must never poison a line total
  });
  return el('span', { class: 'field-chip field-chip--priced' }, [
    it.name, el('span', { class: 'field-chip-currency' }, ['$']), price, remove,
  ]);
}

function addRow(arr, placeholder, priced, onChange) {
  const name = el('input', { type: 'text', class: 'field-add-input', placeholder: 'Type a ' + placeholder + '…' });
  const price = priced ? el('input', { type: 'number', min: '0', step: '0.01', class: 'field-add-price', placeholder: '$0' }) : null;
  const add = () => {
    const v = name.value.trim();
    if (!v) return name.focus();
    arr.push({ name: v, price: priced ? Number(price.value) || 0 : 0 });
    name.value = ''; if (price) price.value = '';
    onChange();
    name.focus();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  if (price) price.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return el('div', { class: 'field-add-row' }, [
    name, price, el('button', { class: 'btn primary small', type: 'button', onclick: add }, ['+ Add']),
  ]);
}

// One category = one card. `groups` is [{ label, arr }] — a single { label: null }
// entry renders as one plain list; several entries (Roller / Zebra / Drapery / …)
// render as side-by-side sub-cards, all in the same neutral style — no color-coding
// to decode, just the plain name of each product type.
function categoryCard({ title, hint, groups, priced, onChange, headerActions }) {
  const sub = (g) => el('div', { class: 'field-subcard' }, [
    g.label ? el('div', { class: 'field-subcard-head' }, [g.label, el('span', { class: 'field-count' }, [String(g.arr.length)])]) : null,
    g.arr.length
      ? el('div', { class: 'field-chip-row' }, g.arr.map((_, i) => chip(g.arr, i, priced, onChange)))
      : el('div', { class: 'field-empty' }, ['Nothing here yet.']),
    addRow(g.arr, (g.label || title).toLowerCase(), priced, onChange),
  ]);
  return el('div', { class: 'panel field-panel' }, [
    el('div', { class: 'section-head', style: 'margin-bottom:14px' }, [
      el('div', {}, [el('h3', { style: 'margin:0' }, [title]), hint ? el('div', { class: 'hint' }, [hint]) : null]),
      headerActions ? el('div', { class: 'row', style: 'gap:8px' }, headerActions) : null,
    ]),
    groups.length > 1
      ? el('div', { class: 'field-subcard-grid' }, groups.map(sub))
      : sub(groups[0]),
  ]);
}

// The self-service flow: two plain yes/no questions, asked in words a first-time
// user can answer without knowing what "per-category" or "schema" mean.
function newCategoryForm(onDone) {
  let perCategory = false, priced = false;
  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Pattern, Trim, Lift Type…' });

  const choiceGroup = (question, choices, get, set) => {
    const btns = choices.map(([val, label]) => el('button', {
      type: 'button',
      class: 'choice-btn' + (get() === val ? ' active' : ''),
      onclick: () => { set(val); refreshChoices(); },
    }, [label]));
    const wrap = el('div', { class: 'field-choice-group' }, [el('div', { class: 'field-choice-q' }, [question]), el('div', { class: 'row', style: 'gap:8px' }, btns)]);
    wrap._refresh = () => btns.forEach((b, i) => b.classList.toggle('active', get() === choices[i][0]));
    return wrap;
  };
  const groups = [];
  const perCatGroup = choiceGroup('Does it change between Roller, Zebra and Drapery?', [[false, 'No — one shared list'], [true, 'Yes — a list for each']], () => perCategory, (v) => (perCategory = v));
  const pricedGroup = choiceGroup('Should picking an option ever add a price?', [[false, 'No — just a label'], [true, 'Yes — let me set prices']], () => priced, (v) => (priced = v));
  groups.push(perCatGroup, pricedGroup);
  function refreshChoices() { groups.forEach((g) => g._refresh()); }

  const create = () => {
    const name = nameInput.value.trim();
    if (!name) return nameInput.focus();
    const s = getState();
    const items = perCategory ? Object.fromEntries(s.categories.map((c) => [c, []])) : [];
    (s.customLists = s.customLists || []).push({ id: genId(), name, perCategory, priced, items });
    save();
    toast(`“${name}” category created`);
    onDone();
  };

  return el('div', { class: 'panel field-panel new-cat-card' }, [
    el('h3', { style: 'margin:0 0 4px' }, ['New category']),
    el('div', { class: 'hint', style: 'margin-bottom:14px' }, ['Give it a name, answer two questions, and it shows up here — and on the worksheet if it changes by product type — right away.']),
    el('label', { class: 'field', style: 'margin-bottom:14px' }, ['Category name', nameInput]),
    ...groups,
    el('div', { class: 'row', style: 'margin-top:16px;gap:10px' }, [
      el('button', { class: 'btn primary', onclick: create }, ['✓ Create category']),
      el('button', { class: 'btn ghost', onclick: onDone }, ['Cancel']),
    ]),
  ]);
}

let creating = false;

export function renderLists() {
  const s = getState();
  const keys = Object.keys(LABELS).filter((k) => s.options[k]);

  const panels = keys.map((key) => {
    const val = s.options[key];
    const priced = !!PRICEABLE[key];
    const groups = GROUPED[key]
      ? s.categories.map((cat) => ({ label: cat, arr: val[cat] || (val[cat] = []) }))
      : [{ label: null, arr: val }];
    return categoryCard({
      title: LABELS[key],
      hint: PRICE_NOTE[key] || (priced ? 'Add a $ amount if picking one should cost extra.' : ''),
      groups, priced, onChange: () => { save(); renderLists(); },
    });
  });

  // Custom categories — same card, plus rename/delete since the user made them.
  const custom = (s.customLists || []).map((list) => {
    const groups = list.perCategory
      ? s.categories.map((cat) => ({ label: cat, arr: list.items[cat] || (list.items[cat] = []) }))
      : [{ label: null, arr: list.items }];
    return categoryCard({
      title: list.name,
      hint: list.perCategory ? 'One list per product type — shown on the worksheet before Color.' : 'One shared list.',
      groups, priced: list.priced, onChange: () => { save(); renderLists(); },
      headerActions: [
        el('button', { class: 'btn small ghost', onclick: () => { const nn = prompt('Rename category:', list.name); if (nn?.trim()) { list.name = nn.trim(); save(); renderLists(); } } }, ['Rename']),
        el('button', { class: 'btn small ghost', style: 'color:var(--danger)', onclick: () => { if (confirmAction(`Delete the “${list.name}” category? Any quotes already using it keep their old value, but it disappears from the dropdown.`)) { s.customLists = s.customLists.filter((l) => l !== list); save(); renderLists(); } } }, ['Delete']),
      ],
    });
  });

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('div', { class: 'section-head' }, [
        el('div', {}, [
          el('h2', {}, ['Lists']),
          el('div', { class: 'hint' }, ['What shows up in the quote form’s dropdowns. Changes save automatically and appear for everyone.']),
        ]),
        el('button', { class: 'btn primary', onclick: () => { creating = true; renderLists(); } }, ['+ New category']),
      ]),
    ]),
    creating ? newCategoryForm(() => { creating = false; renderLists(); }) : null,
    ...panels,
    ...custom,
  ]));
}
