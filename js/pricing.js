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

const FALLBACK_RATES = { fascia: 4.5, cassette: 4.5, sideChannel: 4.5, costFactor: 0.43 };

// Fields whose selected option can carry a flat add-on price (Lists editor). Product,
// fabric, color, location, w/d and control are NOT here: their cost comes from the
// price tables (product/fabric) or they're plain labels.
const PRICED_FIELDS = [
  ['system', 'systems'], ['style', 'styles'],
  ['headrail', 'headrails'], ['bottomRail', 'headrails'],
];

function optionPrice(state, listKey, name) {
  if (!name) return 0;
  const found = (state.options[listKey] || []).find((o) => o && o.name === name);
  return found ? Number(found.price) || 0 : 0;
}

function optionExtras(line, state) {
  return PRICED_FIELDS.reduce((sum, [field, key]) => sum + optionPrice(state, key, line[field]), 0);
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

// Drapery pricing (ported from "Calculo de tela y precios.xlsx") — every number here
// is a formula of a few real inputs (width, height, fabric $/yd, lining, fullness),
// unlike Roller/Zebra's opaque per-width×height list price. So instead of baking a
// static grid (which would mean a separate frozen grid per lining option per style,
// going stale the moment a labor rate changes), each style is a small set of named
// rate constants (editable in Price Tables) plus a shared compute function. Table
// rows created with `kind: 'formula'` and a `style` key use this path in computeLine
// below instead of the width×length grid lookup.
//
// Two bugs fixed from the original sheet: the two "Precio 2.5" cells (Cornice
// 13"-24" and Swag & Jabot) multiplied the already-2x tier by 2.5 (=5x) instead of
// the base cost by 2.5. Also, the sheet computed "with lining" labor but never
// actually used it in the total — here the Lining field on the worksheet line
// genuinely selects which labor rate applies. markupPct below is a plain editable
// per-style number (Price Tables) — margin is a per-product decision, unlike Track
// hardware (Settings → Rates), which costs the same regardless of which style it's
// attached to. Defaults reflect the business's own re-check, not the original sheet.
export const DRAPERY_STYLES = {
  heavyFabric: { label: 'Heavy Fabric', hasLining: true, hasTrack: true, rates: { fullness: 3, fabricWidth: 110, fabricTaxPct: 7, laborNoLining: 18, laborLining: 22, laborInterlining: 26, installPerFoot: 10, markupPct: 50 } },
  sheer: { label: 'Sheer', hasLining: false, hasTrack: true, rates: { fullness: 2.5, fabricWidth: 110, fabricTaxPct: 0, laborNoLining: 18, installPerFoot: 10, markupPct: 50 } },
  corniceSmall: { label: 'Cornice (up to 12")', hasLining: false, hasTrack: false, rates: { laborPerFoot: 20.5, markupPct: 50 } },
  corniceLarge: { label: 'Cornice (13"-24")', hasLining: false, hasTrack: false, rates: { laborPerFoot: 22, markupPct: 50 } },
  swagJabot: { label: 'Swag and Jabot', hasLining: false, hasTrack: false, rates: { laborPerFoot: 15, markupPct: 50 } },
  grommetPanel: { label: 'Grommet Panel', hasLining: true, hasTrack: false, rates: { fullness: 2.5, fabricWidth: 59, panelAllowanceIn: 8, fabricWasteFactor: 1.5, laborNoLining: 18, laborLining: 22, markupPct: 50 } },
};

export const DRAPERY_RATE_LABELS = {
  fullness: 'Fullness ratio (× width)',
  fabricWidth: 'Fabric bolt width (in)',
  fabricTaxPct: 'Fabric tax (%)',
  laborNoLining: 'Labor — no lining ($/yd)',
  laborLining: 'Labor — with lining ($/yd)',
  laborInterlining: 'Labor — lining + interlining ($/yd)',
  installPerFoot: 'Installation ($/ft of width)',
  markupPct: 'Markup added over cost (%)',
  laborPerFoot: 'Labor ($/ft of width)',
  panelAllowanceIn: 'Panel allowance (in, added to half-width)',
  fabricWasteFactor: 'Fabric waste factor (×)',
};

// Track hardware (Settings → Rates) — same physical product no matter which
// drapery style it's attached to, so it isn't duplicated per style.
export const DEFAULT_TRACK_RATES = { trackMotorPerFoot: 2.5, trackMotorMarkupPct: 30, trackManualPerFoot: 1, trackManualMarkupPct: 30 };
export const TRACK_RATE_LABELS = {
  trackMotorPerFoot: 'Motorized track cost ($/ft of width)',
  trackMotorMarkupPct: 'Motorized track markup (%)',
  trackManualPerFoot: 'Manual track cost ($/ft of width)',
  trackManualMarkupPct: 'Manual track markup (%)',
};

// Installation for Heavy Fabric/Sheer scales with width, so unlike Roller's flat
// Settings default, its "auto" value has to be computed from the line — exposed here
// so the worksheet can preview it as a placeholder before anyone overrides it.
export function draperyAutoInstall(line, table) {
  const def = DRAPERY_STYLES[table?.style];
  if (!def || (table.style !== 'heavyFabric' && table.style !== 'sheer')) return 0;
  const rates = { ...def.rates, ...(table.rates || {}) };
  return round2(((Number(line.width) || 0) / 12) * rates.installPerFoot);
}

// Heavy Fabric / Sheer: fullness × width ÷ fabric width = panels, panels × (height + 12) ÷ 36 = yards.
// `track` (global, Settings → Rates) covers the Motorized/Manual track add-on — same
// physical hardware regardless of style, so it isn't duplicated into `rates`. Installation
// auto-computes like Roller's default, but — also like Roller — a typed value overrides it.
function computePanelDrapery(line, rates, hasLining, track, table) {
  const w = Number(line.width) || 0, h = Number(line.height) || 0, price = Number(line.fabricPrice) || 0;
  if (!w || !h || !price) return null;
  const panels = Math.ceil((w * rates.fullness) / rates.fabricWidth);
  const yards = Math.ceil((panels * (h + 12)) / 36);
  const fabricCost = price * yards * (1 + (rates.fabricTaxPct || 0) / 100);
  const laborRate = hasLining
    ? (line.lining === 'Lining + Interlining' ? rates.laborInterlining : line.lining === 'Lining' ? rates.laborLining : rates.laborNoLining)
    : rates.laborNoLining;
  const labor = ((w + h) / 36) * laborRate;
  const installation = line.installation !== '' && line.installation != null ? Number(line.installation) : draperyAutoInstall(line, table);
  const base = fabricCost + labor;
  let unit = base * (1 + rates.markupPct / 100) + installation;
  let cost = base + installation;
  if (line.track === 'Motorized') { unit += w * track.trackMotorPerFoot * (1 + track.trackMotorMarkupPct / 100); cost += w * track.trackMotorPerFoot; }
  else if (line.track === 'Manual') { unit += w * track.trackManualPerFoot * (1 + track.trackManualMarkupPct / 100); cost += w * track.trackManualPerFoot; }
  return { installation, unit, cost };
}

// Cornice / Swag & Jabot: yards = (width + drop) ÷ 36, labor = width ÷ 12 × rate. No install
// formula exists for these (none in the original sheet) — Ins works like Brackets: pure
// manual entry, $0 unless typed.
function computeLinearDrapery(line, rates) {
  const w = Number(line.width) || 0, h = Number(line.height) || 0, price = Number(line.fabricPrice) || 0;
  if (!w || !h || !price) return null;
  const yards = (w + h) / 36;
  const fabricCost = price * yards;
  const labor = (w / 12) * rates.laborPerFoot;
  const installation = Number(line.installation) || 0;
  const base = fabricCost + labor;
  return { installation, unit: base * (1 + rates.markupPct / 100) + installation, cost: base + installation };
}

// Grommet Panel: its own panel-count formula (half-width + fixed allowance, per side).
function computeGrommetDrapery(line, rates) {
  const w = Number(line.width) || 0, h = Number(line.height) || 0, price = Number(line.fabricPrice) || 0;
  if (!w || !h || !price) return null;
  const panelsPerSide = ((w / 2 + rates.panelAllowanceIn) * rates.fullness) / rates.fabricWidth;
  const panels = panelsPerSide * 2;
  const yards = ((h + 12) * panels) / 36;
  const fabricCost = price * rates.fabricWasteFactor * yards;
  const laborRate = line.lining === 'Lining' ? rates.laborLining : rates.laborNoLining;
  const labor = ((w + h) / 36) * laborRate;
  const installation = Number(line.installation) || 0;
  const base = fabricCost + labor;
  return { installation, unit: base * (1 + rates.markupPct / 100) + installation, cost: base + installation };
}

function computeDraperyLine(line, table, state) {
  const def = DRAPERY_STYLES[table.style];
  if (!def) return null;
  const rates = { ...def.rates, ...(table.rates || {}) };
  if (table.style === 'heavyFabric' || table.style === 'sheer') return computePanelDrapery(line, rates, def.hasLining, { ...DEFAULT_TRACK_RATES, ...(state.rates || {}) }, table);
  if (table.style === 'grommetPanel') return computeGrommetDrapery(line, rates);
  return computeLinearDrapery(line, rates); // Cornice (both sizes), Swag & Jabot
}

export function computeLine(line, state) {
  const table = state.tables[line.table];
  if (table?.kind === 'formula') {
    const d = computeDraperyLine(line, table, state);
    const markup = Number(line.markup) || 0, motor = Number(line.motorPrice) || 0, lineDisc = Number(line.discount) || 0;
    if (!d) return { list: null, fascia: 0, cassette: 0, sideChannel: 0, installation: 0, brackets: 0, extras: 0, cost: null, unit: null };
    const unit = Math.max(0, round2(d.unit + markup + motor - lineDisc));
    return { list: unit, fascia: 0, cassette: 0, sideChannel: 0, installation: round2(d.installation), brackets: 0, extras: 0, cost: round2(d.cost), unit };
  }
  const rates = { ...FALLBACK_RATES, ...(state.rates || {}) };
  const list = lookupListPrice(table, line.width, line.widthFrac, line.height, line.heightFrac);
  // Fascia / cassette / side channel: checkbox always uses the per-foot rate (auto).
  const fascia = line.fascia ? ((Number(line.width) || 0) / 12) * rates.fascia : 0;
  const cassette = line.cassette ? ((Number(line.width) || 0) / 12) * rates.cassette : 0;
  const sideChannel = line.sideChannel ? ((Number(line.height) || 0) / 12) * rates.sideChannel * 2 : 0;
  const installation = Number(line.installation) || 0;
  const brackets = Number(line.brackets) || 0;
  const extras = optionExtras(line, state); // priced dropdown options

  const markup = Number(line.markup) || 0; // extra profit the user adds on this line
  const motor = Number(line.motorPrice) || 0; // per-line motor charge
  const lineDisc = Number(line.discount) || 0; // per-item discount
  const base = (list || 0) + fascia + cassette + sideChannel + installation + brackets + extras + markup + motor - lineDisc;
  const unit = list == null ? null : Math.max(0, base);
  // True cost = wholesale material (list × factor) + labor + accessories billed at
  // cost (conservative: no margin claimed on pass-throughs). Keeps profit honest.
  const cost = list == null ? null : round2((list || 0) * rates.costFactor + fascia + cassette + sideChannel + installation + brackets + extras);

  return { list, fascia, cassette, sideChannel, installation, brackets, extras, cost, unit: unit == null ? null : round2(unit) };
}

// Space-saving: the System field already says Manual/Motor Battery, so Control only
// needs to convey the hand side — chain vs motor is redundant on the document.
function controlText(ctrl) {
  if (!ctrl) return '';
  if (/RH/i.test(ctrl)) return 'C-RH';
  if (/LH/i.test(ctrl)) return 'C-LH';
  return '';
}

// Every field that can go into a document's Description, in display order.
// Settings → Documents lets the user toggle each per document (Client vs Work order).
export const DESC_FIELDS = [
  // Roller/Zebra: the table name (Roller #3, Zebra #5...) is an internal price-tier
  // label, not something to print — Product/Fabric already say what it is. Drapery has
  // neither of those fields, so its table name (the style, e.g. "Heavy Fabric") is the
  // only thing that says what the line even is — keep it there.
  { key: 'table', label: 'Shade type', fmt: (l, isWork, compact, tables) => (tables?.[l.table]?.kind === 'formula' ? l.table : '') },
  { key: 'product', label: 'Product', fmt: (l) => l.product },
  { key: 'fabric', label: 'Fabric', fmt: (l) => l.fabric },
  { key: 'color', label: 'Color', fmt: (l) => l.color },
  // System/Track share the worksheet's merged column, so they sit together here too,
  // ahead of Control — matches that column's position (left of Ctrl) on the worksheet.
  { key: 'system', label: 'System', fmt: (l) => (l.system ? l.system.replace('Batt.', 'Battery') : '') },
  { key: 'track', label: 'Track', fmt: (l) => (l.track ? l.track + ' Track' : '') },
  { key: 'control', label: 'Control', fmt: (l) => controlText(l.control) },
  { key: 'style', label: 'Style', fmt: (l) => l.style },
  { key: 'headrail', label: 'Headrail', fmt: (l) => (l.headrail ? 'Headrail: ' + l.headrail : '') },
  { key: 'bottomRail', label: 'Bottom rail', fmt: (l) => (l.bottomRail ? 'Bottom: ' + l.bottomRail : '') },
  { key: 'reverse', label: 'Reverse roll', fmt: (l) => (l.reverse ? 'Reverse Roll' : '') },
  { key: 'fascia', label: 'Fascia', fmt: (l) => (l.fascia ? 'with Fascia' : '') },
  { key: 'cassette', label: 'Cassette', fmt: (l) => (l.cassette ? 'with Cassette' : '') },
  // `compact` is only set for DYMO labels — the sticker is tiny, so this one gets an
  // abbreviation there while Client Quote/Work Order keep the full word.
  { key: 'sideChannel', label: 'Side channels', fmt: (l, isWork, compact) => (l.sideChannel ? (compact ? 'with S/CH' : 'with Side Channels') : '') },
  // Wall vs. ceiling mount only matters to the maker — the client quote just says "with Brackets".
  { key: 'brackets', label: 'Brackets', fmt: (l, isWork) => ((Number(l.brackets) || 0) > 0 ? `with Brackets${isWork ? ' - ' + (l.mount === 'Wall' ? 'WALL' : 'CEILING') : ''}` : '') },
  { key: 'lining', label: 'Lining', fmt: (l) => l.lining || '' },
];

export function describeLine(line, cfg, isWork, compact, tables) {
  return DESC_FIELDS
    .filter((f) => !cfg || cfg[f.key])
    .map((f) => f.fmt(line, isWork, compact, tables))
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

// Whole-dollar money for client-facing amounts (no cents).
export const roundWhole = (n) => Math.round(Number(n) || 0);
export function money0(n) {
  return '$' + roundWhole(n).toLocaleString('en-US');
}

export function money(n) {
  return '$' + round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
