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

// Each language formats amounts with its own separators: en-US writes 1,234.50, es-CO 1.234,50.
const NUMBER_LOCALE: Record<'en' | 'es', string> = { en: 'en-US', es: 'es-CO' };

/** `<code> <amount>` with thousands separators: 0 decimals for COP, 2 otherwise. A null amount is
 * unknown, not zero, so it prints as an em dash; a null currency prints the amount with 2 decimals.
 * `locale` picks only the separators; the currency code is never translated. */
export function formatMoney(amount: number | null, currency: string | null, locale: 'en' | 'es' = 'en'): string {
  if (amount === null) return '—';
  const decimals = currency === 'COP' ? 0 : 2;
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to this module's own two keys, not user input
  const formatted = amount.toLocaleString(NUMBER_LOCALE[locale], { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === null ? formatted : `${currency} ${formatted}`;
}
