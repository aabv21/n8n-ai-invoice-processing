-- Sets the Drive file id and share URL on a saved invoice, then hands back the updated row and
-- its line items (ordered for the Sheets append) in one round trip.
-- $1 invoice_id (bigint)
-- $2 drive_file_id (text)
-- $3 drive_url (text)
WITH updated AS (
  UPDATE invoices
  SET drive_file_id = $2, drive_url = $3
  WHERE id = $1::bigint
  RETURNING *
)
SELECT
  to_jsonb(updated) AS invoice,
  COALESCE(
    (SELECT jsonb_agg(to_jsonb(item) ORDER BY item.line_no) FROM invoice_items item WHERE item.invoice_id = updated.id),
    '[]'::jsonb
  ) AS items
FROM updated;
