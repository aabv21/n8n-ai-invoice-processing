import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { NormalizedInvoice } from '../../src/lib/invoice.ts';
import { VALID_INVOICE } from '../fixtures/invoice-1.ts';
import { openTestDb, type TestDb } from './helpers.ts';

interface SaveRow {
  saved: boolean;
  invoice_id: number | null;
  duplicate_of: number | null;
  // node-postgres returns numeric as a string (no type parser registered here), unlike the
  // Postgres node's own text-oriented binding, but duplicate_of_issue_date is cast to text in SQL
  // itself (to_char), so it comes back the same ISO YYYY-MM-DD string either way - never a JS Date
  // that would print "Tue Jun 16 2026 ..." if a caller stringified it, which the extracted
  // invoice's own ISO date would never match.
  duplicate_of_total: string | null;
  duplicate_of_issue_date: string | null;
  item_count: number;
}

interface Summary {
  report_date: string;
  arrived: number;
  ok: number;
  review: number;
  duplicates: number;
  unfinished: number;
  totals_by_supplier: { supplier: string; currency: string; invoices: number; total: number }[];
  review_items: {
    supplier: string | null;
    invoice_number: string | null;
    currency: string | null;
    total: number | null;
    review_reasons: string[];
    drive_url: string | null;
  }[];
  due_soon: {
    supplier: string | null;
    invoice_number: string | null;
    due_date: string;
    currency: string | null;
    total: number | null;
    status: string;
  }[];
}

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
});
beforeEach(async () => {
  await db.reset();
});
afterAll(async () => {
  await db.close();
});

const save = (event: string, invoice: NormalizedInvoice = VALID_INVOICE, status = 'ok') => db.run<SaveRow>('save-invoice.sql', [
  event, event.split(':')[0], '2026-10-30T15:00:00Z', status, '[]', 'text', 'claude-haiku-5-5', 1,
  invoice, { model_reply: true }, '2026-10-02_bolsamar-empaques-sas_be-2041.pdf', '2026/10']).then((r) => r[0]!);
// Backdates a processed_events row after record-event.sql has stamped it with now().
const setReceivedAt = (eventId: string, at: string) =>
  db.sql('UPDATE processed_events SET received_at = $1::timestamptz WHERE event_id = $2', [at, eventId]);
const setReceivedAtAgo = (eventId: string, agoInterval: string) =>
  db.sql('UPDATE processed_events SET received_at = now() - $1::interval WHERE event_id = $2', [agoInterval, eventId]);

test('records a new event once', async () => {
  expect((await db.run('record-event.sql', ['m1:attachment_0', 'a.pdf']))[0]).toMatchObject({ event_id: 'm1:attachment_0' });
  expect(await db.run('record-event.sql', ['m1:attachment_0', 'a.pdf'])).toEqual([]);
});
test('saves an invoice and its items', async () => {
  expect(await save('m1:attachment_0')).toMatchObject({ saved: true, duplicate_of: null, item_count: 2 });
  expect(await db.sql('SELECT supplier_tax_id, total::text, review_reasons FROM invoices'))
    .toEqual([{ supplier_tax_id: '9013845522', total: '2082500.00', review_reasons: [] }]);
});
test('a second event with the same supplier tax ID and number is a duplicate', async () => {
  const first = await save('m1:attachment_0');
  const row = await save('m2:attachment_0');
  expect(row).toMatchObject({ saved: false, invoice_id: null, duplicate_of: first.invoice_id, item_count: 0 });
  expect(Number(row.duplicate_of_total)).toBe(VALID_INVOICE.total);
  // Asserted as an exact ISO string, not parsed as a Date, so a future regression back to a raw
  // `date` column (which the Postgres node would otherwise parse into a JS Date, like
  // node-postgres does here) fails this test instead of silently comparing two different formats.
  expect(row.duplicate_of_issue_date).toBe(VALID_INVOICE.issue_date);
  expect(row.duplicate_of_issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(await db.sql('SELECT count(*)::int AS n FROM invoices')).toEqual([{ n: 1 }]);
});
test('a conflicting duplicate (same key, different total) returns the original total and date for the caller to compare', async () => {
  const first = await save('m1:attachment_0');
  const forged = { ...VALID_INVOICE, total: VALID_INVOICE.total! + 1_000_000 };
  const row = await save('m2:attachment_0', forged);
  expect(row).toMatchObject({ saved: false, invoice_id: null, duplicate_of: first.invoice_id });
  expect(Number(row.duplicate_of_total)).toBe(VALID_INVOICE.total);
  expect(Number(row.duplicate_of_total)).not.toBe(forged.total);
  expect(row.duplicate_of_issue_date).toBe(VALID_INVOICE.issue_date);
});
test('a conflicting duplicate (same key, same total, different issue date) is still caught', async () => {
  await save('m1:attachment_0');
  const forged = { ...VALID_INVOICE, issue_date: '2026-06-16' };
  const row = await save('m2:attachment_0', forged);
  expect(row.duplicate_of_issue_date).toBe(VALID_INVOICE.issue_date);
  expect(row.duplicate_of_issue_date).not.toBe(forged.issue_date);
});
test('a genuine re-send (same key, same total and issue date) returns values that compare equal to the new extraction', async () => {
  const first = await save('m1:attachment_0');
  const genuine = { ...VALID_INVOICE };
  const row = await save('m2:attachment_0', genuine);
  expect(row.duplicate_of).toBe(first.invoice_id);
  expect(Number(row.duplicate_of_total)).toBe(genuine.total);
  expect(row.duplicate_of_issue_date).toBe(genuine.issue_date);
});
test('saving the same event twice returns the first invoice', async () => {
  const first = await save('m1:attachment_0');
  expect(await save('m1:attachment_0')).toEqual({
    saved: true, invoice_id: first.invoice_id, duplicate_of: null, duplicate_of_total: null, duplicate_of_issue_date: null, item_count: 0,
  });
});
test('review rows without tax ID or number never conflict', async () => {
  const blank = { ...VALID_INVOICE, supplier_tax_id: null, invoice_number: null };
  expect((await save('m1:attachment_0', blank, 'review')).saved).toBe(true);
  expect((await save('m2:attachment_0', blank, 'review')).saved).toBe(true);
});
test('an amount normalized out of its column range saves cleanly as a review row', async () => {
  // normalizeInvoice (src/lib/normalize-invoice.ts) already turned the out-of-range total into
  // null before this ever reaches the database; this proves that normalized record actually
  // saves, instead of the numeric(18,2) column's own overflow failing the insert on every retry.
  const outOfRange: NormalizedInvoice = { ...VALID_INVOICE, total: null };
  const row = await save('m1:attachment_0', outOfRange, 'review');
  expect(row).toMatchObject({ saved: true, duplicate_of: null });
  expect(await db.sql('SELECT total FROM invoices')).toEqual([{ total: null }]);
});
test('Postgres itself rejects a year-0000 date, which is why normalizeDate must reject it first', async () => {
  await expect(db.sql("SELECT '0000-01-01'::date")).rejects.toThrow(/date\/time field value out of range/);
});
test('an invoice with no issue date (because the model echoed a year 0000) saves cleanly as a review row', async () => {
  const noIssueDate: NormalizedInvoice = { ...VALID_INVOICE, issue_date: null };
  const row = await save('m1:attachment_0', noIssueDate, 'review');
  expect(row).toMatchObject({ saved: true, duplicate_of: null });
  expect(await db.sql('SELECT issue_date FROM invoices')).toEqual([{ issue_date: null }]);
});
test('the Drive link comes back with the row and ordered items', async () => {
  const { invoice_id } = await save('m1:attachment_0');
  const [row] = await db.run<{ invoice: { drive_url: string; status: string }; items: { line_no: number }[] }>(
    'save-drive-link.sql', [invoice_id, 'f1', 'https://drive.google.com/file/d/f1/view']);
  expect(row?.invoice).toMatchObject({ drive_url: 'https://drive.google.com/file/d/f1/view', status: 'ok' });
  expect(row?.items.map((i) => i.line_no)).toEqual([1, 2]);
});

test('openTestDb refuses a database that is not postgres', async () => {
  const original = process.env.TEST_DATABASE_URL;
  if (!original) throw new Error('TEST_DATABASE_URL is not set');
  process.env.TEST_DATABASE_URL = original.replace(/\/[^/]+$/, '/template1');
  try {
    await expect(openTestDb()).rejects.toThrow(/refuses to reset database "template1"/);
  } finally {
    process.env.TEST_DATABASE_URL = original;
  }
});

test('a saved but unfinished invoice is excluded from the totals and the review lists', async () => {
  const run = '2026-10-30T23:00:00Z';

  await db.run('record-event.sql', ['pending-ok:attachment_0', 'pending-ok.pdf']);
  await setReceivedAt('pending-ok:attachment_0', '2026-10-30T15:00:00Z');
  await save('pending-ok:attachment_0', { ...VALID_INVOICE, invoice_number: 'BE-9001' }, 'ok');

  await db.run('record-event.sql', ['pending-review:attachment_0', 'pending-review.pdf']);
  await setReceivedAt('pending-review:attachment_0', '2026-10-30T16:00:00Z');
  await save('pending-review:attachment_0', { ...VALID_INVOICE, supplier_tax_id: null, invoice_number: null }, 'review');
  // Neither event's outcome is ever recorded: both invoices are saved, but processing hasn't finished.

  const row = (await db.run<Summary>('daily-summary.sql', [run]))[0]!;
  expect(row.arrived).toBe(2);
  expect(row.ok).toBe(0);
  expect(row.review).toBe(0);
  expect(row.totals_by_supplier).toEqual([]);
  expect(row.review_items).toEqual([]);
});

describe('the summary window is half-open', () => {
  const RUN = '2026-06-15T23:00:00Z'; // 18:00 America/Bogota; window start 2026-06-14T23:00:00Z

  test('an event exactly 24 hours before the run is included', async () => {
    await db.run('record-event.sql', ['w1:attachment_0', 'w1.pdf']);
    await setReceivedAt('w1:attachment_0', '2026-06-14T23:00:00Z');
    expect((await db.run<Summary>('daily-summary.sql', [RUN]))[0]).toMatchObject({ arrived: 1 });
  });
  test('an event exactly at the run is excluded', async () => {
    await db.run('record-event.sql', ['w2:attachment_0', 'w2.pdf']);
    await setReceivedAt('w2:attachment_0', RUN);
    expect((await db.run<Summary>('daily-summary.sql', [RUN]))[0]).toMatchObject({ arrived: 0 });
  });
  test('an event one second before the window start is excluded', async () => {
    await db.run('record-event.sql', ['w3:attachment_0', 'w3.pdf']);
    await setReceivedAt('w3:attachment_0', '2026-06-14T22:59:59Z');
    expect((await db.run<Summary>('daily-summary.sql', [RUN]))[0]).toMatchObject({ arrived: 0 });
  });
});

describe('daily summary for the run at 2026-06-15T23:00:00Z (18:00 Bogota)', () => {
  // window = [2026-06-14T23:00:00Z, 2026-06-15T23:00:00Z); report_date = 2026-06-15
  const RUN = '2026-06-15T23:00:00Z';
  const summary = async () => (await db.run<Summary>('daily-summary.sql', [RUN]))[0]!;

  const arrive = async (
    event: string, invoice: NormalizedInvoice, status: 'ok' | 'review', receivedAt: string, reviewReasons = '[]',
  ): Promise<SaveRow> => {
    await db.run('record-event.sql', [event, `${event}.pdf`]);
    await setReceivedAt(event, receivedAt);
    const row = (await db.run<SaveRow>('save-invoice.sql', [
      event, event.split(':')[0], receivedAt, status, reviewReasons,
      'text', 'claude-haiku-5-5', 1, invoice, null, `${event}.pdf`, '2026/06',
    ]))[0]!;
    await db.run('record-outcome.sql', [event, status, row.invoice_id]);
    return row;
  };

  beforeEach(async () => {
    // A: Bolsamar COP 2,082,500 ok, arrives one second before the window opens -- excluded
    await arrive('a:attachment_0', { ...VALID_INVOICE, invoice_number: 'BE-1001', due_date: '2026-06-15' }, 'ok', '2026-06-14T22:59:59Z');
    // B: Bolsamar COP 1,000,000 ok, arrives exactly at the window's start
    await arrive(
      'b:attachment_0',
      { ...VALID_INVOICE, invoice_number: 'BE-1002', due_date: '2026-06-22', subtotal: 1_000_000, tax: 0, total: 1_000_000 },
      'ok', '2026-06-14T23:00:00Z',
    );
    // C: Bolsamar USD 500.50 ok, arrives mid-window
    await arrive(
      'c:attachment_0',
      { ...VALID_INVOICE, invoice_number: 'BE-1003', currency: 'USD', due_date: '2026-06-23', subtotal: 500.5, tax: 0, total: 500.5 },
      'ok', '2026-06-15T14:00:00Z',
    );
    // D: Marbetaria COP 1,416,600 review (totals_mismatch), arrives one second before the run
    await arrive(
      'd:attachment_0',
      {
        ...VALID_INVOICE, supplier: 'Marbetaria S.A.S.', supplier_tax_id: '9006124986', invoice_number: 'MB-5520',
        due_date: '2026-06-14', subtotal: 1_140_000, tax: 216_600, total: 1_416_600,
      },
      'review', '2026-06-15T22:59:59Z', '["totals_mismatch"]',
    );

    // A duplicate of B's supplier and invoice number, recorded against B's own invoice row
    await db.run('record-event.sql', ['dup:attachment_0', 'dup.pdf']);
    await setReceivedAt('dup:attachment_0', '2026-06-15T09:00:00Z');
    const dup = (await db.run<SaveRow>('save-invoice.sql', [
      'dup:attachment_0', 'dup', '2026-06-15T09:00:00Z', 'ok', '[]', 'text', 'claude-haiku-5-5', 1,
      { ...VALID_INVOICE, invoice_number: 'BE-1002' }, null, 'dup.pdf', '2026/06',
    ]))[0]!;
    await db.run('record-outcome.sql', ['dup:attachment_0', 'duplicate', dup.duplicate_of]);

    // Stuck for two hours: counts as unfinished. Stuck for five minutes: still within the grace period.
    await db.run('record-event.sql', ['stuck:attachment_0', 'stuck.pdf']);
    await setReceivedAtAgo('stuck:attachment_0', '2 hours');
    await db.run('record-event.sql', ['fresh:attachment_0', 'fresh.pdf']);
    await setReceivedAtAgo('fresh:attachment_0', '5 minutes');
  });

  test('the window counts match', async () =>
    expect(await summary()).toMatchObject({ report_date: '2026-06-15', arrived: 4, ok: 2, review: 1, duplicates: 1 }));
  test('unfinished counts events stuck for 30 minutes, on any day', async () => expect((await summary()).unfinished).toBe(1));
  test('totals by supplier keep currencies apart', async () => expect((await summary()).totals_by_supplier).toEqual([
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'COP', invoices: 1, total: 1_000_000 },
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'USD', invoices: 1, total: 500.5 }]));
  test('review items list the reasons', async () =>
    expect((await summary()).review_items).toMatchObject([{ supplier: 'Marbetaria S.A.S.', review_reasons: ['totals_mismatch'] }]));
  test('due soon covers the report day through day +7', async () =>
    expect((await summary()).due_soon.map((d) => d.due_date)).toEqual(['2026-06-15', '2026-06-22']));
});

test('the scenario report joins events, invoices, items, and duplicates', async () => {
  const since = '2026-10-30T00:00:00Z';

  await db.run('record-event.sql', ['orig:attachment_0', 'invoice-01-two-items.pdf']);
  await setReceivedAt('orig:attachment_0', '2026-10-30T15:00:00Z');
  const original = await save('orig:attachment_0', VALID_INVOICE, 'ok');
  await db.run('record-outcome.sql', ['orig:attachment_0', 'ok', original.invoice_id]);

  await db.run('record-event.sql', ['dup:attachment_0', 'invoice-06-copy-of-01.pdf']);
  await setReceivedAt('dup:attachment_0', '2026-10-30T16:00:00Z');
  const dup = await save('dup:attachment_0', VALID_INVOICE, 'ok');
  await db.run('record-outcome.sql', ['dup:attachment_0', 'duplicate', dup.duplicate_of]);

  const sql = readFileSync('scripts/sql/scenario-report.sql', 'utf8');
  const [row] = await db.sql<{ report: unknown[] }>(sql, [since]);
  const report = row?.report as { file_name: string; invoice: { line_items: unknown[] } | null; duplicate_of_file: string | null }[];

  expect(report).toHaveLength(2);
  expect(report[0]).toMatchObject({ file_name: 'invoice-01-two-items.pdf', outcome: 'ok', duplicate_of_file: null });
  expect(report[0]?.invoice?.line_items).toHaveLength(2);
  expect(report[1]).toMatchObject({ file_name: 'invoice-06-copy-of-01.pdf', outcome: 'duplicate', duplicate_of_file: 'invoice-01-two-items.pdf' });
});
