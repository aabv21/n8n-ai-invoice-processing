// Turns every extraction outcome - a real check result, or a skip taken before any AI call ran -
// into one InvoiceRecord and builds the Drive file name for it. Pure: no I/O, no clock.
import { invoiceFileName } from '../lib/file-name.ts';
import type { CheckOutput, InvoiceRecord } from '../lib/invoice.ts';
import { emptyInvoice } from '../lib/util.ts';

export type PrepareInput = CheckOutput | { skip_reason: 'too_many_pages' | 'too_much_text' | 'unreadable_pdf'; event_id: string; received_at: string };

function isSkip(input: PrepareInput): input is { skip_reason: 'too_many_pages' | 'too_much_text' | 'unreadable_pdf'; event_id: string; received_at: string } {
  return 'skip_reason' in input;
}

export function run(input: PrepareInput): InvoiceRecord {
  const record: Omit<InvoiceRecord, 'file'> = isSkip(input)
    ? {
        status: 'review',
        reasons: [input.skip_reason],
        invoice: emptyInvoice(),
        raw: null,
        event_id: input.event_id,
        received_at: input.received_at,
        path: 'none',
        model: null,
        attempt: 0,
      }
    : input;

  const file = invoiceFileName({
    issue_date: record.invoice.issue_date,
    supplier: record.invoice.supplier,
    invoice_number: record.invoice.invoice_number,
    received_at: record.received_at,
    event_id: record.event_id,
  });

  return { ...record, file };
}
