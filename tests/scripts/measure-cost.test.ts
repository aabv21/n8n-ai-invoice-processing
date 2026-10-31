import { expect, test } from 'vitest';
import { costUsd } from '../../scripts/lib/pricing.ts';
import { summarizeCosts } from '../../scripts/measure-cost.ts';

const exec = (event_id: string, path: string, model: string, attempt: number, calls: { chat?: [number, number][]; http?: [number, number] }) => ({
  data: { resultData: { runData: {
    'When called': [{ data: { main: [[{ json: { event_id, path, model, attempt } }]] } }],
    ...(calls.chat ? { Claude: calls.chat.map(([p, c]) => ({ data: { ai_languageModel: [[{ json: { tokenUsage: { promptTokens: p, completionTokens: c } } }]] } })) } : {}),
    ...(calls.http ? { 'Read PDF with Claude': [{ data: { main: [[{ json: { usage: { input_tokens: calls.http[0], output_tokens: calls.http[1] } } }]] } }] } : {}),
  } } } });

test.each([
  ['claude-haiku-5-5', 2000, 1000, 0.0007],
  ['claude-haiku-5-5', 100000, 1000, 0.0105],
  ['claude-haiku-5-5', 150000, 1000, 0.0775],
  ['claude-sonnet-5-5', 5000, 1500, 0.025],
])('%s %i in / %i out costs %f', (model, i, o, usd) => expect(costUsd(model, i, o)).toBeCloseTo(usd, 10));
test('an unknown model is an error', () => expect(() => costUsd('claude-opus-5', 1, 1)).toThrow('no price for model claude-opus-5'));
test('costs are summed per invoice and averaged per path', () => {
  const rows = summarizeCosts([
    exec('a', 'text', 'claude-haiku-5-5', 1, { chat: [[2000, 600], [2400, 300]] }),
    exec('b', 'vision', 'claude-haiku-5-5', 1, { http: [4800, 900] }),
    exec('c', 'text', 'claude-haiku-5-5', 1, { chat: [[2100, 700]] }),
    exec('c', 'text', 'claude-sonnet-5-5', 2, { chat: [[2300, 650]] }),
  ]);
  expect(rows.find((r) => r.path === 'text')).toMatchObject({ invoices: 2, retried: 1, avgInputTokens: 4400, avgOutputTokens: 1125 });
  expect(rows.find((r) => r.path === 'text')?.avgCostUsd).toBeCloseTo(0.006275, 10);
  expect(rows.find((r) => r.path === 'vision')).toMatchObject({ invoices: 1, retried: 0, avgInputTokens: 4800, avgOutputTokens: 900 });
  expect(rows.find((r) => r.path === 'vision')?.avgCostUsd).toBeCloseTo(0.00093, 10);
  expect(rows.find((r) => r.path === 'all')?.invoices).toBe(3);
});
