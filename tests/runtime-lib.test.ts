import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { compose, isWebhookLive, waitForWebhookLive } from '../scripts/lib/runtime.ts';

// compose(args, { input }) spawns instead of using execFile, so these tests mock
// node:child_process.spawn instead of talking to a real docker compose process — the same
// "fake the dependency, trigger its events, assert on the outcome" shape as the fetch tests in
// dev-client.test.ts, applied to vi.mock since spawn is a module export, not a global.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
});

class FakeStdin extends EventEmitter {
  end(): this {
    return this;
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = new FakeStdin();
}

const mockSpawn = vi.mocked(spawn);

test('a non-zero exit rejects with the captured stdout and stderr', async () => {
  const fake = new FakeChild();
  mockSpawn.mockReturnValue(fake as never);

  const promise = compose(['exec', '-T', 'postgres', 'psql'], { input: 'SELECT 1;' });
  fake.stdout.emit('data', Buffer.from('partial output'));
  fake.stderr.emit('data', Buffer.from('some warning'));
  fake.emit('close', 1);

  await expect(promise).rejects.toMatchObject({ stdout: 'partial output', stderr: 'some warning' });
  await expect(promise).rejects.toThrow(/some warning/);
});

test('a stdin error, like EPIPE, rejects instead of throwing', async () => {
  const fake = new FakeChild();
  mockSpawn.mockReturnValue(fake as never);

  const promise = compose(['exec', '-T', 'postgres', 'psql'], { input: 'x'.repeat(1_000_000) });
  // Without a stdin 'error' listener, this emit would throw — that's the crash being guarded against.
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  fake.stdin.emit('error', epipe);

  await expect(promise).rejects.toThrow(/EPIPE/);
  await expect(promise).rejects.toMatchObject({ stdout: '', stderr: '' });
});

test('isWebhookLive treats 404 as not yet registered', () => expect(isWebhookLive(404)).toBe(false));
test('isWebhookLive treats 403 (the dev harness rejecting an unauthenticated call) as live', () => expect(isWebhookLive(403)).toBe(true));
test('isWebhookLive treats any other status as live too', () => {
  expect(isWebhookLive(200)).toBe(true);
  expect(isWebhookLive(500)).toBe(true);
});

// A fake fetch standing in for n8n's webhook endpoint, so the poll's timing and decision logic
// (live immediately, still-404-then-live, and timeout) are provable with no real network and no
// live stack — the mechanism `import-workflows.ts` relies on to know a publish actually took
// effect before `pnpm run setup` returns.
function fakeFetch(statuses: readonly number[]): typeof fetch {
  let call = 0;
  return ((): Promise<Pick<Response, 'status'>> => {
    const status = statuses[Math.min(call, statuses.length - 1)] ?? 404;
    call += 1;
    return Promise.resolve({ status });
  }) as unknown as typeof fetch;
}

test('waitForWebhookLive returns true right away when the first poll is already live', async () => {
  expect(await waitForWebhookLive('http://n8n.test', 'dev', 5000, fakeFetch([403]))).toBe(true);
});
test('waitForWebhookLive returns true once a run of 404s turns live within the budget', async () => {
  expect(await waitForWebhookLive('http://n8n.test', 'dev', 5000, fakeFetch([404, 404, 403]))).toBe(true);
});
test('waitForWebhookLive returns false when the budget elapses while every poll still answers 404', async () => {
  expect(await waitForWebhookLive('http://n8n.test', 'dev', 0, fakeFetch([404]))).toBe(false);
});
