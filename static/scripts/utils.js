// Escape API text before HTML interpolation; keep formatting consistent across pages.
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const text = (value, fallback) => value == null || value === '' ? fallback : String(value);
const productTitle = item => item.item_title
  ? String(item.item_title).replace(/(^|[\s-])\p{L}/gu, value => value.toUpperCase())
  : item.parent_asin;
const trim = (value, length) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const words = (value, limit) => String(value).split(/\s+/).slice(0, limit).join(' ');
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export {escapeHTML, text, productTitle, trim, words, number};
