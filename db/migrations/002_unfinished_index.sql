-- daily-summary.sql's "unfinished" scan filters processed_events on outcome IS NULL AND
-- received_at < now() - interval. The baseline processed_events_received_at_idx covers the age
-- half, but a plain CREATE INDEX on (received_at) WHERE outcome IS NULL also needs the predicate
-- column indexed, not just scanned after the fact; the partial index below keeps that scan small
-- regardless of table size, since it only ever holds the rows still mid-pipeline. An index always
-- belongs to its table's owner, so this needs no SET ROLE to end up owned by app.
-- NOTE: A plain CREATE INDEX blocks writes to the table while it builds, which is brief at this
-- table's size. A large production table would take CREATE INDEX CONCURRENTLY, which can't run
-- inside db-migrate's transaction, so it would ship as a separately applied step.
CREATE INDEX IF NOT EXISTS processed_events_unfinished_idx ON processed_events (received_at) WHERE outcome IS NULL;
