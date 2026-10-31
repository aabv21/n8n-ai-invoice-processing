-- Builds one ScenarioRow per Gmail event received since $1, for comparing an offline scenario run
-- against samples/expected.json. A duplicate's row carries no invoice of its own; its
-- duplicate_of_file is the file name of the earliest event that reached the same invoice row.
-- $1 since (timestamptz)
WITH events AS (
  SELECT *
  FROM processed_events pe
  WHERE pe.source = 'gmail' AND pe.received_at >= $1::timestamptz
),
originals AS (
  SELECT DISTINCT ON (invoice_id) invoice_id, file_name
  FROM processed_events
  WHERE invoice_id IS NOT NULL
  ORDER BY invoice_id, received_at
)
SELECT jsonb_agg(
  jsonb_build_object(
    'file_name', events.file_name,
    'outcome', events.outcome,
    'extraction_path', i.extraction_path,
    'invoice', CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object(
      'supplier', i.supplier, 'supplier_tax_id', i.supplier_tax_id, 'invoice_number', i.invoice_number,
      'issue_date', i.issue_date, 'due_date', i.due_date, 'currency', i.currency,
      'subtotal', i.subtotal, 'tax', i.tax, 'total', i.total, 'confidence', i.confidence,
      'line_items', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'line_no', li.line_no, 'description', li.description,
          'quantity', li.quantity, 'unit_price', li.unit_price, 'line_total', li.line_total
        ) ORDER BY li.line_no) FROM invoice_items li WHERE li.invoice_id = i.id),
        '[]'::jsonb
      )
    ) END,
    'review_reasons', COALESCE(to_jsonb(i.review_reasons), '[]'::jsonb),
    'drive_file_name', i.drive_file_name,
    'duplicate_of_file', CASE WHEN events.outcome = 'duplicate' THEN originals.file_name END
  ) ORDER BY events.received_at
) AS report
FROM events
LEFT JOIN invoices i ON i.id = events.invoice_id
LEFT JOIN originals ON originals.invoice_id = events.invoice_id AND events.outcome = 'duplicate';
