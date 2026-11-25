-- invoices.approved_by and invoices.approved_at record who approved a review invoice from the
-- Invoices tab and when: db/queries/approve-invoice.sql sets both together with status 'ok', and
-- approved_at is what tells a replayed approval apart from an invoice that was ok from the start.
-- Both stay NULL for every other invoice. Idempotent: IF NOT EXISTS.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_by text, ADD COLUMN IF NOT EXISTS approved_at timestamptz;
