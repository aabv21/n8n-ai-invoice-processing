import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Config } from '../../src/lib/config.ts';
import { run } from '../../src/nodes/check-config.ts';

const VALID = JSON.parse(readFileSync('config/config.example.json', 'utf8')) as Config;

test('passes the loaded config through once checked', () => expect(run({ config: VALID })).toEqual({ config: VALID }));
test('a bad config fails loudly instead of passing through unchecked', () =>
  expect(() => run({ config: { ...VALID, team_email: '' } })).toThrow('config.team_email'));
