import { expect, test } from 'vitest';
import { run } from '../../src/nodes/approval-note.ts';

const COPY = {
  duplicate_key: [
    'Not approved: another invoice already has this supplier NIT and invoice number.',
    'No se aprobó: otra factura ya tiene este NIT de proveedor y número de factura.',
  ],
  not_in_review: ['Not approved: this invoice is not in review.', 'No se aprobó: esta factura no está en revisión.'],
  row_mismatch: [
    "Not approved: invoice_id and email_id don't belong to the same invoice. Don't edit those two columns.",
    'No se aprobó: invoice_id y email_id no corresponden a la misma factura. No edite esas dos columnas.',
  ],
  not_found: ['Not approved: no saved invoice has this invoice_id.', 'No se aprobó: ninguna factura guardada tiene este invoice_id.'],
} as const;

test.each(Object.entries(COPY))('each result has its note in both languages (%s)', (result, [en, es]) => {
  const input = { invoice_id: '12', email_id: 'gm12', result: result as keyof typeof COPY };
  expect(run(input)).toEqual({ invoice_id: '12', email_id: 'gm12', note: en });
  expect(run({ ...input, team_locale: 'en' }).note).toBe(en);
  expect(run({ ...input, team_locale: 'es' }).note).toBe(es);
});
