-- Saves a checked invoice and its line items once per event. Replaying the same event (a node
-- retry, or an owner retry from the n8n UI) returns the row it already saved instead of a second
-- one; a different event claiming the same supplier tax ID and invoice number is reported as a
-- duplicate of the invoice that already holds that pair, instead of raising a constraint error.
-- Parameters, in order:
-- first: event_id (text, the invoice's source_event_id)
-- second: gmail_message_id (text)
-- third: received_at (timestamptz)
-- fourth: status (text: 'ok' | 'review')
-- fifth: review_reasons (text, a JSON array of reason strings, e.g. '[]' or '["totals_mismatch"]')
-- sixth: extraction_path (text: 'text' | 'vision' | 'none')
-- seventh: model (text, nullable)
-- eighth: attempts (smallint)
-- ninth: invoice (text, a NormalizedInvoice JSON object, including its line_items array)
-- tenth: raw_extraction (text, a JSON value, or NULL)
-- eleventh: drive_file_name (text)
-- twelfth: drive_folder (text)
WITH replay AS (
  SELECT id FROM invoices WHERE source_event_id = $1
),
fields AS (
  SELECT *
  FROM jsonb_to_record($9::jsonb) AS f(
    supplier text, supplier_tax_id text, invoice_number text,
    issue_date date, due_date date, currency text,
    subtotal numeric(18,2), tax numeric(18,2), total numeric(18,2),
    confidence numeric(4,3)
  )
),
inserted AS (
  INSERT INTO invoices (
    source_event_id, gmail_message_id, received_at, status, review_reasons,
    supplier, supplier_tax_id, invoice_number, issue_date, due_date, currency,
    subtotal, tax, total, confidence,
    extraction_path, model, attempts, raw_extraction, drive_file_name, drive_folder
  )
  SELECT
    $1, $2, $3::timestamptz, $4, ARRAY(SELECT jsonb_array_elements_text($5::jsonb)),
    f.supplier, f.supplier_tax_id, f.invoice_number, f.issue_date, f.due_date, f.currency,
    f.subtotal, f.tax, f.total, f.confidence,
    $6, $7, $8::smallint, $10::jsonb, $11, $12
  FROM fields f
  WHERE NOT EXISTS (SELECT 1 FROM replay)
  ON CONFLICT DO NOTHING
  RETURNING id
),
items AS (
  INSERT INTO invoice_items (invoice_id, line_no, description, quantity, unit_price, line_total)
  SELECT inserted.id, li.line_no, li.description, li.quantity, li.unit_price, li.line_total
  FROM inserted
  CROSS JOIN LATERAL jsonb_to_recordset($9::jsonb -> 'line_items') AS li(
    line_no smallint, description text, quantity numeric(14,3), unit_price numeric(18,4), line_total numeric(18,2)
  )
  RETURNING invoice_id
)
SELECT
  (replay.id IS NOT NULL OR inserted.id IS NOT NULL) AS saved,
  COALESCE(replay.id, inserted.id) AS invoice_id,
  CASE WHEN replay.id IS NULL AND inserted.id IS NULL THEN dup.id END AS duplicate_of,
  -- The original's total and issue date, so the caller can tell a genuine re-send from a forged
  -- copy with the same supplier tax ID and invoice number (Review, not a silent Duplicate).
  -- issue_date goes out as YYYY-MM-DD text (to_char, not ::text, whatever the server's DateStyle): the Postgres node
  -- parses a `date` into a JS Date, which would never equal the extracted ISO date string.
  CASE WHEN replay.id IS NULL AND inserted.id IS NULL THEN dup.total END AS duplicate_of_total,
  CASE WHEN replay.id IS NULL AND inserted.id IS NULL THEN to_char(dup.issue_date, 'YYYY-MM-DD') END AS duplicate_of_issue_date,
  (SELECT count(*)::int FROM items) AS item_count
FROM fields f
LEFT JOIN replay ON true
LEFT JOIN inserted ON true
LEFT JOIN invoices dup
  ON dup.supplier_tax_id = f.supplier_tax_id
 AND dup.invoice_number = f.invoice_number
 AND replay.id IS NULL AND inserted.id IS NULL;
