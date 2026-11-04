// Page-by-page layout of a printable document (Client Quote / Work Order).
//
// The browser's own pagination is what used to decide where a printout broke, and the
// on-screen sheet knew nothing about it — so the preview showed one tall page while the
// printer produced two. Here the app decides: the document is measured once, split into
// US Letter pages, and those very pages are what the screen shows AND what gets printed.
// What you see is, by construction, what comes out.

const PAGE_H = 1056;       // 11 in at 96 dpi
const BOTTOM_SAFE = 44;    // content never runs into the bottom edge of a page
const FIT_SLACK = 4;       // measured and final layouts may differ by a rounding error

export function paginate(inv) {
  const scroll = inv.querySelector(':scope > .inv-scroll');
  const table = scroll?.querySelector('table.items');
  const rows = table ? [...table.querySelectorAll('tbody > tr')] : [];
  if (!table || !rows.length || !inv.isConnected) return [inv];

  const top = inv.getBoundingClientRect().top;
  const yTop = (n) => n.getBoundingClientRect().top - top;
  const yBottom = (n) => n.getBoundingClientRect().bottom - top;
  const padTop = parseFloat(getComputedStyle(inv).paddingTop) || 0;
  const children = [...inv.children];
  const before = children.slice(0, children.indexOf(scroll));
  const after = children.slice(children.indexOf(scroll) + 1).filter((c) => c.classList.contains('sum') || c.classList.contains('terms'));
  const sum = after.find((c) => c.classList.contains('sum'));
  const terms = after.find((c) => c.classList.contains('terms'));

  const headRows = [...table.querySelectorAll('thead > tr')].filter((r) => !r.classList.contains('print-gap'));
  const headRowH = headRows.reduce((a, r) => a + r.getBoundingClientRect().height, 0);
  const firstTop = yTop(rows[0]);
  const capacity = PAGE_H - BOTTOM_SAFE - FIT_SLACK;
  const contStart = padTop + headRowH;

  const units = rows.map((r) => ({ rows: [r], h: yBottom(r) - yTop(r) }));

  const afterTable = yBottom(rows.at(-1));
  const sumH = sum ? yBottom(sum) - afterTable : 0;
  const termsH = terms ? yBottom(terms) - (sum ? yBottom(sum) : afterTable) : 0;

  const pages = [];
  let page = { first: true, rows: [], sum: false, terms: false };
  let used = firstTop;
  const next = (start) => { pages.push(page); page = { first: false, rows: [], sum: false, terms: false }; used = start; };
  for (const u of units) {
    if (used + u.h > capacity && page.rows.length) next(contStart);
    page.rows.push(...u.rows);
    used += u.h;
  }
  if (sum) {
    if (used + sumH > capacity) next(padTop);
    page.sum = true; used += sumH;
  }
  if (terms) {
    if (used + termsH > capacity) next(padTop);
    page.terms = true; used += termsH;
  }
  pages.push(page);

  const colWidths = [...table.querySelectorAll('thead > tr:not(.print-gap) > th')].map((th) => th.getBoundingClientRect().width);
  const tableW = table.getBoundingClientRect().width;
  const clone = (n) => n.cloneNode(true);

  const total = pages.length;
  const built = pages.map((p, i) => {
    const el = inv.cloneNode(false);
    el.classList.add('page');
    if (p.first) before.forEach((b) => el.append(clone(b)));
    if (p.rows.length) {
      const t = document.createElement('table');
      t.className = table.className;
      t.style.tableLayout = 'fixed';
      t.style.width = tableW + 'px';
      const cg = document.createElement('colgroup');
      colWidths.forEach((w) => { const c = document.createElement('col'); c.style.width = w + 'px'; cg.append(c); });
      const thead = document.createElement('thead');
      headRows.forEach((r) => thead.append(clone(r)));
      const tbody = document.createElement('tbody');
      p.rows.forEach((r) => tbody.append(clone(r)));
      t.append(cg, thead, tbody);
      const wrap = document.createElement('div');
      wrap.className = scroll.className;
      wrap.append(t);
      el.append(wrap);
    }
    if (p.sum) el.append(clone(sum));
    if (p.terms) el.append(clone(terms));
    if (total > 1) {
      const pg = document.createElement('div');
      pg.className = 'pg';
      pg.textContent = `Page ${i + 1} of ${total}`;
      el.append(pg);
    }
    return el;
  });
  inv.replaceWith(...built);
  return built;
}
