-- processed_events.ai_cost_usd holds the estimated AI cost of an attachment's extraction, in USD:
-- every model call it took, the retry included, priced by src/lib/ai-cost.ts. It sits on the event,
-- not the invoice, so a duplicate (which saves no invoice row) and a run that dies after the model
-- call still count. db/queries/record-event.sql sums it per Bogota day for the daily budget, and
-- db/queries/daily-summary.sql reports the window's sum. Rows from before this migration hold 0.
-- Idempotent: IF NOT EXISTS.
ALTER TABLE processed_events ADD COLUMN IF NOT EXISTS ai_cost_usd numeric(12,6) NOT NULL DEFAULT 0;
