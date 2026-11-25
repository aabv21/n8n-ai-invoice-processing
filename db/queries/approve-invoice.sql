-- Approves a review invoice a reviewer corrected in the Invoices tab: saves the corrected header
-- fields, marks the invoice ok with no review reasons, stamps who approved it and when, and marks
-- its event ok. Always returns exactly one row: invoice_id, gmail_message_id (NULL when the invoice
-- doesn't exist), result, review_left, and the header the database holds for the invoice.
-- result is one of approved, already_approved, duplicate_key, not_in_review, not_found or
-- row_mismatch (the row's email_id isn't the invoice's gmail_message_id, so its invoice_id was
-- edited or pasted from another row). A replay changes nothing and reports already_approved; its
-- header columns are the values saved by the first approval, not the replay's cells.
-- review_left is true when another attachment of the same email still needs a person (its event
-- is unfinished, in review or a duplicate), so the Review label must stay on the email.
-- Dates are text and amounts are float8, so n8n's Postgres node returns plain values.
-- Parameters, in order:
-- first: invoice_id (a bigint as text)
-- second: the approved fields (JSON text: supplier, supplier_tax_id, invoice_number, issue_date,
--   due_date, currency, subtotal, tax, total)
-- third: approved_by (text)
-- fourth: email_id (text): the row's email_id, which must equal the invoice's gmail_message_id
-- target locks the row: a call that raced an approval waits for it, then reads the approved row
-- instead of its own earlier snapshot, so it answers already_approved, not not_in_review.
-- NOTE: Postgres runs a data-modifying CTE whether or not the final SELECT reads it, so the
-- outcome CTE below updates the event even though nothing selects from it.
WITH f AS (
  SELECT * FROM jsonb_to_record($2::jsonb) AS f(
    supplier text, supplier_tax_id text, invoice_number text, issue_date date, due_date date,
    currency text, subtotal numeric(18,2), tax numeric(18,2), total numeric(18,2))
),
target AS (
  SELECT id, source_event_id, gmail_message_id, status, approved_at,
    supplier, supplier_tax_id, invoice_number, issue_date, due_date, currency, subtotal, tax, total
  FROM invoices WHERE id = $1::bigint FOR UPDATE
),
clash AS (
  SELECT 1 FROM invoices i, f
  WHERE i.supplier_tax_id = f.supplier_tax_id AND i.invoice_number = f.invoice_number AND i.id <> $1::bigint
),
updated AS (
  UPDATE invoices i SET
    supplier = f.supplier, supplier_tax_id = f.supplier_tax_id, invoice_number = f.invoice_number,
    issue_date = f.issue_date, due_date = f.due_date, currency = f.currency,
    subtotal = f.subtotal, tax = f.tax, total = f.total,
    status = 'ok', review_reasons = '{}', approved_by = $3, approved_at = now()
  FROM f
  WHERE i.id = $1::bigint AND i.gmail_message_id = $4::text AND i.status = 'review'
    AND NOT EXISTS (SELECT 1 FROM clash)
  RETURNING i.id, i.supplier, i.supplier_tax_id, i.invoice_number, i.issue_date, i.due_date,
    i.currency, i.subtotal, i.tax, i.total
),
outcome AS (
  UPDATE processed_events pe SET outcome = 'ok'
  FROM updated WHERE pe.invoice_id = updated.id AND pe.outcome = 'review'
  RETURNING pe.event_id
)
SELECT $1::text AS invoice_id, t.gmail_message_id,
  CASE
    WHEN t.id IS NULL THEN 'not_found'
    WHEN t.gmail_message_id <> $4::text THEN 'row_mismatch'
    WHEN u.id IS NOT NULL THEN 'approved'
    WHEN t.status = 'ok' AND t.approved_at IS NOT NULL THEN 'already_approved'
    WHEN EXISTS (SELECT 1 FROM clash) THEN 'duplicate_key'
    ELSE 'not_in_review'
  END AS result,
  EXISTS (
    SELECT 1 FROM processed_events pe
    WHERE pe.source = 'gmail'
      AND left(pe.event_id, length(t.gmail_message_id) + 1) = t.gmail_message_id || ':'
      AND pe.event_id <> t.source_event_id
      AND (pe.outcome IS NULL OR pe.outcome IN ('review', 'duplicate'))
  ) AS review_left,
  COALESCE(u.supplier, t.supplier) AS supplier,
  COALESCE(u.supplier_tax_id, t.supplier_tax_id) AS supplier_tax_id,
  COALESCE(u.invoice_number, t.invoice_number) AS invoice_number,
  to_char(COALESCE(u.issue_date, t.issue_date), 'YYYY-MM-DD') AS issue_date,
  to_char(COALESCE(u.due_date, t.due_date), 'YYYY-MM-DD') AS due_date,
  COALESCE(u.currency, t.currency) AS currency,
  COALESCE(u.subtotal, t.subtotal)::float8 AS subtotal,
  COALESCE(u.tax, t.tax)::float8 AS tax,
  COALESCE(u.total, t.total)::float8 AS total
FROM (SELECT 1) one LEFT JOIN target t ON true LEFT JOIN updated u ON true;
