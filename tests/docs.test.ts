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

test("every diagram is referenced from the README, docs/architecture.md and the diagrams' own index", () => {
  const images = readdirSync('docs/diagrams').filter((name) => name.endsWith('.svg'));
  expect(images.length).toBeGreaterThanOrEqual(4);
  const readme = readFileSync('README.md', 'utf8');
  const architecture = readFileSync('docs/architecture.md', 'utf8');
  const index = readFileSync('docs/diagrams/README.md', 'utf8');
  for (const image of images) {
    expect(readme, `README.md names ${image}`).toContain(image);
    expect(architecture, `docs/architecture.md names ${image}`).toContain(image);
    expect(index, `docs/diagrams/README.md lists ${image}`).toContain(image);
  }
});

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
}

test('every link with an anchor into a Markdown file points at a heading that exists', () => {
  const files = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', ...markdownFiles('docs')];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, target, anchor] of text.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
      const path = target === '' ? file : join(dirname(file), target as string);
      if (!path.endsWith('.md')) continue;
      const headings = [...readFileSync(path, 'utf8').matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1] as string));
      expect(headings, `${file} links to ${path}#${anchor as string}`).toContain(anchor);
    }
  }
});
