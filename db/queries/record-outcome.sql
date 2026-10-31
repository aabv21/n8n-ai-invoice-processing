-- Marks a processed Gmail event's final outcome once every downstream step for it has run
-- (saved, filed in Drive and Sheets, labeled). The event's outcome stays NULL until this runs, so
-- an execution that dies partway through still shows up as unfinished rather than as a success.
-- $1 event_id (text)
-- $2 outcome (text: 'ok' | 'review' | 'duplicate')
-- $3 invoice_id (bigint, or NULL for a duplicate recorded against no new row)
UPDATE processed_events
SET outcome = $2, invoice_id = $3::bigint
WHERE source = 'gmail' AND event_id = $1
RETURNING event_id, outcome;
