// Settings — company info, document field visibility, backup/export and reset.
import { el, mount, input, toast, confirmAction } from './dom.js';
import { getState, save, exportJSON, importJSON, resetToDefaults } from './store.js';
import { dbEnabled } from './db.js';
import { DESC_FIELDS } from './pricing.js';

// Two checkbox columns controlling what each document's Description includes.
function documentsPanel(s) {
  const col = (docKey, title, note) => {
    const cfg = s.docConfig[docKey];
    const boxes = DESC_FIELDS.map((f) => {
      const box = el('input', { type: 'checkbox', onchange: (e) => { cfg[f.key] = e.target.checked; save(); } });
      box.checked = !!cfg[f.key];
      return el('label', { class: 'field check', style: 'margin:0' }, [box, f.label]);
    });
    return el('div', { class: 'list-group' }, [
      el('div', { class: 'list-group-head', style: 'color:var(--ink)' }, [title]),
      el('p', { class: 'hint', style: 'margin:-6px 0 12px' }, [note]),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px 14px' }, boxes),
    ]);
  };
  return el('div', { class: 'panel' }, [
    el('h2', {}, ['Documents — what to show']),
    el('p', { class: 'muted', style: 'margin-top:0' }, ['Pick which details go into each document’s Description. Location, size and price are handled by their own columns.']),
    el('div', { class: 'list-split' }, [
      col('client', 'Client Quote', 'Shown to the customer. No dimensions; prices shown.'),
      col('work', 'Work Order', 'For your maker. Dimensions shown; no prices.'),
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

  const fileInput = el('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirmAction('Restore this backup? It replaces ALL current data (tables, lists, quotes) and cannot be undone.')) { e.target.value = ''; return; }
    const r = new FileReader();
    r.onload = () => { try { importJSON(r.result); toast('Backup restored'); renderSettings(); } catch { toast('Invalid file'); } };
    r.readAsText(f);
  } });

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
