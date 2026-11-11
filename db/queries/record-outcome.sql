-- Marks a processed Gmail event's final outcome once every downstream step for it has run
-- (saved, filed in Drive and Sheets, labeled). The event's outcome stays NULL until this runs, so
-- an execution that dies partway through still shows up as unfinished rather than as a success.
-- Parameters, in order:
-- first: event_id (text)
-- second: outcome (text: 'ok' | 'review' | 'duplicate')
-- third: invoice_id (a bigint as text, or '' for a duplicate when Look up the original found no
--   original, which fails closed to Review; NULLIF stores that as NULL)
UPDATE processed_events
SET outcome = $2, invoice_id = NULLIF($3::text, '')::bigint
WHERE source = 'gmail' AND event_id = $1
RETURNING event_id, outcome;
