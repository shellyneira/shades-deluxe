// Bootstrap + tab router.
import { renderQuotes } from './quotes.js';
import { renderTables } from './tables.js';
import { renderLists } from './lists.js';
import { renderSettings } from './settings.js';

const VIEWS = {
  quotes: renderQuotes,
  tables: renderTables,
  lists: renderLists,
  settings: renderSettings,
};

function go(view) {
  if (!VIEWS[view]) view = 'quotes';
  location.hash = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  VIEWS[view]();
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.view)));
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

go(location.hash.slice(1) || 'quotes');
