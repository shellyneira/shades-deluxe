// Quotes: list -> estimator worksheet (internal, with dimensions) -> invoice (customer, no dimensions).
import { el, input, checkbox, mount, toast, FRACTION_LABEL } from './dom.js';
import { dropdown, combo, popover, closePopover, icon, ICON, selectField, dateField, iconButton, confirmAction, labeled } from './ui.js';
import { getState, save, STAGES, PAYMENTS, isInvoiceStage, payPct, newQuote, duplicateQuote, getQuote, deleteQuote, assignInvoiceNumber } from './store.js';
import { computeLine, isSizeless, isOtherLine, SERVICE_TABLE, CUSTOM_TABLE, ACCESSORY_TABLE, lineIssues, describeLine, quoteTotals, money, money0, roundWhole, round2, DRAPERY_STYLES, draperyAutoInstall, installAutoText, explainLine, descFields } from './pricing.js';
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
  if ((sub.view === 'edit' || sub.view === 'invoice') && getQuote(sub.quoteId)) return mount(editor(getQuote(sub.quoteId)));
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

  const toolbar = el('div', { class: 'section-head no-print' }, [
    el('button', { class: 'btn ghost', onclick: () => { sub = { view: 'list', quoteId: null }; renderQuotes(); } }, labeled('arrowLeft', 'All quotes')),
    el('div', { class: 'row toolbar' }, [
      // One click, and this quote stops counting as business: it leaves every
      // dashboard number and never takes an invoice number.
      (() => {
        const box = checkbox('Is test', q.isTest, (v) => { q.isTest = v; save(); renderQuotes(); toast(v ? 'Marked as a test — kept out of your numbers' : 'Back to a real quote'); });
        box.title = q.isTest ? 'This is a practice quote — it is excluded from the dashboard' : 'Mark as a practice quote, excluded from the dashboard';
        return box;
      })(),
      el('button', { class: 'btn', onclick: () => { commitDraftIfFilled(q); const d = duplicateQuote(q.id); open(d.id); toast(`Duplicated as quote #${d.number}`); } }, ['Duplicate']),
      el('button', { class: 'btn', style: 'color:var(--danger)', onclick: async () => { if (await confirmAction(`Delete quote #${q.number}${q.client.name ? ' for ' + q.client.name : ''}? This cannot be undone.`)) { deleteQuote(q.id); sub = { view: 'list', quoteId: null }; renderQuotes(); toast('Quote deleted'); } } }, ['Delete']),
    ]),
  ]);

  const client = el('div', { class: 'panel no-print' }, [
    el('h3', {}, ['Client · Quote #' + q.number + (q.isTest ? ' · TEST' : '')]),
    el('div', { class: 'row' }, [
      input('Client name', q.client.name, (v) => set(() => (q.client.name = v)), { class: 'grow' }),
      input('Phone', q.client.phone, (v) => set(() => (q.client.phone = v)), { class: 'grow' }),
      input('Email', q.client.email, (v) => set(() => (q.client.email = v)), { class: 'grow', keepCase: true }),
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
  const inDoc = sub.view === 'invoice';
  const reRender = () => dynamic.replaceChildren(inDoc ? docView(q) : sheet(q, reRender));
  reRender();
  // One page, five views: the tabs swap what is shown underneath, nothing navigates away.
  const bar = el('div', { class: 'quote-bar no-print' }, [
    quoteTabs(q, inDoc ? invMode : sheetMode()),
    inDoc ? el('button', { class: 'btn primary small', onclick: () => window.print() }, labeled('printer', 'Print / Save PDF')) : null,
  ]);
  return el('div', {}, [toolbar, client, bar, dynamic]);
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

// A section's "add" row that was filled in but never committed is kept, so jumping to
// the invoice never silently drops a line.
const hasSizelessContent = (l) => Number(l.customPrice) || l.customText;
function commitDraftIfFilled(q) {
  const tables = getState().tables;
  for (const [key, d] of Object.entries(q._drafts || {})) {
    const sizeless = ['accessory', 'service'].includes(familyOf(d, tables));
    if (sizeless ? hasSizelessContent(d) : d.width && d.height) {
      q.items.push({ ...d });
      delete q._drafts[key];
    }
  }
  save();
}

function blankLine(s, table) {
  // Accessories and services carry only what they are: no size, fabric or mount to leak
  // into a document.
  if (table === ACCESSORY_TABLE || table === SERVICE_TABLE) return { table, qty: 1, location: '', customText: '', customPrice: '', installation: '', discount: '', forLines: [] };
  return {
    table: table || Object.keys(s.tables).find((n) => s.tables[n].kind !== 'formula'), qty: 1, location: '', wdNumber: '',
    width: '', widthFrac: 0, height: '', heightFrac: 0,
    product: '', fabric: '', color: '', control: '', system: '', style: '',
    headrail: '', bottomRail: '', reverse: false, fascia: false, cassette: false, sideChannel: false,
    installation: s.defaultInstallation || '', brackets: '', mount: 'Ceiling', discount: '', markup: '', motorPrice: '',
    fabricPrice: '', fabricWidth: '', lining: '', track: '', notes: '',
  };
}

// A draft row is "empty" if nothing but the default table is set (so clearing needs no confirm).
function isRowEmpty(l) {
  return !l.width && !l.height && !l.location && !l.wdNumber && !l.product && !l.fabric &&
    !l.color && !l.control && !l.system && !l.style && !l.headrail && !l.bottomRail && !l.reverse &&
    !l.fascia && !l.cassette && !l.sideChannel && !l.installation && !l.brackets && !l.fabricPrice &&
    !l.customText && !l.customPrice;
}

// A shade's Product/Fabric options are filtered by its table's category (Roller,
// Zebra, or whatever category was assigned in Price Tables) — each category has
// its own dropdown list.
export const tableCategory = (table, tables) => tables[table]?.category || 'Roller';

const isDrapery = (it, tables) => tables[it.table]?.kind === 'formula';

// Every line belongs to one family, and a family decides which worksheet section it sits in
// and which columns that section shows.
const familyOf = (it, tables) => (it.table === ACCESSORY_TABLE ? 'accessory' : isOtherLine(it) ? 'service' : isDrapery(it, tables) ? 'drapery' : 'shade');
const sectionKeyOf = (it, tables) => { const f = familyOf(it, tables); return f === 'drapery' ? 'drapery:' + it.table : f === 'shade' ? 'shades' : f; };
// Lining/Track only mean something for the Drapery styles that actually offer them
// (e.g. Cornice has neither) — null here means "hide the field" for this row.
const draperyStyleOf = (it, tables) => (isDrapery(it, tables) ? DRAPERY_STYLES[tables[it.table].style] : null);

// Any worksheet column whose key also appears in Settings → "Order these appear in
// every document" (descFields) gets reordered to match — dragging a row there (e.g.
// moving Pattern before Color) reorders the matching worksheet columns in place, not
// just the printed Description. Columns with no Settings equivalent (Qty, Location,
// W/H, Motor $, Ins, Disc, Notes...) are structural/data-entry fields, not printable
// attributes, so they stay exactly where they are.
function reorderByFieldOrder(cols, state) {
  const order = descFields(state).map((f) => f.key);
  const slots = [];
  const movable = [];
  cols.forEach((c, i) => { if (order.includes(c.key)) { slots.push(i); movable.push(c); } });
  if (movable.length < 2) return cols;
  const rank = (c) => order.indexOf(c.key);
  const sorted = [...movable].sort((a, b) => rank(a) - rank(b));
  const result = [...cols];
  slots.forEach((slotIdx, i) => { result[slotIdx] = sorted[i]; });
  return result;
}

// Spreadsheet columns — one narrow column each, mirroring the Excel worksheet (Hoja 1).
// `opts` may be an array or a function of the row item (used for table-aware filtering).
// `hideWhen(item)` greys a cell out for rows where the field is meaningless.
function columns(state, tables, categories, customLists) {
  const o = state.options;
  const SH = ['shade'], DR = ['drapery'], SD = ['shade', 'drapery'], OT = ['accessory', 'service'], SIA = ['shade', 'drapery', 'accessory'], ALL = ['shade', 'drapery', 'accessory', 'service'];
  const opt = (arr) => ['', ...arr];
  const tableNames = Object.keys(tables);
  const forDrapery = (it) => isDrapery(it, tables);
  // Per-category attributes created from the Lists screen (Pattern, and whatever gets
  // added after it) — same shape as Product/Fabric, so they're filtered by the line's
  // category the same way. Placed after Color rather than squeezed between Description
  // and Color: they read as their own group, right after the shade's core identity
  // (Product/Fabric/Color), not wedged into the middle of it.
  const customCols = (customLists || []).filter((l) => l.perCategory).map((l) => ({
    key: 'custom_' + l.id, label: l.name, kind: 'select', fam: SD, w: 130, free: !l.priced,
    opts: (it) => opt(l.items[tableCategory(it.table, tables)] || []),
  }));
  return reorderByFieldOrder([
    { key: 'table', label: 'Table', kind: 'tablegroup', fam: SD, w: 108 },
    { key: 'qty', fam: ALL, label: 'Qty', kind: 'num', w: 48 },
    { key: 'location', fam: ALL, label: 'Location', kind: 'select', free: true, opts: opt(o.locations), w: 116 },
    { key: 'wdNumber', fam: SD, label: 'W/D #', kind: 'select', free: true, opts: opt(o.wdNumbers), w: 92 },
    { key: 'width', fam: SD, label: 'W', kind: 'num', w: 52 },
    { key: 'widthFrac', fam: SD, label: 'Fr', kind: 'frac', w: 66 },
    { key: 'height', fam: SD, label: 'H', kind: 'num', w: 52 },
    { key: 'heightFrac', fam: SD, label: 'Fr', kind: 'frac', w: 66 },
    { key: 'product', fam: SD, label: 'Product', kind: 'select', free: true, opts: (it) => opt(o.products[tableCategory(it.table, tables)] || []), w: 150 },
    { key: 'fabric', fam: SD, label: 'Description', kind: 'select', free: true, opts: (it) => opt(o.fabrics[tableCategory(it.table, tables)] || []), w: 160 },
    { key: 'color', fam: SD, label: 'Color', kind: 'select', free: true, opts: opt(o.colors), w: 116 },
    // Custom item lines: what to call it and what to charge. Every other column stays live.
    { key: 'customText', label: 'Item', kind: 'text', fam: OT, w: 220, placeholder: 'Pick a saved one or type',
      // Saved services/accessories as suggestions; anything else can still be typed. Picking one fills its price.
      suggest: (it) => (it.table === SERVICE_TABLE ? o.services : it.table === ACCESSORY_TABLE ? o.accessories : []) || [] },
    { key: 'customPrice', label: 'Price $', kind: 'num', fam: OT, w: 84, placeholder: '0' },
    // Which shades or drapes an accessory goes with. Optional: empty means the whole quote.
    { key: 'forLines', label: 'For', kind: 'forlines', fam: ['accessory'], w: 170 },
    ...customCols,
    // Roller/Zebra: System (Manual/Motor). Drapery: same column becomes Track
    // (Motorized/Manual) instead — the two concepts play the same role, so Track
    // replaces System in place rather than sitting in its own separate column.
    {
      key: 'system', label: 'System / Track', kind: 'select', fam: SD, w: 108,
      keyFor: (it) => (isDrapery(it, tables) ? 'track' : 'system'),
      opts: (it) => (isDrapery(it, tables) ? opt(draperyStyleOf(it, tables)?.hasTrack ? ['Motorized', 'Manual'] : []) : opt(o.systems)),
      hideWhen: (it) => isDrapery(it, tables) && !draperyStyleOf(it, tables)?.hasTrack,
      naWhy: 'This drapery style has no track',
    },
    { key: 'control', fam: SH, label: 'Ctrl', kind: 'select', opts: opt(o.controls), w: 86 },
    { key: 'motorPrice', fam: SD, label: 'Motor $', kind: 'num', w: 74, placeholder: '0' },
    { key: 'style', fam: SH, label: 'Style', kind: 'select', opts: opt(o.styles), w: 96 },
    { key: 'headrail', fam: SH, label: 'Headrails', kind: 'select', opts: opt(o.headrails), w: 118 },
    { key: 'bottomRail', fam: SH, label: 'Bottom Rail', kind: 'select', opts: opt(o.headrails), w: 118 },
    // Reverse roll: the fabric comes off the back of the tube instead of the front.
    // A Roller/Zebra build detail only — no such thing on Drapery.
    { key: 'reverse', fam: SH, label: 'Reverse', kind: 'check', w: 66, hideWhen: forDrapery, naWhy: 'Reverse roll is a Roller/Zebra option — not for drapery' },
    { key: 'fascia', fam: SH, label: 'Fascia', kind: 'check', w: 58 },
    { key: 'cassette', fam: SH, label: 'Cassette', kind: 'check', w: 66 },
    { key: 'sideChannel', fam: SH, label: 'S/Ch', kind: 'check', w: 54 },
    // Roller: pre-filled from Settings' default, then a plain override from then on.
    // Drapery Heavy/Sheer: same idea, but the "default" is a live formula (scales with
    // width) shown as a placeholder — leave it blank to use it, type a number to override.
    // Drapery Cornice/Swag/Grommet: no formula exists, so it behaves exactly like Brackets.
    { key: 'installation', fam: SIA, label: 'Ins', kind: 'num', w: 58, placeholder: (it) => String(draperyAutoInstall(it, tables[it.table]) || '0') },
    { key: 'brackets', fam: SD, label: 'Bra', kind: 'num', w: 58 },
    { key: 'mount', fam: SD, label: 'Mount', kind: 'select', opts: opt(o.mount), w: 90 },
    { key: 'fabricPrice', fam: DR, label: 'Fabric $/yd', kind: 'num', w: 92, placeholder: '0', hideWhen: (it) => !forDrapery(it), naWhy: 'Fabric price per yard only applies to drapery — Roller and Zebra are priced from their chart' },
    { key: 'fabricWidth', fam: DR, label: 'Fabric W', kind: 'select', opts: opt(['54', '118']), w: 90, hideWhen: (it) => !['heavyFabric', 'sheer', 'grommetPanel'].includes(tables[it.table]?.style), naWhy: 'Fabric width only applies to Heavy Fabric, Sheer and Grommet Panel' },
    { key: 'lining', fam: DR, label: 'Lining', kind: 'select', opts: opt(['Lining', 'Lining + Interlining']), w: 130, hideWhen: (it) => !draperyStyleOf(it, tables)?.hasLining, naWhy: 'Lining only applies to drapery styles that come lined (Heavy Fabric, Grommet Panel)' },
    { key: 'discount', fam: ALL, label: 'Disc −$', kind: 'num', w: 78, placeholder: '0' },
    { key: 'markup', fam: SD, label: 'Extra +$', kind: 'num', w: 74, placeholder: '0' },
    // Free-text, per-line — only printed on the Work Order (its own column there), never
    // on Client Quote or Labels.
    { key: 'notes', fam: SD, label: 'Notes', kind: 'text', w: 160, placeholder: 'Work order only' },
  ], state);
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
  notes: 'Free-text note for the maker — prints only on the Work Order, its own column',
};

// field-sizing does this in CSS; `size` is the same idea for browsers without it.
const fitText = (inp) => { inp.size = Math.max(4, inp.value.length || (inp.placeholder || '').length, 1) + 1; };

// Labels that only describe (location, color, product...) accept anything typed, with
// the saved list as suggestions — a one-off name never has to be added to Lists first.
// Priced or rule-bearing fields stay strict: a typed value there would silently charge $0.
function cell(col, item, onChange, ctx = {}) {
  if (col.kind === 'select' && col.free) {
    const listed = col;
    col = { ...col, kind: 'text', suggest: (it) => ((typeof listed.opts === 'function' ? listed.opts(it) : listed.opts) || []).filter(Boolean).map((o) => (typeof o === 'string' ? { name: o, price: 0 } : o)) };
  }
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
  if (col.kind === 'forlines') {
    const tables = getState().tables;
    const targets = () => ctx.q.items.filter((l) => ['shade', 'drapery'].includes(familyOf(l, tables)) && l.id);
    const label = () => {
      const picked = targets().filter((l) => (item.forLines || []).includes(l.id));
      return picked.length ? picked.map((l) => l.location || l.table).join(', ') : 'Whole quote';
    };
    const text = el('span', { class: 'dd-text' }, [label()]);
    const btn = el('button', { type: 'button', class: 'dd', style, 'aria-haspopup': 'listbox' }, [text, icon(ICON.chevron, 14)]);
    btn.querySelector('.ico').classList.add('dd-chev');
    btn.addEventListener('click', () => {
      const chosen = new Set(item.forLines || []);
      const rows = targets().map((l) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = chosen.has(l.id);
        box.onchange = () => {
          if (box.checked) chosen.add(l.id); else chosen.delete(l.id);
          onChange('forLines', [...chosen]);
          text.textContent = label();
        };
        return el('label', { class: 'dd-opt for-opt' }, [box, el('span', { class: 'dd-label' }, [`${l.location || '—'} · ${l.table}${l.width ? ` · ${l.width}×${l.height}` : ''}`])]);
      });
      const panel = el('div', { class: 'dd-list', style: 'max-width:min(420px, calc(100vw - 24px))' }, [
        el('div', { class: 'dd-group' }, ['Goes with (empty = whole quote)']),
        ...(rows.length ? rows : [el('div', { class: 'dd-empty' }, ['Add a shade or drapery first'])]),
      ]);
      popover(btn, panel);
    });
    return el('td', {}, [btn]);
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
    const suggestions = col.suggest ? col.suggest(item) : [];
    if (suggestions.length) {
      return el('td', {}, [combo({
        options: suggestions, value: item[col.key], placeholder: col.placeholder || '', style, money,
        // Choosing a saved entry (not typing one) fills in its price, which stays editable.
        onChange: (text, picked) => {
          onChange(col.key, text);
          if (picked && col.key === 'customText' && Number(picked.price) && !Number(item.customPrice)) { onChange('customPrice', picked.price); ctx.rerender?.(); }
        },
      })]);
    }
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

// How the quote page shows its lines: "sheet" (spreadsheet, fast for many similar lines)
// or "lines" (a short list with every field of the chosen line stacked beside it).
const sheetMode = () => { try { return localStorage.getItem('sd-sheet-mode') === 'lines' ? 'lines' : 'sheet'; } catch { return 'sheet'; } };
const setSheetMode = (m) => { try { localStorage.setItem('sd-sheet-mode', m); } catch { /* the choice just is not remembered */ } };

// The five views of one quote, always in the same place: between the client card and the lines.
function quoteTabs(q, active) {
  // Switching views keeps the bar where it is: the new view starts right under it instead of
  // inheriting whatever scroll offset the old, taller or shorter, view had.
  const tab = (id, label, go) => el('button', { type: 'button', class: 'subtab' + (active === id ? ' active' : ''), onclick: () => { go(); document.querySelector('.quote-bar')?.scrollIntoView({ block: 'start' }); } }, [label]);
  const doc = (mode) => () => { commitDraftIfFilled(q); invMode = mode; open(q.id, 'invoice'); };
  return el('div', { class: 'subtabs quote-tabs no-print' }, [
    tab('sheet', 'Worksheet', () => { setSheetMode('sheet'); open(q.id, 'edit'); }),
    tab('lines', 'Line editor', () => { setSheetMode('lines'); open(q.id, 'edit'); }),
    tab('client', 'Client quote', doc('client')),
    tab('work', 'Work order', doc('work')),
    tab('labels', 'Stickers', doc('labels')),
  ]);
}

// Which fields of a line sit together in the line editor; anything not listed (a custom
// list added in Lists) lands under "What it is".
const EDITOR_GROUPS = [
  ['Where', ['location', 'wdNumber', 'qty']],
  ['Size', ['width', 'widthFrac', 'height', 'heightFrac']],
  ['What it is', ['table', 'customText', 'customPrice', 'forLines', 'product', 'fabric', 'color']],
  ['Build', ['system', 'control', 'style', 'headrail', 'bottomRail', 'mount', 'fabricPrice', 'fabricWidth', 'lining', 'reverse', 'fascia', 'cassette', 'sideChannel']],
  ['Charges', ['motorPrice', 'installation', 'brackets', 'markup', 'discount']],
  ['Notes', ['notes']],
];
const editorSel = new Map(); // "quote|section" -> index of the line being edited, or 'new'

// One open-section memory per quote for this session: a section the user just asked for
// exists even before it has a line, so there is somewhere to type the first one.
const openedSections = new Map();

function sheet(q, rerender) {
  const s = getState();
  const tables = s.tables;
  delete q._draft;
  q._drafts = q._drafts || {};
  const allCols = columns(s, tables, s.categories, s.customLists);
  const tableNames = Object.keys(tables);
  const isGrid = (n) => tables[n].kind !== 'formula';
  const groupsOf = (pred) => s.categories
    .map((cat) => ({ label: cat, names: tableNames.filter((n) => tables[n].category === cat && pred(n)) }))
    .filter((g) => g.names.length);
  const firstGrid = tableNames.find(isGrid);

  // Every section a quote can have. Shades share one (same fields); each drapery table has
  // its own because Sheer, Cornice and Grommet Panel genuinely ask different questions.
  const allSections = [
    { key: 'shades', family: 'shade', defaultTable: firstGrid, tag: 'sized from a price chart', groups: groupsOf(isGrid) },
    ...tableNames.filter((n) => !isGrid(n)).map((n) => ({
      key: 'drapery:' + n, family: 'drapery', defaultTable: n, title: 'Drapery · ' + n,
      tag: DRAPERY_STYLES[tables[n].style]?.label || 'formula priced', groups: groupsOf((x) => x === n),
    })),
    { key: 'accessory', family: 'accessory', defaultTable: ACCESSORY_TABLE, title: 'Accessories', tag: 'from your Accessories list' },
    { key: 'service', family: 'service', defaultTable: SERVICE_TABLE, title: 'Services', tag: 'saved or typed' },
  ];
  const draftOf = (sec) => q._drafts[sec.key] || (q._drafts[sec.key] = blankLine(s, sec.defaultTable));
  const colsOf = (sec) => {
    const sample = draftOf(sec);
    return allCols
      .filter((c) => c.fam.includes(sec.family) && !(c.hideWhen && c.hideWhen(sample)))
      .map((c) => (c.kind === 'tablegroup' ? { ...c, groups: sec.groups } : c))
      // Accessories and services lead with what they are.
      .sort((a, b) => (b.key === 'customText') - (a.key === 'customText'));
  };
  const titleOf = (sec) => sec.title || [...new Set(sec.groups.map((g) => g.label))].join(' & ') || 'Shades';
  const linesOf = (sec) => q.items.map((it, idx) => ({ it, idx })).filter(({ it }) => sectionKeyOf(it, tables) === sec.key);
  const isOpen = (sec) => linesOf(sec).length || openedSections.get(q.id)?.has(sec.key) || !isRowEmpty(q._drafts[sec.key] || {});
  const sections = allSections.filter((sec) => (sec.family !== 'shade' || sec.defaultTable) && isOpen(sec));

  const priceCells = []; // {getItem, node}
  const insCells = []; // {item, input} — Drapery's live "auto install" placeholder
  const secRefs = [];  // per-section subtotal nodes
  const totalsRefs = {};

  const draftsPriced = () => Object.values(q._drafts);
  const recalc = () => {
    for (const { item, input } of insCells) { input.placeholder = String(draperyAutoInstall(item, tables[item.table]) || '0'); input.title = installAutoText(item, tables[item.table]); }
    for (const p of priceCells) {
      const c = computeLine(p.item, s);
      const hasDims = p.item.width && p.item.height;
      p.node.textContent = c.unit != null ? money(c.unit) : '—';
      p.node.classList.toggle('off', !!c.listMissing);
      // Tint the cell(s) that caused a problem, so the eye lands on what to change.
      const bad = lineIssues(p.item, s, { committed: p.committed }).flatMap((i) => i.fields);
      for (const [k, td] of Object.entries(p.dims || {})) td?.classList.toggle('off-dim', bad.includes(k));
      p.td.querySelector('.offtag')?.remove();
      // The amount shown IS charged now, so the tag has to say what it is missing
      // rather than the price cell reading as a complete one.
      if (c.listMissing) p.td.append(el('span', { class: 'offtag', title: `This size is off the ${p.item.table} chart, so the shade itself is not priced — only the charges typed on this line are. Extend the chart in Price Tables.` }, ['no list']));
      // An untitled em-dash is why a row with a markup typed into it reads as a dead
      // app. Say what is missing instead of saying nothing.
      p.node.title = isSizeless(s, p.item) ? 'Priced from what is typed on this line — no size needed'
        : c.list == null && isDrapery(p.item, tables)
        ? (hasDims ? 'Type the fabric price per yard in the "Fabric $/yd" column — drapery is priced from it. Price Tables only holds the rates (fullness, labor, markup).' : 'Enter width, height and Fabric $/yd to price this drapery')
        : c.list == null
        ? (hasDims ? `Off the ${p.item.table} chart — this is the typed charges only, NOT a full price` : 'Enter width and height — charges are added on top of the list price, so there is nothing to price yet')
        : `List ${money(c.list)}`;
      p.client.textContent = c.unit == null ? '—' : money0((c.unit || 0) - (s.showInstall !== false ? (c.installation || 0) : 0));
    }
    for (const r of secRefs) {
      const lines = linesOf(r.sec);
      r.count.textContent = lines.length === 1 ? '1 line' : lines.length + ' lines';
      r.sub.textContent = money0(lines.reduce((a, { it }) => a + roundWhole(computeLine(it, s).unit || 0) * (Number(it.qty) || 1), 0));
    }
    // Subtotal reflects committed lines PLUS the rows currently being filled, so the
    // number is never a surprising $0 while a priced line sits in a draft row.
    // Mirror the client invoice: whole-dollar amounts + tax, so the worksheet matches.
    const priced = [...q.items, ...draftsPriced()].map((it) => ({ it, c: computeLine(it, s), qty: Number(it.qty) || 1 }));
    const sub = priced.reduce((a, p) => a + roundWhole(p.c.unit || 0) * p.qty, 0);
    const afterDiscount = sub - roundWhole(Number(q.discount) || 0);
    // The worksheet used to ignore the minimum order entirely, so the screen showed
    // one total and the printed invoice another for the same quote.
    const minOrder = roundWhole(Number(s.minimumOrder) || 0);
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
          const tr = priceCells.find((c) => c.item === p.it)?.node.closest('tr, .edrow');
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
    // The always-visible strip: what the job is worth right now, wherever you are scrolled.
    totalsRefs.barSub.textContent = money0(sub);
    totalsRefs.barTotal.textContent = money0(taxable + tax);
    totalsRefs.barProfit.textContent = money0(profit);
  };

  // A ROW MUST NOT CAPTURE ITS ITEM. A sync replaces q.items with fresh objects of
  // the same content, in the same order, while this sheet keeps rendering — so a row
  // that closed over its item then writes to an object the quote no longer holds.
  // Measured: after the first edit the identity breaks ~400ms later (the echo of our
  // own push), and the NEXT edit writes 555 into the orphan while q.items still says
  // 999 — the line price moves (it reads the capture), the subtotal does not (it
  // reads q.items), and the save drops the edit entirely. Resolve by position on
  // every access instead; order is preserved by the merge, and the two operations
  // that do reorder (duplicate, remove) rerender. Drafts are replaced by the same
  // merge, so a draft row resolves its section's draft the same way.
  const liveItem = (idx, sec, captured) => (sec ? q._drafts[sec.key] : q.items[idx]) || captured;

  const makeRow = (captured, cols, { sec, idx } = {}) => {
    // Falling back to `captured` (never to another line) keeps a row whose index went
    // away writing to its own dead object instead of corrupting a different line.
    const live = () => liveItem(idx, sec, captured);
    const item = live();
    // Changing the table refilters the Product/Description options, so rebuild the row.
    // Save on every keystroke, draft rows included — otherwise a refresh (or a browser
    // that never gets to "Add line") silently loses whatever was typed into them.
    const onChange = (key, val) => { live()[key] = val; save(); recalc(); if (key === 'table') rerender(); };
    // Every charge should be checkable without trusting the app: click the price and
    // it shows the arithmetic that produced it.
    const priceNode = el('strong', { class: 'price-explain', title: 'Click to see how this price is calculated' }, ['—']);
    const priceTd = el('td', { class: 'r price', onclick: () => showBreakdown(live(), getState()) }, [priceNode]);
    const clientNode = el('span', {}, ['—']);
    const clientTd = el('td', { class: 'r', style: 'color:var(--muted)' }, [clientNode]);
    priceCells.push({ committed: !sec, get item() { return live(); }, node: priceNode, td: priceTd, client: clientNode });
    const cells = cols.map((col) => cell(col, item, onChange, { q, rerender }));
    const insInput = cells[cols.findIndex((c) => c.key === 'installation')]?.querySelector('input[data-live-ins-placeholder]');
    if (insInput) insCells.push({ get item() { return live(); }, input: insInput });
    const dimCell = (key) => cells[cols.findIndex((c) => c.key === key)];
    priceCells[priceCells.length - 1].dims = { width: dimCell('width'), height: dimCell('height'), fabricPrice: dimCell('fabricPrice') };
    cells.push(priceTd);
    cells.push(clientTd);
    if (sec) {
      cells.push(el('td', { style: 'white-space:nowrap' }, [
        iconButton('check', 'Add this line', 'ok', () => addLine(sec)),
        iconButton('undo', 'Clear this row', '', async () => { if (isRowEmpty(live()) || await confirmAction('Clear this row? What you typed in it will be lost.', 'Clear row')) { q._drafts[sec.key] = blankLine(s, sec.defaultTable); save(); rerender(); } }),
      ]));
      const tr = el('tr', { class: 'draftrow' }, cells);
      // Enter anywhere in the draft row commits it.
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); addLine(sec); } });
      return tr;
    }
    cells.push(el('td', { class: 'rowact', style: 'white-space:nowrap' }, [
      iconButton('copy', 'Duplicate this line', '', () => { q.items.splice(idx + 1, 0, { ...live(), id: undefined }); save(); rerender(); }),
      iconButton('trash', 'Delete this line', 'danger', async () => { if (await confirmAction('Delete this line from the quote?', 'Delete line')) { q.items.splice(idx, 1); save(); rerender(); } }),
    ]));
    return el('tr', {}, cells);
  };

  const addLine = (sec) => {
    const d = q._drafts[sec.key] || draftOf(sec);
    if (['accessory', 'service'].includes(sec.family)) { if (!hasSizelessContent(d)) return toast('Pick or type an item, and a price'); }
    else if (!d.width || !d.height) return toast('Enter width and height');
    q.items.push({ ...d });
    q._drafts[sec.key] = blankLine(s, sec.defaultTable);
    save();
    rerender();
    focusDraft(sec.key);
  };
  const focusDraft = (key) => setTimeout(() => document.querySelector(`[data-sec="${CSS.escape(key)}"] :is(tr.draftrow, .ed-panel) input:not([type=checkbox])`)?.focus(), 40);

  const openSection = (key) => {
    if (!openedSections.has(q.id)) openedSections.set(q.id, new Set());
    openedSections.get(q.id).add(key);
    rerender();
    focusDraft(key);
  };

  const sectionEl = (sec) => {
    const cols = colsOf(sec);
    const head = el('tr', {}, [
      ...cols.map((c) => el('th', { style: `min-width:${c.w}px`, title: COL_HELP[c.key] || '' }, [c.label])),
      el('th', { class: 'r', title: 'Internal full price for ONE unit (with installation, cents).' }, ['Unit $']),
      el('th', { class: 'r', title: 'What the client sees per unit on the invoice — rounded, with installation shown as its own line.' }, ['Client $']),
      el('th', {}, ['']),
    ]);
    const body = [...linesOf(sec).map(({ it, idx }) => makeRow(it, cols, { idx })), makeRow(draftOf(sec), cols, { sec })];
    const count = el('span', { class: 'sub' }, ['']);
    const sub = el('strong', { class: 'sec-sub' }, ['']);
    secRefs.push({ sec, count, sub });
    return el('section', { class: 'fam', 'data-sec': sec.key }, [
      el('header', {}, [el('h4', {}, [titleOf(sec)]), count, el('span', { class: 'grow' }, []), el('span', { class: 'tag' }, [`${cols.length} fields · ${sec.tag}`]), sub]),
      el('div', { class: 'sheet-wrap' }, [el('table', { class: 'sheet' }, [el('thead', {}, [head]), el('tbody', {}, body)])]),
    ]);
  };

  // ---- line editor: a short list of lines, and every field of the chosen one stacked beside it
  const lineSummary = (l) => {
    const family = familyOf(l, tables);
    const main = l.location || (family === 'accessory' || family === 'service' ? '' : '—');
    const what = describeLine(l, { ...s.docConfig.client, table: false }, false, false, s) || (['accessory', 'service'].includes(family) ? '' : l.table);
    const size = l.width && l.height ? `${l.width} × ${l.height}` : '';
    return { main: main || what || 'New line', what: main ? what : '', size };
  };

  const editorEl = (sec, cols, target) => {
    const live = () => (target.draft ? q._drafts[sec.key] : q.items[target.idx]) || {};
    const item = live();
    const onChange = (key, val) => { live()[key] = val; save(); recalc(); if (key === 'table') rerender(); };
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    const placed = new Set(EDITOR_GROUPS.flatMap(([, keys]) => keys));
    let groups = EDITOR_GROUPS.map(([title, keys]) => [title, keys.filter((k) => byKey[k])]);
    // Accessories and services are about WHAT they are first; where they go comes after.
    if (['accessory', 'service'].includes(sec.family)) groups = [...groups.filter(([t]) => t === 'What it is'), ...groups.filter(([t]) => t !== 'What it is')];
    const extra = cols.filter((c) => !placed.has(c.key)).map((c) => c.key);
    const whatIs = groups.find(([t]) => t === 'What it is');
    whatIs[1] = [...whatIs[1], ...extra];
    const field = (col) => {
      const td = cell(col, item, onChange, { q, rerender });
      if (col.kind === 'check') {
        const box = td.querySelector('input');
        return el('label', { class: 'field check', style: 'flex-direction:row;align-items:center;gap:8px' }, [box, col.label]);
      }
      return el('label', { class: 'field' }, [col.label, ...td.childNodes]);
    };
    const body = groups.filter(([, keys]) => keys.length).map(([title, keys]) => {
      const checks = keys.filter((k) => byKey[k].kind === 'check');
      const rest = keys.filter((k) => byKey[k].kind !== 'check');
      return el('div', { class: 'ed-group' }, [
        el('div', { class: 'ed-title' }, [title]),
        el('div', { class: 'ed-grid' }, rest.map((k) => field(byKey[k]))),
        checks.length ? el('div', { class: 'ed-checks' }, checks.map((k) => field(byKey[k]))) : null,
      ]);
    });
    const priceNode = el('strong', { class: 'price-explain', title: 'Click to see how this price is calculated' }, ['—']);
    const priceTd = el('span', { onclick: () => showBreakdown(live(), getState()) }, [priceNode]);
    priceCells.push({ committed: !target.draft, get item() { return live(); }, node: priceNode, td: priceTd, client: el('span', {}, []), dims: {} });
    const key = q.id + '|' + sec.key;
    const head = target.draft
      ? [el('h4', {}, ['New ' + titleOf(sec).toLowerCase().replace(/^drapery · /, '') + ' line'])]
      : [el('h4', {}, ['Edit line · ' + lineSummary(live()).main]), el('span', { class: 'grow' }, []),
        iconButton('copy', 'Duplicate this line', '', () => { q.items.splice(target.idx + 1, 0, { ...live(), id: undefined }); save(); editorSel.set(key, target.idx + 1); rerender(); }),
        iconButton('trash', 'Delete this line', 'danger', async () => { if (await confirmAction('Delete this line from the quote?', 'Delete line')) { q.items.splice(target.idx, 1); save(); editorSel.set(key, null); rerender(); } })];
    // The action sits where the form ends: that is where the eye and the cursor are when it is filled.
    const action = target.draft
      ? el('button', { class: 'btn primary', type: 'button', onclick: () => addLine(sec) }, ['Add line'])
      : el('button', { class: 'btn', type: 'button', onclick: () => { editorSel.set(key, 'new'); rerender(); } }, ['Done']);
    const box = el('div', { class: 'ed-panel' }, [
      el('div', { class: 'ed-head' }, head),
      el('div', { class: 'ed-body' }, body),
      el('div', { class: 'ed-foot' }, [el('span', { class: 'ed-price' }, [el('span', { class: 'muted' }, ['Price per unit ']), priceTd]), action]),
    ]);
    if (target.draft) box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.defaultPrevented && e.target.tagName === 'INPUT') { e.preventDefault(); addLine(sec); } });
    return box;
  };

  const listSectionEl = (sec) => {
    const cols = colsOf(sec);
    const key = q.id + '|' + sec.key;
    const lines = linesOf(sec);
    // The editor on the right shows the chosen line, or a blank one for the next line to add.
    let sel = editorSel.get(key);
    if (sel === undefined || (typeof sel === 'number' && !q.items[sel])) sel = 'new';
    // Picking an existing line opens it without stealing the cursor; only a new line takes focus.
    const pick = (target) => { editorSel.set(key, target); rerender(); if (target === 'new') focusEditor(sec.key); };
    const rows = lines.map(({ it, idx }) => {
      const sm = lineSummary(it);
      const priceNode = el('strong', {}, ['—']);
      const priceTd = el('div', { class: 'edprice' }, [priceNode]);
      priceCells.push({ committed: true, get item() { return q.items[idx] || it; }, node: priceNode, td: priceTd, client: el('span', {}, []), dims: {} });
      const row = el('div', { class: 'edrow' + (sel === idx ? ' active' : ''), tabindex: 0, role: 'button', 'aria-pressed': String(sel === idx), onclick: () => pick(idx) }, [
        el('div', { class: 'edmain' }, [el('b', {}, [(Number(it.qty) > 1 ? it.qty + ' × ' : '') + sm.main]), sm.what ? el('span', {}, [sm.what]) : null, sm.size ? el('small', {}, [sm.size]) : null]),
        priceTd,
      ]);
      row.addEventListener('keydown', (e) => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(idx); } });
      return row;
    });
    const addRow = el('div', { class: 'edrow edadd' + (sel === 'new' ? ' active' : ''), tabindex: 0, role: 'button', 'aria-pressed': String(sel === 'new'), onclick: () => pick('new') }, [el('div', { class: 'edmain' }, [el('b', {}, ['+ New line'])])]);
    addRow.addEventListener('keydown', (e) => { if (e.target === addRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick('new'); } });
    const count = el('span', { class: 'sub' }, ['']);
    const sub = el('strong', { class: 'sec-sub' }, ['']);
    secRefs.push({ sec, count, sub });
    return el('section', { class: 'fam', 'data-sec': sec.key }, [
      el('header', {}, [el('h4', {}, [titleOf(sec)]), count, el('span', { class: 'grow' }, []), el('span', { class: 'tag' }, [`${cols.length} fields · ${sec.tag}`]), sub]),
      el('div', { class: 'ed-wrap' }, [el('div', { class: 'ed-list' }, [...rows, addRow]), sel === 'new' ? editorEl(sec, cols, { draft: true }) : editorEl(sec, cols, { idx: sel })]),
    ]);
  };
  const focusEditor = (key) => setTimeout(() => document.querySelector(`[data-sec="${CSS.escape(key)}"] .ed-panel input:not([type=checkbox])`)?.focus(), 40);

  // The one place to start anything: a menu of every kind of line the quote can hold.
  const addMenu = (anchor) => {
    const item = (label, hint, key) => el('div', { class: 'dd-opt', role: 'option', onclick: () => { closePopover(); openSection(key); } }, [
      el('span', { class: 'dd-label' }, [label]), hint ? el('em', {}, [hint]) : null,
    ]);
    const list = el('div', { class: 'dd-list', style: 'max-height:min(460px, calc(100vh - 140px))' }, [
      ...(firstGrid ? [item('Shade', groupsOf(isGrid).map((g) => g.label).join(', '), 'shades')] : []),
      item('Accessory', 'remote, charger, hub', 'accessory'),
      item('Service', 'service call, repair…', 'service'),
      ...(allSections.some((x) => x.family === 'drapery') ? [el('div', { class: 'dd-group' }, ['Drapery'])] : []),
      ...allSections.filter((x) => x.family === 'drapery').map((x) => item(x.defaultTable, '', x.key)),
    ]);
    popover(anchor, list);
  };

  const t = quoteTotals(q, s);
  totalsRefs.sub = el('span', {}, [money(t.subtotal)]);
  totalsRefs.total = el('span', {}, [money(t.total)]);
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
  totalsRefs.barSub = el('strong', {}, ['—']);
  totalsRefs.barTotal = el('strong', {}, ['—']);
  totalsRefs.barProfit = el('strong', {}, ['—']);
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
  ]);
  const profitBox = el('div', { class: 'profit-box' }, [
    el('div', { class: 'pb-head' }, ['Internal · not shown to client']),
    el('div', { class: 'line' }, [el('span', {}, ['Revenue (taxable)']), totalsRefs.revenue]),
    el('div', { class: 'line sub' }, [el('span', {}, ['Material']), totalsRefs.material]),
    el('div', { class: 'line sub' }, [el('span', {}, ['Labor / install']), totalsRefs.labor]),
    el('div', { class: 'line sub' }, [el('span', {}, ['Accessories']), totalsRefs.acc]),
    el('div', { class: 'line profit' }, [el('span', {}, ['Est. profit ', totalsRefs.margin]), totalsRefs.profit]),
  ]);
  // The numbers belong to the quote like any section does, so they get a card of their own.
  const summary = el('section', { class: 'fam summary' }, [
    el('header', {}, [el('h4', {}, ['Summary'])]),
    el('div', { class: 'sum-body' }, [totals, profitBox]),
  ]);

  const addBtn = el('button', { class: 'btn primary', type: 'button' }, labeled('plus', 'Add to quote'));
  addBtn.onclick = () => addMenu(addBtn);
  const body = sections.length
    ? sections.map(sheetMode() === 'sheet' ? sectionEl : listSectionEl)
    : [el('div', { class: 'empty-sheet' }, [el('p', {}, ['Nothing here yet. Start with the kind of line you want to add.']), ...['shades', 'accessory', 'service'].filter((k) => k !== 'shades' || firstGrid).map((k) => el('button', { class: 'btn', type: 'button', onclick: () => openSection(k) }, [({ shades: 'Shade', accessory: 'Accessory', service: 'Service' })[k]]))])];

  recalc();

  return el('div', { class: 'panel' }, [
    el('div', { class: 'section-head' }, [
      el('h3', { style: 'margin:0' }, [sheetMode() === 'sheet' ? 'Worksheet' : 'Line editor']),
      el('span', { class: 'hint' }, [sheetMode() === 'sheet' ? 'Each kind of line has its own section with only the fields that belong to it · scroll sideways inside a section.' : 'Pick a line to edit all of its fields, or start a new one.']),
      addBtn,
    ]),
    ...body,
    summary,
    el('div', { class: 'sumbar' }, [
      el('span', {}, ['Subtotal ', totalsRefs.barSub]),
      el('span', {}, ['Total ', totalsRefs.barTotal]),
      el('span', { class: 'sumbar-profit' }, ['Est. profit ', totalsRefs.barProfit]),
    ]),
  ]);
}

/* ---------------- printable documents (Client quote + Work order) ---------------- */
let woSeparate = false; // several product types ticked: one order each instead of one merged order
let woSel = null; // product types ticked on the work order; null = all of them
let invMode = 'client'; // 'client' = prices, no dimensions · 'work' = specs + dimensions, no prices

const sizeText = (l) => {
  if (isSizeless(getState(), l) && !l.width && !l.height) return '—';
  const f = (v, fr) => `${v ?? ''}${fr && FRACTION_LABEL[fr] ? ' ' + FRACTION_LABEL[fr] : ''}`;
  return `${f(l.width, l.widthFrac)} × ${f(l.height, l.heightFrac)}`;
};

// The work order is what the shop orders from its supplier: shades and the parts that
// come with them. Labour (services) and one-off charges are never ordered from anyone.
const orderable = (l) => l.table !== SERVICE_TABLE && l.table !== CUSTOM_TABLE;

// Plain-text version of the document — pasteable into WhatsApp / email.
function docText(q, s, isWork) {
  const cfg = isWork ? s.docConfig.work : s.docConfig.client;
  const t = quoteTotals(q, s);
  const rows = (isWork ? q.items.filter(orderable) : q.items).map((l, i) => {
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

// The printable documents, shown inline under the quote's view bar.
function docView(q) {
  const s = getState();
  const co = s.company;
  const t = quoteTotals(q, s);
  const isWork = invMode === 'work';

  if (invMode === 'labels') return labelsView(q, s);

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

  return el('div', {}, [makerBar, el('div', { class: 'panel invoice-panel' }, docs)]);
}

// DYMO 30252 stickers (1⅛" × 3½"), one per shade, for the LabelWriter 550.
function labelsView(q, s) {
  // Control's hand side is always printed next to the size (dl-size below) — leaving it
  // in the description too would print it twice on the same sticker.
  const cfg = { ...s.docConfig.label, control: false };
  // One sticker per shade. This mapped over lines, so a line of six produced a
  // single label and five shades went out unlabelled.
  const perShade = q.items.filter((l) => !isOtherLine(l)).flatMap((l) => {
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
// Documents group lines by kind, in the order a customer thinks of them. Headings only
// appear when more than one kind is present, so a shades-only quote reads exactly as before.
const DOC_GROUPS = [['shade', 'Shades'], ['drapery', 'Drapery'], ['accessory', 'Accessories'], ['service', 'Services']];
function groupedRows(items, tables, span, rowFor) {
  const groups = DOC_GROUPS
    .map(([family, label]) => ({ label, lines: items.filter((l) => familyOf(l, tables) === family) }))
    .filter((g) => g.lines.length);
  let n = 0;
  return groups.flatMap((g) => [
    groups.length > 1 ? el('tr', { class: 'grp' }, [el('td', { colspan: span }, [g.label.toUpperCase()])]) : null,
    ...g.lines.map((l) => rowFor(l, n++)),
  ]);
}

// Which shades or drapes an accessory goes with, by room.
const forNames = (q, l) => q.items.filter((x) => (l.forLines || []).includes(x.id) && x.id !== l.id).map((x) => x.location || x.table);

// "Bundle accessories" folds each linked accessory into the shades it goes with, so the
// document shows one line per window. Whole dollars, split equally across the shades it
// is linked to (the first gets any odd dollar), so the rows still add up to the total.
function bundling(q, s, showInstall, { singleOnly = false } = {}) {
  const hidden = new Set(), extra = new Map(), added = new Map();
  const targets = (a) => q.items.filter((x) => (a.forLines || []).includes(x.id) && ['shade', 'drapery'].includes(familyOf(x, s.tables)));
  for (const a of q.items) {
    if (familyOf(a, s.tables) !== 'accessory') continue;
    const t = targets(a);
    // On an order to the supplier, a part shared by several shades must stay one line with
    // its real quantity — repeating it under each shade reads as one per shade.
    if (!t.length || (singleOnly && t.length > 1)) continue;
    const c = computeLine(a, s), qty = Number(a.qty) || 1;
    const amount = roundWhole((c.unit || 0) - (showInstall ? (c.installation || 0) : 0)) * qty;
    hidden.add(a.id);
    t.forEach((x, i) => {
      const share = Math.floor(amount / t.length) + (i < amount % t.length ? 1 : 0);
      extra.set(x.id, (extra.get(x.id) || 0) + share);
      added.set(x.id, [...(added.get(x.id) || []), `${qty > 1 ? qty + '× ' : ''}${a.customText || 'accessory'}`]);
    });
  }
  return { hidden, extra, added };
}

function clientTable(q, s) {
  const cfg = s.docConfig.client;
  const showInstall = s.showInstall !== false;
  const bundle = cfg.bundleAccessories === true ? bundling(q, s, showInstall) : { hidden: new Set(), extra: new Map(), added: new Map() };
  const rows = groupedRows(q.items.filter((l) => !bundle.hidden.has(l.id)), s.tables, 5, (l) => {
    const c = computeLine(l, s);
    const qty = Number(l.qty) || 1;
    const shownUnit = (c.unit || 0) - (showInstall ? (c.installation || 0) : 0);
    const extra = bundle.extra.get(l.id) || 0;
    const lineTotal = roundWhole(shownUnit) * qty + extra;
    const unitText = extra && lineTotal % qty ? money(lineTotal / qty) : money0(lineTotal / qty);
    // An off-chart line used to print $0 / $0 — a client-facing invoice offering a
    // shade for free, with nothing on the page saying it was unpriced.
    // A line with no size at all still cannot be priced; one that is merely off the
    // chart now carries its typed charges, and those are in the totals below, so the
    // page has to print them or the column would not add up to the Total.
    const unpriced = c.unit == null;
    const names = familyOf(l, s.tables) === 'accessory' ? forNames(q, l) : [];
    const desc = [describeLine(l, cfg, false, false, s) + (names.length ? ` (for ${names.join(', ')})` : ''), ...(bundle.added.get(l.id) || []).map((t) => '+ ' + t)].filter(Boolean).join(', ');
    return el('tr', { class: unpriced ? 'unpriced' : '' }, [
      el('td', { class: 'num' }, [String(qty)]),
      el('td', { class: 'strong' }, [l.location]),
      el('td', { class: 'desc' }, [desc]),
      el('td', { class: 'num' }, [unpriced ? 'TBD' : unitText]),
      el('td', { class: 'num strong' }, [unpriced ? 'TBD' : money0(lineTotal)]),
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
  items = items.filter(orderable);
  const cfg = s.docConfig.work;
  // Qty was missing entirely: a line reading "Living room x 6" printed as one row
  // with no quantity, and the shop built one shade.
  const cols = ['#', 'Qty', 'Location', 'Size (W×H)', 'Description', 'Notes'];
  const bundle = cfg.bundleAccessories === true ? bundling(q, s, true, { singleOnly: true }) : { hidden: new Set(), added: new Map() };
  const rows = groupedRows(items.filter((l) => !bundle.hidden.has(l.id)), s.tables, cols.length, (l, i) => {
    const names = familyOf(l, s.tables) === 'accessory' ? forNames(q, l) : [];
    const desc = [describeLine(l, cfg, true, false, s) + (names.length ? ` (for ${names.join(', ')})` : ''), ...(bundle.added.get(l.id) || []).map((t) => '+ ' + t)].filter(Boolean).join(', ');
    return el('tr', {}, [
      el('td', { class: 'num' }, [String(i + 1)]),
      el('td', { class: 'num strong' }, [String(Number(l.qty) || 1)]),
      el('td', { class: 'strong' }, [l.location]),
      el('td', { class: 'strong' }, [sizeText(l)]),
      el('td', { class: 'desc' }, [desc]),
      el('td', { class: 'desc' }, [l.notes || '']),
    ]);
  });
  return el('table', { class: 'items' }, [
    el('thead', {}, [el('tr', { class: 'print-gap' }, [el('td', { colspan: cols.length })]), el('tr', {}, cols.map((h, i) => el('th', { class: i === 0 ? 'num' : '' }, [h])))]),
    el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: cols.length, class: 'muted', style: 'text-align:center;padding:24px' }, ['No items'])])]),
    el('tfoot', {}, [el('tr', { class: 'print-gap' }, [el('td', { colspan: cols.length })])]),
  ]);
}
