import { describe, expect, it } from 'vitest';
import { isSummaryPreview } from '../../scripts/check-dev-response.ts';

const H2 = (text: string): string => `<h2 style="font-size:16px;margin:24px 0 8px;">${text}</h2>`;
const EMPTY_HTML = [
  '<div lang="en" style="max-width:640px;">',
  '<h1 style="font-size:20px;margin:0 0 4px;">Magdaport invoices</h1>',
  '<p>June 15, 2026</p>',
  '<p>No invoices arrived in the last 24 hours.</p>',
  H2('Invoices to review'),
  H2('Totals by supplier'),
  H2('Due in the next 7 days'),
  '</div>',
].join('\n');

describe('isSummaryPreview', () => {
  it('accepts the exact deterministic shape an empty database renders for the fixed run_at', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 15, 2026: 0 arrived, 0 to review', html: EMPTY_HTML })).toBe(true);
  });

  it('rejects a different subject, like a non-empty day', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 15, 2026: 1 arrived, 0 to review', html: EMPTY_HTML })).toBe(false);
  });

  it('rejects a subject for a different report date', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 16, 2026: 0 arrived, 0 to review', html: EMPTY_HTML })).toBe(false);
  });

  it('rejects html missing the empty-day line', () => {
    const html = EMPTY_HTML.replace('<p>No invoices arrived in the last 24 hours.</p>\n', '');
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 15, 2026: 0 arrived, 0 to review', html })).toBe(false);
  });

  it('rejects html missing a section heading', () => {
    const html = EMPTY_HTML.replace(`${H2('Due in the next 7 days')}\n`, '');
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 15, 2026: 0 arrived, 0 to review', html })).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 15, 2026: 0 arrived, 0 to review', html: EMPTY_HTML, extra: 1 })).toBe(false);
  });

  it('rejects a non-string html value', () => {
    expect(isSummaryPreview({ subject: 'Magdaport invoices, June 15, 2026: 0 arrived, 0 to review', html: 123 })).toBe(false);
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
