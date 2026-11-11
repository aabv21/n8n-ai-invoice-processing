-- Summarizes the half-open 24 hours [run - 24h, run), so an email sent at 18:00 Bogota never loses
-- invoices arriving between that run and midnight. Totals and the review list draw only from
-- finished events (a non-NULL outcome), the same population the counts use, so a still-processing
-- invoice never shows in a total. "Due soon" is the run's Bogota date through seven days after.
-- Parameter: run (timestamptz), the moment the summary is generated
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
-- Stuck events: received at least 30 minutes before the run, on any day, and still without an
-- outcome when the query runs. The 30-minute bound uses the run's own moment, not now(), so a
-- backfilled summary (a past run_at) ignores events that arrived after it; an event that has
-- finished since is no longer listed, since no history records when an outcome was set.
stuck AS (
  SELECT pe.event_id, pe.file_name, pe.received_at
  FROM processed_events pe
  CROSS JOIN bounds
  WHERE pe.outcome IS NULL AND pe.received_at < bounds.run_at - interval '30 minutes'
),
unfinished AS (
  SELECT count(*)::int AS n FROM stuck
),
-- The oldest 20 stuck events, each with its Bogota arrival time; the count above stays the total.
unfinished_list AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'event_id', s.event_id, 'file_name', s.file_name,
      'received_at', to_char(s.received_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI')
    ) ORDER BY s.received_at, s.event_id
  ) AS rows
  FROM (SELECT * FROM stuck ORDER BY received_at, event_id LIMIT 20) s
),
-- DISTINCT collapses an invoice two events reference (its arrival and a later duplicate) to one row.
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
  COALESCE(unfinished_list.rows, '[]'::jsonb) AS unfinished_events,
  COALESCE(totals.rows, '[]'::jsonb) AS totals_by_supplier,
  COALESCE(review.rows, '[]'::jsonb) AS review_items,
  COALESCE(due.rows, '[]'::jsonb) AS due_soon
FROM bounds, counts, unfinished, unfinished_list, totals, review, due;
