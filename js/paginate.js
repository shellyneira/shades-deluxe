// Page-by-page layout of a printable document (Client Quote / Work Order).
//
// The browser's own pagination is what used to decide where a printout broke, and the
// on-screen sheet knew nothing about it — so the preview showed one tall page while the
// printer produced two. Here the app decides: the document is measured once, split into
// US Letter pages, and those very pages are what the screen shows AND what gets printed.
// What you see is, by construction, what comes out.
//
// A document is a header, then one or more sections (each an optional `.sec-title` and a
// `table.items`), then an optional summary and terms. A section that runs onto the next
// page gets its title ("continued") and column headings again.

const PAGE_H = 1056;       // 11 in at 96 dpi
const BOTTOM_SAFE = 44;    // content never runs into the bottom edge of a page
const FIT_SLACK = 4;       // measured and final layouts may differ by a rounding error

export function paginate(inv) {
  const scroll = inv.querySelector(':scope > .inv-scroll');
  const tables = scroll ? [...scroll.querySelectorAll('table.items')] : [];
  if (!tables.length || !inv.isConnected) return [inv];

  const top = inv.getBoundingClientRect().top;
  const yTop = (n) => n.getBoundingClientRect().top - top;
  const yBottom = (n) => n.getBoundingClientRect().bottom - top;
  const padTop = parseFloat(getComputedStyle(inv).paddingTop) || 0;
  const children = [...inv.children];
  const before = children.slice(0, children.indexOf(scroll));
  const sum = children.find((c) => c.classList.contains('sum'));
  const terms = children.find((c) => c.classList.contains('terms'));

  const sections = tables.map((t) => {
    const prev = t.previousElementSibling;
    const title = prev?.classList.contains('sec-title') ? prev : null;
    const headRows = [...t.querySelectorAll('thead > tr')].filter((r) => !r.classList.contains('print-gap'));
    return {
      table: t, title, headRows,
      rows: [...t.querySelectorAll('tbody > tr')],
      widths: [...t.querySelectorAll('thead > tr:not(.print-gap) > th')].map((th) => th.getBoundingClientRect().width),
      width: t.getBoundingClientRect().width,
      headH: headRows.reduce((a, r) => a + r.getBoundingClientRect().height, 0),
      titleH: title ? title.getBoundingClientRect().height : 0,
    };
  }).filter((s) => s.rows.length);
  if (!sections.length) return [inv];

  const capacity = PAGE_H - BOTTOM_SAFE - FIT_SLACK;

  // Every row is a unit, and a section's first row carries its title and headings with it,
  // so a title is never left alone at the bottom of a page. A unit's height is measured
  // from the bottom of the one before it, which keeps the gaps between sections.
  const first = sections[0].title || sections[0].table;
  let prev = yTop(first);
  const firstTop = prev;
  const units = [];
  sections.forEach((s, si) => s.rows.forEach((r, ri) => {
    const bottom = yBottom(r);
    units.push({ si, row: r, h: bottom - prev, startsSection: ri === 0 });
    prev = bottom;
  }));
  const afterTable = prev;
  const sumH = sum ? yBottom(sum) - afterTable : 0;
  const termsH = terms ? yBottom(terms) - (sum ? yBottom(sum) : afterTable) : 0;

  const newPage = (isFirst) => ({ first: isFirst, segs: [], sum: false, terms: false });
  const pages = [];
  let page = newPage(true);
  let used = firstTop;
  const breakPage = (start) => { pages.push(page); page = newPage(false); used = start; };
  for (const u of units) {
    const s = sections[u.si];
    if (used + u.h > capacity && page.segs.length) {
      breakPage(u.startsSection ? padTop : padTop + s.titleH + s.headH);
    }
    let seg = page.segs.at(-1);
    if (!seg || seg.si !== u.si) { seg = { si: u.si, rows: [], cont: !u.startsSection }; page.segs.push(seg); }
    seg.rows.push(u.row);
    used += u.h;
  }
  if (sum) {
    if (used + sumH > capacity) breakPage(padTop);
    page.sum = true; used += sumH;
  }
  if (terms) {
    if (used + termsH > capacity) breakPage(padTop);
    page.terms = true; used += termsH;
  }
  pages.push(page);

  const clone = (n) => n.cloneNode(true);
  const total = pages.length;
  const built = pages.map((p, i) => {
    const el = inv.cloneNode(false);
    el.classList.add('page');
    if (p.first) before.forEach((b) => el.append(clone(b)));
    if (p.segs.length) {
      const wrap = document.createElement('div');
      wrap.className = scroll.className;
      p.segs.forEach((seg) => {
        const s = sections[seg.si];
        if (s.title) {
          const t = clone(s.title);
          if (seg.cont) { const c = document.createElement('span'); c.className = 'sec-cont'; c.textContent = ' (continued)'; t.firstElementChild?.append(c); }
          wrap.append(t);
        }
        const t = document.createElement('table');
        t.className = s.table.className;
        t.style.tableLayout = 'fixed';
        t.style.width = s.width + 'px';
        const cg = document.createElement('colgroup');
        s.widths.forEach((w) => { const c = document.createElement('col'); c.style.width = w + 'px'; cg.append(c); });
        const thead = document.createElement('thead');
        s.headRows.forEach((r) => thead.append(clone(r)));
        const tbody = document.createElement('tbody');
        seg.rows.forEach((r) => tbody.append(clone(r)));
        t.append(cg, thead, tbody);
        wrap.append(t);
      });
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
