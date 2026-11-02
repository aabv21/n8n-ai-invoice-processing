-- processed_events.source holds what db/queries/record-event.sql writes: the literal 'gmail'.
-- scripts/sql/scenario-report.sql and scripts/check-db.ts's probe both only ever read or write
-- that same value, and so does every row tests/db/queries.test.ts inserts through record-event.sql.
-- Guarded on pg_constraint, so a second run adds nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'processed_events'::regclass AND conname = 'processed_events_source_check'
  ) THEN
    ALTER TABLE processed_events ADD CONSTRAINT processed_events_source_check CHECK (source IN ('gmail'));
  END IF;
END
$$;
