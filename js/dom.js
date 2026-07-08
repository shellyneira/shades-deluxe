// Tiny DOM helpers — keep the views readable without a framework.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// Labeled <select>. options: array of strings. Returns the wrapping <label>.
export function select(labelText, options, value, onChange, extraClass = '') {
  const sel = el('select', { onchange: (e) => onChange(e.target.value) });
  for (const opt of options) {
    const o = el('option', { value: opt }, [String(opt)]);
    if (String(opt) === String(value)) o.selected = true;
    sel.append(o);
  }
  return el('label', { class: 'field ' + extraClass }, [labelText, sel]);
}

export function input(labelText, value, onChange, opts = {}) {
  const inp = el('input', {
    type: opts.type || 'text',
    value: value ?? '',
    placeholder: opts.placeholder || '',
    oninput: (e) => onChange(opts.type === 'number' ? e.target.value : e.target.value),
  });
  if (opts.step) inp.step = opts.step;
  if (opts.width) inp.style.width = opts.width;
  return el('label', { class: 'field ' + (opts.class || '') }, [labelText, inp]);
}

export function checkbox(labelText, checked, onChange) {
  const box = el('input', { type: 'checkbox', onchange: (e) => onChange(e.target.checked) });
  box.checked = !!checked;
  return el('label', { class: 'field check' }, [box, labelText]);
}

// Guard for irreversible actions (delete / overwrite). Returns true if confirmed.
export function confirmAction(message) {
  return window.confirm(message);
}

export function mount(node) {
  const app = document.getElementById('app');
  app.replaceChildren(node);
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

export const FRACTION_LABEL = {
  0: '—', 0.125: '1/8', 0.25: '1/4', 0.375: '3/8',
  0.5: '1/2', 0.625: '5/8', 0.75: '3/4', 0.875: '7/8',
};
