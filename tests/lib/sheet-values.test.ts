import { expect, test } from 'vitest';
import { sheetDate, sheetText } from '../../src/lib/sheet-values.ts';

test('a Sheets serial becomes an ISO date', () => {
  expect(sheetDate(46298)).toBe('2026-10-03');
  expect(sheetDate(25569)).toBe('1970-01-01');
});

test('an ISO string passes through trimmed', () => {
  expect(sheetDate(' 2026-10-03 ')).toBe('2026-10-03');
});

test('anything else passes through as is', () => {
  expect(sheetDate(null)).toBeNull();
  expect(sheetDate(Number.NaN)).toBeNaN();
  expect(sheetDate(true)).toBe(true);
});

test('sheetText turns a number into text and blank into null', () => {
  expect(sheetText(' Laura ')).toBe('Laura');
  expect(sheetText(12)).toBe('12');
  expect(sheetText('  ')).toBeNull();
  expect(sheetText('')).toBeNull();
  expect(sheetText(null)).toBeNull();
  expect(sheetText(undefined)).toBeNull();
  expect(sheetText(Number.NaN)).toBeNull();
  expect(sheetText({})).toBeNull();
});
