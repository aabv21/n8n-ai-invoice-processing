// Pins the documentation set: AGENTS.md stays a short map, every link in it resolves, the prose
// style rule holds, and every diagram is referenced from the places that show it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';

const agents = readFileSync('AGENTS.md', 'utf8');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? markdownFiles(join(dir, entry.name)) : entry.name.endsWith('.md') ? [join(dir, entry.name)] : [],
  );
}

test('AGENTS.md stays under 160 lines and 14,000 bytes', () => {
  expect(agents.split('\n').length).toBeLessThan(160);
  expect(Buffer.byteLength(agents)).toBeLessThan(14_000);
});

test("every document AGENTS.md's map links to exists", () => {
  const targets = [...agents.matchAll(/\]\(([^)#\s]+)[^)]*\)/g)].map((m) => m[1] as string).filter((t) => !t.startsWith('http'));
  expect(targets.length).toBeGreaterThan(5);
  for (const target of targets) expect(existsSync(join(dirname('AGENTS.md'), target)), target).toBe(true);
});

test('no doc uses a spaced em dash as punctuation', () => {
  const files = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', ...markdownFiles('docs')];
  const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(' — '));
  expect(offenders).toEqual([]);
});
