-- Records a newly seen Gmail attachment once. A replayed poll for the same event (a node retry,
-- or an owner retry from the n8n UI) returns no row instead of raising a duplicate-key error.
-- $1 event_id (text)
-- $2 file_name (text)
INSERT INTO processed_events (source, event_id, file_name)
VALUES ('gmail', $1, $2)
ON CONFLICT DO NOTHING
RETURNING event_id, to_jsonb(received_at) #>> '{}' AS received_at;
