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

// The merged, effective Compose config, so `n8n-worker`'s settings inherited through `extends` are
// checked too; `--profile test` includes `testdb`.
const composeConfig = async (args: string[]): Promise<Record<string, { security_opt?: string[]; cap_drop?: string[] }>> => {
  const { stdout } = await execFileAsync('docker', ['compose', ...args, 'config', '--format', 'json']);
  return (JSON.parse(stdout) as { services: Record<string, { security_opt?: string[]; cap_drop?: string[] }> }).services;
};

test('every long-running service disables privilege escalation', async () => {
  const queue = await composeConfig(['-f', 'compose.yaml', '-f', 'compose.queue.yaml']);
  const testProfile = await composeConfig(['--profile', 'test']);
  for (const name of ['postgres', 'n8n', 'redis', 'n8n-worker']) {
    expect(queue[name]?.security_opt, name).toContain('no-new-privileges:true');
  }
  expect(testProfile.testdb?.security_opt).toContain('no-new-privileges:true');
});

test('only n8n (and the worker that extends it) drops every Linux capability', async () => {
  const queue = await composeConfig(['-f', 'compose.yaml', '-f', 'compose.queue.yaml']);
  const testProfile = await composeConfig(['--profile', 'test']);
  expect(queue.n8n?.cap_drop).toEqual(['ALL']);
  expect(queue['n8n-worker']?.cap_drop).toEqual(['ALL']);
  for (const name of ['postgres', 'redis']) {
    expect(queue[name]?.cap_drop, name).toBeUndefined();
  }
  expect(testProfile.testdb?.cap_drop).toBeUndefined();
});

test('every docker run image across .github/workflows/*.yml is pinned by digest', () => {
  const dir = '.github/workflows';
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  expect(files.length).toBeGreaterThan(0);
  const images: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => /\bdocker run\b/.test(l))) {
      // `name` may or may not carry a `/` (`owner/repo`, `composer`). An unparsable line is kept as
      // `unparsed: ...`, so it fails the digest check instead of passing vacuously.
      images.push(/\s([a-z0-9][\w./-]*:\S+)/.exec(line)?.[1] ?? `unparsed: ${line.trim()}`);
    }
  }
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) expect(image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[a-f0-9]{64}$/);
});
