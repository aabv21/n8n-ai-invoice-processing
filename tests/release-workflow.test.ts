import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the release job runs only for a merge from develop or a release branch', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  expect(workflow).toContain("github.event.pull_request.head.ref == 'develop'");
  expect(workflow).toContain("startsWith(github.event.pull_request.head.ref, 'release/')");
});

test('the security policy names only the services this repo uses, and its supported version', () => {
  const policy = readFileSync('SECURITY.md', 'utf8');
  expect(policy).toContain('n8n, Google, Anthropic, and Postgres');
  for (const other of ['Meta', 'Shopify', 'WordPress']) expect(policy).not.toContain(other);
  expect(policy).toMatch(/^## Supported versions$/m);
});
