-- Records a newly seen Gmail attachment once. A replayed poll for the same event (a node retry,
-- or an owner retry from the n8n UI) is suppressed by ON CONFLICT DO NOTHING instead of raising a
-- duplicate-key error. On the SQL side that's zero rows, but this is an INSERT, not a SELECT, so
-- n8n's Postgres node reports it as one {success: true} item with no event_id, not as zero items.
-- $1 event_id (text)
-- $2 file_name (text)
INSERT INTO processed_events (source, event_id, file_name)
VALUES ('gmail', $1, $2)
ON CONFLICT DO NOTHING
RETURNING event_id, to_jsonb(received_at) #>> '{}' AS received_at;
