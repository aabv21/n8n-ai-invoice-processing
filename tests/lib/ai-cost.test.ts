import { expect, test } from 'vitest';
import { callCostUsd } from '../../src/lib/ai-cost.ts';

test('prices a PDF call from its real usage', () => {
  expect(callCostUsd({ model: 'claude-haiku-5-5', path: 'vision', usage: { input_tokens: 3000, output_tokens: 700 } })).toBe(0.00065);
});
test('estimates a text call from its length', () => {
  expect(callCostUsd({ model: 'claude-haiku-5-5', path: 'text', text_chars: 3000 })).toBe(0.00125);
});
test('falls back to a fixed vision estimate without usage', () => {
  expect(callCostUsd({ model: 'claude-haiku-5-5', path: 'vision' })).toBe(0.003);
  expect(callCostUsd({ model: 'claude-haiku-5-5', path: 'vision', usage: null })).toBe(0.003);
});
test('prices the retry model the same way', () => {
  expect(callCostUsd({ model: 'claude-sonnet-5-5', path: 'text', text_chars: 3000 })).toBe(0.025);
});
