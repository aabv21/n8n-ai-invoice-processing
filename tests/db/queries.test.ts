import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { NormalizedInvoice } from '../../src/lib/invoice.ts';
import { VALID_INVOICE } from '../fixtures/invoice-1.ts';
import { openTestDb, type TestDb } from './helpers.ts';

interface SaveRow {
  saved: boolean;
  invoice_id: number | null;
  duplicate_of: number | null;
  // node-postgres returns numeric as a string (no type parser registered here).
  // duplicate_of_issue_date is cast to text in SQL (to_char), so it's YYYY-MM-DD here and in the
  // Postgres node alike, never a JS Date.
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
  unfinished_events: { event_id: string; file_name: string | null; received_at: string }[];
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
  ai_cost_usd: number;
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

const save = async (event: string, invoice: NormalizedInvoice = VALID_INVOICE, status = 'ok', cost = 0) => {
  // The cost lands on the event's own row, so a test that prices a save records the event first.
  if (cost > 0) await db.run('record-event.sql', [event, `${event}.pdf`]);
  return saveRow(event, invoice, status, cost);
};
const saveRow = (event: string, invoice: NormalizedInvoice, status: string, cost: number) => db.run<SaveRow>('save-invoice.sql', [
  event, event.split(':')[0], '2026-10-30T15:00:00Z', status, '[]', 'text', 'claude-haiku-5-5', 1,
  invoice, { model_reply: true }, '2026-10-02_bolsamar-empaques-sas_be-2041.pdf', '2026/10', cost]).then((r) => r[0]!);
// Backdates a processed_events row after record-event.sql has stamped it with now().
const setReceivedAt = (eventId: string, at: string) =>
  db.sql('UPDATE processed_events SET received_at = $1::timestamptz WHERE event_id = $2', [at, eventId]);

test('records a new event once', async () => {
  expect((await db.run('record-event.sql', ['m1:attachment_0', 'a.pdf']))[0]).toMatchObject({ event_id: 'm1:attachment_0' });
  expect(await db.run('record-event.sql', ['m1:attachment_0', 'a.pdf'])).toEqual([]);
});
test('saves an invoice and its items', async () => {
  expect(await save('m1:attachment_0')).toMatchObject({ saved: true, duplicate_of: null, item_count: 2 });
  expect(await db.sql('SELECT supplier_tax_id, total::text, review_reasons FROM invoices'))
    .toEqual([{ supplier_tax_id: '9013845522', total: '2082500.00', review_reasons: [] }]);
});
test("save-invoice stores the extraction's cost on the event", async () => {
  await save('m1:attachment_0', VALID_INVOICE, 'ok', 0.012345);
  expect(await db.sql('SELECT ai_cost_usd::text FROM processed_events')).toEqual([{ ai_cost_usd: '0.012345' }]);
});
test("a duplicate's extraction cost counts toward today's spend", async () => {
  await save('m1:attachment_0', VALID_INVOICE, 'ok', 0.2);
  const dup = await save('m2:attachment_0', VALID_INVOICE, 'ok', 0.3);
  expect(dup.saved).toBe(false);
  const [row] = await db.run<{ ai_spent_usd: number }>('record-event.sql', ['m3:attachment_0', 'c.pdf']);
  expect(row?.ai_spent_usd).toBe(0.5);
});
test('a record-cost with no saved invoice still counts toward today\'s spend, and never lowers a higher figure', async () => {
  await db.run('record-event.sql', ['m1:attachment_0', 'a.pdf']);
  await db.run('record-cost.sql', ['m1:attachment_0', 0.004]);
  await db.run('record-cost.sql', ['m1:attachment_0', 0.001]);
  const [row] = await db.run<{ ai_spent_usd: number }>('record-event.sql', ['m2:attachment_0', 'b.pdf']);
  expect(row?.ai_spent_usd).toBe(0.004);
});
test("record-event returns today's Bogota-day AI spend as a number", async () => {
  await save('m1:attachment_0', VALID_INVOICE, 'ok', 0.5);
  await save('m2:attachment_0', { ...VALID_INVOICE, invoice_number: 'BE-9' }, 'ok', 1);
  await db.sql("UPDATE processed_events SET received_at = now() - interval '2 days' WHERE event_id = 'm2:attachment_0'");
  const [row] = await db.run<{ ai_spent_usd: unknown }>('record-event.sql', ['m3:attachment_0', 'c.pdf']);
  expect(row?.ai_spent_usd).toBe(0.5);
});
test('a second event with the same supplier tax ID and number is a duplicate', async () => {
  const first = await save('m1:attachment_0');
  const row = await save('m2:attachment_0');
  expect(row).toMatchObject({ saved: false, invoice_id: null, duplicate_of: first.invoice_id, item_count: 0 });
  expect(Number(row.duplicate_of_total)).toBe(VALID_INVOICE.total);
  // An exact ISO string, so a regression to a raw `date` column (parsed into a JS Date) fails here.
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
// Two emails carrying the same new invoice in one poll: the second save blocks on the first's
// uncommitted row, then finds the conflict, but its statement snapshot predates the first's
// commit, so it can't name the original. The workflow labels this Duplicate, not Review.
test('a save racing an uncommitted save of the same key returns no duplicate_of', async () => {
  const text = readFileSync('db/queries/save-invoice.sql', 'utf8');
  const params = (event: string) => [
    event, event.split(':')[0], '2026-10-30T15:00:00Z', 'ok', '[]', 'text', 'claude-haiku-5-5', '1',
    JSON.stringify(VALID_INVOICE), null, 'race.pdf', '2026/10', '0'];
  const clientA = await db.connect();
  try {
    await clientA.query('BEGIN');
    await clientA.query(text, params('race-a:attachment_0'));
    const raceB = db.sql<SaveRow>(text, params('race-b:attachment_0'));
    // Wait until B is blocked on A's uncommitted row (a lock it hasn't been granted).
    for (let tries = 0; ; tries++) {
      const [waiting] = await db.sql<{ n: number }>('SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted');
      if (waiting!.n > 0) break;
      if (tries === 100) throw new Error('the racing save never blocked on the first save');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await clientA.query('COMMIT');
    expect((await raceB)[0]).toEqual({
      saved: false, invoice_id: null, duplicate_of: null, duplicate_of_total: null, duplicate_of_issue_date: null, item_count: 0,
    });
    // The workflow's next statement takes a new snapshot, which does see the committed original.
    const [original] = await db.sql<{ id: string }>("SELECT id FROM invoices WHERE source_event_id = 'race-a:attachment_0'");
    expect(await db.run('find-original.sql', [VALID_INVOICE.supplier_tax_id, VALID_INVOICE.invoice_number])).toEqual([
      { id: original!.id, total: '2082500.00', issue_date: VALID_INVOICE.issue_date }]);
  } finally {
    clientA.release();
  }
});
test('find-original returns one row of NULLs when no invoice holds the key', async () =>
  expect(await db.run('find-original.sql', ['9013845522', 'NO-SUCH-NUMBER'])).toEqual([{ id: null, total: null, issue_date: null }]));
test('record-outcome stores an empty invoice id as NULL', async () => {
  await db.run('record-event.sql', ['ev', 'ev.pdf']);
  expect(await db.run('record-outcome.sql', ['ev', 'duplicate', ''])).toEqual([{ event_id: 'ev', outcome: 'duplicate' }]);
  expect(await db.sql("SELECT invoice_id FROM processed_events WHERE event_id = 'ev'")).toEqual([{ invoice_id: null }]);
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
  // normalizeInvoice already nulled the out-of-range total; this proves the normalized record saves
  // instead of overflowing numeric(18,2) on every retry.
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
    event: string, invoice: NormalizedInvoice, status: 'ok' | 'review', receivedAt: string, reviewReasons = '[]', cost = 0,
  ): Promise<SaveRow> => {
    await db.run('record-event.sql', [event, `${event}.pdf`]);
    await setReceivedAt(event, receivedAt);
    const row = (await db.run<SaveRow>('save-invoice.sql', [
      event, event.split(':')[0], receivedAt, status, reviewReasons,
      'text', 'claude-haiku-5-5', 1, invoice, null, `${event}.pdf`, '2026/06', cost,
    ]))[0]!;
    expect(await db.run('record-outcome.sql', [event, status, row.invoice_id])).toEqual([{ event_id: event, outcome: status }]);
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
      { ...VALID_INVOICE, invoice_number: 'BE-1002' }, null, 'dup.pdf', '2026/06', 0,
    ]))[0]!;
    expect(await db.run('record-outcome.sql', ['dup:attachment_0', 'duplicate', dup.duplicate_of]))
      .toEqual([{ event_id: 'dup:attachment_0', outcome: 'duplicate' }]);

    // Unfinished at the run's own time, not now(): stuck two hours before the run counts; 15 minutes
    // before the run is still within the 30-minute grace period; after the run doesn't exist yet.
    await db.run('record-event.sql', ['stuck:attachment_0', 'stuck.pdf']);
    await setReceivedAt('stuck:attachment_0', '2026-06-15T21:00:00Z');
    await db.run('record-event.sql', ['fresh:attachment_0', 'fresh.pdf']);
    await setReceivedAt('fresh:attachment_0', '2026-06-15T22:45:00Z');
    await db.run('record-event.sql', ['later:attachment_0', 'later.pdf']);
    await setReceivedAt('later:attachment_0', '2026-06-16T10:00:00Z');
  });

  // stuck and fresh arrived inside the window too, so they count as arrived, with no outcome yet.
  test("the window's ai_cost_usd sums only the events received inside it, duplicates included", async () => {
    await db.sql("UPDATE processed_events SET ai_cost_usd = 0.25 WHERE event_id IN ('a:attachment_0', 'b:attachment_0', 'c:attachment_0', 'dup:attachment_0')");
    expect((await summary()).ai_cost_usd).toBe(0.75);
  });
  test('the window counts match', async () =>
    expect(await summary()).toMatchObject({ report_date: '2026-06-15', arrived: 6, ok: 2, review: 1, duplicates: 1 }));
  test('unfinished is measured at run_at, not now()', async () => expect((await summary()).unfinished).toBe(1));
  test('the unfinished list names each stuck event, oldest first', async () =>
    expect((await summary()).unfinished_events).toEqual([
      { event_id: 'stuck:attachment_0', file_name: 'stuck.pdf', received_at: '2026-06-15 16:00' }]));
  test('totals by supplier keep currencies apart', async () => expect((await summary()).totals_by_supplier).toEqual([
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'COP', invoices: 1, total: 1_000_000 },
    { supplier: 'Bolsamar Empaques S.A.S.', currency: 'USD', invoices: 1, total: 500.5 }]));
  test('review items list the reasons', async () =>
    expect((await summary()).review_items).toMatchObject([{ supplier: 'Marbetaria S.A.S.', review_reasons: ['totals_mismatch'] }]));
  test('due soon covers the report day through day +7', async () =>
    expect((await summary()).due_soon.map((d) => d.due_date)).toEqual(['2026-06-15', '2026-06-22']));
});

test('the unfinished list stops at 20', async () => {
  const run = '2026-06-15T23:00:00Z';
  for (let i = 0; i < 25; i++) {
    const event = `stuck-${String(i).padStart(2, '0')}:attachment_0`;
    await db.run('record-event.sql', [event, `${event}.pdf`]);
    // stuck-00 is the oldest, one hour before the run.
    await setReceivedAt(event, new Date(Date.parse(run) - (60 + 25 - i) * 60_000).toISOString());
  }
  const row = (await db.run<Summary>('daily-summary.sql', [run]))[0]!;
  expect(row.unfinished).toBe(25);
  expect(row.unfinished_events).toHaveLength(20);
  expect(row.unfinished_events[0]?.event_id).toBe('stuck-00:attachment_0');
  expect(row.unfinished_events[19]?.event_id).toBe('stuck-19:attachment_0');
});
test('the unfinished list is an empty array when nothing is stuck', async () => {
  const row = (await db.run<Summary>('daily-summary.sql', ['2026-06-15T23:00:00Z']))[0]!;
  expect(row).toMatchObject({ unfinished: 0, unfinished_events: [] });
});

test('the scenario report joins events, invoices, items, and duplicates', async () => {
  const since = '2026-10-30T00:00:00Z';

  await db.run('record-event.sql', ['orig:attachment_0', 'invoice-01-two-items.pdf']);
  await setReceivedAt('orig:attachment_0', '2026-10-30T15:00:00Z');
  const original = await save('orig:attachment_0', VALID_INVOICE, 'ok');
  expect(await db.run('record-outcome.sql', ['orig:attachment_0', 'ok', original.invoice_id]))
    .toEqual([{ event_id: 'orig:attachment_0', outcome: 'ok' }]);

  await db.run('record-event.sql', ['dup:attachment_0', 'invoice-06-copy-of-01.pdf']);
  await setReceivedAt('dup:attachment_0', '2026-10-30T16:00:00Z');
  const dup = await save('dup:attachment_0', VALID_INVOICE, 'ok');
  expect(await db.run('record-outcome.sql', ['dup:attachment_0', 'duplicate', dup.duplicate_of]))
    .toEqual([{ event_id: 'dup:attachment_0', outcome: 'duplicate' }]);

  const sql = readFileSync('scripts/sql/scenario-report.sql', 'utf8');
  const [row] = await db.sql<{ report: unknown[] }>(sql, [since]);
  const report = row?.report as { file_name: string; invoice: { line_items: unknown[] } | null; duplicate_of_file: string | null }[];

  expect(report).toHaveLength(2);
  expect(report[0]).toMatchObject({ file_name: 'invoice-01-two-items.pdf', outcome: 'ok', duplicate_of_file: null });
  expect(report[0]?.invoice?.line_items).toHaveLength(2);
  expect(report[1]).toMatchObject({ file_name: 'invoice-06-copy-of-01.pdf', outcome: 'duplicate', duplicate_of_file: 'invoice-01-two-items.pdf' });
});

describe('approve-invoice', () => {
  const FIELDS = {
    supplier: 'Bolsamar Empaques S.A.S.', supplier_tax_id: '9013845522', invoice_number: 'BE-2041',
    issue_date: '2026-10-03', due_date: '2026-11-02', currency: 'COP', subtotal: 1_750_000, tax: 332_500, total: 2_082_500,
  };
  interface Approval {
    invoice_id: string; gmail_message_id: string | null; result: string; review_left: boolean;
    supplier: string | null; invoice_number: string | null; issue_date: string | null; due_date: string | null; subtotal: number | null; total: number | null;
  }
  const approve = async (id: unknown, fields: object = FIELDS, by = 'Laura', email = 'rev') =>
    (await db.run<Approval>('approve-invoice.sql', [id, fields, by, email]))[0]!;
  // A review invoice with a wrong printed total, and its event left at outcome review. The event id
  // is `<email>:attachment_<n>`, so the email id is what comes before the colon.
  const seedReview = async (event = 'rev:attachment_0', invoice: NormalizedInvoice = { ...VALID_INVOICE, total: 2_000_000 }) => {
    await db.run('record-event.sql', [event, `${event}.pdf`]);
    const row = await save(event, invoice, 'review');
    await db.run('record-outcome.sql', [event, 'review', row.invoice_id]);
    return row.invoice_id!;
  };
  const seedSibling = async (event: string, outcome: string | null, number: string) => {
    await db.run('record-event.sql', [event, `${event}.pdf`]);
    const row = await save(event, { ...VALID_INVOICE, invoice_number: number, total: 2_000_000 }, 'review');
    if (outcome !== null) await db.run('record-outcome.sql', [event, outcome, row.invoice_id]);
    return row.invoice_id!;
  };

  test('approves a review invoice with corrected fields and marks its event ok', async () => {
    const id = await seedReview();
    expect(await approve(id)).toMatchObject({
      invoice_id: String(id), gmail_message_id: 'rev', result: 'approved', review_left: false,
      supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041', issue_date: '2026-10-03', due_date: '2026-11-02', subtotal: 1_750_000, total: 2_082_500,
    });
    expect(await db.sql('SELECT status, review_reasons, total::text, approved_by, approved_at IS NOT NULL AS stamped FROM invoices WHERE id = $1', [id]))
      .toEqual([{ status: 'ok', review_reasons: [], total: '2082500.00', approved_by: 'Laura', stamped: true }]);
    expect(await db.sql("SELECT outcome FROM processed_events WHERE event_id = 'rev:attachment_0'")).toEqual([{ outcome: 'ok' }]);
  });
  test('reports already_approved on a replay and changes nothing', async () => {
    const id = await seedReview();
    await approve(id);
    const [before] = await db.sql<{ approved_at: string }>('SELECT approved_at::text FROM invoices WHERE id = $1', [id]);
    expect(await approve(id, { ...FIELDS, total: 1 }, 'Marta')).toMatchObject({ result: 'already_approved', gmail_message_id: 'rev' });
    expect(await db.sql('SELECT approved_at::text, approved_by, total::text FROM invoices WHERE id = $1', [id]))
      .toEqual([{ approved_at: before!.approved_at, approved_by: 'Laura', total: '2082500.00' }]);
  });
  test('a replay returns the values the first approval saved, not the replay cells', async () => {
    const id = await seedReview();
    await approve(id);
    const replay = await approve(id, { ...FIELDS, supplier: 'Someone Else', invoice_number: 'ZZ-1', issue_date: '2026-01-05', total: 1 }, 'Marta');
    expect(replay).toMatchObject({
      result: 'already_approved', supplier: 'Bolsamar Empaques S.A.S.', invoice_number: 'BE-2041', issue_date: '2026-10-03', due_date: '2026-11-02', subtotal: 1_750_000, total: 2_082_500,
    });
  });
  test('refuses a corrected key another invoice holds', async () => {
    await save('held:attachment_0', { ...VALID_INVOICE, invoice_number: 'BE-9999' });
    const id = await seedReview('rev:attachment_0', { ...VALID_INVOICE, invoice_number: 'BE-2041', total: 2_000_000 });
    expect(await approve(id, { ...FIELDS, invoice_number: 'BE-9999' })).toMatchObject({ result: 'duplicate_key' });
    expect(await db.sql('SELECT status, approved_at FROM invoices WHERE id = $1', [id])).toEqual([{ status: 'review', approved_at: null }]);
    expect(await db.sql("SELECT outcome FROM processed_events WHERE event_id = 'rev:attachment_0'")).toEqual([{ outcome: 'review' }]);
  });
  test('reports not_in_review for an ok invoice, and not_found for an unknown id', async () => {
    const ok = await save('ok:attachment_0');
    expect(await approve(ok.invoice_id, FIELDS, 'Laura', 'ok')).toMatchObject({ result: 'not_in_review', gmail_message_id: 'ok' });
    expect(await approve('987654')).toMatchObject({ invoice_id: '987654', gmail_message_id: null, result: 'not_found', review_left: false });
  });
  test('refuses a row whose email_id is not the invoice email, and approves nothing', async () => {
    const mine = await seedReview('mine:attachment_0');
    const other = await seedReview('other:attachment_0', { ...VALID_INVOICE, invoice_number: 'BE-3000', total: 2_000_000 });
    // A pasted or edited invoice_id: this row (email "mine") now names the other invoice.
    expect(await approve(other, FIELDS, 'Laura', 'mine')).toMatchObject({ result: 'row_mismatch', gmail_message_id: 'other' });
    expect(await approve(mine, FIELDS, 'Laura', '')).toMatchObject({ result: 'row_mismatch' });
    expect(await db.sql('SELECT status, approved_at FROM invoices ORDER BY id')).toEqual([
      { status: 'review', approved_at: null }, { status: 'review', approved_at: null }]);
    expect(await db.sql('SELECT outcome FROM processed_events ORDER BY received_at, event_id')).toEqual([{ outcome: 'review' }, { outcome: 'review' }]);
  });
  test('review_left is true while another attachment of the email still needs a person', async () => {
    const first = await seedSibling('m1:attachment_0', 'review', 'BE-2041');
    await seedSibling('m1:attachment_1', 'review', 'BE-2042');
    expect(await approve(first, FIELDS, 'Laura', 'm1')).toMatchObject({ result: 'approved', review_left: true });
    // Another email's review invoice doesn't count, and a finished sibling doesn't either.
    const solo = await seedSibling('m2:attachment_0', 'review', 'BE-2050');
    await seedSibling('m2:attachment_1', 'ok', 'BE-2051');
    expect(await approve(solo, { ...FIELDS, invoice_number: 'BE-2050' }, 'Laura', 'm2')).toMatchObject({ result: 'approved', review_left: false });
  });
  test('review_left counts an unfinished or duplicate sibling event, and not the approved invoice own event', async () => {
    const a = await seedSibling('m3:attachment_0', 'review', 'BE-2060');
    await db.run('record-event.sql', ['m3:attachment_1', 'm3.pdf']);
    expect(await approve(a, { ...FIELDS, invoice_number: 'BE-2060' }, 'Laura', 'm3')).toMatchObject({ result: 'approved', review_left: true });
    await db.run('record-outcome.sql', ['m3:attachment_1', 'duplicate', a]);
    // A replay now sees a duplicate sibling event of the same email.
    expect(await approve(a, { ...FIELDS, invoice_number: 'BE-2060' }, 'Laura', 'm3')).toMatchObject({ result: 'already_approved', review_left: true });
    const b = await seedSibling('m4:attachment_0', 'review', 'BE-2070');
    expect(await approve(b, { ...FIELDS, invoice_number: 'BE-2070' }, 'Laura', 'm4')).toMatchObject({ review_left: false });
  });
  test('a call that raced an approval reports already_approved, not not_in_review', async () => {
    const id = await seedReview();
    const text = readFileSync('db/queries/approve-invoice.sql', 'utf8');
    const params = [String(id), JSON.stringify(FIELDS), 'Laura', 'rev'];
    const clientA = await db.connect();
    try {
      await clientA.query('BEGIN');
      expect((await clientA.query(text, params)).rows[0]).toMatchObject({ result: 'approved' });
      const raceB = db.sql<{ result: string }>(text, params);
      // Wait until B is blocked on A's uncommitted row (a lock it hasn't been granted).
      for (let tries = 0; ; tries++) {
        const [waiting] = await db.sql<{ n: number }>('SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted');
        if (waiting!.n > 0) break;
        if (tries === 100) throw new Error('the racing approval never blocked on the first one');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await clientA.query('COMMIT');
      expect((await raceB)[0]).toMatchObject({ result: 'already_approved', gmail_message_id: 'rev' });
    } finally {
      clientA.release();
    }
  });
});
