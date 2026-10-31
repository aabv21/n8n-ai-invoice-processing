-- Summarizes the 24 hours ending at the run's timestamp, for an email sent at a fixed local time
-- (18:00 Bogota) that must not lose invoices arriving between that run and midnight. The window is
-- half-open: [run - 24h, run). The totals and review list only draw from invoices whose event has
-- actually finished (a non-NULL outcome) -- the same population the counts use -- so a saved but
-- still-processing invoice never appears in a total while missing from its own outcome count.
-- "Due soon" stays a calendar-date window: the run's own Bogota date through seven days after it.
-- $1 run (timestamptz): the moment the summary is generated
WITH bounds AS (
  SELECT
    $1::timestamptz AS run_at,
    $1::timestamptz - interval '24 hours' AS window_start,
    ($1::timestamptz AT TIME ZONE 'America/Bogota')::date AS report_date
),
window_events AS (
  SELECT pe.*
  FROM processed_events pe
  CROSS JOIN bounds
  WHERE pe.received_at >= bounds.window_start AND pe.received_at < bounds.run_at
),
counts AS (
  SELECT
    count(*)::int AS arrived,
    count(*) FILTER (WHERE outcome = 'ok')::int AS ok,
    count(*) FILTER (WHERE outcome = 'review')::int AS review,
    count(*) FILTER (WHERE outcome = 'duplicate')::int AS duplicates
  FROM window_events
),
unfinished AS (
  SELECT count(*)::int AS n
  FROM processed_events
  WHERE outcome IS NULL AND received_at < now() - interval '30 minutes'
),
-- Only invoices whose processed_events row has actually finished (outcome IS NOT NULL). DISTINCT
-- collapses an invoice that two events reference (its own arrival, plus a later duplicate of it)
-- back to one row, so it isn't double-counted.
finished_invoices AS (
  SELECT DISTINCT i.*
  FROM invoices i
  JOIN processed_events pe ON pe.invoice_id = i.id
  WHERE pe.outcome IS NOT NULL
),
totals AS (
  SELECT jsonb_agg(
    jsonb_build_object('supplier', t.supplier, 'currency', t.currency, 'invoices', t.invoices, 'total', t.total)
    ORDER BY t.supplier, t.currency
  ) AS rows
  FROM (
    SELECT fi.supplier, fi.currency, count(*)::int AS invoices, sum(fi.total) AS total
    FROM finished_invoices fi
    CROSS JOIN bounds
    WHERE fi.status = 'ok' AND fi.received_at >= bounds.window_start AND fi.received_at < bounds.run_at
    GROUP BY fi.supplier, fi.currency
  ) t
),
review AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'supplier', r.supplier, 'invoice_number', r.invoice_number, 'currency', r.currency,
      'total', r.total, 'review_reasons', to_jsonb(r.review_reasons), 'drive_url', r.drive_url
    ) ORDER BY r.received_at
  ) AS rows
  FROM (
    SELECT fi.supplier, fi.invoice_number, fi.currency, fi.total, fi.review_reasons, fi.drive_url, fi.received_at
    FROM finished_invoices fi
    CROSS JOIN bounds
    WHERE fi.status = 'review' AND fi.received_at >= bounds.window_start AND fi.received_at < bounds.run_at
  ) r
),
due AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'supplier', d.supplier, 'invoice_number', d.invoice_number, 'due_date', d.due_date,
      'currency', d.currency, 'total', d.total, 'status', d.status
    ) ORDER BY d.due_date, d.supplier
  ) AS rows
  FROM (
    SELECT i.supplier, i.invoice_number, i.due_date, i.currency, i.total, i.status
    FROM invoices i
    CROSS JOIN bounds
    WHERE i.due_date BETWEEN bounds.report_date AND bounds.report_date + 7
  ) d
)
SELECT
  bounds.report_date::text AS report_date,
  counts.arrived, counts.ok, counts.review, counts.duplicates,
  unfinished.n AS unfinished,
  COALESCE(totals.rows, '[]'::jsonb) AS totals_by_supplier,
  COALESCE(review.rows, '[]'::jsonb) AS review_items,
  COALESCE(due.rows, '[]'::jsonb) AS due_soon
FROM bounds, counts, unfinished, totals, review, due;
