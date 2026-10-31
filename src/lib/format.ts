// Small formatting helpers for rendering database values into the daily summary's HTML. Pure: no
// I/O, no clock.

/** Escapes the five characters that matter in HTML text and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `<code> <amount>`, with thousands commas: 0 decimals for COP, 2 for anything else. A null
 * amount is unknown, not zero, so it prints as an em dash; a null currency still prints the
 * amount, with 2 decimals, since there's no code to pick a decimal count from. */
export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  const decimals = currency === 'COP' ? 0 : 2;
  const formatted = amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === null ? formatted : `${currency} ${formatted}`;
}
