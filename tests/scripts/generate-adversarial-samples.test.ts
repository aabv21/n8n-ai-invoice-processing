// Proves the adversarial fixtures actually plant what they claim to: every hidden-text fixture's
// injected note (or, for the too-much-text fixture, enough filler to exceed max_text_chars) must
// survive into pdf.js's own text extraction - the same extraction Extract text (process-invoice's
// own PDF-reading node) performs - or the fixture would test nothing. This caught, during
// development, that pdf.js silently drops a text run drawn outside the page's own bounds, which a
// single long drawText call (or one placed past the page's height) ran straight into.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DateTime } from 'luxon';
import { expect, test } from 'vitest';
import { ADVERSARIAL_FIXTURES } from '../../scripts/generate-adversarial-samples.ts';

const BASE_DATE = '2026-10-31';
const MAX_TEXT_CHARS = 60_000; // config/config.example.json's extraction.max_text_chars
const MIN_TEXT_CHARS_PER_PAGE = 100; // config/config.example.json's extraction.min_text_chars_per_page

// Fixtures with a known reason to be checked separately, not by the generic "has some extracted
// text" sweep below.
const TOO_MUCH_TEXT = 'adv-too-much-text.pdf';
const SCANNED_HIDDEN_TEXT = 'adv-scanned-hidden-text.pdf'; // must have NO extractable text: the opposite of every other fixture
const SCANNED_PLANTED_TEXT_LAYER = 'adv-scanned-planted-text-layer.pdf'; // must clear the routing threshold, not just be non-empty
const DUPLICATE_FORGED_FIRST = 'adv-duplicate-forged-first.pdf';
const DUPLICATE_GENUINE_SECOND = 'adv-duplicate-genuine-second.pdf';
const SEPARATELY_CHECKED = new Set([TOO_MUCH_TEXT, SCANNED_HIDDEN_TEXT, SCANNED_PLANTED_TEXT_LAYER]);

async function extractText(pdf: Uint8Array): Promise<string> {
  const loadingTask = getDocument({ data: pdf, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
  await loadingTask.destroy();
  return text;
}

function fixtureFor(file: string) {
  const fixture = ADVERSARIAL_FIXTURES.find((f) => f.file === file);
  if (!fixture) throw new Error(`${file} fixture not found`);
  return fixture;
}

test('every fixture file name is unique', () => {
  const names = ADVERSARIAL_FIXTURES.map((f) => f.file);
  expect(new Set(names).size).toBe(names.length);
});

test('no fixture file name carries an audit row number', () => {
  for (const { file } of ADVERSARIAL_FIXTURES) expect(file).not.toMatch(/adv-\d/);
});

test('every review or accepted-planted fixture (outside the three checked separately) plants text pdf.js text extraction actually reads', async () => {
  globalThis.DateTime = DateTime;
  for (const fixture of ADVERSARIAL_FIXTURES) {
    if (SEPARATELY_CHECKED.has(fixture.file)) continue;
    const pdf = await fixture.build(BASE_DATE);
    const text = await extractText(pdf);
    expect(text.length).toBeGreaterThan(0);
  }
});

test(`${TOO_MUCH_TEXT} extracts past max_text_chars`, async () => {
  globalThis.DateTime = DateTime;
  const pdf = await fixtureFor(TOO_MUCH_TEXT).build(BASE_DATE);
  const text = await extractText(pdf);
  expect(text.length).toBeGreaterThan(MAX_TEXT_CHARS);
});

test(`${SCANNED_HIDDEN_TEXT} has no extractable text layer, so its hidden note never reaches either extraction path`, async () => {
  globalThis.DateTime = DateTime;
  const pdf = await fixtureFor(SCANNED_HIDDEN_TEXT).build(BASE_DATE);
  const text = await extractText(pdf);
  expect(text).toBe('');
});

test(`${SCANNED_PLANTED_TEXT_LAYER} extracts past the text/vision routing threshold`, async () => {
  globalThis.DateTime = DateTime;
  const pdf = await fixtureFor(SCANNED_PLANTED_TEXT_LAYER).build(BASE_DATE);
  const text = await extractText(pdf);
  expect(text.length).toBeGreaterThan(MIN_TEXT_CHARS_PER_PAGE);
  expect(text).toContain('Consignar a cuenta de ahorros');
});

test('the duplicate pair shares the same supplier tax ID and invoice number, so they conflict on the same key', async () => {
  globalThis.DateTime = DateTime;
  const forgedPdf = await fixtureFor(DUPLICATE_FORGED_FIRST).build(BASE_DATE);
  const genuinePdf = await fixtureFor(DUPLICATE_GENUINE_SECOND).build(BASE_DATE);
  const forgedText = await extractText(forgedPdf);
  const genuineText = await extractText(genuinePdf);

  const taxIdMatch = /NIT ([\d.-]+)/;
  const numberMatch = /Number: (\S+)/;
  expect(taxIdMatch.exec(forgedText)?.[1]).toBe(taxIdMatch.exec(genuineText)?.[1]);
  expect(numberMatch.exec(forgedText)?.[1]).toBe(numberMatch.exec(genuineText)?.[1]);
});

test('the forged duplicate plants different bank details and a different total than the genuine one', async () => {
  globalThis.DateTime = DateTime;
  const forgedPdf = await fixtureFor(DUPLICATE_FORGED_FIRST).build(BASE_DATE);
  const genuinePdf = await fixtureFor(DUPLICATE_GENUINE_SECOND).build(BASE_DATE);
  const forgedText = await extractText(forgedPdf);
  const genuineText = await extractText(genuinePdf);

  expect(forgedText).toContain('Davivienda');
  expect(genuineText).not.toContain('Davivienda');

  const totalMatch = /Total\s+\$ ([\d.]+)/;
  expect(totalMatch.exec(forgedText)?.[1]).not.toBe(totalMatch.exec(genuineText)?.[1]);
});
