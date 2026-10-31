import { expect, test } from 'vitest';
import { invoiceFileName } from '../../src/lib/file-name.ts';

const base = { received_at: '2026-10-30T15:00:00Z', event_id: '18c2f0a1b2c3d4e5:attachment_0' };
test.each([
  [{ issue_date: '2026-10-02', supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041' },
    '2026-10-02_bolsamar-empaques-sas_be-2041.pdf', '2026/10'],
  [{ issue_date: '2026-09-15', supplier: 'Lácteos del Río Ñame S.A.S.', invoice_number: 'FV 2026/0098' },
    '2026-09-15_lacteos-del-rio-name-sas_fv-2026-0098.pdf', '2026/09'],
  [{ issue_date: '2026-10-02', supplier: 'S&S Distribuciones Ltda.', invoice_number: 'SS-1' },
    '2026-10-02_s-s-distribuciones-ltda_ss-1.pdf', '2026/10'],
  [{ issue_date: '2026-02-30', supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041' },
    '2026-10-30_bolsamar-empaques-sas_be-2041.pdf', '2026/10'],
  [{ issue_date: '2026-10-02', supplier: null, invoice_number: null },
    '2026-10-02_unknown-supplier_msg-18c2f0a1b2c3d4e5-attachment-0.pdf', '2026/10'],
  [{ issue_date: '2026-10-02', supplier: '***', invoice_number: 'BE-2041' },
    '2026-10-02_unknown-supplier_be-2041.pdf', '2026/10'],
  [{ issue_date: '2026-10-02', supplier: 'Comercializadora Internacional de Productos Agroindustriales del Caribe S.A.S.', invoice_number: 'C-1' },
    '2026-10-02_comercializadora-internacional-de-produc_c-1.pdf', '2026/10'],
])('%j', (input, name, folder) => expect(invoiceFileName({ ...base, ...input })).toEqual({ name, folder }));
test('without an issue date, the received date is taken in Bogota', () =>
  expect(invoiceFileName({ ...base, received_at: '2026-10-31T03:30:00Z', issue_date: null, supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041' }))
    .toEqual({ name: '2026-10-30_bolsamar-empaques-sas_be-2041.pdf', folder: '2026/10' }));
