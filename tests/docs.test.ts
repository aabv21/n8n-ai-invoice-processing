// Pins AGENTS.md as a short map whose links all resolve.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';

const agents = readFileSync('AGENTS.md', 'utf8');

test('AGENTS.md stays under 160 lines and 14,000 bytes', () => {
  expect(agents.split('\n').length).toBeLessThan(160);
  expect(Buffer.byteLength(agents)).toBeLessThan(14_000);
});

test("every document AGENTS.md's map links to exists", () => {
  const targets = [...agents.matchAll(/\]\(([^)#\s]+)[^)]*\)/g)].map((m) => m[1] as string).filter((t) => !t.startsWith('http'));
  expect(targets.length).toBeGreaterThan(5);
  for (const target of targets) expect(existsSync(join(dirname('AGENTS.md'), target)), target).toBe(true);
});
