// Small pure helpers shared across the app.
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const p2 = (n) => String(n).padStart(2, '0');

const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const keyStart = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); };

const pct = (t, tMin, tMax) => Math.max(0, Math.min(100, ((t - tMin) / (tMax - tMin)) * 100));

function fmt(ts, span) {
  const d = new Date(ts);
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (span > 2 * 24 * 3600e3) return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${hm}`;
  return hm;
}

function dur(msVal) {
  const m = Math.round(msVal / 60000);
  if (m < 1) return `${Math.round(msVal / 1000)}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${p2(m % 60)}m`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Make a string safe to sit inside a double-quoted HTML attribute while keeping
// any inline markup (e.g. <br>, <b>) intact — used for the data-tip explanations,
// which are rendered back as innerHTML by showTip(). Only " and & need escaping;
// '<' is legal inside an attribute value.
function attrTip(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Turn a model id into a short label: claude-opus-4-8 → "Opus 4.8", claude-opus-5
// → "Opus 5", claude-haiku-4-5-20251001 → "Haiku 4.5". Unknown shapes degrade
// gracefully (prefix + date suffix stripped, dashes shown as spaces).
function prettyModel(id) {
  if (!id) return '';
  const clean = String(id).replace(/^claude-/, '').replace(/-\d{6,}$/, '');
  const m = clean.match(/^([a-z]+)-([\d-]+)$/i);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2].replace(/-/g, '.');
  return clean.replace(/-/g, ' ');
}
