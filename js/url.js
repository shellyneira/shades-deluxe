// Real-path URLs on a static host. BASE is the folder the app is served from
// (/shades-deluxe/ on GitHub Pages, / locally), set by the <base> tag in index.html.
export const BASE = new URL(document.baseURI).pathname;

const safeDecode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };

// '/shades-deluxe/quotes/q_1/invoice' -> ['quotes', 'q_1', 'invoice']
export const pathSegments = () => location.pathname.slice(BASE.length).split('/').filter(Boolean).map(safeDecode);
export const pathFor = (segments) => BASE + segments.map(encodeURIComponent).join('/');
