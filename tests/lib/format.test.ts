import { expect, test } from 'vitest';
import { escapeHtml, formatMoney } from '../../src/lib/format.ts';

test('escapes the five HTML-significant characters', () => {
  expect(escapeHtml(`<b>&'"</b>`)).toBe('&lt;b&gt;&amp;&#39;&quot;&lt;/b&gt;');
});

test('formats COP without decimals and USD with cents in English by default', () => {
  expect(formatMoney(2082500, 'COP')).toBe('COP 2,082,500');
  expect(formatMoney(2191, 'USD')).toBe('USD 2,191.00');
});
test('a null amount is an em dash, not zero', () => {
  expect(formatMoney(null, 'COP')).toBe('—');
});
test('a null currency still prints the amount, with 2 decimals', () => {
  expect(formatMoney(500.5, null)).toBe('500.50');
});

// es-CO swaps en-US's separators: '.' for thousands, ',' for the decimal.
test('formats COP and USD with es-CO separators when locale is es', () => {
  expect(formatMoney(2082500, 'COP', 'es')).toBe('COP 2.082.500');
  expect(formatMoney(2191, 'USD', 'es')).toBe('USD 2.191,00');
});
test('a null amount is still an em dash in Spanish', () => {
  expect(formatMoney(null, 'COP', 'es')).toBe('—');
});
test('a null currency still prints the Spanish-formatted amount', () => {
  expect(formatMoney(500.5, null, 'es')).toBe('500,50');
});
