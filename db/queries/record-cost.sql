-- Keeps the estimated AI cost of an attachment's extraction on its event, so the daily budget counts
-- it even when the run later dies or the invoice turns out to be a duplicate. GREATEST means a
-- lower figure never replaces a higher one already saved (Save invoice stores the final total,
-- the retry included, and this statement stores the first pass beside it).
-- Parameters, in order:
-- first: event_id (text)
-- second: ai_cost_usd (numeric, USD)
UPDATE processed_events
SET ai_cost_usd = GREATEST(ai_cost_usd, $2::numeric)
WHERE source = 'gmail' AND event_id = $1
RETURNING event_id, ai_cost_usd::float8 AS ai_cost_usd;
