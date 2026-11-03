import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string };

// Reads pnpm's effective config, not just pnpm-workspace.yaml's text, so a misspelled key or a
// value pnpm ignores fails this test instead of passing silently.
const pnpmConfig = async (): Promise<Record<string, unknown>> => {
  const { stdout } = await execFileAsync('pnpm', ['config', 'list', '--json']);
  return JSON.parse(stdout) as Record<string, unknown>;
};

test('pnpm effective config carries every supply-chain setting', async () => {
  const config = await pnpmConfig();
  expect(config.minimumReleaseAge).toBeGreaterThanOrEqual(4320);
  // pnpm 11 ships a built-in exclusion for n8n/n8n-*/@n8n/*; this repo overrides it with an
  // explicit empty list, so nothing is exempt from the release-age gate.
  expect(config.minimumReleaseAgeExclude).toEqual([]);
  expect(config.trustPolicy).toBe('no-downgrade');
  expect(config.blockExoticSubdeps).toBe(true);
  expect(config.strictDepBuilds).toBe(true);
  expect(config.engineStrict).toBe(true);
  expect(config.dangerouslyAllowAllBuilds).toBe(false);
});

test('packageManager pins an exact pnpm 11.x version', () => {
  expect(pkg.packageManager).toMatch(/^pnpm@11\.\d+\.\d+$/);
});

test('package-lock.json does not exist', () => {
  expect(existsSync('package-lock.json')).toBe(false);
});

test('no tracked file still teaches npm commands', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files']);
  const files = stdout.split('\n').filter(Boolean);
  const pattern = /\bnpm (ci|run|test|install|audit)\b|command npm/;
  const offenders: string[] = [];
  for (const file of files) {
    if (file === 'tests/supply-chain.test.ts') continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable file; not a text hit
    }
    if (pattern.test(content)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test('every Compose image is pinned by digest', () => {
  for (const file of ['compose.yaml', 'compose.queue.yaml']) {
    const content = readFileSync(file, 'utf8');
    const images = [...content.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
  }
});

/** The text of one top-level service block in a Compose file, up to (not including) the next top-level key at the same indent. */
function serviceBlock(content: string, service: string): string {
  const lines = content.split('\n');
  const header = `  ${service}:`;
  const start = lines.findIndex((line) => line === header || line.startsWith(`${header} `));
  if (start === -1) throw new Error(`service ${service} not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return rest.slice(0, end === -1 ? rest.length : end).join('\n');
}

test('n8n and postgres/testdb run with no-new-privileges', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  for (const service of ['n8n', 'postgres', 'testdb']) {
    expect(serviceBlock(compose, service)).toMatch(/security_opt:\s*\n\s*-\s*no-new-privileges:true/);
  }
});
test('redis runs with no-new-privileges', () => {
  const queue = readFileSync('compose.queue.yaml', 'utf8');
  expect(serviceBlock(queue, 'redis')).toMatch(/security_opt:\s*\n\s*-\s*no-new-privileges:true/);
});
test('n8n drops all capabilities; postgres and testdb keep theirs for gosu', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  expect(serviceBlock(compose, 'n8n')).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
  for (const service of ['postgres', 'testdb']) {
    expect(serviceBlock(compose, service)).not.toMatch(/cap_drop:/);
  }
});
test('n8n-worker inherits n8n hardening through extends, not a repeated block', () => {
  const queue = readFileSync('compose.queue.yaml', 'utf8');
  const worker = serviceBlock(queue, 'n8n-worker');
  expect(worker).toMatch(/extends:/);
  expect(worker).not.toMatch(/security_opt:|cap_drop:/);
});

test('every docker run image across .github/workflows/*.yml is pinned by digest', () => {
  const dir = '.github/workflows';
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  expect(files.length).toBeGreaterThan(0);
  let imageCount = 0;
  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    const images = [...content.matchAll(/docker run\b[^\n]*?\s(\S+\/\S+:\S+)/g)].map((m) => m[1]);
    for (const image of images) {
      imageCount += 1;
      expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
    }
  }
  expect(imageCount).toBeGreaterThan(0);
});
