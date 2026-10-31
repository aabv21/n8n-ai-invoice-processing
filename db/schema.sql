CREATE TABLE invoices (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_event_id  text NOT NULL UNIQUE,
  gmail_message_id text NOT NULL,
  received_at      timestamptz NOT NULL,
  status           text NOT NULL CHECK (status IN ('ok', 'review')),
  review_reasons   text[] NOT NULL DEFAULT '{}',
  supplier         text,
  supplier_tax_id  text,
  invoice_number   text,
  issue_date       date,
  due_date         date,
  currency         char(3),
  subtotal         numeric(18, 2),
  tax              numeric(18, 2),
  total            numeric(18, 2),
  confidence       numeric(4, 3),
  extraction_path  text NOT NULL CHECK (extraction_path IN ('text', 'vision', 'none')),
  model            text,
  attempts         smallint NOT NULL CHECK (attempts BETWEEN 0 AND 2),
  raw_extraction   jsonb,
  drive_file_name  text NOT NULL,
  drive_folder     text NOT NULL,
  drive_file_id    text,
  drive_url        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_tax_id, invoice_number)
);
CREATE INDEX invoices_received_at_idx ON invoices (received_at);
CREATE INDEX invoices_due_date_idx ON invoices (due_date);

CREATE TABLE invoice_items (
  invoice_id  bigint NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_no     smallint NOT NULL,
  description text NOT NULL,
  quantity    numeric(14, 3),
  unit_price  numeric(18, 4),
  line_total  numeric(18, 2),
  PRIMARY KEY (invoice_id, line_no)
);

CREATE TABLE processed_events (
  source      text NOT NULL,
  event_id    text NOT NULL,
  file_name   text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  outcome     text CHECK (outcome IN ('ok', 'review', 'duplicate')),
  invoice_id  bigint REFERENCES invoices (id),
  PRIMARY KEY (source, event_id)
);
CREATE INDEX processed_events_received_at_idx ON processed_events (received_at);
