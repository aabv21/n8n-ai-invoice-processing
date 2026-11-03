import { expect, test } from 'vitest';
import { roundTo } from '../../src/lib/util.ts';

test.each([
  [1.236, 2, 1.24],
  [1.234, 2, 1.23],
  [99999999999.9996, 3, 100000000000],
  [99999999999.9994, 3, 99999999999.999],
  [0, 2, 0],
  [-1.236, 2, -1.24],
])('roundTo(%j, %j) → %j', (value, scale, expected) => expect(roundTo(value, scale)).toBeCloseTo(expected, 10));
