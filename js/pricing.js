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

const FASCIA_RATE = 4.5;

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
  const list = lookupListPrice(table, line.width, line.widthFrac, line.height, line.heightFrac);
  const fascia = line.fascia ? ((Number(line.width) || 0) / 12) * FASCIA_RATE : 0;
  const sideChannel = line.sideChannel ? ((Number(line.height) || 0) / 12) * FASCIA_RATE * 2 : 0;
  const installation = Number(line.installation) || 0;
  const brackets = Number(line.brackets) || 0;

  const base = (list || 0) + fascia + sideChannel + installation + brackets;
  const floor = Number(state.minPrice[line.table]) || 0;
  const unit = list == null ? null : Math.max(base, floor);

  return { list, fascia, sideChannel, installation, brackets, unit: unit == null ? null : round2(unit) };
}

// Customer-facing description — mirrors the Invoice sheet's TEXTJOIN.
// Installation is labor baked into the price, so it is intentionally not described.
export function describeLine(line) {
  const parts = [line.fabric || line.product || ''];
  const ctrl = line.control || '';
  if (ctrl) {
    let c;
    if (ctrl.startsWith('C')) c = 'Chain Control';
    else if (/M/i.test(ctrl)) c = 'Motor Control';
    else c = ctrl;
    if (/LH/i.test(ctrl)) c += ' - Left Hand';
    else if (/RH/i.test(ctrl)) c += ' - Right Hand';
    parts.push(c);
  }
  if (line.system) parts.push(line.system.replace('Batt.', 'Battery'));
  if (line.style) parts.push(line.style);
  if (line.bottomRail) parts.push('with ' + line.bottomRail);
  if (line.fascia) parts.push('with Fascia');
  if (line.sideChannel) parts.push('with Side Channels');
  if ((Number(line.brackets) || 0) > 0) parts.push('with Extra Brackets');
  return parts.filter(Boolean).join(', ');
}

export function quoteTotals(quote, state) {
  const subtotal = quote.items.reduce((s, it) => s + (computeLine(it, state).unit || 0), 0);
  const discount = Number(quote.discount) || 0;
  return { subtotal: round2(subtotal), discount, total: round2(subtotal - discount) };
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function money(n) {
  return '$' + round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
