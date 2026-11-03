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

// en-US separates thousands with ',' and the decimal with '.'; es-CO (Colombian Spanish, this
// repo's only Spanish locale) does the reverse, '.' for thousands and ',' for the decimal -
// global-constraints.md's "COP prices formatted with the locale's own separators".
const NUMBER_LOCALE: Record<'en' | 'es', string> = { en: 'en-US', es: 'es-CO' };

/** `<code> <amount>`, with thousands separators: 0 decimals for COP, 2 for anything else. A null
 * amount is unknown, not zero, so it prints as an em dash; a null currency still prints the
 * amount, with 2 decimals, since there's no code to pick a decimal count from. `locale` ('en' by
 * default) picks the separators only - the currency code itself is never translated. */
export function formatMoney(amount: number | null, currency: string | null, locale: 'en' | 'es' = 'en'): string {
  if (amount === null) return '—';
  const decimals = currency === 'COP' ? 0 : 2;
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to this module's own two keys, not user input
  const formatted = amount.toLocaleString(NUMBER_LOCALE[locale], { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === null ? formatted : `${currency} ${formatted}`;
}
