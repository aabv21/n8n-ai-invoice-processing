import { afterEach, expect, test, vi } from 'vitest';
import { callDev } from '../scripts/lib/dev-client.ts';

// callDev calls loadDotEnv() first, which calls the real process.loadEnvFile('.env'). CI has no
// .env (it's gitignored), so every test here stubs that one call instead of mocking our own
// runtime module, keeping the rest of loadDotEnv's behavior under test.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.N8N_URL;
  delete process.env.DEV_HARNESS_TOKEN;
});

test('callDev throws when N8N_URL is not set', async () => {
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
  await expect(callDev('load-config', {})).rejects.toThrow('N8N_URL is not set');
});

test('callDev posts the target and input to the dev webhook with the dev-token header', async () => {
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
  process.env.N8N_URL = 'http://localhost:5678';
  process.env.DEV_HARNESS_TOKEN = 'secret-token';
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);

  const result = await callDev('load-config', { a: 1 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  const [url, init] = call;
  expect(url).toBe('http://localhost:5678/webhook/dev');
  expect(init?.method).toBe('POST');
  const body = init?.body as string;
  expect(JSON.parse(body) as unknown).toEqual({ target: 'load-config', input: { a: 1 } });
  expect((init?.headers as Record<string, string> | undefined)?.['X-Dev-Token']).toBe('secret-token');
  expect(result).toEqual({ ok: true });
});

test('callDev throws with the status and body on a failed response', async () => {
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
  process.env.N8N_URL = 'http://localhost:5678';
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('bad request', { status: 400 }))));
  await expect(callDev('load-config', {})).rejects.toThrow('400 bad request');
});
