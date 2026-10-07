// Quotes: list -> estimator worksheet (internal, with dimensions) -> invoice (customer, no dimensions).
import { el, input, checkbox, mount, toast, FRACTION_LABEL } from './dom.js';
import { dropdown, selectField, dateField, multiDropdown, iconButton, confirmAction, labeled } from './ui.js';
import { getState, save, STAGES, PAYMENTS, isInvoiceStage, payPct, newQuote, duplicateQuote, getQuote, deleteQuote, assignInvoiceNumber } from './store.js';
import { computeLine, lineIssues, describeLine, quoteTotals, money, money0, roundWhole, round2, DRAPERY_STYLES, draperyAutoInstall, explainLine } from './pricing.js';
import { textToPdfBlob } from './pdf.js';

let sub = { view: 'list', quoteId: null };

// Which quote this screen is on — read by presence.js to tell everyone else.
export const currentQuoteRef = () => sub;

// Jump straight to a quote's worksheet from another screen (e.g. the dashboard's
// "no price" warning). Only sets where the Quotes tab should land — the caller
// still has to switch to that tab, since this module doesn't own the router.
export function openQuote(id, view = 'edit') { sub = { view, quoteId: id }; }
export const stageBadgeClass = (st) => STAGE_CLASS[st] || 'quote';

// URL <-> screen. A reload lands before the cloud pull, so a quote that isn't in
// the store yet keeps its place in `sub`; dropMissingQuote() runs once data settled.
// /quotes/<id> is the worksheet; /quotes/<id>/<doc> a printable document:
// invoice (client quote), work-order[/<Category,Category>] or labels.
const DOC_SEGMENT = { client: 'invoice', work: 'work-order', labels: 'labels' };
const DOC_MODE = Object.fromEntries(Object.entries(DOC_SEGMENT).map(([mode, seg]) => [seg, mode]));
export const quoteRoute = () => {
  if (!sub.quoteId) return [];
  if (sub.view !== 'invoice') return [sub.quoteId];
  return [sub.quoteId, DOC_SEGMENT[invMode], ...(invMode === 'work' && woSel ? [[...woSel].join(',')] : [])];
};
export function applyQuoteRoute([id, doc, cats] = []) {
  if (!id) { sub = { view: 'list', quoteId: null }; return; }
  if (!DOC_MODE[doc]) { sub = { view: 'edit', quoteId: id }; return; }
  sub = { view: 'invoice', quoteId: id };
  invMode = DOC_MODE[doc];
  woSel = invMode === 'work' && cats ? new Set(cats.split(',')) : null;
  woSeparate = false;
}
export function dropMissingQuote() {
  if (sub.quoteId && !getQuote(sub.quoteId)) sub = { view: 'list', quoteId: null };
}

export function renderQuotes() {
  if (sub.view === 'edit' && getQuote(sub.quoteId)) return mount(editor(getQuote(sub.quoteId)));
  if (sub.view === 'invoice' && getQuote(sub.quoteId)) return mount(invoice(getQuote(sub.quoteId)));
  return mount(list());
}

function open(id, view = 'edit') {
  sub = { view, quoteId: id };
  renderQuotes();
}

/* ---------------- list ---------------- */
// One lifecycle: Quote → 50% Invoice → 100% Invoice. Payment is tracked separately.
const STAGE_CLASS = { Quote: 'quote', '50% Invoice': 'half', '100% Invoice': 'paid' };
const stageClass = (st) => STAGE_CLASS[st] || 'quote';
let filter = 'All';

function list() {
  const s = getState();
  const head = el('div', { class: 'section-head' }, [
    el('div', {}, [el('h2', {}, ['Quotes & Orders']), el('div', { class: 'hint' }, [
      s.quotes.filter((q) => !q.isTest).length + ' total'
      + (s.quotes.some((q) => q.isTest) ? ` · ${s.quotes.filter((q) => q.isTest).length} test` : ''),
    ])]),
    el('button', { class: 'btn primary', onclick: () => open(newQuote().id) }, labeled('plus', 'New quote')),
  ]);

  const hasTests = s.quotes.some((q) => q.isTest);
  const filters = el('div', { class: 'subtabs' }, ['All', ...STAGES, ...(hasTests ? ['Test'] : [])].map((f) =>
    el('button', { class: 'subtab' + (f === filter ? ' active' : ''), onclick: () => { filter = f; renderQuotes(); } }, [f])));

  // Tests are hidden unless asked for: they are practice, not work in progress.
  const shown = s.quotes.filter((q) => (filter === 'Test' ? q.isTest
    : !q.isTest && (filter === 'All' || (q.stage || 'Quote') === filter)));
  const body = shown.length
    ? el('div', { class: 'cards' }, shown.map((q) => {
      const t = quoteTotals(q, s);
      const st = q.stage || 'Quote';
      const num = isInvoiceStage(st) && q.invoiceNumber ? 'INV #' + q.invoiceNumber : 'Q #' + q.number;
      return el('div', { class: 'card', 'data-quote-id': q.id, onclick: () => open(q.id) }, [
        el('div', { class: 'status' }, [
          q.isTest ? el('span', { class: 'badge test' }, ['TEST']) : null,
          el('span', { class: 'badge ' + stageClass(st) }, [st]),
          payPct(q) > 0 ? el('span', { class: 'badge paid' }, [q.payment]) : null,
        ]),
        el('div', { class: 'muted' }, [num + ' · ' + (q.date || '')]),
        el('div', { class: 'big' }, [q.client.name || 'Untitled client']),
        el('div', { class: 'muted' }, [q.items.length + ' item(s)']),
        el('div', { class: 'total' }, [money(t.total)]),
      ]);
    }))
    : el('div', { class: 'empty' }, [el('div', { class: 'big' }, labeled('window', '', 40)), s.quotes.length ? 'No quotes in this filter.' : 'No quotes yet. Click “New Quote” to start.']);

  return el('div', { class: 'panel' }, [head, filters, body]);
}

/* ---------------- estimator worksheet ---------------- */
function editor(q) {
  const s = getState();
  const set = (fn) => { fn(); save(); };

  const toolbar = el('div', { class: 'section-head' }, [
    el('button', { class: 'btn ghost', onclick: () => { sub = { view: 'list', quoteId: null }; renderQuotes(); } }, labeled('arrowLeft', 'All quotes')),
    el('div', { class: 'row toolbar' }, [
      // One click, and this quote stops counting as business: it leaves every
      // dashboard number and never takes an invoice number.
      (() => {
        const box = checkbox('Is test', q.isTest, (v) => { q.isTest = v; save(); renderQuotes(); toast(v ? 'Marked as a test — kept out of your numbers' : 'Back to a real quote'); });
        box.title = q.isTest ? 'This is a practice quote — it is excluded from the dashboard' : 'Mark as a practice quote, excluded from the dashboard';
        return box;
      })(),
      el('button', { class: 'btn', onclick: () => { commitDraftIfFilled(q); open(q.id, 'invoice'); } }, ['View Invoice']),
      el('button', { class: 'btn', onclick: () => { commitDraftIfFilled(q); const d = duplicateQuote(q.id); open(d.id); toast(`Duplicated as quote #${d.number}`); } }, ['Duplicate']),
      el('button', { class: 'btn', style: 'color:var(--danger)', onclick: async () => { if (await confirmAction(`Delete quote #${q.number}${q.client.name ? ' for ' + q.client.name : ''}? This cannot be undone.`)) { deleteQuote(q.id); sub = { view: 'list', quoteId: null }; renderQuotes(); toast('Quote deleted'); } } }, ['Delete']),
    ]),
  ]);

  const client = el('div', { class: 'panel' }, [
    el('h3', {}, ['Client · Quote #' + q.number + (q.isTest ? ' · TEST' : '')]),
    el('div', { class: 'row' }, [
      input('Client name', q.client.name, (v) => set(() => (q.client.name = v)), { class: 'grow' }),
      input('Phone', q.client.phone, (v) => set(() => (q.client.phone = v)), { class: 'grow' }),
      input('Email', q.client.email, (v) => set(() => (q.client.email = v)), { class: 'grow' }),
    ]),
    el('div', { class: 'row' }, [
      input('Address', q.client.address, (v) => set(() => (q.client.address = v)), { class: 'grow' }),
      dateField('Quote date', q.date, (v) => set(() => (q.date = v))),
      dateField('Install date', q.installDate, (v) => set(() => (q.installDate = v))),
      dateField('Delivery date', q.deliveryDate, (v) => set(() => (q.deliveryDate = v))),
      selectField('Status', STAGES, q.stage || 'Quote', (v) => { q.stage = v; if (isInvoiceStage(v)) assignInvoiceNumber(q); save(); renderQuotes(); }),
      selectField('Payment', PAYMENTS, q.payment || 'Not paid', (v) => { q.payment = v; save(); renderQuotes(); }),
    ]),
  ]);

  // The worksheet rebuilds itself only when rows are added/removed (keeps input focus otherwise).
  const dynamic = el('div', {});
  const reRender = () => dynamic.replaceChildren(sheet(q, reRender));
  reRender();
  return el('div', {}, [toolbar, client, dynamic]);
}

/* ---------------- price breakdown ----------------
   The worksheet shows what a line costs; this shows why. Every component, with the
   formula and the numbers that went into it, adding up to exactly what is billed. */
function showBreakdown(item, s) {
  const x = explainLine(item, s);
  const row = (label, detail, amount, cls = '') => el('div', { class: 'bd-row ' + cls }, [
    el('div', {}, [el('div', { class: 'bd-label' }, [label]), detail ? el('div', { class: 'bd-detail' }, [detail]) : null]),
    el('div', { class: 'bd-amt' }, [amount == null ? '' : amount]),
  ]);

  const body = el('div', { class: 'bd-body' }, [
    ...x.steps.map((st) => row(
      st.label,
      st.detail,
      st.amount == null ? null : (st.kind === 'sub' ? '−' : st.kind === 'add' ? '+' : '') + money(st.amount),
      st.kind === 'note' ? 'note' : '',
    )),
    x.unit == null ? null : row('Price per shade', null, money(x.unit), 'sum'),
    x.qty > 1 ? row(`Line total (${x.qty} shades)`, `${money(x.unit)} × ${x.qty}`, money(x.lineTotal), 'grand') : null,
    x.cost == null ? null : el('div', { class: 'bd-cost' }, [
      el('div', { class: 'bd-cost-head' }, ['Internal — not shown to the client']),
      row('Your cost', `Material at ${Math.round((Number(s.rates?.costFactor) || 0.43) * 100)}% of list, plus everything billed at cost`, money(x.cost)),
      row('Profit on this shade', null, money(round2((x.unit || 0) - x.cost)), 'sum'),
    ]),
  ].filter(Boolean));

  const close = () => wrap.remove();
  const wrap = el('div', { class: 'bd-wrap no-print', onclick: (e) => { if (e.target === wrap) close(); } }, [
    el('div', { class: 'bd-card' }, [
      el('div', { class: 'bd-head' }, [
        el('div', {}, [
          el('h3', { style: 'margin:0' }, ['How this price is calculated']),
          el('div', { class: 'bd-sub' }, [[item.location, item.table, sizeText(item)].filter(Boolean).join(' · ')]),
        ]),
        iconButton('x', 'Close', '', close, 16),
      ]),
      body,
    ]),
  ]);
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.body.append(wrap);
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
    fabricPrice: '', fabricWidth: '', lining: '', track: '', accessories: [], notes: '',
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
function columns(o, tables, categories, customLists) {
  const opt = (arr) => ['', ...arr];
  const tableNames = Object.keys(tables);
  // Grouped by category (Roller/Zebra/Drapery/...) so the dropdown still shows what
  // kind of table each one is, even though the table names themselves are plain.
  const tableGroups = categories.map((cat) => ({ label: cat, names: tableNames.filter((n) => tables[n].category === cat) }));
  const forDrapery = (it) => isDrapery(it, tables);
  // Per-category attributes created from the Lists screen (Pattern, and whatever gets
  // added after it) — same shape as Product/Fabric, so they're filtered by the line's
  // category the same way. Placed after Color rather than squeezed between Description
  // and Color: they read as their own group, right after the shade's core identity
  // (Product/Fabric/Color), not wedged into the middle of it.
  const customCols = (customLists || []).filter((l) => l.perCategory).map((l) => ({
    key: 'custom_' + l.id, label: l.name, kind: 'select', w: 130,
    opts: (it) => opt(l.items[tableCategory(it.table, tables)] || []),
  }));
  return [
    { key: 'table', label: 'Table', kind: 'tablegroup', groups: tableGroups, w: 108 },
    { key: 'qty', label: 'Qty', kind: 'num', w: 48 },
    { key: 'location', label: 'Location', kind: 'select', opts: opt(o.locations), w: 116 },
    { key: 'wdNumber', label: 'W/D #', kind: 'select', opts: opt(o.wdNumbers), w: 92 },
    { key: 'width', label: 'W', kind: 'num', w: 52 },
    { key: 'widthFrac', label: 'Fr', kind: 'frac', w: 66 },
    { key: 'height', label: 'H', kind: 'num', w: 52 },
    { key: 'heightFrac', label: 'Fr', kind: 'frac', w: 66 },
    { key: 'product', label: 'Product', kind: 'select', opts: (it) => opt(o.products[tableCategory(it.table, tables)] || []), w: 150 },
    { key: 'fabric', label: 'Description', kind: 'select', opts: (it) => opt(o.fabrics[tableCategory(it.table, tables)] || []), w: 160 },
    { key: 'color', label: 'Color', kind: 'select', opts: opt(o.colors), w: 116 },
    ...customCols,
    // Roller/Zebra: System (Manual/Motor). Drapery: same column becomes Track
    // (Motorized/Manual) instead — the two concepts play the same role, so Track
    // replaces System in place rather than sitting in its own separate column.
    {
      key: 'system', label: 'System / Track', kind: 'select', w: 108,
      keyFor: (it) => (isDrapery(it, tables) ? 'track' : 'system'),
      opts: (it) => (isDrapery(it, tables) ? opt(draperyStyleOf(it, tables)?.hasTrack ? ['Motorized', 'Manual'] : []) : opt(o.systems)),
      hideWhen: (it) => isDrapery(it, tables) && !draperyStyleOf(it, tables)?.hasTrack,
      naWhy: 'This drapery style has no track',
    },
    { key: 'control', label: 'Ctrl', kind: 'select', opts: opt(o.controls), w: 86 },
    { key: 'motorPrice', label: 'Motor $', kind: 'num', w: 74, placeholder: '0' },
    { key: 'style', label: 'Style', kind: 'select', opts: opt(o.styles), w: 96 },
    { key: 'headrail', label: 'Headrails', kind: 'select', opts: opt(o.headrails), w: 118 },
    { key: 'bottomRail', label: 'Bottom Rail', kind: 'select', opts: opt(o.headrails), w: 118 },
    // Reverse roll: the fabric comes off the back of the tube instead of the front.
    // A Roller/Zebra build detail only — no such thing on Drapery.
    { key: 'reverse', label: 'Reverse', kind: 'check', w: 66, hideWhen: forDrapery, naWhy: 'Reverse roll is a Roller/Zebra option — not for drapery' },
    { key: 'fascia', label: 'Fascia', kind: 'check', w: 58 },
    { key: 'cassette', label: 'Cassette', kind: 'check', w: 66 },
    { key: 'sideChannel', label: 'S/Ch', kind: 'check', w: 54 },
    // Roller: pre-filled from Settings' default, then a plain override from then on.
    // Drapery Heavy/Sheer: same idea, but the "default" is a live formula (scales with
    // width) shown as a placeholder — leave it blank to use it, type a number to override.
    // Drapery Cornice/Swag/Grommet: no formula exists, so it behaves exactly like Brackets.
    { key: 'installation', label: 'Ins', kind: 'num', w: 58, placeholder: (it) => String(draperyAutoInstall(it, tables[it.table]) || '0') },
    { key: 'brackets', label: 'Bra', kind: 'num', w: 58 },
    { key: 'mount', label: 'Mount', kind: 'select', opts: opt(o.mount), w: 90 },
    { key: 'fabricPrice', label: 'Fabric $/yd', kind: 'num', w: 92, placeholder: '0', hideWhen: (it) => !forDrapery(it), naWhy: 'Fabric price per yard only applies to drapery — Roller and Zebra are priced from their chart' },
    { key: 'fabricWidth', label: 'Fabric W', kind: 'select', opts: opt(['54', '118']), w: 90, hideWhen: (it) => !['heavyFabric', 'sheer', 'grommetPanel'].includes(tables[it.table]?.style), naWhy: 'Fabric width only applies to Heavy Fabric, Sheer and Grommet Panel' },
    { key: 'lining', label: 'Lining', kind: 'select', opts: opt(['Lining', 'Lining + Interlining']), w: 130, hideWhen: (it) => !draperyStyleOf(it, tables)?.hasLining, naWhy: 'Lining only applies to drapery styles that come lined (Heavy Fabric, Grommet Panel)' },
    { key: 'discount', label: 'Disc −$', kind: 'num', w: 78, placeholder: '0' },
    { key: 'markup', label: 'Extra +$', kind: 'num', w: 74, placeholder: '0' },
    // Shared across Roller/Zebra/Drapery (unlike Product/Fabric, which are per-category)
    // and multi-valued — a line can carry any number of priced accessories.
    { key: 'accessories', label: 'Accessories', kind: 'multiselect', opts: o.accessories, w: 150 },
    // Free-text, per-line — only printed on the Work Order (its own column there), never
    // on Client Quote or Labels.
    { key: 'notes', label: 'Notes', kind: 'text', w: 160, placeholder: 'Work order only' },
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
  fabricWidth: 'Fabric width in inches (54 or 118) — narrower fabric = more panels = more yards. Blank = the table\'s default. Prints on the Work Order only',
  lining: 'Drapery lining tier — changes which labor rate applies (edit in Price Tables)',
  markup: 'Extra profit added on top (0 = none). Overall margin comes from the cost factor in Settings → Rates.',
  accessories: 'Priced extras (Remote, Valance, etc.) — same list for every table. Click to open and tick as many as you need. Edit prices in Lists.',
  notes: 'Free-text note for the maker — prints only on the Work Order, its own column',
};

// field-sizing does this in CSS; `size` is the same idea for browsers without it.
const fitText = (inp) => { inp.size = Math.max(4, inp.value.length || (inp.placeholder || '').length, 1) + 1; };

function cell(col, item, onChange) {
  // col.w is a floor, not a size: cells grow to whatever their text needs (see table.sheet in styles.css).
  const style = `min-width:${col.w}px`;
  if (col.hideWhen && col.hideWhen(item)) {
    return el('td', { class: 'c na', style, title: col.naWhy || 'Not applicable to this line' }, [el('span', { class: 'muted' }, ['—'])]);
  }
  if (col.kind === 'tablegroup') {
    const cur = String(item[col.key] ?? '');
    const options = col.groups.flatMap(({ label, names }) => names.map((name) => ({ value: name, label: name, group: label })));
    if (cur && !options.some((o) => o.value === cur)) options.push({ value: cur, label: cur }); // table renamed/deleted elsewhere — keep it visible
    return el('td', {}, [dropdown({ options, value: cur, style, onChange: (v) => onChange(col.key, v) })]);
  }
  if (col.kind === 'check') {
    const box = el('input', { type: 'checkbox', onchange: (e) => onChange(col.key, e.target.checked) });
    box.checked = !!item[col.key];
    return el('td', { class: 'c' }, [el('div', { class: 'ck' }, [box])]);
  }
  if (col.kind === 'frac') {
    const options = FRAC_OPTS.map((f) => ({ value: f, label: FRACTION_LABEL[f] || String(f) }));
    return el('td', {}, [dropdown({ options, value: Number(item[col.key]) || 0, style, onChange: (v) => onChange(col.key, Number(v)) })]);
  }
  if (col.kind === 'text') {
    const inp = el('input', {
      type: 'text', value: item[col.key] ?? '', style, placeholder: col.placeholder || '',
      oninput: (e) => { fitText(e.target); onChange(col.key, e.target.value); },
    });
    fitText(inp);
    return el('td', {}, [inp]);
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
  if (col.kind === 'multiselect') {
    const options = (typeof col.opts === 'function' ? col.opts(item) : col.opts) || [];
    return el('td', {}, [multiDropdown({
      options, values: item[col.key], style, money, emptyHint: 'No accessories yet — add them in Lists',
      onChange: (names) => onChange(col.key, names),
    })]);
  }
  // select — options may be plain strings, priced objects {name, price}, or a
  // function of the row item (table-dependent product/fabric lists). `keyFor`
  // lets one column write to different fields per row (System vs Track).
  const key = col.keyFor ? col.keyFor(item) : col.key;
  const options = (typeof col.opts === 'function' ? col.opts(item) : col.opts).map((o) => (typeof o === 'string' ? { name: o, price: 0 } : o));
  const cur = String(item[key] ?? '');
  if (cur && !options.some((o) => o.name === cur)) options.push({ name: cur, price: 0 }); // keep a value not in the filtered set
  const choices = options.map((o) => ({ value: o.name, label: o.price > 0 ? `${o.name} (${money(o.price)})` : o.name }));
  return el('td', {}, [dropdown({ options: choices, value: cur, style, onChange: (v) => onChange(key, v) })]);
}

function sheet(q, rerender) {
  const s = getState();
  const cols = columns(s.options, s.tables, s.categories, s.customLists);
  const draft = q._draft || (q._draft = blankLine(s));

  const priceCells = []; // {getItem, node}
  const insCells = []; // {item, input} — Drapery's live "auto install" placeholder
  const totalsRefs = {};

  const recalc = () => {
    for (const { item, input } of insCells) input.placeholder = String(draperyAutoInstall(item, s.tables[item.table]) || '0');
    for (const p of priceCells) {
      const c = computeLine(p.item, s);
      const hasDims = p.item.width && p.item.height;
      p.node.textContent = c.unit != null ? money(c.unit) : '—';
      p.node.classList.toggle('off', !!c.listMissing);
      // Tint the cell(s) that caused a problem, so the eye lands on what to change.
      const bad = lineIssues(p.item, s, { committed: p.committed }).flatMap((i) => i.fields);
      for (const [k, td] of Object.entries(p.dims || {})) td?.classList.toggle('off-dim', bad.includes(k));
      p.td.querySelector('.offtag')?.remove();
      // DISABLED table minimum (see pricing.js header): restore with the pricing.js blocks.
      // p.td.querySelector('.mintag')?.remove();
      // if (c.floored) p.td.append(el('span', { class: 'mintag', title: `Table minimum ${money(c.floor)} for ${p.item.table} — raise the size or lower the minimum in Price Tables` }, ['min']));
      // The amount shown IS charged now, so the tag has to say what it is missing
      // rather than the price cell reading as a complete one.
      if (c.listMissing) p.td.append(el('span', { class: 'offtag', title: `This size is off the ${p.item.table} chart, so the shade itself is not priced — only the charges typed on this line are. Extend the chart in Price Tables.` }, ['no list']));
      // An untitled em-dash is why a row with a markup typed into it reads as a dead
      // app. Say what is missing instead of saying nothing.
      p.node.title = c.list == null && isDrapery(p.item, s.tables)
        ? (hasDims ? 'Type the fabric price per yard in the "Fabric $/yd" column — drapery is priced from it. Price Tables only holds the rates (fullness, labor, markup).' : 'Enter width, height and Fabric $/yd to price this drapery')
        : c.list == null
        ? (hasDims ? `Off the ${p.item.table} chart — this is the typed charges only, NOT a full price` : 'Enter width and height — charges are added on top of the list price, so there is nothing to price yet')
        : `List ${money(c.list)}`;
      p.client.textContent = c.unit == null ? '—' : money0((c.unit || 0) - (s.showInstall !== false ? (c.installation || 0) : 0));
    }
    // Subtotal reflects committed lines PLUS the row currently being filled, so the
    // number is never a surprising $0 while a priced line sits in the draft row.
    // Mirror the client invoice: whole-dollar amounts + tax, so the worksheet matches.
    // Live q._draft, not the `draft` this sheet captured — same reason the rows do it.
    const priced = [...q.items, q._draft || draft].map((it) => ({ it, c: computeLine(it, s), qty: Number(it.qty) || 1 }));
    const sub = priced.reduce((a, p) => a + roundWhole(p.c.unit || 0) * p.qty, 0);
    const afterDiscount = sub - roundWhole(Number(q.discount) || 0);
    // The worksheet used to ignore the minimum order entirely, so the screen showed
    // one total and the printed invoice another for the same quote.
    const minOrder = roundWhole(Number(s.minimumOrder) || 0);
    // The subtotal above counts the draft row, so the minimum has to as well — keyed
    // to committed lines only, a priced draft showed a total that jumped the moment
    // you clicked ✓ on the same numbers.
    const minApplied = (q.items.length > 0 || sub > 0) && minOrder > 0 && afterDiscount < minOrder;
    const taxable = minApplied ? minOrder : afterDiscount;
    const rate = Number(s.taxRate) || 0;
    const tax = roundWhole(taxable * rate / 100);
    // Sized but unpriceable — an unsized draft row is not a finding, it is a row
    // nobody has filled in yet.
    const flagged = priced.flatMap((p) => {
      const idx = q.items.indexOf(p.it);
      return lineIssues(p.it, s, { committed: idx >= 0 }).map((issue) => ({ p, idx, issue }));
    });
    totalsRefs.offRow.style.display = flagged.length ? '' : 'none';
    totalsRefs.off.textContent = flagged.length === 1 ? '1 line' : flagged.length + ' lines';
    totalsRefs.offList.replaceChildren(...flagged.map(({ p, idx, issue }) => {
      const what = [idx < 0 ? 'New line' : 'Line ' + (idx + 1), p.it.location, p.it.table].filter(Boolean).join(' · ');
      return el('button', {
        class: 'off-line', type: 'button',
        onclick: () => {
          const tr = priceCells.find((c) => c.item === p.it)?.node.closest('tr');
          if (!tr) return;
          tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
          tr.classList.add('flash');
          setTimeout(() => tr.classList.remove('flash'), 1800);
        },
      }, [el('strong', {}, [what]), ' — ', issue.text]);
    }));
    totalsRefs.offRow.title = 'These lines are not priced in full. Charges typed on them are in the total above, but the shade itself is not — so the total is an UNDERCOUNT, not a quote.';
    totalsRefs.minRow.style.display = minApplied ? '' : 'none';
    if (minApplied) totalsRefs.min.textContent = '+' + money0(minOrder - afterDiscount);
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

  // A ROW MUST NOT CAPTURE ITS ITEM. A sync replaces q.items with fresh objects of
  // the same content, in the same order, while this sheet keeps rendering — so a row
  // that closed over its item then writes to an object the quote no longer holds.
  // Measured: after the first edit the identity breaks ~400ms later (the echo of our
  // own push), and the NEXT edit writes 555 into the orphan while q.items still says
  // 999 — the line price moves (it reads the capture), the subtotal does not (it
  // reads q.items), and the save drops the edit entirely. Resolve by position on
  // every access instead; order is preserved by the merge, and the two operations
  // that do reorder (duplicate, remove) rerender.
  // q._draft is replaced by the same merge, so the draft row resolves it too rather
  // than holding the object `draft` pointed at when this sheet was built.
  const liveItem = (idx, draftRow, captured) =>
    (draftRow ? q._draft : q.items[idx]) || captured;

  const makeRow = (captured, { draftRow, idx } = {}) => {
    // Falling back to `captured` (never to the draft) keeps a row whose index went
    // away writing to its own dead object instead of corrupting a different line.
    const live = () => liveItem(idx, draftRow, captured);
    const item = live();
    // Changing the table refilters the Product/Description options, so rebuild the row.
    // Save on every keystroke, draft row included — otherwise a refresh (or a browser
    // that never gets to "Add line") silently loses whatever was typed into it.
    const onChange = (key, val) => { live()[key] = val; save(); recalc(); if (key === 'table') rerender(); };
    // Every charge should be checkable without trusting the app: click the price and
    // it shows the arithmetic that produced it.
    const priceNode = el('strong', { class: 'price-explain', title: 'Click to see how this price is calculated' }, ['—']);
    const priceTd = el('td', { class: 'r price', onclick: () => showBreakdown(live(), getState()) }, [priceNode]);
    const clientNode = el('span', {}, ['—']);
    const clientTd = el('td', { class: 'r', style: 'color:var(--muted)' }, [clientNode]);
    priceCells.push({ committed: !draftRow, get item() { return live(); }, node: priceNode, td: priceTd, client: clientNode });
    const cells = cols.map((col) => cell(col, item, onChange));
    const insInput = cells[cols.findIndex((c) => c.key === 'installation')]?.querySelector('input[data-live-ins-placeholder]');
    if (insInput) insCells.push({ get item() { return live(); }, input: insInput });
    const dimCell = (key) => cells[cols.findIndex((c) => c.key === key)];
    priceCells[priceCells.length - 1].dims = { width: dimCell('width'), height: dimCell('height'), fabricPrice: dimCell('fabricPrice') };
    cells.push(priceTd);
    cells.push(clientTd);
    if (draftRow) {
      cells.push(el('td', { style: 'white-space:nowrap' }, [
        iconButton('check', 'Add this line', 'ok', () => addLine()),
        iconButton('undo', 'Clear this row', '', async () => { if (isRowEmpty(live()) || await confirmAction('Clear this row? What you typed in it will be lost.', 'Clear row')) { q._draft = blankLine(s); save(); rerender(); } }),
      ]));
      return el('tr', { class: 'draftrow' }, cells);
    }
    cells.push(el('td', { style: 'white-space:nowrap' }, [
      iconButton('copy', 'Duplicate this line', '', () => { q.items.splice(idx + 1, 0, { ...live() }); save(); rerender(); }),
      iconButton('trash', 'Delete this line', 'danger', async () => { if (await confirmAction('Delete this line from the quote?', 'Delete line')) { q.items.splice(idx, 1); save(); rerender(); } }),
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

  const bodyRows = q.items.map((it, idx) => makeRow(it, { idx }));
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
  totalsRefs.min = el('span', {}, ['—']);
  totalsRefs.minRow = el('div', { class: 'line', style: 'display:none' }, [el('span', {}, ['Minimum order']), totalsRefs.min]);
  // A line that is off the chart contributes $0, so the total silently understates
  // the job. Say so next to the number rather than leaving the gap to be noticed.
  totalsRefs.offList = el('div', { class: 'off-list' }, []);
  totalsRefs.offRow = el('div', { class: 'off-block', style: 'display:none' }, [
    el('div', { class: 'line', style: 'color:var(--danger)' }, [el('span', {}, ['Not fully priced — fix before sending']), (totalsRefs.off = el('span', {}, ['—']))]),
    totalsRefs.offList,
  ]);
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
    totalsRefs.minRow,
    totalsRefs.offRow,
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
      el('button', { class: 'btn primary', onclick: addLine }, labeled('plus', 'Add line')),
      el('span', { class: 'hint' }, ['or press Enter']),
    ]),
    totals,
  ]);
}

/* ---------------- printable documents (Client quote + Work order) ---------------- */
let woSeparate = false; // several product types ticked: one order each instead of one merged order
let woSel = null; // product types ticked on the work order; null = all of them
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
    const desc = describeLine(l, cfg, isWork, false, s);
    const size = isWork ? ` [${sizeText(l)}]` : '';
    const price = isWork ? '' : ` — ${money(computeLine(l, s).unit || 0)}`;
    const qty = Number(l.qty) || 1;
    const count = qty > 1 ? `${qty}× ` : '';
    const notes = isWork && l.notes ? ` — ${l.notes}` : '';
    return `${i + 1}. ${count}${l.location ? l.location + ' · ' : ''}${desc}${size}${price}${notes}`;
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
  const btn = el('button', { class: 'btn small', title: 'Share this document' }, labeled('share', 'Share'));
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
      item(labeled('chat', 'WhatsApp (attach the PDF)'), () => window.open('https://wa.me/?text=' + enc(), '_blank')),
      item(labeled('mail', 'Email (attach the PDF)'), () => { window.location.href = `mailto:${q.client.email || ''}?subject=${encodeURIComponent(title)}&body=${enc()}`; }),
      item(labeled('clipboard', 'Copy text'), async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); } catch { toast('Copy failed'); } }),
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
    el('button', { class: 'btn ghost', onclick: () => open(q.id, 'edit') }, labeled('arrowLeft', 'Back to worksheet')),
    el('div', { class: 'subtabs', style: 'margin:0' }, [
      el('button', { class: 'subtab' + (invMode === 'client' ? ' active' : ''), onclick: () => { invMode = 'client'; renderQuotes(); } }, ['Client Quote']),
      el('button', { class: 'subtab' + (invMode === 'work' ? ' active' : ''), onclick: () => { invMode = 'work'; renderQuotes(); } }, ['Work Order']),
      el('button', { class: 'subtab' + (invMode === 'labels' ? ' active' : ''), onclick: () => { invMode = 'labels'; renderQuotes(); } }, ['Labels']),
      el('button', { class: 'btn primary small', onclick: () => window.print() }, labeled('printer', 'Print / Save PDF')),
    ]),
  ]);

  if (invMode === 'labels') return el('div', {}, [toolbar, labelsView(q, s)]);

  const catOf = (l) => s.tables[l.table]?.category;
  const cats = s.categories.filter((c) => q.items.some((l) => catOf(l) === c)); // types this quote actually has
  const itemsFor = (c) => q.items.filter((l) => catOf(l) === c);
  const picked = woSel ? cats.filter((c) => woSel.has(c)) : cats;
  const makerBar = isWork && cats.length > 1 ? el('div', { class: 'maker-bar no-print' }, [
    el('span', { class: 'hint' }, ['Work order for']),
    ...s.categories.map((c) => el('button', {
      class: 'chip-btn' + (picked.includes(c) ? ' active' : '') + (cats.includes(c) ? '' : ' empty'),
      disabled: !cats.includes(c),
      onclick: () => {
        const next = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c];
        if (next.length) woSel = new Set(next); // always keep at least one ticked
        renderQuotes();
      },
    }, [c, el('span', { class: 'n' }, [String(itemsFor(c).length)])])),
    picked.length > 1 ? el('label', { style: 'display:inline-flex;align-items:center;gap:8px;margin-left:10px;font-size:13px;font-weight:600;cursor:pointer' }, [
      (() => { const b = el('input', { type: 'checkbox', onchange: (e) => { woSeparate = e.target.checked; renderQuotes(); } }); b.checked = woSeparate; return b; })(),
      'Separate order for each',
    ]) : null,
  ]) : null;

  const meta = (label, val) => el('div', { class: 'mrow' }, [el('span', { class: 'ml' }, [label]), el('span', { class: 'mv' }, [val])]);

  const build = (items, maker) => {
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
        maker ? meta('For', maker.name) : null,
        meta('Date', q.date || '—'),
        q.installDate ? meta('Install', q.installDate) : null,
        q.deliveryDate ? meta('Delivery', q.deliveryDate) : null,
      ]),
    ]),
  ]);

  // The maker needs this to jump out at a glance — a small meta row isn't enough.
  const deliveryBanner = isWork && q.deliveryDate
    ? el('div', { class: 'delivery-banner' }, [el('span', {}, ['DELIVERY DATE: ']), el('strong', {}, [q.deliveryDate])])
    : null;

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

  const table = el('div', { class: 'inv-scroll' }, [isWork ? workTable(q, s, items) : clientTable(q, s)]);

  return el('div', { class: 'invoice' + (isWork ? ' work' : '') }, [
    head, deliveryBanner, bill, table,
    isWork ? null : (() => {
      // Whole-dollar, adds up: products (install broken out if enabled) + install + tax.
      const showInstall = s.showInstall !== false;
      const per = q.items.map((l) => ({ c: computeLine(l, s), qty: Number(l.qty) || 1 }));
      const install = showInstall ? per.reduce((a, p) => a + roundWhole(p.c.installation || 0) * p.qty, 0) : 0;
      const sub = per.reduce((a, p) => a + roundWhole((p.c.unit || 0) - (showInstall ? (p.c.installation || 0) : 0)) * p.qty, 0);
      const discount = roundWhole(t.discount);
      const afterDiscount = sub + install - discount;
      const minTopUp = t.minApplied ? Math.max(0, roundWhole(t.minOrder) - afterDiscount) : 0;
      const taxable = afterDiscount + minTopUp;
      const tax = roundWhole(taxable * (Number(s.taxRate) || 0) / 100);
      const total = taxable + tax;
      const pct = payPct(q);
      const paid = roundWhole(total * pct);
      return el('div', { class: 'sum' }, [
        el('div', { class: 'sum-box' }, [
          el('div', { class: 'line' }, [el('span', {}, ['Subtotal']), el('span', {}, [money0(sub)])]),
          install ? el('div', { class: 'line' }, [el('span', {}, ['Installation']), el('span', {}, [money0(install)])]) : null,
          discount ? el('div', { class: 'line' }, [el('span', {}, ['Discount']), el('span', {}, ['−' + money0(discount)])]) : null,
          // Without this line the client sees a Total that does not equal the numbers
          // printed above it, and no explanation for the gap.
          minTopUp ? el('div', { class: 'line' }, [el('span', {}, ['Minimum order']), el('span', {}, ['+' + money0(minTopUp)])]) : null,
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
  };

  let docs;
  if (!isWork || picked.length < 2 || !woSeparate) {
    const items = !isWork || picked.length === cats.length ? q.items : q.items.filter((l) => picked.includes(catOf(l)));
    docs = [build(items, !isWork || picked.length === cats.length ? null : { name: picked.join(' + ') })];
  } else docs = picked.map((c) => build(itemsFor(c), { name: c }));
  if (!docs.length) docs = [el('div', { class: 'empty' }, ['Nothing to show for this selection.'])];

  return el('div', {}, [toolbar, makerBar, el('div', { class: 'panel invoice-panel' }, docs)]);
}

// DYMO 30252 stickers (1⅛" × 3½"), one per shade, for the LabelWriter 550.
function labelsView(q, s) {
  // Control's hand side is always printed next to the size (dl-size below) — leaving it
  // in the description too would print it twice on the same sticker.
  const cfg = { ...s.docConfig.label, control: false };
  // One sticker per shade. This mapped over lines, so a line of six produced a
  // single label and five shades went out unlabelled.
  const perShade = q.items.flatMap((l) => {
    const n = Math.max(1, Number(l.qty) || 1);
    return Array.from({ length: n }, (_, k) => ({ l, k, n }));
  });
  const labels = perShade.map(({ l, k, n }) => {
    const card = el('div', { class: 'dymo-label' }, [
      el('div', { class: 'dl-text' }, [
        el('div', { class: 'dl-name' }, [q.client.name || '']),
        el('div', { class: 'dl-loc' }, [(l.location || '') + (n > 1 ? ` (${k + 1} of ${n})` : '')]),
        el('div', { class: 'dl-prod' }, [[l.product, describeLine(l, cfg, false, true, s)].filter(Boolean).join(' — ')]),
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
    // An off-chart line used to print $0 / $0 — a client-facing invoice offering a
    // shade for free, with nothing on the page saying it was unpriced.
    // A line with no size at all still cannot be priced; one that is merely off the
    // chart now carries its typed charges, and those are in the totals below, so the
    // page has to print them or the column would not add up to the Total.
    const unpriced = c.unit == null;
    return el('tr', { class: unpriced ? 'unpriced' : '' }, [
      el('td', { class: 'num' }, [String(qty)]),
      el('td', { class: 'strong' }, [l.location]),
      el('td', { class: 'desc' }, [describeLine(l, cfg, false, false, s)]),
      el('td', { class: 'num' }, [unpriced ? 'TBD' : money0(shownUnit)]),
      el('td', { class: 'num strong' }, [unpriced ? 'TBD' : money0(roundWhole(shownUnit) * qty)]),
    ]);
  });
  const cols = ['Qty', 'Location', 'Description', 'Unit Price', 'Total'];
  return el('table', { class: 'items' }, [
    el('thead', {}, [el('tr', { class: 'print-gap' }, [el('td', { colspan: cols.length })]), el('tr', {}, cols.map((h, i) => el('th', { class: i === 0 || i >= 3 ? 'num' : '' }, [h])))]),
    el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: cols.length, class: 'muted', style: 'text-align:center;padding:24px' }, ['No items'])])]),
    el('tfoot', {}, [el('tr', { class: 'print-gap' }, [el('td', { colspan: cols.length })])]),
  ]);
}

// Work order: same Description style (fields chosen in Settings) PLUS dimensions,
// NO prices. Few columns so it always fits a page / PDF.
function workTable(q, s, items = q.items) {
  const cfg = s.docConfig.work;
  // Qty was missing entirely: a line reading "Living room x 6" printed as one row
  // with no quantity, and the shop built one shade.
  const cols = ['#', 'Qty', 'Location', 'Size (W×H)', 'Description', 'Notes'];
  const rows = items.map((l, i) => el('tr', {}, [
    el('td', { class: 'num' }, [String(i + 1)]),
    el('td', { class: 'num strong' }, [String(Number(l.qty) || 1)]),
    el('td', { class: 'strong' }, [l.location]),
    el('td', { class: 'strong' }, [sizeText(l)]),
    el('td', { class: 'desc' }, [describeLine(l, cfg, true, false, s)]),
    el('td', { class: 'desc' }, [l.notes || '']),
  ]));
  return el('table', { class: 'items' }, [
    el('thead', {}, [el('tr', { class: 'print-gap' }, [el('td', { colspan: cols.length })]), el('tr', {}, cols.map((h, i) => el('th', { class: i === 0 ? 'num' : '' }, [h])))]),
    el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: cols.length, class: 'muted', style: 'text-align:center;padding:24px' }, ['No items'])])]),
    el('tfoot', {}, [el('tr', { class: 'print-gap' }, [el('td', { colspan: cols.length })])]),
  ]);
}
