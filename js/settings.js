// Settings — company info on invoices, plus backup (export/import) and reset.
import { el, mount, input, toast } from './dom.js';
import { getState, save, exportJSON, importJSON, resetToDefaults } from './store.js';

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
    el('div', { class: 'panel' }, [
      el('h2', {}, ['Backup & data']),
      el('p', { class: 'muted' }, ['Everything is stored in this browser. Download a backup regularly, and use it to move data to another computer.']),
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
