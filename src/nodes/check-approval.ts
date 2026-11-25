// Decides whether a reviewer's corrected Invoices row can be approved. The row is normalized with
// the same rules as an extracted invoice, then checked by validateInvoice's own rules: every
// required field, and the hard checks (a total above zero, a supplier that isn't the buyer, dates
// in order and not in the future). Only the checks about reading the PDF are exempt: the totals
// and line-item arithmetic and the model's confidence, since the reviewer's word is the approval.
// A refusal is a note for the row, never an error. Pure: no I/O, no clock.
import type { NormalizedInvoice, ReviewReason } from '../lib/invoice.ts';
import { normalizeInvoice } from '../lib/normalize-invoice.ts';
import { sheetDate, sheetText } from '../lib/sheet-values.ts';
import { APPROVAL_STRINGS, reasonLabel } from '../lib/strings.ts';
import { validateInvoice } from '../lib/validate-invoice.ts';

export interface ApprovalRow {
  invoice_id: unknown;
  email_id: unknown;
  approved_by: unknown;
  supplier: unknown;
  supplier_tax_id: unknown;
  invoice_number: unknown;
  issue_date: unknown;
  due_date: unknown;
  currency: unknown;
  subtotal: unknown;
  tax: unknown;
  total: unknown;
}

export type ApprovalResult =
  | { ok: true; invoice_id: string; email_id: string; approved_by: string; invoice: Omit<NormalizedInvoice, 'line_items' | 'confidence'> }
  | { ok: false; invoice_id: string; email_id: string; note: string };

const MAX_APPROVER_LENGTH = 100;
// A bigint holds 19 digits, so 18 always fits `$1::bigint`.
const ID_RE = /^\d{1,18}$/;
// Checks about reading the PDF, which a reviewer's correction replaces.
const READING_CHECKS: ReadonlySet<ReviewReason> = new Set(['totals_mismatch', 'line_items_mismatch', 'line_items_incomplete', 'low_confidence']);
// With no line items and no confidence, these rules can only trip on the checks above, which are exempt.
const NO_ARITHMETIC = { totals_tolerance: Number.MAX_SAFE_INTEGER, min_confidence: 0 } as const;

export function run(input: { row: ApprovalRow; team_locale?: 'en' | 'es'; buyer_tax_id: string; today: string }): ApprovalResult {
  const locale = input.team_locale ?? 'en';
  // eslint-disable-next-line security/detect-object-injection -- locale is typed to APPROVAL_STRINGS's own two keys, not user input
  const t = APPROVAL_STRINGS[locale];
  const { row } = input;
  const emailId = sheetText(row.email_id) ?? '';

  const id = sheetText(row.invoice_id);
  if (id === null || !ID_RE.test(id)) return { ok: false, invoice_id: id ?? '', email_id: emailId, note: t.badId };

  const approvedBy = sheetText(row.approved_by);
  if (approvedBy === null || approvedBy.length > MAX_APPROVER_LENGTH) return { ok: false, invoice_id: id, email_id: emailId, note: t.badApprover };

  const { invoice, reasons } = normalizeInvoice({
    supplier: sheetText(row.supplier),
    supplier_tax_id: sheetText(row.supplier_tax_id),
    invoice_number: sheetText(row.invoice_number),
    issue_date: sheetDate(row.issue_date),
    due_date: sheetDate(row.due_date),
    currency: sheetText(row.currency),
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    line_items: [],
  });

  // As in checkInvoice, a field reported as invalid isn't also reported as missing.
  const reported = new Set<string>(reasons);
  const found = validateInvoice(invoice, { ...NO_ARITHMETIC, buyer_tax_id: input.buyer_tax_id }, input.today).filter(
    (reason) =>
      !READING_CHECKS.has(reason) &&
      !(reason === 'missing_issue_date' && reported.has('invalid_issue_date')) &&
      !(reason === 'missing_currency' && reported.has('invalid_currency')) &&
      !(reported.has('amount_out_of_range') && ['missing_subtotal', 'missing_tax', 'missing_total'].includes(reason)),
  );
  const problems = [...reasons, ...found];
  if (problems.length > 0) {
    const list = problems.map((reason) => reasonLabel(reason, locale)).join('; ');
    return { ok: false, invoice_id: id, email_id: emailId, note: t.rejected.replace('{reasons}', list) };
  }

  const header = {
    supplier: invoice.supplier,
    supplier_tax_id: invoice.supplier_tax_id,
    invoice_number: invoice.invoice_number,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
  };
  return { ok: true, invoice_id: id, email_id: emailId, approved_by: approvedBy, invoice: header };
}
