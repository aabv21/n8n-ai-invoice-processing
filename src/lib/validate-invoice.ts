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
    // Rounded to the cent first: binary floating-point addition of two decimal amounts can leave
    // an error far smaller than a cent, which a zero tolerance would otherwise flag as a mismatch.
    const diff = Math.round(Math.abs(invoice.subtotal + invoice.tax - invoice.total) * 100) / 100;
    if (diff > rules.totals_tolerance) reasons.push('totals_mismatch');
  }

  if (invoice.confidence === null || invoice.confidence < rules.min_confidence) reasons.push('low_confidence');

  return reasons;
}
