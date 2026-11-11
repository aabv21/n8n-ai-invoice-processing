// Pins README.md to the repo standard's shape: the section order, the image before the overview,
// a short quick start, and a live-check table that covers the whole live run.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const readme = readFileSync('README.md', 'utf8');

/** The text from `## <title>` up to the next `## ` heading. */
function section(title: string): string {
  const start = readme.indexOf(`\n## ${title}\n`);
  if (start === -1) throw new Error(`README has no "## ${title}" section`);
  const next = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}

test("README sections follow the repo standard's order", () => {
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  expect(headings).toEqual([
    'Video', 'What it does', 'Quick start', 'Configuration', 'Test scenarios', 'Cost per invoice',
    'Design decisions and production notes', 'Limitations', 'License',
  ]);
});

test('the architecture image comes before What it does', () => {
  const image = readme.indexOf('](docs/diagrams/architecture.svg)');
  expect(image).toBeGreaterThan(-1);
  expect(image).toBeLessThan(readme.indexOf('\n## What it does\n'));
});

test('the quick start has at most five commands', () => {
  const fence = /```bash\n([\s\S]*?)```/.exec(section('Quick start'));
  expect(fence).not.toBeNull();
  const commands = fence![1]!.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  expect(commands.length).toBeGreaterThan(0);
  expect(commands.length).toBeLessThanOrEqual(5);
});

test('the live checks cover the setup, pipeline, drills, queue mode and clean clone', () => {
  const tests = section('Test scenarios');
  const start = tests.indexOf('\n### Live checks\n');
  expect(start).toBeGreaterThan(-1);
  const rows = tests.slice(start).split('\n').filter((line) => /^\| \d+ \|/.test(line));
  expect(rows.length).toBeGreaterThanOrEqual(25);
  for (const check of ['Credentials import', 'Samples', 'Invalid Anthropic key', 'Queue mode', 'Clean clone']) {
    expect(rows.some((row) => row.includes(check)), check).toBe(true);
  }
});
