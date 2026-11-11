import { runInNewContext } from 'node:vm';
import { DateTime } from 'luxon';

/** Runs a generated Code node's `jsCode` the way n8n does: as a function body, with `$input` and `DateTime` in scope. */
export function runGenerated(jsCode: string, json: unknown): unknown {
  const item = { json };
  const sandbox = {
    $input: { first: () => item, all: () => [item] },
    DateTime,
  };
  return runInNewContext(`(function () {\n${jsCode}\n})()`, sandbox) as unknown;
}

/** Runs a per-item (`runOnceForEachItem`) Code node's `jsCode` on one whole item, exposed as `$input.item`. */
export function runGeneratedItem(jsCode: string, item: unknown): unknown {
  const sandbox = { $input: { item }, DateTime };
  return runInNewContext(`(function () {\n${jsCode}\n})()`, sandbox) as unknown;
}
