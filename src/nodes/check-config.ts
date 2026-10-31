// Validates the config just loaded from /files/config/config.json before anything else reads it,
// so a bad value fails loudly here instead of silently disabling a check or an AI-cost guard
// downstream. Pure: no I/O, no clock.
import { checkConfig, type Config } from '../lib/config.ts';

export interface CheckConfigInput {
  config: unknown;
}

export interface CheckConfigOutput {
  config: Config;
}

export function run(input: CheckConfigInput): CheckConfigOutput {
  return { config: checkConfig(input.config) };
}
