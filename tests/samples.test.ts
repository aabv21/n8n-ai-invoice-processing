import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test } from 'vitest';
import { invoiceFileName } from '../src/lib/file-name.ts';
import { renderInvoicePdf, renderPage } from '../scripts/lib/invoice-pdf.ts';
import { BUYER, COPY_OF_FIRST, SAMPLES, type SampleExpectation } from '../scripts/lib/sample-invoices.ts';

const expected = JSON.parse(readFileSync('samples/expected.json', 'utf8')) as { base_date: string; samples: SampleExpectation[] };
const bytes = (file: string) => new Uint8Array(readFileSync(`samples/${file}`));
const open = (file: string) => getDocument({ data: bytes(file) }).promise;
const textOf = async (file: string) => {
  const doc = await open(file);
  const pages = await Promise.all(Array.from({ length: doc.numPages }, async (_, i) =>
    (await (await doc.getPage(i + 1)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ')));
  return pages.join('\n');
};
const sha = (file: string) => createHash('sha256').update(bytes(file)).digest('hex');
const dianCheckDigit = (digits: string): number => {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- digits are ASCII 0-9, one UTF-16 code unit each; no surrogate pairs to mishandle
  const r = [...digits].reverse().reduce((sum, d, i) => sum + Number(d) * (weights[i] ?? 0), 0) % 11;
  return r > 1 ? 11 - r : r;
};

test('the six samples are listed in order', () => expect(expected.samples.map((s) => s.file)).toEqual([
  'invoice-01-two-items.pdf', 'invoice-02-ten-items.pdf', 'invoice-03-usd.pdf',
  'invoice-04-scanned.pdf', 'invoice-05-bad-totals.pdf', 'invoice-06-copy-of-01.pdf']));
test('invoice 6 is a byte-identical copy of invoice 1', () => expect(sha(COPY_OF_FIRST)).toBe(sha('invoice-01-two-items.pdf')));
test('invoice 4 has no extractable text', async () => expect((await textOf('invoice-04-scanned.pdf')).trim()).toBe(''));
test('invoice 4 is a page image', async () => {
  const ops = await (await (await open('invoice-04-scanned.pdf')).getPage(1)).getOperatorList();
  expect(ops.fnArray).toContain(OPS.paintImageXObject);
  expect(ops.fnArray).not.toContain(OPS.showText);
});
test('the text samples carry supplier and number in their text layer', async () => {
  for (const s of SAMPLES.filter((x) => !x.scanned)) {
    const text = await textOf(s.file);
    expect(text).toContain(s.supplier);
    expect(text).toContain(s.invoice_number);
  }
});
test('invoice 2 spans several pages and lists ten items', async () => {
  expect((await open('invoice-02-ten-items.pdf')).numPages).toBeGreaterThanOrEqual(2);
  expect(expected.samples[1]?.invoice?.line_items).toHaveLength(10);
});
test('only invoice 5 has totals that do not add up', () => {
  for (const s of expected.samples.filter((x) => x.invoice)) {
    const i = s.invoice!;
    expect(Math.abs((i.subtotal ?? 0) + (i.tax ?? 0) - (i.total ?? 0)) > 1).toBe(s.file === 'invoice-05-bad-totals.pdf');
  }
});
test('every printed NIT fails the DIAN check digit', () => {
  const nits = [BUYER.tax_id_printed, ...SAMPLES.filter((s) => s.currency === 'COP').map((s) => s.supplier_tax_id_printed)];
  for (const nit of nits) {
    // A printed label ahead of the digits (e.g. "NIT 901.384.552-2") would make `Number(dv)` NaN
    // below, and the check after it would pass without checking anything.
    expect(nit).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d$/);
    const [body = '', dv = ''] = nit.replace(/\./g, '').split('-');
    expect(dianCheckDigit(body)).not.toBe(Number(dv));
  }
});
test('regenerating with the recorded base date reproduces the text samples byte for byte', async () => {
  for (const s of SAMPLES.filter((x) => !x.scanned))
    expect(Buffer.from(await renderInvoicePdf(s, expected.base_date)).equals(Buffer.from(bytes(s.file)))).toBe(true);
});
test('expected Drive names come from the shared file-name rule', () => {
  for (const s of expected.samples.filter((x) => x.invoice)) {
    const i = s.invoice!;
    expect(s.drive_file_name).toBe(invoiceFileName({ issue_date: i.issue_date, supplier: i.supplier, invoice_number: i.invoice_number,
      received_at: `${expected.base_date}T12:00:00Z`, event_id: 'unused' }).name);
  }
});
test('the scan is rendered from visible text', async () => {
  const canvas = await renderPage(await renderInvoicePdf(SAMPLES[3]!, '2026-10-30'), 1, 100);
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 128) dark++;
  expect(dark / (data.length / 4)).toBeGreaterThan(0.01);
});
