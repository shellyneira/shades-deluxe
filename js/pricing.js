// Pricing engine — a faithful port of the workbook's lookup + accessory math.
//
// Workbook logic (Hoja 1):
//   effective size  = dimension + 1 when the fraction is over 1/2, else the dimension
//   L/Price (Q)     = grid cell at the first column width >= eff. width
//                     and the first row length >= eff. height  (MINIFS + INDEX/MATCH)
//   Fascia   (T)    = width  / 12 * 4.5           when enabled
//   Side Ch. (V)    = height / 12 * 4.5 * 2       when enabled
//   Client price(AB)= L/Price + Fascia + SideCh + Installation + Brackets
//
// One judgment call beyond the sheet: each table carries a minimum price
// (Values!O/P: 300/400/550/600). It is applied as a floor on the unit price
// and is editable per-table in the Price Tables screen (set 0 to disable).

const FALLBACK_RATES = { fascia: 4.5, sideChannel: 4.5, costFactor: 0.43 };

// Fields whose selected option can carry a flat add-on price (Lists editor). Product,
// fabric, color, location, w/d and control are NOT here: their cost comes from the
// price tables (product/fabric) or they're plain labels.
const PRICED_FIELDS = [
  ['system', 'systems'], ['style', 'styles'],
  ['headrail', 'headrails'], ['bottomRail', 'headrails'],
];

function optionPrice(state, listKey, name, table) {
  if (!name) return 0;
  let arr = state.options[listKey];
  if (listKey === 'products' || listKey === 'fabrics') arr = arr?.[/zebra/i.test(table || '') ? 'zebra' : 'roller'];
  const found = (arr || []).find((o) => o && o.name === name);
  return found ? Number(found.price) || 0 : 0;
}

function optionExtras(line, state) {
  return PRICED_FIELDS.reduce((sum, [field, key]) => sum + optionPrice(state, key, line[field], line.table), 0);
}

export function effectiveDim(inches, fraction) {
  const n = Number(inches) || 0;
  return (Number(fraction) || 0) > 0.5 ? n + 1 : n;
}

// First value in an ascending list that is >= target. -1 if the size is off the chart.
function firstAtLeast(list, target) {
  for (let i = 0; i < list.length; i++) if (Number(list[i]) >= target) return i;
  return -1;
}

export function lookupListPrice(table, width, widthFrac, height, heightFrac) {
  if (!table) return null;
  const w = effectiveDim(width, widthFrac);
  const h = effectiveDim(height, heightFrac);
  if (!w || !h) return null;
  const col = firstAtLeast(table.widths, w);
  const rowIdx = firstAtLeast(table.rows.map((r) => r.length), h);
  if (col === -1 || rowIdx === -1) return null;
  const price = table.rows[rowIdx].prices[col];
  return typeof price === 'number' ? price : null;
}

export function computeLine(line, state) {
  const table = state.tables[line.table];
  const rates = { ...FALLBACK_RATES, ...(state.rates || {}) };
  const list = lookupListPrice(table, line.width, line.widthFrac, line.height, line.heightFrac);
  // Fascia / side channel: a typed amount wins (manual); otherwise the checkbox uses the
  // per-foot rate (auto). This gives "click for auto, or type your own price".
  const fasciaOverride = line.fasciaAmount !== '' && line.fasciaAmount != null ? Number(line.fasciaAmount) : null;
  const scOverride = line.sideChannelAmount !== '' && line.sideChannelAmount != null ? Number(line.sideChannelAmount) : null;
  const fascia = fasciaOverride != null ? fasciaOverride : (line.fascia ? ((Number(line.width) || 0) / 12) * rates.fascia : 0);
  const sideChannel = scOverride != null ? scOverride : (line.sideChannel ? ((Number(line.height) || 0) / 12) * rates.sideChannel * 2 : 0);
  const installation = Number(line.installation) || 0;
  const brackets = Number(line.brackets) || 0;
  const extras = optionExtras(line, state); // priced dropdown options

  const markup = Number(line.markup) || 0; // extra profit the user adds on this line
  const base = (list || 0) + fascia + sideChannel + installation + brackets + extras + markup;
  const unit = list == null ? null : base;
  // True cost = wholesale material (list × factor) + labor + accessories billed at
  // cost (conservative: no margin claimed on pass-throughs). Keeps profit honest.
  const cost = list == null ? null : round2((list || 0) * rates.costFactor + fascia + sideChannel + installation + brackets + extras);

  return { list, fascia, sideChannel, installation, brackets, extras, cost, unit: unit == null ? null : round2(unit) };
}

function controlText(ctrl) {
  if (!ctrl) return '';
  let c = ctrl.startsWith('C') ? 'Chain Control' : /M/i.test(ctrl) ? 'Motor Control' : ctrl;
  if (/LH/i.test(ctrl)) c += ' - Left Hand';
  else if (/RH/i.test(ctrl)) c += ' - Right Hand';
  return c;
}

// Every field that can go into a document's Description, in display order.
// Settings → Documents lets the user toggle each per document (Client vs Work order).
export const DESC_FIELDS = [
  { key: 'table', label: 'Shade type', fmt: (l) => l.table },
  { key: 'product', label: 'Product', fmt: (l) => l.product },
  { key: 'fabric', label: 'Fabric', fmt: (l) => l.fabric },
  { key: 'color', label: 'Color', fmt: (l) => l.color },
  { key: 'control', label: 'Control', fmt: (l) => controlText(l.control) },
  { key: 'system', label: 'System', fmt: (l) => (l.system ? l.system.replace('Batt.', 'Battery') : '') },
  { key: 'style', label: 'Style', fmt: (l) => l.style },
  { key: 'headrail', label: 'Headrail', fmt: (l) => (l.headrail ? 'Headrail: ' + l.headrail : '') },
  { key: 'bottomRail', label: 'Bottom rail', fmt: (l) => (l.bottomRail ? 'Bottom: ' + l.bottomRail : '') },
  { key: 'fascia', label: 'Fascia', fmt: (l) => (l.fascia ? 'with Fascia' : '') },
  { key: 'sideChannel', label: 'Side channels', fmt: (l) => (l.sideChannel ? 'with Side Channels' : '') },
  { key: 'brackets', label: 'Extra brackets', fmt: (l) => ((Number(l.brackets) || 0) > 0 ? 'with Extra Brackets' : '') },
];

export function describeLine(line, cfg) {
  return DESC_FIELDS
    .filter((f) => !cfg || cfg[f.key])
    .map((f) => f.fmt(line))
    .filter(Boolean)
    .join(', ');
}

export function quoteTotals(quote, state) {
  const subtotal = quote.items.reduce((s, it) => s + (computeLine(it, state).unit || 0) * (Number(it.qty) || 1), 0);
  const discount = Number(quote.discount) || 0;
  const minOrder = Number(state.minimumOrder) || 0;
  let total = subtotal - discount;
  const minApplied = quote.items.length > 0 && minOrder > 0 && total < minOrder;
  if (minApplied) total = minOrder;
  return { subtotal: round2(subtotal), discount, minOrder, minApplied, total: round2(total) };
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function money(n) {
  return '$' + round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
