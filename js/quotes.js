// Quotes: list -> estimator worksheet (internal, with dimensions) -> invoice (customer, no dimensions).
import { el, select, input, mount, toast, confirmAction, FRACTION_LABEL } from './dom.js';
import { getState, save, newQuote, getQuote, deleteQuote, assignInvoiceNumber } from './store.js';
import { computeLine, describeLine, quoteTotals, money, money0, roundWhole, round2, DRAPERY_STYLES, draperyAutoInstall } from './pricing.js';
import { textToPdfBlob } from './pdf.js';

let sub = { view: 'list', quoteId: null };

export function renderQuotes() {
  if (sub.view === 'edit' && getQuote(sub.quoteId)) return mount(editor(getQuote(sub.quoteId)));
  if (sub.view === 'invoice' && getQuote(sub.quoteId)) return mount(invoice(getQuote(sub.quoteId)));
  sub = { view: 'list', quoteId: null };
  return mount(list());
}

function open(id, view = 'edit') {
  sub = { view, quoteId: id };
  renderQuotes();
}

/* ---------------- list ---------------- */
// One lifecycle: Quote → Sent (still a quote) → Accepted/Deposit Paid/Paid (an invoice).
const STAGES = ['Quote', 'Accepted', '50% Paid', '100% Paid'];
const stagePct = (st) => (st === '100% Paid' ? 1 : st === '50% Paid' ? 0.5 : 0);
const isInvoiceStage = (st) => st === 'Accepted' || st === '50% Paid' || st === '100% Paid';
const STAGE_CLASS = { Quote: 'quote', Accepted: 'accepted', '50% Paid': 'half', '100% Paid': 'paid' };
const stageClass = (st) => STAGE_CLASS[st] || 'quote';
let filter = 'all';

function list() {
  const s = getState();
  const head = el('div', { class: 'section-head' }, [
    el('div', {}, [el('h2', {}, ['Quotes & Orders']), el('div', { class: 'hint' }, [s.quotes.length + ' total'])]),
    el('button', { class: 'btn primary', onclick: () => open(newQuote().id) }, ['＋ New Quote']),
  ]);

  const filters = el('div', { class: 'subtabs' }, ['all', ...STAGES].map((f) =>
    el('button', { class: 'subtab' + (f === filter ? ' active' : ''), onclick: () => { filter = f; renderQuotes(); } }, [f])));

  const shown = s.quotes.filter((q) => filter === 'all' || (q.stage || 'Quote') === filter);
  const body = shown.length
    ? el('div', { class: 'cards' }, shown.map((q) => {
      const t = quoteTotals(q, s);
      const st = q.stage || 'Quote';
      const num = isInvoiceStage(st) && q.invoiceNumber ? 'INV #' + q.invoiceNumber : 'Q #' + q.number;
      return el('div', { class: 'card', onclick: () => open(q.id) }, [
        el('div', { class: 'status' }, [el('span', { class: 'badge ' + stageClass(st) }, [st])]),
        el('div', { class: 'muted' }, [num + ' · ' + (q.date || '')]),
        el('div', { class: 'big' }, [q.client.name || 'Untitled client']),
        el('div', { class: 'muted' }, [q.items.length + ' item(s)']),
        el('div', { class: 'total' }, [money(t.total)]),
      ]);
    }))
    : el('div', { class: 'empty' }, [el('div', { class: 'big' }, ['🪟']), s.quotes.length ? 'No quotes in this filter.' : 'No quotes yet. Click “New Quote” to start.']);

  return el('div', { class: 'panel' }, [head, filters, body]);
}

/* ---------------- estimator worksheet ---------------- */
function editor(q) {
  const s = getState();
  const set = (fn) => { fn(); save(); };

  const toolbar = el('div', { class: 'section-head' }, [
    el('button', { class: 'btn ghost', onclick: () => { sub = { view: 'list' }; renderQuotes(); } }, ['← All quotes']),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn', onclick: () => { commitDraftIfFilled(q); open(q.id, 'invoice'); } }, ['View Invoice']),
      el('button', { class: 'btn', style: 'color:var(--danger)', onclick: () => { if (confirmAction(`Delete quote #${q.number}${q.client.name ? ' for ' + q.client.name : ''}? This cannot be undone.`)) { deleteQuote(q.id); sub = { view: 'list' }; renderQuotes(); toast('Quote deleted'); } } }, ['Delete']),
    ]),
  ]);

  const client = el('div', { class: 'panel' }, [
    el('h3', {}, ['Client · Quote #' + q.number]),
    el('div', { class: 'row' }, [
      input('Client name', q.client.name, (v) => set(() => (q.client.name = v)), { class: 'grow' }),
      input('Phone', q.client.phone, (v) => set(() => (q.client.phone = v)), { class: 'grow' }),
      input('Email', q.client.email, (v) => set(() => (q.client.email = v)), { class: 'grow' }),
    ]),
    el('div', { class: 'row' }, [
      input('Address', q.client.address, (v) => set(() => (q.client.address = v)), { class: 'grow' }),
      input('Quote date', q.date, (v) => set(() => (q.date = v)), { type: 'date' }),
      input('Install date', q.installDate, (v) => set(() => (q.installDate = v)), { type: 'date' }),
      select('Stage', STAGES, q.stage || 'Quote', (v) => { q.stage = v; if (isInvoiceStage(v)) assignInvoiceNumber(q); save(); renderQuotes(); }),
    ]),
  ]);

  // The worksheet rebuilds itself only when rows are added/removed (keeps input focus otherwise).
  const dynamic = el('div', {});
  const reRender = () => dynamic.replaceChildren(sheet(q, reRender));
  reRender();
  return el('div', {}, [toolbar, client, dynamic]);
}

// If the bottom "add" row was filled in but never committed, keep it so the user
// doesn't silently lose a line when they jump to the invoice.
function commitDraftIfFilled(q) {
  const d = q._draft;
  if (d && d.width && d.height) {
    q.items.push({ ...d });
    delete q._draft;
    save();
  }
}

function blankLine(s) {
  return {
    table: Object.keys(s.tables)[0], qty: 1, location: '', wdNumber: '',
    width: '', widthFrac: 0, height: '', heightFrac: 0,
    product: '', fabric: '', color: '', control: '', system: '', style: '',
    headrail: '', bottomRail: '', reverse: false, fascia: false, cassette: false, sideChannel: false,
    installation: s.defaultInstallation || '', brackets: '', mount: 'Ceiling', discount: '', markup: '', motorPrice: '',
    fabricPrice: '', lining: '', track: '',
  };
}

// A draft row is "empty" if nothing but the default table is set (so clearing needs no confirm).
function isRowEmpty(l) {
  return !l.width && !l.height && !l.location && !l.wdNumber && !l.product && !l.fabric &&
    !l.color && !l.control && !l.system && !l.style && !l.headrail && !l.bottomRail && !l.reverse &&
    !l.fascia && !l.cassette && !l.sideChannel && !l.installation && !l.brackets && !l.fabricPrice;
}

// A shade's Product/Fabric options are filtered by its table's category (Roller,
// Zebra, or whatever category was assigned in Price Tables) — each category has
// its own dropdown list.
export const tableCategory = (table, tables) => tables[table]?.category || 'Roller';

const isDrapery = (it, tables) => tables[it.table]?.kind === 'formula';
// Lining/Track only mean something for the Drapery styles that actually offer them
// (e.g. Cornice has neither) — null here means "hide the field" for this row.
const draperyStyleOf = (it, tables) => (isDrapery(it, tables) ? DRAPERY_STYLES[tables[it.table].style] : null);

// Spreadsheet columns — one narrow column each, mirroring the Excel worksheet (Hoja 1).
// `opts` may be an array or a function of the row item (used for table-aware filtering).
// `hideWhen(item)` greys a cell out for rows where the field is meaningless.
function columns(o, tables, categories) {
  const opt = (arr) => ['', ...arr];
  const tableNames = Object.keys(tables);
  // Grouped by category (Roller/Zebra/Drapery/...) so the dropdown still shows what
  // kind of table each one is, even though the table names themselves are plain.
  const tableGroups = categories.map((cat) => ({ label: cat, names: tableNames.filter((n) => tables[n].category === cat) }));
  const forDrapery = (it) => isDrapery(it, tables);
  return [
    { key: 'table', label: 'Table', kind: 'tablegroup', groups: tableGroups, w: 108 },
    { key: 'qty', label: 'Qty', kind: 'num', w: 48 },
    { key: 'location', label: 'Location', kind: 'select', opts: opt(o.locations), w: 116 },
    { key: 'wdNumber', label: 'W/D #', kind: 'select', opts: opt(o.wdNumbers), w: 92 },
    { key: 'width', label: 'W', kind: 'num', w: 52 },
    { key: 'widthFrac', label: 'Fr', kind: 'frac', w: 66 },
    { key: 'height', label: 'H', kind: 'num', w: 52 },
    { key: 'heightFrac', label: 'Fr', kind: 'frac', w: 66 },
    { key: 'product', label: 'Product', kind: 'select', opts: (it) => opt(o.products[tableCategory(it.table, tables)] || []), w: 150, hideWhen: forDrapery },
    { key: 'fabric', label: 'Description', kind: 'select', opts: (it) => opt(o.fabrics[tableCategory(it.table, tables)] || []), w: 160, hideWhen: forDrapery },
    { key: 'color', label: 'Color', kind: 'select', opts: opt(o.colors), w: 116 },
    // Roller/Zebra: System (Manual/Motor). Drapery: same column becomes Track
    // (Motorized/Manual) instead — the two concepts play the same role, so Track
    // replaces System in place rather than sitting in its own separate column.
    {
      key: 'system', label: 'System / Track', kind: 'select', w: 108,
      keyFor: (it) => (isDrapery(it, tables) ? 'track' : 'system'),
      opts: (it) => (isDrapery(it, tables) ? opt(draperyStyleOf(it, tables)?.hasTrack ? ['Motorized', 'Manual'] : []) : opt(o.systems)),
      hideWhen: (it) => isDrapery(it, tables) && !draperyStyleOf(it, tables)?.hasTrack,
    },
    { key: 'control', label: 'Ctrl', kind: 'select', opts: opt(o.controls), w: 86 },
    { key: 'motorPrice', label: 'Motor $', kind: 'num', w: 74, placeholder: '0', hideWhen: forDrapery }, // Track (above) + Extra +$ already cover this for Drapery
    { key: 'style', label: 'Style', kind: 'select', opts: opt(o.styles), w: 96 },
    { key: 'headrail', label: 'Headrails', kind: 'select', opts: opt(o.headrails), w: 118 },
    { key: 'bottomRail', label: 'Bottom Rail', kind: 'select', opts: opt(o.headrails), w: 118 },
    // Reverse roll: the fabric comes off the back of the tube instead of the front.
    // A Roller/Zebra build detail only — no such thing on Drapery.
    { key: 'reverse', label: 'Reverse', kind: 'check', w: 66, hideWhen: forDrapery },
    { key: 'fascia', label: 'Fascia', kind: 'check', w: 58 },
    { key: 'cassette', label: 'Cassette', kind: 'check', w: 66 },
    { key: 'sideChannel', label: 'S/Ch', kind: 'check', w: 54 },
    // Roller: pre-filled from Settings' default, then a plain override from then on.
    // Drapery Heavy/Sheer: same idea, but the "default" is a live formula (scales with
    // width) shown as a placeholder — leave it blank to use it, type a number to override.
    // Drapery Cornice/Swag/Grommet: no formula exists, so it behaves exactly like Brackets.
    { key: 'installation', label: 'Ins', kind: 'num', w: 58, placeholder: (it) => String(draperyAutoInstall(it, tables[it.table]) || '0') },
    { key: 'brackets', label: 'Bra', kind: 'num', w: 58 },
    { key: 'mount', label: 'Mount', kind: 'select', opts: ['Ceiling', 'Wall'], w: 90 },
    { key: 'fabricPrice', label: 'Fabric $/yd', kind: 'num', w: 92, placeholder: '0' },
    { key: 'lining', label: 'Lining', kind: 'select', opts: opt(['Lining', 'Lining + Interlining']), w: 130, hideWhen: (it) => !draperyStyleOf(it, tables)?.hasLining },
    { key: 'discount', label: 'Disc −$', kind: 'num', w: 78, placeholder: '0', prefix: '−' },
    { key: 'markup', label: 'Extra +$', kind: 'num', w: 74, placeholder: '0' },
  ];
}

const FRAC_OPTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

// Hover help for each worksheet column header — says what it is and where in Settings/Lists it's set.
const COL_HELP = {
  table: 'Product line — sets the base price from Price Tables',
  qty: 'How many identical shades on this line',
  location: 'Room/area (edit the list in Lists)',
  wdNumber: 'Which window or door (edit in Lists)',
  width: 'Width in inches', widthFrac: 'Width fraction — rounds up if over ½',
  height: 'Height in inches', heightFrac: 'Height fraction — rounds up if over ½',
  product: "Product type — filtered by the table's category (edit in Lists)",
  fabric: "Fabric / description — filtered by the table's category (edit in Lists)",
  color: 'Chain/cassette color, shared for both (edit in Lists)',
  control: 'Chain or motor + side (RH/LH)',
  system: 'Roller/Zebra: Manual or motor (Lists → Systems). Drapery: Track add-on (Motorized/Manual), priced in Settings → Rates.',
  motorPrice: 'Motor charge for this line ($). Adds to the price. Empty = 0.',
  discount: 'Discount for THIS shade ($). Subtracts from its price. The quote-level discount is separate.',
  style: 'Mount/operation (IB/OB/One-way) — price in Lists → Styles',
  headrail: 'Headrail — price in Lists → Headrails',
  bottomRail: 'Bottom rail — price in Lists → Headrails',
  reverse: 'Reverse roll — fabric comes off the back of the tube instead of the front',
  fascia: 'Add fascia (auto, per-foot rate in Settings → Rates)',
  cassette: 'Add cassette (auto, per-foot rate in Settings → Rates)',
  sideChannel: 'Add side channels (auto, per-foot ×2 in Settings → Rates)',
  installation: 'Installation/labor $ (default in Settings → Rates)',
  brackets: 'Brackets $',
  mount: 'Where the brackets mount',
  fabricPrice: 'Fabric cost ($ per yard) — Drapery lines only, drives the whole price',
  lining: 'Drapery lining tier — changes which labor rate applies (edit in Price Tables)',
  markup: 'Extra profit added on top (0 = none). Overall margin comes from the cost factor in Settings → Rates.',
};

function cell(col, item, onChange) {
  const style = `width:${col.w}px`;
  if (col.hideWhen && col.hideWhen(item)) {
    return el('td', { class: 'c', style, title: 'Not applicable to this line' }, [el('span', { class: 'muted' }, ['—'])]);
  }
  if (col.kind === 'tablegroup') {
    const sel = el('select', { style, onchange: (e) => onChange(col.key, e.target.value) });
    const cur = String(item[col.key] ?? '');
    let found = false;
    for (const { label, names } of col.groups) {
      if (!names.length) continue;
      const group = el('optgroup', { label });
      for (const name of names) {
        const o = el('option', { value: name }, [name]);
        if (name === cur) { o.selected = true; found = true; }
        group.append(o);
      }
      sel.append(group);
    }
    if (cur && !found) sel.append(el('option', { value: cur, selected: true }, [cur])); // table renamed/deleted elsewhere — keep it visible
    return el('td', {}, [sel]);
  }
  if (col.kind === 'check') {
    const box = el('input', { type: 'checkbox', onchange: (e) => onChange(col.key, e.target.checked) });
    box.checked = !!item[col.key];
    return el('td', { class: 'c' }, [el('div', { class: 'ck' }, [box])]);
  }
  if (col.kind === 'frac') {
    const sel = el('select', { style, onchange: (e) => onChange(col.key, FRAC_OPTS[e.target.selectedIndex]) });
    FRAC_OPTS.forEach((f, i) => {
      const o = el('option', { value: f }, [FRACTION_LABEL[f] || String(f)]);
      if (f === (Number(item[col.key]) || 0)) o.selected = true;
      sel.append(o);
    });
    return el('td', {}, [sel]);
  }
  if (col.kind === 'num') {
    const placeholder = typeof col.placeholder === 'function' ? col.placeholder(item) : (col.placeholder || '');
    const inp = el('input', {
      type: 'number', value: item[col.key] ?? '', style, class: 'r', min: '0', step: 'any', placeholder,
      oninput: (e) => {
        if (e.target.value !== '' && Number(e.target.value) < 0) e.target.value = '0'; // no negative sizes/costs
        onChange(col.key, e.target.value);
      },
    });
    if (col.placeholder && typeof col.placeholder === 'function') inp.dataset.liveInsPlaceholder = col.key; // recalc() refreshes this as width changes
    if (col.prefix) return el('td', {}, [el('div', { style: 'display:flex;align-items:center;gap:2px' }, [el('span', { style: 'color:var(--danger);font-weight:800' }, [col.prefix]), inp])]);
    return el('td', {}, [inp]);
  }
  // select — options may be plain strings, priced objects {name, price}, or a
  // function of the row item (table-dependent product/fabric lists). `keyFor`
  // lets one column write to different fields per row (System vs Track).
  const key = col.keyFor ? col.keyFor(item) : col.key;
  const sel = el('select', { style, onchange: (e) => onChange(key, e.target.value) });
  const options = (typeof col.opts === 'function' ? col.opts(item) : col.opts).map((o) => (typeof o === 'string' ? { name: o, price: 0 } : o));
  const cur = String(item[key] ?? '');
  if (cur && !options.some((o) => o.name === cur)) options.push({ name: cur, price: 0 }); // keep a value not in the filtered set
  for (const opt of options) {
    const label = opt.price > 0 ? `${opt.name} (${money(opt.price)})` : opt.name;
    const o = el('option', { value: opt.name }, [label || ' ']);
    if (opt.name === cur) o.selected = true;
    sel.append(o);
  }
  return el('td', {}, [sel]);
}

function sheet(q, rerender) {
  const s = getState();
  const cols = columns(s.options, s.tables, s.categories);
  const draft = q._draft || (q._draft = blankLine(s));

  const priceCells = []; // {getItem, node}
  const insCells = []; // {item, input} — Drapery's live "auto install" placeholder
  const totalsRefs = {};

  const recalc = () => {
    for (const { item, input } of insCells) input.placeholder = String(draperyAutoInstall(item, s.tables[item.table]) || '0');
    for (const p of priceCells) {
      const c = computeLine(p.item, s);
      const hasDims = p.item.width && p.item.height;
      p.node.textContent = c.unit != null ? money(c.unit) : (hasDims ? 'off chart' : '—');
      p.node.classList.toggle('off', c.unit == null && hasDims);
      p.td.querySelector('.mintag')?.remove();
      if (c.floored) p.td.append(el('span', { class: 'mintag', title: `Table minimum ${money(c.floor)} for ${p.item.table} — raise the size or lower the minimum in Price Tables` }, ['min']));
      p.node.title = c.list == null
        ? (hasDims ? `Size is larger than the ${p.item.table} chart` : '')
        : (c.floored ? `List ${money(c.list)} · minimum ${money(c.floor)} applied` : `List ${money(c.list)}`);
      p.client.textContent = c.unit == null ? '—' : money0((c.unit || 0) - (s.showInstall !== false ? (c.installation || 0) : 0));
    }
    // Subtotal reflects committed lines PLUS the row currently being filled, so the
    // number is never a surprising $0 while a priced line sits in the draft row.
    // Mirror the client invoice: whole-dollar amounts + tax, so the worksheet matches.
    const priced = [...q.items, draft].map((it) => ({ c: computeLine(it, s), qty: Number(it.qty) || 1 }));
    const sub = priced.reduce((a, p) => a + roundWhole(p.c.unit || 0) * p.qty, 0);
    const taxable = sub - roundWhole(Number(q.discount) || 0);
    const rate = Number(s.taxRate) || 0;
    const tax = roundWhole(taxable * rate / 100);
    totalsRefs.sub.textContent = money0(sub);
    totalsRefs.tax.textContent = money0(tax);
    totalsRefs.taxRow.style.display = rate > 0 ? '' : 'none';
    totalsRefs.taxLbl.textContent = `Tax (${rate}%)`;
    totalsRefs.total.textContent = money0(taxable + tax);
    // Internal breakdown — profit excludes tax (pass-through); revenue = rounded taxable.
    const cost = priced.reduce((a, p) => a + (p.c.cost || 0) * p.qty, 0);
    const labor = priced.reduce((a, p) => a + (p.c.installation || 0) * p.qty, 0);
    const acc = priced.reduce((a, p) => a + ((p.c.fascia || 0) + (p.c.cassette || 0) + (p.c.sideChannel || 0) + (p.c.brackets || 0) + (p.c.extras || 0)) * p.qty, 0);
    const material = cost - labor - acc; // = list × cost factor
    const profit = taxable - cost;
    totalsRefs.revenue.textContent = money(taxable);
    totalsRefs.material.textContent = '−' + money(material);
    totalsRefs.labor.textContent = '−' + money(labor);
    totalsRefs.acc.textContent = '−' + money(acc);
    totalsRefs.profit.textContent = money(profit);
    totalsRefs.margin.textContent = taxable > 0 ? Math.round((profit / taxable) * 100) + '% margin' : '';
  };

  const makeRow = (item, { draftRow } = {}) => {
    // Changing the table refilters the Product/Description options, so rebuild the row.
    // Save on every keystroke, draft row included — otherwise a refresh (or a browser
    // that never gets to "Add line") silently loses whatever was typed into it.
    const onChange = (key, val) => { item[key] = val; save(); recalc(); if (key === 'table') rerender(); };
    const priceNode = el('strong', {}, ['—']);
    const priceTd = el('td', { class: 'r price' }, [priceNode]);
    const clientNode = el('span', {}, ['—']);
    const clientTd = el('td', { class: 'r', style: 'color:var(--muted)' }, [clientNode]);
    priceCells.push({ item, node: priceNode, td: priceTd, client: clientNode });
    const cells = cols.map((col) => cell(col, item, onChange));
    const insInput = cells[cols.findIndex((c) => c.key === 'installation')]?.querySelector('input[data-live-ins-placeholder]');
    if (insInput) insCells.push({ item, input: insInput });
    cells.push(priceTd);
    cells.push(clientTd);
    if (draftRow) {
      cells.push(el('td', { style: 'white-space:nowrap' }, [
        el('button', { class: 'icon', style: 'color:var(--accent);font-weight:800', title: 'Add this line', onclick: () => addLine() }, ['✓']),
        el('button', { class: 'icon', title: 'Clear this row', onclick: () => { if (isRowEmpty(item) || confirmAction('Clear this row?')) { q._draft = blankLine(s); save(); rerender(); } } }, ['↺']),
      ]));
      return el('tr', { class: 'draftrow' }, cells);
    }
    const idx = q.items.indexOf(item);
    cells.push(el('td', { style: 'white-space:nowrap' }, [
      el('button', { class: 'icon', style: 'color:var(--muted)', title: 'Duplicate', onclick: () => { q.items.splice(idx + 1, 0, { ...item }); save(); rerender(); } }, ['⎘']),
      el('button', { class: 'icon', title: 'Remove', onclick: () => { if (confirmAction('Delete this line?')) { q.items.splice(idx, 1); save(); rerender(); } } }, ['✕']),
    ]));
    return el('tr', {}, cells);
  };

  const addLine = () => {
    if (!draft.width || !draft.height) return toast('Enter width and height');
    q.items.push({ ...draft });
    q._draft = blankLine(s);
    save();
    rerender();
  };

  const head = el('tr', {}, [
    ...cols.map((c) => el('th', { style: `min-width:${c.w}px`, title: COL_HELP[c.key] || '' }, [c.label])),
    el('th', { class: 'r', title: 'Internal full price for ONE shade (with installation, cents).' }, ['Unit $']),
    el('th', { class: 'r', title: 'What the client sees per shade on the invoice — rounded, with installation shown as its own line.' }, ['Client $']),
    el('th', {}, ['']),
  ]);

  const bodyRows = q.items.map((it) => makeRow(it));
  const draftRow = makeRow(draft, { draftRow: true });
  // Enter anywhere in the draft row commits it.
  draftRow.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } });

  const table = el('table', { class: 'sheet' }, [
    el('thead', {}, [head]),
    el('tbody', {}, [...bodyRows, draftRow]),
  ]);

  const t = quoteTotals(q, s);
  totalsRefs.sub = el('span', {}, [money(t.subtotal)]);
  totalsRefs.total = el('span', {}, [money(t.total)]);
  totalsRefs.cost = el('span', {}, ['—']);
  totalsRefs.profit = el('span', {}, ['—']);
  totalsRefs.margin = el('span', { class: 'muted', style: 'font-size:12px' }, ['']);
  totalsRefs.tax = el('span', {}, ['—']);
  totalsRefs.taxLbl = el('span', {}, ['Tax']);
  totalsRefs.taxRow = el('div', { class: 'line', style: 'display:none' }, [totalsRefs.taxLbl, totalsRefs.tax]);
  totalsRefs.revenue = el('span', {}, ['—']);
  totalsRefs.material = el('span', {}, ['—']);
  totalsRefs.labor = el('span', {}, ['—']);
  totalsRefs.acc = el('span', {}, ['—']);
  const totals = el('div', { class: 'totals' }, [
    el('div', { class: 'line' }, [el('span', {}, ['Subtotal']), totalsRefs.sub]),
    el('div', { class: 'line' }, [
      el('span', {}, ['Discount']),
      (() => { const i = el('input', { type: 'number', value: q.discount || 0, style: 'width:120px;padding:8px;border:1px solid var(--line-strong);border-radius:8px', oninput: (e) => { q.discount = Number(e.target.value) || 0; save(); recalc(); } }); return i; })(),
    ]),
    totalsRefs.taxRow,
    el('div', { class: 'line grand' }, [el('span', {}, ['Total']), totalsRefs.total]),
    el('div', { class: 'profit-box' }, [
      el('div', { class: 'pb-head' }, ['Internal · not shown to client']),
      el('div', { class: 'line' }, [el('span', {}, ['Revenue (taxable)']), totalsRefs.revenue]),
      el('div', { class: 'line sub' }, [el('span', {}, ['Material']), totalsRefs.material]),
      el('div', { class: 'line sub' }, [el('span', {}, ['Labor / install']), totalsRefs.labor]),
      el('div', { class: 'line sub' }, [el('span', {}, ['Accessories']), totalsRefs.acc]),
      el('div', { class: 'line profit' }, [el('span', {}, ['Est. profit ', totalsRefs.margin]), totalsRefs.profit]),
    ]),
  ]);

  recalc();

  return el('div', { class: 'panel' }, [
    el('div', { class: 'section-head' }, [
      el('h3', { style: 'margin:0' }, ['Worksheet']),
      el('span', { class: 'hint' }, ['Fill the highlighted row, then Add line. Every cell is editable · scroll sideways for more.']),
    ]),
    el('div', { class: 'sheet-wrap' }, [table]),
    el('div', { class: 'addbar' }, [
      el('button', { class: 'btn primary', onclick: addLine }, ['＋ Add line']),
      el('span', { class: 'hint' }, ['or press Enter']),
    ]),
    totals,
  ]);
}

/* ---------------- printable documents (Client quote + Work order) ---------------- */
let invMode = 'client'; // 'client' = prices, no dimensions · 'work' = specs + dimensions, no prices

const sizeText = (l) => {
  const f = (v, fr) => `${v ?? ''}${fr && FRACTION_LABEL[fr] ? ' ' + FRACTION_LABEL[fr] : ''}`;
  return `${f(l.width, l.widthFrac)} × ${f(l.height, l.heightFrac)}`;
};

// Plain-text version of the document — pasteable into WhatsApp / email.
function docText(q, s, isWork) {
  const cfg = isWork ? s.docConfig.work : s.docConfig.client;
  const t = quoteTotals(q, s);
  const rows = q.items.map((l, i) => {
    const desc = describeLine(l, cfg, isWork);
    const size = isWork ? ` [${sizeText(l)}]` : '';
    const price = isWork ? '' : ` — ${money(computeLine(l, s).unit || 0)}`;
    return `${i + 1}. ${l.location ? l.location + ' · ' : ''}${desc}${size}${price}`;
  });
  if (isWork) {
    return `${s.company.name} — WORK ORDER #${q.number}${q.date ? ' · ' + q.date : ''}\n\n${rows.join('\n')}`;
  }
  const hi = q.client.name ? `Hi ${q.client.name}, ` : 'Hi, ';
  return `${hi}here's your quote from ${s.company.name} (#${q.number}):\n\n${rows.join('\n')}\n\nTotal: ${money(t.total)}\n\nThank you! Let us know if you'd like to proceed. — ${s.company.name}, ${s.company.phone}`;
}

// Share menu that works everywhere: WhatsApp, Email, Copy, plus the native share
// sheet when the device offers it (phones). Always a visible menu — no silent no-op.
function shareButton(q, s, isWork) {
  const wrap = el('div', { style: 'position:relative;display:inline-block' });
  const btn = el('button', { class: 'btn small', title: 'Share this document' }, ['↗ Share']);
  const text = () => docText(q, s, isWork);
  const title = `${s.company.name} — ${isWork ? 'Work Order' : 'Quote'} #${q.number}`;
  const pdfFile = () => new File([textToPdfBlob(text().split('\n'))], `${isWork ? 'work-order' : 'quote'}-${q.number}.pdf`, { type: 'application/pdf' });
  btn.onclick = async () => {
    // Phones: one tap → native share sheet WITH the PDF attached (WhatsApp/email/etc).
    const file = pdfFile();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); } catch { /* cancelled */ } // send the PDF, not text
      return;
    }
    // Desktop can't attach files to wa.me/mailto — download the PDF, then offer text links.
    if (wrap.querySelector('.share-menu')) { wrap.querySelector('.share-menu').remove(); return; }
    const blob = textToPdfBlob(text().split('\n'));
    const a = el('a', { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove();
    toast('PDF downloaded — attach it below');
    const enc = () => encodeURIComponent(text());
    const item = (label, fn) => el('button', { class: 'share-item', onclick: () => { fn(); menu.remove(); } }, [label]);
    const menu = el('div', { class: 'share-menu' }, [
      item('💬 WhatsApp (attach the PDF)', () => window.open('https://wa.me/?text=' + enc(), '_blank')),
      item('✉️ Email (attach the PDF)', () => { window.location.href = `mailto:${q.client.email || ''}?subject=${encodeURIComponent(title)}&body=${enc()}`; }),
      item('📋 Copy text', async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); } catch { toast('Copy failed'); } }),
    ]);
    wrap.append(menu);
    setTimeout(() => document.addEventListener('click', function h(e) { if (!wrap.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); } }), 0);
  };
  wrap.append(btn);
  return wrap;
}

function invoice(q) {
  const s = getState();
  const co = s.company;
  const t = quoteTotals(q, s);
  const isWork = invMode === 'work';

  const toolbar = el('div', { class: 'section-head no-print' }, [
    el('button', { class: 'btn ghost', onclick: () => open(q.id, 'edit') }, ['← Back to worksheet']),
    el('div', { class: 'subtabs', style: 'margin:0' }, [
      el('button', { class: 'subtab' + (invMode === 'client' ? ' active' : ''), onclick: () => { invMode = 'client'; renderQuotes(); } }, ['Client Quote']),
      el('button', { class: 'subtab' + (invMode === 'work' ? ' active' : ''), onclick: () => { invMode = 'work'; renderQuotes(); } }, ['Work Order']),
      el('button', { class: 'subtab' + (invMode === 'labels' ? ' active' : ''), onclick: () => { invMode = 'labels'; renderQuotes(); } }, ['Labels']),
      el('button', { class: 'btn primary small', onclick: () => window.print() }, ['🖨 Print / Save PDF']),
    ]),
  ]);

  if (invMode === 'labels') return el('div', {}, [toolbar, labelsView(q, s)]);

  const meta = (label, val) => el('div', { class: 'mrow' }, [el('span', { class: 'ml' }, [label]), el('span', { class: 'mv' }, [val])]);

  const head = el('div', { class: 'head' }, [
    el('div', { class: 'co' }, [
      el('img', { class: 'logo', src: 'assets/logo.png', alt: co.name }),
      el('div', { class: 'co-lines' }, [
        el('div', { class: 'co-meta' }, [co.address]),
        el('div', { class: 'co-meta' }, [co.phone]),
        el('div', { class: 'co-meta' }, [co.email]),
      ]),
    ]),
    el('div', { class: 'doc-title' }, [
      el('div', { class: 't' }, [isWork ? 'WORK ORDER' : (isInvoiceStage(q.stage) ? 'INVOICE' : 'QUOTE')]),
      el('div', { class: 'doc-meta' }, [
        meta(isWork ? 'Order #' : (isInvoiceStage(q.stage) ? 'Invoice #' : 'Quote #'), String(isInvoiceStage(q.stage) && q.invoiceNumber ? q.invoiceNumber : q.number)),
        meta('Date', q.date || '—'),
        q.installDate ? meta('Install', q.installDate) : null,
      ]),
    ]),
  ]);

  const bill = el('div', { class: 'parties' }, [
    el('div', { class: 'bill' }, [
      el('h4', {}, [isWork ? 'Client' : 'Bill To']),
      el('div', { class: 'bill-name' }, [q.client.name || '—']),
      el('div', { class: 'co-meta' }, [[q.client.phone, q.client.email].filter(Boolean).join(' · ')]),
    ]),
    q.client.address ? el('div', { class: 'bill ship' }, [
      el('h4', {}, ['Ship To']),
      el('div', {}, [q.client.address]),
    ]) : null,
  ]);

  const table = el('div', { class: 'inv-scroll' }, [isWork ? workTable(q, s) : clientTable(q, s)]);

  const doc = el('div', { class: 'invoice' + (isWork ? ' work' : '') }, [
    head, bill, table,
    isWork ? null : (() => {
      // Whole-dollar, adds up: products (install broken out if enabled) + install + tax.
      const showInstall = s.showInstall !== false;
      const per = q.items.map((l) => ({ c: computeLine(l, s), qty: Number(l.qty) || 1 }));
      const install = showInstall ? per.reduce((a, p) => a + roundWhole(p.c.installation || 0) * p.qty, 0) : 0;
      const sub = per.reduce((a, p) => a + roundWhole((p.c.unit || 0) - (showInstall ? (p.c.installation || 0) : 0)) * p.qty, 0);
      const discount = roundWhole(t.discount);
      const taxable = Math.max(sub + install - discount, t.minApplied ? roundWhole(t.minOrder) : 0);
      const tax = roundWhole(taxable * (Number(s.taxRate) || 0) / 100);
      const total = taxable + tax;
      const pct = stagePct(q.stage);
      const paid = roundWhole(total * pct);
      return el('div', { class: 'sum' }, [
        el('div', { class: 'sum-box' }, [
          el('div', { class: 'line' }, [el('span', {}, ['Subtotal']), el('span', {}, [money0(sub)])]),
          install ? el('div', { class: 'line' }, [el('span', {}, ['Installation']), el('span', {}, [money0(install)])]) : null,
          discount ? el('div', { class: 'line' }, [el('span', {}, ['Discount']), el('span', {}, ['−' + money0(discount)])]) : null,
          tax ? el('div', { class: 'line' }, [el('span', {}, [`Tax (${s.taxRate}%)`]), el('span', {}, [money0(tax)])]) : null,
          el('div', { class: 'line grand' }, [el('span', {}, ['Total']), el('span', {}, [money0(total)])]),
          pct > 0 ? el('div', { class: 'line paid' }, [el('span', {}, ['Paid' + (pct < 1 ? ' (50%)' : '')]), el('span', {}, ['−' + money0(paid)])]) : null,
          pct > 0 ? el('div', { class: 'line balance' }, [el('span', {}, ['Balance due']), el('span', {}, [money0(total - paid)])]) : null,
          pct >= 1 ? el('div', { class: 'paid-stamp' }, ['PAID IN FULL']) : null,
        ]),
      ]);
    })(),
    isWork ? null : el('div', { class: 'terms' }, [co.terms]),
  ]);

  return el('div', {}, [toolbar, el('div', { class: 'panel invoice-panel' }, [doc])]);
}

// DYMO 30252 stickers (1⅛" × 3½"), one per shade, for the LabelWriter 550.
function labelsView(q, s) {
  // Control's hand side is always printed next to the size (dl-size below) — leaving it
  // in the description too would print it twice on the same sticker.
  const cfg = { ...s.docConfig.label, control: false };
  const labels = q.items.map((l) => {
    const card = el('div', { class: 'dymo-label' }, [
      el('div', { class: 'dl-text' }, [
        el('div', { class: 'dl-name' }, [q.client.name || '']),
        el('div', { class: 'dl-loc' }, [l.location || '']),
        el('div', { class: 'dl-prod' }, [[l.product, describeLine(l, cfg, false, true)].filter(Boolean).join(' — ')]),
        el('div', { class: 'dl-size' }, [(sizeText(l) + (l.control ? ' ' + l.control : '')).trim()]),
      ]),
      el('img', { class: 'dl-logo', src: 'assets/logo.png', alt: '' }),
    ]);
    const cb = el('input', { type: 'checkbox', class: 'dl-check no-print' });
    cb.checked = true;
    cb.onchange = () => card.classList.toggle('deselected', !cb.checked);
    return el('div', { class: 'dl-wrap' }, [cb, card]);
  });
  setTimeout(fitLabels, 0); // shrink each label's text just enough to fit nicely
  const toggleAll = el('button', { class: 'btn small no-print', onclick: () => {
    const boxes = [...document.querySelectorAll('.dl-check')];
    const target = boxes.some((b) => !b.checked); // if any off → select all, else clear all
    boxes.forEach((b) => { b.checked = target; b.onchange(); });
  } }, ['Select / clear all']);
  return el('div', {}, [
    el('div', { class: 'section-head no-print', style: 'margin-bottom:12px' }, [
      el('span', { class: 'hint' }, ['One label per shade · DYMO 30252. Uncheck any you don’t want, then Print. Only checked labels print.']),
      toggleAll,
    ]),
    el('div', { class: 'labels-wrap' }, labels.length ? labels : [el('div', { class: 'muted' }, ['No items'])]),
  ]);
}

// Auto-fit: reduce each label's base font-size until its text fits the sticker (FAANG-y
// "shrink-to-fit" so long descriptions stay legible without overflowing).
function fitLabels() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.dymo-label .dl-text').forEach((t) => {
      let fs = 13;
      t.style.fontSize = fs + 'px';
      while (fs > 7 && (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1)) {
        fs -= 0.5; t.style.fontSize = fs + 'px';
      }
    });
  });
}

// Client version: everything goes into the Description (fields chosen in Settings),
// client price shown, NO dimensions.
function clientTable(q, s) {
  const cfg = s.docConfig.client;
  const rows = q.items.map((l, i) => {
    const c = computeLine(l, s);
    const qty = Number(l.qty) || 1;
    const shownUnit = (c.unit || 0) - (s.showInstall !== false ? (c.installation || 0) : 0);
    return el('tr', {}, [
      el('td', { class: 'num' }, [String(qty)]),
      el('td', { class: 'strong' }, [l.location]),
      el('td', { class: 'desc' }, [describeLine(l, cfg)]),
      el('td', { class: 'num' }, [money0(shownUnit)]),
      el('td', { class: 'num strong' }, [money0(roundWhole(shownUnit) * qty)]),
    ]);
  });
  const cols = ['Qty', 'Location', 'Description', 'Unit Price', 'Total'];
  return el('table', { class: 'items' }, [
    el('thead', {}, [el('tr', {}, cols.map((h, i) => el('th', { class: i === 0 || i >= 3 ? 'num' : '' }, [h])))]),
    el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: cols.length, class: 'muted', style: 'text-align:center;padding:24px' }, ['No items'])])]),
  ]);
}

// Work order: same Description style (fields chosen in Settings) PLUS dimensions,
// NO prices. Few columns so it always fits a page / PDF.
function workTable(q, s) {
  const cfg = s.docConfig.work;
  const cols = ['#', 'Location', 'Size (W×H)', 'Description'];
  const rows = q.items.map((l, i) => el('tr', {}, [
    el('td', { class: 'num' }, [String(i + 1)]),
    el('td', { class: 'strong' }, [l.location]),
    el('td', { class: 'strong' }, [sizeText(l)]),
    el('td', { class: 'desc' }, [describeLine(l, cfg, true)]),
  ]));
  return el('table', { class: 'items' }, [
    el('thead', {}, [el('tr', {}, cols.map((h, i) => el('th', { class: i === 0 ? 'num' : '' }, [h])))]),
    el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: cols.length, class: 'muted', style: 'text-align:center;padding:24px' }, ['No items'])])]),
  ]);
}
