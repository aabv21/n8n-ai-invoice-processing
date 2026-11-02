// Regenerates the six sample invoices and the extraction result each one should produce. Run
// before a demo so the "due in the next 7 days" section of the daily summary has entries: see
// `pnpm run samples` in the README.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { renderInvoicePdf, rasterizeToScan } from './lib/invoice-pdf.ts';
import { COPY_OF_FIRST, SAMPLES, expectations } from './lib/sample-invoices.ts';

export async function generateSamples(opts: { baseDate: string; outDir: string }): Promise<void> {
  // `invoiceFileName` (used by `expectations`) reads Luxon's `DateTime` off the global, the same
  // way the n8n Code-node sandbox provides it; nothing else sets that up outside of a test run.
  globalThis.DateTime = DateTime;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- outDir is this script's own fixed samples directory, not user input
  mkdirSync(opts.outDir, { recursive: true });

  const pdfPaths: string[] = [];
  let firstInvoiceBytes: Uint8Array | null = null;

  for (const sample of SAMPLES) {
    const textPdf = await renderInvoicePdf(sample, opts.baseDate);
    const bytes = sample.scanned ? await rasterizeToScan(textPdf) : textPdf;
    const filePath = join(opts.outDir, sample.file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is built from this script's own fixed sample file names, not user input
    writeFileSync(filePath, bytes);
    pdfPaths.push(filePath);
    firstInvoiceBytes ??= bytes; // the first sample in file order is always invoice 1, and it's never scanned
  }

  if (firstInvoiceBytes === null) throw new Error('SAMPLES must list at least the first invoice');
  const copyPath = join(opts.outDir, COPY_OF_FIRST);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- copyPath is this script's own fixed copy file name, not user input
  writeFileSync(copyPath, firstInvoiceBytes);
  pdfPaths.push(copyPath);

  const expectedPath = join(opts.outDir, 'expected.json');
  const payload = { base_date: opts.baseDate, samples: expectations(opts.baseDate) };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- expectedPath is this script's own fixed output file name, not user input
  writeFileSync(expectedPath, `${JSON.stringify(payload, null, 2)}\n`);

  for (const filePath of pdfPaths) console.log(filePath);
}

function parseBaseDate(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--base-date');
  if (flagIndex === -1) {
    const today = DateTime.now().setZone('America/Bogota').toISODate();
    if (today === null) throw new Error('could not compute today in America/Bogota');
    return today;
  }
  const value = argv[flagIndex + 1];
  if (value === undefined) throw new Error('--base-date needs a YYYY-MM-DD value');
  return value;
}

async function main(): Promise<void> {
  await generateSamples({ baseDate: parseBaseDate(process.argv.slice(2)), outDir: 'samples' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
