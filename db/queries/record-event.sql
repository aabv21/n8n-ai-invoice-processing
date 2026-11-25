-- Records a newly seen Gmail attachment once. A replay (a node or UI retry) hits ON CONFLICT DO
-- NOTHING: zero rows in SQL, but n8n's Postgres node reports a non-SELECT that returns nothing as
-- one {success: true} item with no event_id.
-- Also returns ai_spent_usd: the estimated AI cost of every attachment received so far today in Bogota,
-- which process-invoice compares to ai.daily_budget_usd. The sum is cast to float8 so n8n's Postgres
-- node returns a number, not the string it returns for numeric.
-- Parameters, in order: event_id (text), file_name (text)
INSERT INTO processed_events (source, event_id, file_name)
VALUES ('gmail', $1, $2)
ON CONFLICT DO NOTHING
RETURNING
  event_id,
  to_jsonb(received_at) #>> '{}' AS received_at,
  (SELECT COALESCE(sum(ai_cost_usd), 0)::float8 FROM processed_events
   WHERE received_at >= (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')) AS ai_spent_usd;
