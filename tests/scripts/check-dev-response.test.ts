import { describe, expect, it } from 'vitest';
import { isSummaryPreview } from '../../scripts/check-dev-response.ts';

const EMPTY_HTML = [
  '<h1>Magdaport invoices: 2026-06-15</h1>',
  '<p>Arrived: 0 | OK: 0 | Review: 0 | Duplicates: 0</p>',
  '<p>No invoices arrived in the last 24 hours.</p>',
  '<h2>Totals by supplier</h2>',
  '<p>None.</p>',
  '<h2>Review items</h2>',
  '<p>None.</p>',
  '<h2>Due in the next 7 days</h2>',
  '<p>None.</p>',
].join('\n');

describe('isSummaryPreview', () => {
  it('accepts the exact deterministic shape an empty database renders for the fixed run_at', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-15: 0 arrived, 0 to review', html: EMPTY_HTML })).toBe(true);
  });

  it('rejects a different subject, like a non-empty day', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-15: 1 arrived, 0 to review', html: EMPTY_HTML })).toBe(false);
  });

  it('rejects a subject for a different report date', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-16: 0 arrived, 0 to review', html: EMPTY_HTML })).toBe(false);
  });

  it('rejects html missing the empty-day line', () => {
    const html = EMPTY_HTML.replace('<p>No invoices arrived in the last 24 hours.</p>\n', '');
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-15: 0 arrived, 0 to review', html })).toBe(false);
  });

  it('rejects html missing a section heading', () => {
    const html = EMPTY_HTML.replace('<h2>Due in the next 7 days</h2>\n', '');
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-15: 0 arrived, 0 to review', html })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-15: 0 arrived, 0 to review', html: EMPTY_HTML, extra: 1 })).toBe(false);
  });

  it('rejects a non-string html value', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices 2026-06-15: 0 arrived, 0 to review', html: 123 })).toBe(false);
  });

  it('rejects null, arrays, and primitives', () => {
    expect(isSummaryPreview(null)).toBe(false);
    expect(isSummaryPreview([])).toBe(false);
    expect(isSummaryPreview('preview')).toBe(false);
    expect(isSummaryPreview(undefined)).toBe(false);
  });

  it('rejects an error shape like { error: "unknown_target" }', () => {
    expect(isSummaryPreview({ error: 'unknown_target' })).toBe(false);
  });
});
