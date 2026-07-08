// Quotes: list -> estimator worksheet (internal, with dimensions) -> invoice (customer, no dimensions).
import { el, select, input, checkbox, mount, toast, FRACTION_LABEL } from './dom.js';
import { getState, save, newQuote, getQuote, deleteQuote } from './store.js';
import { computeLine, describeLine, quoteTotals, money } from './pricing.js';

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
const STATUSES = ['draft', 'sent', 'won', 'lost'];
let filter = 'all';

function list() {
  const s = getState();
  const head = el('div', { class: 'section-head' }, [
    el('div', {}, [el('h2', {}, ['Quotes & Orders']), el('div', { class: 'hint' }, [s.quotes.length + ' total'])]),
    el('button', { class: 'btn primary', onclick: () => open(newQuote().id) }, ['＋ New Quote']),
  ]);

  const filters = el('div', { class: 'subtabs' }, ['all', ...STATUSES].map((f) =>
    el('button', { class: 'subtab' + (f === filter ? ' active' : ''), onclick: () => { filter = f; renderQuotes(); } },
      [f[0].toUpperCase() + f.slice(1)])));

  const shown = s.quotes.filter((q) => filter === 'all' || (q.status || 'draft') === filter);
  const body = shown.length
    ? el('div', { class: 'cards' }, shown.map((q) => {
        const t = quoteTotals(q, s);
        const st = q.status || 'draft';
        return el('div', { class: 'card', onclick: () => open(q.id) }, [
          el('div', { class: 'status' }, [el('span', { class: 'badge ' + st }, [st])]),
          el('div', { class: 'muted' }, ['#' + q.number + ' · ' + (q.date || '')]),
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
      el('button', { class: 'btn', onclick: () => open(q.id, 'invoice') }, ['View Invoice']),
      el('button', { class: 'btn', onclick: () => { deleteQuote(q.id); sub = { view: 'list' }; renderQuotes(); toast('Quote deleted'); } }, ['Delete']),
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
      select('Status', STATUSES, q.status || 'draft', (v) => set(() => (q.status = v))),
    ]),
  ]);

  // Only the form + items table are data-driven, so rebuild just those on change.
  const dynamic = el('div', {});
  const reRender = () => dynamic.replaceChildren(lineForm(q, reRender), itemsTable(q, s, reRender));
  reRender();
  return el('div', {}, [toolbar, client, dynamic]);
}

function blankLine(s) {
  return {
    table: Object.keys(s.tables)[0], location: '', wdNumber: '',
    width: '', widthFrac: 0, height: '', heightFrac: 0,
    product: '', fabric: '', color: '', control: '', system: '', style: '',
    headrail: '', bottomRail: '', fascia: false, sideChannel: false, installation: '', brackets: '',
  };
}

function lineForm(q, rerender) {
  const s = getState();
  const draft = q._draft || (q._draft = blankLine(s));
  const o = s.options;
  const fracOpts = [0, ...o.fractions];
  const fracVals = fracOpts.map((f) => FRACTION_LABEL[f] || f);
  const bind = (k) => (v) => (draft[k] = v);
  const fracSelect = (label, key) =>
    select(label, fracVals, FRACTION_LABEL[draft[key]] ?? '—', (v) => {
      draft[key] = fracOpts[fracVals.indexOf(v)];
    }, '');

  const preview = el('span', { class: 'pill' }, ['—']);
  const refreshPreview = () => {
    const c = computeLine(draft, s);
    preview.textContent = c.unit == null ? 'size off chart' : 'Unit: ' + money(c.unit);
  };

  const rows = el('div', {}, [
    el('div', { class: 'row' }, [
      select('Table', Object.keys(s.tables), draft.table, bind('table')),
      select('Location', ['', ...o.locations], draft.location, bind('location'), 'grow'),
      select('W/D #', ['', ...o.wdNumbers], draft.wdNumber, bind('wdNumber')),
    ]),
    el('div', { class: 'row' }, [
      el('div', { class: 'dim' }, [input('Width', draft.width, bind('width'), { type: 'number' }), fracSelect(' ', 'widthFrac')]),
      el('div', { class: 'dim' }, [input('Height', draft.height, bind('height'), { type: 'number' }), fracSelect(' ', 'heightFrac')]),
      select('Product', ['', ...o.products], draft.product, bind('product'), 'grow'),
    ]),
    el('div', { class: 'row' }, [
      select('Fabric / Description', ['', ...o.fabrics], draft.fabric, bind('fabric'), 'grow'),
      select('Color', ['', ...o.colors], draft.color, bind('color'), 'grow'),
      select('Control', ['', ...o.controls], draft.control, bind('control')),
    ]),
    el('div', { class: 'row' }, [
      select('System', ['', ...o.systems], draft.system, bind('system')),
      select('Style', ['', ...o.styles], draft.style, bind('style')),
      select('Headrail', ['', ...o.headrails], draft.headrail, bind('headrail')),
      select('Bottom rail', ['', ...o.headrails], draft.bottomRail, bind('bottomRail')),
    ]),
    el('div', { class: 'row' }, [
      checkbox('Fascia', draft.fascia, bind('fascia')),
      checkbox('Side channel', draft.sideChannel, bind('sideChannel')),
      input('Installation $', draft.installation, bind('installation'), { type: 'number' }),
      input('Brackets $', draft.brackets, bind('brackets'), { type: 'number' }),
      el('div', { class: 'field check' }, [preview]),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn accent', onclick: () => {
          if (!draft.width || !draft.height) return toast('Enter width and height');
          q.items.push({ ...draft });
          q._draft = blankLine(s);
          save();
          rerender();
        },
      }, ['+ Add line']),
    ]),
  ]);

  rows.addEventListener('input', refreshPreview);
  rows.addEventListener('change', refreshPreview);
  refreshPreview();

  return el('div', { class: 'panel' }, [el('h3', {}, ['Add window / shade']), rows]);
}

function itemsTable(q, s, rerender) {
  if (!q.items.length) return el('div', { class: 'panel' }, [el('div', { class: 'empty' }, ['No lines yet.'])]);
  const cols = ['Table', 'Location', 'W/D', 'Size', 'Product', 'Fabric', 'Color', 'List', 'Fascia', 'S/Ch', 'Inst', 'Bra', 'Unit', ''];
  const head = el('tr', {}, cols.map((c) => el('th', { class: ['List','Fascia','S/Ch','Inst','Bra','Unit'].includes(c) ? 'num' : '' }, [c])));
  const size = (l) => `${l.width}${FRACTION_LABEL[l.widthFrac] && l.widthFrac ? ' ' + FRACTION_LABEL[l.widthFrac] : ''} × ${l.height}${FRACTION_LABEL[l.heightFrac] && l.heightFrac ? ' ' + FRACTION_LABEL[l.heightFrac] : ''}`;

  const body = q.items.map((l, i) => {
    const c = computeLine(l, s);
    return el('tr', {}, [
      el('td', {}, [el('span', { class: 'pill' }, [l.table])]),
      el('td', {}, [l.location]), el('td', {}, [l.wdNumber]), el('td', {}, [size(l)]),
      el('td', {}, [l.product]), el('td', {}, [l.fabric]), el('td', {}, [l.color]),
      el('td', { class: 'num' }, [c.list == null ? '⚠︎' : money(c.list)]),
      el('td', { class: 'num' }, [c.fascia ? money(c.fascia) : '—']),
      el('td', { class: 'num' }, [c.sideChannel ? money(c.sideChannel) : '—']),
      el('td', { class: 'num' }, [c.installation ? money(c.installation) : '—']),
      el('td', { class: 'num' }, [c.brackets ? money(c.brackets) : '—']),
      el('td', { class: 'num' }, [el('strong', {}, [c.unit == null ? '—' : money(c.unit)])]),
      el('td', {}, [el('button', { class: 'icon', title: 'Remove', onclick: () => { q.items.splice(i, 1); save(); rerender(); } }, ['✕'])]),
    ]);
  });

  const t = quoteTotals(q, s);
  const totals = el('div', { class: 'totals' }, [
    el('div', { class: 'line' }, [el('span', {}, ['Subtotal']), el('span', {}, [money(t.subtotal)])]),
    el('div', { class: 'line' }, [
      el('span', {}, ['Discount']),
      (() => { const i = input('', q.discount, (v) => { q.discount = Number(v) || 0; save(); rerender(); }, { type: 'number', width: '120px' }); i.style.margin = '0'; return i; })(),
    ]),
    el('div', { class: 'line grand' }, [el('span', {}, ['Total']), el('span', {}, [money(t.total)])]),
  ]);

  return el('div', { class: 'panel' }, [
    el('h3', {}, ['Lines (internal worksheet)']),
    el('div', { class: 'scroll' }, [el('table', { class: 'data' }, [el('thead', {}, [head]), el('tbody', {}, body)])]),
    totals,
  ]);
}

/* ---------------- customer invoice (no dimensions) ---------------- */
function invoice(q) {
  const s = getState();
  const co = s.company;
  const t = quoteTotals(q, s);

  const toolbar = el('div', { class: 'section-head no-print' }, [
    el('button', { class: 'btn ghost', onclick: () => open(q.id, 'edit') }, ['← Back to worksheet']),
    el('button', { class: 'btn primary', onclick: () => window.print() }, ['🖨 Print / Save PDF']),
  ]);

  const items = q.items.map((l) => {
    const c = computeLine(l, s);
    return el('tr', {}, [
      el('td', { class: 'num' }, ['1']),
      el('td', {}, [l.location]),
      el('td', {}, [l.product]),
      el('td', {}, [describeLine(l)]),
      el('td', {}, [l.color]),
      el('td', { class: 'num' }, [money(c.unit || 0)]),
      el('td', { class: 'num' }, [money(c.unit || 0)]),
    ]);
  });

  const doc = el('div', { class: 'invoice' }, [
    el('div', { class: 'head' }, [
      el('div', {}, [
        el('div', { class: 'co-name' }, [co.name]),
        el('div', { class: 'co-meta' }, [co.address]),
        el('div', { class: 'co-meta' }, [co.phone + ' · ' + co.email]),
      ]),
      el('div', { class: 'doc-title' }, [
        el('div', { class: 't' }, ['QUOTE']),
        el('div', { class: 'co-meta' }, ['#' + q.number]),
        el('div', { class: 'co-meta' }, ['Date: ' + (q.date || '')]),
        q.installDate ? el('div', { class: 'co-meta' }, ['Install: ' + q.installDate]) : null,
      ]),
    ]),
    el('div', { class: 'parties' }, [
      el('div', {}, [el('h4', {}, ['Sold To']), el('div', {}, [q.client.name || '—']), el('div', {}, [q.client.address || '']), el('div', {}, [q.client.phone || '']), el('div', {}, [q.client.email || ''])]),
    ]),
    el('table', { class: 'items' }, [
      el('thead', {}, [el('tr', {}, ['Qty', 'Location', 'Product', 'Description', 'Color', 'Unit Price', 'Total'].map((h, i) =>
        el('th', { class: i >= 5 || i === 0 ? 'num' : '' }, [h])))]),
      el('tbody', {}, items.length ? items : [el('tr', {}, [el('td', { colspan: 7, class: 'muted' }, ['No items'])])]),
    ]),
    el('div', { class: 'totals' }, [
      el('div', { class: 'line' }, [el('span', {}, ['Subtotal']), el('span', {}, [money(t.subtotal)])]),
      t.discount ? el('div', { class: 'line' }, [el('span', {}, ['Discount']), el('span', {}, ['−' + money(t.discount)])]) : null,
      el('div', { class: 'line grand' }, [el('span', {}, ['Total']), el('span', {}, [money(t.total)])]),
    ]),
    el('div', { class: 'terms' }, [co.terms]),
  ]);

  return el('div', {}, [toolbar, el('div', { class: 'panel' }, [doc])]);
}
