import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { compose } from '../scripts/lib/runtime.ts';

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
