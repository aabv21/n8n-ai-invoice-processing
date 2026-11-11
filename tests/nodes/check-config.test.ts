import { expect, test } from 'vitest';
import { run } from '../../src/nodes/check-config.ts';
import { filledConfig } from '../fixtures/config.ts';

const VALID = filledConfig();

test('passes the loaded config through once checked', () => expect(run({ config: VALID })).toEqual({ config: VALID }));
test('a bad config fails loudly instead of passing through unchecked', () =>
  expect(() => run({ config: { ...VALID, team_email: '' } })).toThrow('config.team_email'));
