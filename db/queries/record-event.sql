-- Records a newly seen Gmail attachment once. A replay (a node or UI retry) hits ON CONFLICT DO
-- NOTHING: zero rows in SQL, but n8n's Postgres node reports a non-SELECT that returns nothing as
-- one {success: true} item with no event_id.
-- Parameters, in order: event_id (text), file_name (text)
INSERT INTO processed_events (source, event_id, file_name)
VALUES ('gmail', $1, $2)
ON CONFLICT DO NOTHING
RETURNING event_id, to_jsonb(received_at) #>> '{}' AS received_at;
