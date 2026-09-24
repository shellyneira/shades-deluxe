// Settings — company info, document field visibility, backup/export and reset.
import { el, mount, input, toast, confirmAction } from './dom.js';
import { getState, save, exportJSON, importJSON, resetToDefaults } from './store.js';
import { dbEnabled } from './db.js';
import { descFields, TRACK_RATE_LABELS } from './pricing.js';

// Short forms printed on documents — e.g. Control prints "C-RH" instead of the full
// Lists value, because the System field next to it already says Manual/Motor. These
// used to be hardcoded strings baked into pricing.js; a shop that writes them
// differently (or in another language) had no way to change them.
function abbreviationsPanel(s) {
  const a = s.abbrev;
  const field = (label, key, hint) => el('label', { class: 'field', style: 'flex:1 1 200px' }, [
    el('span', { style: 'display:block;min-height:28px' }, [label]),
    el('input', { type: 'text', value: a[key], oninput: (e) => { a[key] = e.target.value; save(); } }),
    el('span', { class: 'hint', style: 'font-weight:500;text-transform:none;letter-spacing:0' }, [hint]),
  ]);
  return el('div', { class: 'panel' }, [
    el('h2', {}, ['Abbreviations']),
    el('p', { class: 'muted', style: 'margin-top:0' }, ['Short forms used in printed documents. Change these instead of editing code if your shop writes them differently.']),
    el('div', { class: 'row' }, [
      field('Control — right hand', 'controlRH', 'Printed on Client Quote / Work Order when Control ends in RH.'),
      field('Control — left hand', 'controlLH', 'Printed when Control ends in LH.'),
      field('Side channels (sticker)', 'sideChannelShort', 'Short form used only on DYMO stickers — full "Side Channels" elsewhere.'),
    ]),
  ]);
}

// Drag a row to reorder — one shared order, used by every document, so dragging in
// Settings never raises "does this affect just this document?" The list itself
// comes from descFields(), which already includes any category the user has added
// from Lists — nothing here is hardcoded to a fixed field set.
function fieldOrderPanel(s) {
  const fields = descFields(s); // already sorted by s.docFieldOrder
  const order = fields.map((f) => f.key);
  const isBefore = (e, row) => e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;

  const row = (f) => {
    const r = el('div', {
      class: 'order-row', draggable: true,
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', f.key); r.classList.add('dragging'); },
      ondragend: () => r.classList.remove('dragging'),
      ondragover: (e) => { e.preventDefault(); r.classList.toggle('dragover-top', isBefore(e, r)); r.classList.toggle('dragover-bottom', !isBefore(e, r)); },
      ondragleave: () => r.classList.remove('dragover-top', 'dragover-bottom'),
      ondrop: (e) => {
        e.preventDefault();
        const draggedKey = e.dataTransfer.getData('text/plain');
        const before = isBefore(e, r);
        r.classList.remove('dragover-top', 'dragover-bottom');
        if (draggedKey === f.key) return;
        const next = order.filter((k) => k !== draggedKey);
        next.splice(next.indexOf(f.key) + (before ? 0 : 1), 0, draggedKey);
        s.docFieldOrder = next;
        save(); renderSettings();
      },
    }, [el('span', { class: 'drag-handle' }, ['⠿']), f.label]);
    return r;
  };

  return el('div', { class: 'panel' }, [
    el('h2', {}, ['Order these appear in every document']),
    el('p', { class: 'muted', style: 'margin-top:0' }, ['Drag to reorder. This is the order used everywhere a Description is printed — Client Quote, Work Order and Stickers all follow it.']),
    el('div', { class: 'order-list' }, fields.map(row)),
  ]);
}

// Three checkbox columns controlling what each document's Description includes.
function documentsPanel(s) {
  const fields = descFields(s);
  const col = (docKey, title, note) => {
    const cfg = s.docConfig[docKey];
    // Labels always print the control's hand side next to the size — the Description
    // toggle for it would just duplicate that, so it's not offered here.
    const docFields = docKey === 'label' ? fields.filter((f) => f.key !== 'control') : fields;
    const boxes = docFields.map((f) => {
      const box = el('input', { type: 'checkbox', onchange: (e) => { cfg[f.key] = e.target.checked; save(); } });
      box.checked = !!cfg[f.key];
      return el('label', { class: 'field check', style: 'margin:0' }, [box, f.label]);
    });
    return el('div', { class: 'field-subcard' }, [
      el('div', { class: 'field-subcard-head' }, [title]),
      el('p', { class: 'hint', style: 'margin:-6px 0 12px' }, [note]),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px 14px' }, boxes),
    ]);
  };
  return el('div', { class: 'panel' }, [
    el('h2', {}, ['Documents — what to show']),
    el('p', { class: 'muted', style: 'margin-top:0' }, ['Pick which details go into each document’s Description. Location, size and price are handled by their own columns. Adding a category in Lists adds it here too — nothing to wire up by hand.']),
    el('div', { class: 'field-subcard-grid' }, [
      col('client', 'Client Quote', 'Shown to the customer. No dimensions; prices shown.'),
      col('work', 'Work Order', 'For your maker. Dimensions shown; no prices.'),
      col('label', 'Stickers (DYMO)', 'Extra info line on each shade label (name, location, product, size & control are always shown).'),
    ]),
  ]);
}

// Pricing rates — the per-foot add-on charges and wholesale cost factor, all editable.
function ratesPanel(s) {
  const r = s.rates;
  const labelSpan = (text) => el('span', { style: 'display:block;min-height:28px' }, [text]);
  const num = (label, key, hint) => el('label', { class: 'field', style: 'flex:1 1 200px' }, [
    labelSpan(label),
    el('input', { type: 'number', min: '0', step: '0.01', value: r[key], oninput: (e) => { r[key] = Number(e.target.value) || 0; save(); } }),
    el('span', { class: 'hint', style: 'font-weight:500;text-transform:none;letter-spacing:0' }, [hint]),
  ]);
  const minOrder = el('label', { class: 'field', style: 'flex:1 1 200px' }, [
    labelSpan('Minimum order ($)'),
    el('input', { type: 'number', min: '0', step: '0.01', value: s.minimumOrder || 0, oninput: (e) => { s.minimumOrder = Number(e.target.value) || 0; save(); } }),
    el('span', { class: 'hint', style: 'font-weight:500;text-transform:none;letter-spacing:0' }, ['If a quote total is below this, it is raised to this amount. 0 = off.']),
  ]);
  const defInstall = el('label', { class: 'field', style: 'flex:1 1 200px' }, [
    labelSpan('Default installation / labor ($)'),
    el('input', { type: 'number', min: '0', step: '0.01', value: s.defaultInstallation || 0, oninput: (e) => { s.defaultInstallation = Number(e.target.value) || 0; save(); } }),
    el('span', { class: 'hint', style: 'font-weight:500;text-transform:none;letter-spacing:0' }, ['Pre-fills the “Ins” column on each new line. Change it on the line anytime.']),
  ]);
  return el('div', { class: 'panel' }, [
    el('h2', {}, ['Rates & minimums']),
    el('p', { class: 'muted', style: 'margin-top:0' }, ['Fascia, cassette and side channels are charged per foot (from the All Blinds price list). Change a rate here and every quote recalculates.']),
    el('div', { class: 'row' }, [
      num('Fascia — $ / foot of width', 'fascia', 'Fascia cost = width ÷ 12 × this rate.'),
      num('Cassette — $ / foot of width', 'cassette', 'Cassette cost = width ÷ 12 × this rate.'),
      num('Side channel — $ / foot (each side)', 'sideChannel', 'Side channels = height ÷ 12 × this rate × 2 sides.'),
      num('Wholesale cost factor', 'costFactor', 'Your material cost ≈ list price × this (All Blinds = 0.43). Used for profit on the dashboard.'),
      minOrder,
      defInstall,
      (() => {
        const tax = el('label', { class: 'field', style: 'flex:1 1 200px' }, [
          labelSpan('Sales tax (%)'),
          el('input', { type: 'number', min: '0', step: '0.001', value: s.taxRate ?? 0, oninput: (e) => { s.taxRate = Number(e.target.value) || 0; save(); } }),
          el('span', { class: 'hint', style: 'font-weight:500;text-transform:none;letter-spacing:0' }, ['Added on the client invoice. FL = 7. 0 = no tax.']),
        ]);
        return tax;
      })(),
      (() => {
        const box = el('input', { type: 'checkbox', onchange: (e) => { s.showInstall = e.target.checked; save(); } });
        box.checked = s.showInstall !== false;
        return el('label', { class: 'field', style: 'flex:1 1 200px' }, [labelSpan('Installation on invoice'), el('label', { class: 'field check', style: 'margin-top:6px' }, [box, 'Show installation as its own line (client invoice)'])]);
      })(),
    ]),
    el('h3', { style: 'margin:20px 0 4px' }, ['Drapery track']),
    el('p', { class: 'muted', style: 'margin:0 0 10px' }, ['Same Motorized/Manual track hardware regardless of drapery style, so it lives here once instead of on every style.']),
    el('div', { class: 'row' }, [
      num(TRACK_RATE_LABELS.trackMotorPerFoot, 'trackMotorPerFoot', 'Cost = width ÷ 12 × this rate.'),
      num(TRACK_RATE_LABELS.trackMotorMarkupPct, 'trackMotorMarkupPct', 'Sell price = cost × (1 + this ÷ 100).'),
      num(TRACK_RATE_LABELS.trackManualPerFoot, 'trackManualPerFoot', 'Cost = width ÷ 12 × this rate.'),
      num(TRACK_RATE_LABELS.trackManualMarkupPct, 'trackManualMarkupPct', 'Sell price = cost × (1 + this ÷ 100).'),
    ]),
  ]);
}

export function renderSettings() {
  const s = getState();
  const co = s.company;
  const set = (k) => (v) => { co[k] = v; save(); };

  const terms = el('textarea', {
    rows: 4, style: 'width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font:inherit',
    oninput: (e) => { co.terms = e.target.value; save(); },
  });
  terms.value = co.terms;

  const fileInput = el('input', {
    type: 'file', accept: 'application/json', style: 'display:none', onchange: (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirmAction('Restore this backup? It replaces ALL current data (tables, lists, quotes) and cannot be undone.')) { e.target.value = ''; return; }
      const r = new FileReader();
      r.onload = () => { try { importJSON(r.result); toast('Backup restored'); renderSettings(); } catch { toast('Invalid file'); } };
      r.readAsText(f);
    }
  });

  const downloadBackup = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'shades-deluxe-backup.json' });
    document.body.append(a); a.click(); a.remove();
    toast('Backup downloaded');
  };

  mount(el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', {}, ['Company (shown on invoices)']),
      el('div', { class: 'row' }, [
        input('Company name', co.name, set('name'), { class: 'grow' }),
        input('Phone', co.phone, set('phone'), { class: 'grow' }),
        input('Email', co.email, set('email'), { class: 'grow' }),
      ]),
      el('div', { class: 'row' }, [input('Address', co.address, set('address'), { class: 'grow' })]),
      el('label', { class: 'field', style: 'margin-top:14px' }, ['Payment & terms', terms]),
    ]),
    ratesPanel(s),
    abbreviationsPanel(s),
    fieldOrderPanel(s),
    documentsPanel(s),
    el('div', { class: 'panel' }, [
      el('h2', {}, ['Backup & data']),
      dbEnabled()
        ? el('p', { class: 'muted' }, ['✅ Connected to the cloud — everything saves to your Supabase database automatically and syncs across devices. Backups are optional; keep one if you like an extra copy.'])
        : el('p', { class: 'muted' }, ['Everything is stored in this browser. Download a backup regularly, and use it to move data to another computer. (Connect Supabase to sync automatically and stop needing manual backups.)']),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', onclick: downloadBackup }, ['⬇ Download backup']),
        el('button', { class: 'btn', onclick: () => fileInput.click() }, ['⬆ Restore backup']),
        fileInput,
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', style: 'color:var(--danger)', onclick: () => { if (confirm('Reset all tables, lists and quotes to the original spreadsheet values? This cannot be undone.')) { resetToDefaults(); toast('Reset done'); renderSettings(); } } }, ['Reset to defaults']),
      ]),
    ]),
  ]));
}
