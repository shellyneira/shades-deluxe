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

/* ---- element paths ----
   The index of an element among its ancestors' element-children, from #app down
   ("3.1.0.2"). Two people looking at the same screen build the same DOM from the
   same state, so the path of a field is the same string on both machines — which is
   what lets one screen point at "the box the other person is typing in" without
   every input having to be given an id. It is also how focus survives a re-render. */
export function nodePath(node, root = document.getElementById('app')) {
  const parts = [];
  let n = node;
  while (n && n !== root) {
    const parent = n.parentElement;
    if (!parent) return null;
    parts.unshift([...parent.children].indexOf(n));
    n = parent;
  }
  return n === root ? parts.join('.') : null;
}

export function nodeAtPath(path, root = document.getElementById('app')) {
  if (path == null || path === '') return null;
  let n = root;
  for (const i of String(path).split('.')) {
    n = n?.children?.[Number(i)];
    if (!n) return null;
  }
  return n;
}

const afterMount = [];
export function onAfterMount(fn) { afterMount.push(fn); }

// A field the local user is typing in must survive a re-render caused by someone
// else's edit — otherwise every keystroke of theirs would kick the caret out of this
// user's box. Same path, same caret, same scroll.
// Scroll positions live on the elements themselves, so replaceChildren throws them
// away. The worksheet scrolls sideways, and losing that on someone else's unrelated
// edit yanks the sheet back to the first column mid-keystroke — the caret ends up
// off-screen and the row appears to lurch left and right. Every scrolled container
// is recorded by path and put back, not just the window.
function captureScroll(root) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.scrollLeft || c.scrollTop) out.push({ path: nodePath(c, root), left: c.scrollLeft, top: c.scrollTop });
      walk(c);
    }
  };
  walk(root);
  return out;
}

function restoreScroll(root, list) {
  for (const s of list) {
    const n = s.path && nodeAtPath(s.path, root);
    if (!n) continue;
    n.scrollLeft = s.left;
    n.scrollTop = s.top;
  }
}

function captureFocus(root) {
  const scroll = captureScroll(root);
  const page = { x: window.scrollX, y: window.scrollY };
  const a = document.activeElement;
  if (!a || !root.contains(a) || !/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return { scroll, page };
  const path = nodePath(a, root);
  if (!path) return { scroll, page };
  const sel = /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'number' && a.type !== 'date' && a.type !== 'checkbox';
  return { scroll, page, path, tag: a.tagName, start: sel ? a.selectionStart : null, end: sel ? a.selectionEnd : null };
}

function restoreFocus(root, f) {
  if (!f) return;
  restoreScroll(root, f.scroll);
  const n = f.path && nodeAtPath(f.path, root);
  if (n && n.tagName === f.tag) {
    n.focus({ preventScroll: true });
    if (f.start != null) { try { n.setSelectionRange(f.start, f.end); } catch { /* type has no selection */ } }
  }
  // Both axes: restoring only Y silently snapped the page back to the left edge.
  window.scrollTo(f.page.x, f.page.y);
}

export function mount(node) {
  const app = document.getElementById('app');
  const focus = captureFocus(app);
  app.replaceChildren(node);
  restoreFocus(app, focus);
  afterMount.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
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
