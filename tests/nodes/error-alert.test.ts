import { expect, test } from 'vitest';
import type { ErrorAlertInput } from '../../src/nodes/error-alert.ts';
import { run } from '../../src/nodes/error-alert.ts';

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
  expect(out.subject).toBe('[Magdaport demo] Workflow failed: Process invoice');
  expect(out.message).toBe(
    'Failed node: Save invoice\n' +
      'Error: relation "invoices" does not exist\n' +
      'Execution: http://localhost:5678/workflow/mgpProcessInv001/executions/123\n' +
      'Time: 2026-10-30 18:05 America/Bogota',
  );
});

test('renders the Spanish subject and body', () => {
  const out = run({ ...input, team_locale: 'es' });
  expect(out.subject).toBe('[Demo Magdaport] Falló el flujo: Process invoice');
  expect(out.message).toBe(
    'Nodo fallido: Save invoice\n' +
      'Error: relation "invoices" does not exist\n' +
      'Ejecución: http://localhost:5678/workflow/mgpProcessInv001/executions/123\n' +
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
  expect(out.subject).toBe('[Magdaport demo] Workflow failed: Process invoice');
});

// The alert is plain text (platform.test.ts pins emailType: text), so no value is HTML-escaped.
test('does not HTML-escape plain-text values', () => {
  const out = run({ ...input, workflow_name: 'A & B <workflow>' });
  expect(out.subject).toBe('[Magdaport demo] Workflow failed: A & B <workflow>');
});
