import { expect, test } from 'vitest';
import type { ErrorAlertInput } from '../../src/nodes/error-alert.ts';
import { run } from '../../src/nodes/error-alert.ts';

const URL = 'http://localhost:5678/workflow/mgpProcessInv001/executions/123';
const input: ErrorAlertInput = {
  team_locale: 'en',
  workflow_name: 'Process invoice',
  failed_node: 'Save invoice',
  error_message: 'relation "invoices" does not exist',
  execution_url: 'http://localhost:5678/workflow/mgpProcessInv001/executions/123',
  time: '2026-10-30 18:05 America/Bogota',
};

test('renders the English subject and body', () => {
  const out = run(input);
  expect(out.subject).toBe('[Magdaport] Workflow failed: Process invoice');
  expect(out.message).toBe(
    `Execution: ${URL}\n` +
      'Open the execution, fix the cause, then retry it.\n' +
      '\n' +
      'Failed node: Save invoice\n' +
      'Error: relation "invoices" does not exist\n' +
      'Time: 2026-10-30 18:05 America/Bogota',
  );
});

test('renders the Spanish subject and body', () => {
  const out = run({ ...input, team_locale: 'es' });
  expect(out.subject).toBe('[Magdaport] Falló el flujo: Process invoice');
  expect(out.message).toBe(
    `Ejecución: ${URL}\n` +
      'Abra la ejecución, corrija la causa y reinténtela.\n' +
      '\n' +
      'Nodo fallido: Save invoice\n' +
      'Error: relation "invoices" does not exist\n' +
      'Hora: 2026-10-30 18:05 America/Bogota',
  );
});

// Missing means 'en', as in checkConfig: a config predating this field must not crash the error handler.
test('defaults to English when team_locale is missing', () => {
  const withoutLocale: ErrorAlertInput = {
    workflow_name: input.workflow_name,
    failed_node: input.failed_node,
    error_message: input.error_message,
    execution_url: input.execution_url,
    time: input.time,
  };
  const out = run(withoutLocale);
  expect(out.subject).toBe('[Magdaport] Workflow failed: Process invoice');
});

// The alert is plain text (platform.test.ts pins emailType: text), so no value is HTML-escaped.
test('does not HTML-escape plain-text values', () => {
  const out = run({ ...input, workflow_name: 'A & B <workflow>' });
  expect(out.subject).toBe('[Magdaport] Workflow failed: A & B <workflow>');
});

test('puts the execution link first and the next step second', () => {
  const [first, second] = run(input).message.split('\n');
  expect(first).toBe(`Execution: ${URL}`);
  expect(second).toBe('Open the execution, fix the cause, then retry it.');
  const [esFirst, esSecond] = run({ ...input, team_locale: 'es' }).message.split('\n');
  expect(esFirst).toBe(`Ejecución: ${URL}`);
  expect(esSecond).toBe('Abra la ejecución, corrija la causa y reinténtela.');
});

test('no subject says demo', () => {
  expect(run(input).subject).not.toMatch(/demo/i);
  expect(run({ ...input, team_locale: 'es' }).subject).not.toMatch(/demo/i);
});
