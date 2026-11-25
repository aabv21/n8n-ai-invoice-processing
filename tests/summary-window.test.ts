import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

test('the stuck window and the list cap are stated once and quoted the same everywhere', () => {
  const sql = read('db/queries/daily-summary.sql');
  expect(sql).toContain("interval '30 minutes'");
  expect(sql).toContain('LIMIT 20');
  for (const doc of ['docs/architecture.md', 'docs/database.md']) {
    expect(read(doc)).toContain('30 minutes');
    expect(read(doc)).toMatch(/oldest 20/);
  }
  const node = read('src/nodes/render-summary.ts');
  expect(node).not.toContain('30 minutes');
  expect(node).not.toContain('at most 20');
});
