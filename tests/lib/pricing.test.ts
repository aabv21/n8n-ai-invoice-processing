import { expect, test } from 'vitest';
import { costUsd, hasPrice } from '../../src/lib/pricing.ts';

test.each([
  ['claude-haiku-5-5', 2000, 1000, 0.0007],
  ['claude-haiku-5-5', 100000, 1000, 0.0105],
  ['claude-haiku-5-5', 150000, 1000, 0.0775],
  ['claude-sonnet-5-5', 5000, 1500, 0.025],
])('%s %i in / %i out costs %f', (model, i, o, usd) => expect(costUsd(model, i, o)).toBeCloseTo(usd, 10));
test('an unknown model is an error', () => expect(() => costUsd('claude-opus-5', 1, 1)).toThrow('no price for model claude-opus-5'));
test('hasPrice knows both config models and no other', () => {
  expect(hasPrice('claude-haiku-5-5')).toBe(true);
  expect(hasPrice('claude-sonnet-5-5')).toBe(true);
  expect(hasPrice('claude-unknown')).toBe(false);
});
