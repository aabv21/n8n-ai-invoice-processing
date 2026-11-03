import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const compose = readFileSync('compose.yaml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const config: unknown = JSON.parse(readFileSync('config/config.example.json', 'utf8'));
const service = (name: string): string =>
  compose.split(/^ {2}(?=[a-z][\w-]*:$)/m).find((block) => block.startsWith(`${name}:`)) ?? '';

test('every variable compose reads is in .env.example', () => {
  const used = [...compose.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]);
  const declared = new Set([...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  expect(used.filter((name) => !declared.has(name))).toEqual([]);
});
test('images are pinned', () => {
  expect(service('n8n')).toContain('image: n8nio/n8n:2.45.6');
  expect(service('postgres')).toContain('image: postgres:17-alpine');
});
test('n8n never sees the Postgres superuser', () => {
  expect(service('n8n')).toContain('DB_POSTGRESDB_USER: ${N8N_DB_USER}');
  expect(service('n8n')).not.toMatch(/POSTGRES_(USER|PASSWORD)/);
});
test('n8n reads config read-only and has no tunnel', () => {
  expect(service('n8n')).toContain('./config:/files/config:ro');
  expect(service('n8n')).toContain('127.0.0.1:5678:5678');
  expect(compose).not.toMatch(/ngrok/);
});
test('the test database is local and opt-in', () => {
  expect(service('testdb')).toContain('profiles: [test]');
  expect(service('testdb')).toContain('127.0.0.1:55432:5432');
});
test('config example carries the spec values', () => expect(config).toEqual({
  team_email: 'team@example.com',
  gmail: { label_ids: { processed: 'REPLACE_ME', review: 'REPLACE_ME', duplicate: 'REPLACE_ME' } },
  google: { drive_root_folder_id: 'REPLACE_ME', spreadsheet_id: 'REPLACE_ME', invoices_tab: 'Invoices', items_tab: 'Items' },
  ai: { default_model: 'claude-haiku-5-5', retry_model: 'claude-sonnet-5-5', effort: 'low' },
  extraction: { min_text_chars_per_page: 100, max_pages: 20, max_text_chars: 60000 },
  validation: { totals_tolerance: 1, min_confidence: 0.8 },
}));
