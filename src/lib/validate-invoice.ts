// Applies the business rules to an already-normalized invoice, in a fixed order: missing
// required fields, date consistency, totals arithmetic, then confidence. Never recomputes a
// total - the model copies amounts as printed, so a printed arithmetic error surfaces here as
// totals_mismatch instead of being silently corrected away.
import type { NormalizedInvoice, ReviewReason, ValidationRules } from './invoice.ts';

const REQUIRED_FIELDS: ReadonlyArray<readonly [keyof NormalizedInvoice, ReviewReason]> = [
  ['supplier', 'missing_supplier'],
  ['supplier_tax_id', 'missing_supplier_tax_id'],
  ['invoice_number', 'missing_invoice_number'],
  ['issue_date', 'missing_issue_date'],
  ['currency', 'missing_currency'],
  ['subtotal', 'missing_subtotal'],
  ['tax', 'missing_tax'],
  ['total', 'missing_total'],
];

export function validateInvoice(invoice: NormalizedInvoice, rules: ValidationRules, today: string): ReviewReason[] {
  // A missing or malformed rule would otherwise make every comparison against it silently false
  // (`n > undefined` and `n < undefined` are both false), passing every invoice as ok.
  if (!Number.isFinite(rules.totals_tolerance) || !Number.isFinite(rules.min_confidence)) {
    throw new Error('validateInvoice: rules.totals_tolerance and rules.min_confidence must be finite numbers');
  }

  const reasons: ReviewReason[] = [];

  for (const [field, reason] of REQUIRED_FIELDS) {
    // eslint-disable-next-line security/detect-object-injection -- field is one of this module's own fixed keys, not user input
    if (invoice[field] === null) reasons.push(reason);
  }

  if (invoice.due_date !== null && invoice.issue_date !== null && invoice.due_date < invoice.issue_date) {
    reasons.push('due_before_issue');
  }
  if (invoice.issue_date !== null && invoice.issue_date > today) {
    reasons.push('issue_date_in_future');
  }

  if (invoice.subtotal !== null && invoice.tax !== null && invoice.total !== null) {
    // Rounded to the cent first: floating-point addition leaves sub-cent errors that a zero
    // tolerance would flag as a mismatch.
    const diff = Math.round(Math.abs(invoice.subtotal + invoice.tax - invoice.total) * 100) / 100;
    if (diff > rules.totals_tolerance) reasons.push('totals_mismatch');
  }

  // Hidden text can make the model report header totals the printed lines don't support, so the
  // lines are checked against the header. Fails closed: an empty line_items or a null line_total
  // would otherwise let a model dodge the check.
  if (invoice.subtotal !== null) {
    const incomplete = invoice.line_items.length === 0 || invoice.line_items.some((item) => item.line_total === null);
    if (incomplete) {
      reasons.push('line_items_incomplete');
    } else {
      const lineSum = invoice.line_items.reduce((sum, item) => sum + (item.line_total ?? 0), 0);
      const diff = Math.round(Math.abs(lineSum - invoice.subtotal) * 100) / 100;
      if (diff > rules.totals_tolerance) reasons.push('line_items_mismatch');
    }
  }
  if (invoice.total !== null && invoice.total <= 0) reasons.push('non_positive_total');

  if (invoice.confidence === null || invoice.confidence < rules.min_confidence) reasons.push('low_confidence');

  return reasons;
}
