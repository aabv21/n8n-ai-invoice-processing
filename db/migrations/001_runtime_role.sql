-- The runtime role n8n's app credential connects as: DML on the tables listed below and nothing
-- else, so no DDL, no TRUNCATE, and no access to n8n's own database. docs/database.md maps every
-- statement the workflows issue to the grant that covers it. db-migrate sets the role's password
-- from APP_RUNTIME_DB_PASSWORD after every run, so this file only creates the role.
\getenv runtime_role APP_RUNTIME_DB_USER

SELECT format('CREATE ROLE %I LOGIN', :'runtime_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

-- Postgres 15 and later already withhold CREATE on public from PUBLIC; this states it outright.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Guarded on the database existing, not just run \gexec unconditionally: pnpm run test:db points
-- this same migration at testdb (see db-migrate.ts's DB_MIGRATE_CONTAINER), which never has an
-- n8n database of its own, and a plain REVOKE ALL ON DATABASE n8n would fail there with
-- "database does not exist" before the grants below ever ran.
SELECT 'REVOKE ALL ON DATABASE n8n FROM ' || quote_ident(:'runtime_role')
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = 'n8n')
\gexec

-- current_database(), not the literal app: pnpm run test:db runs this same migration against
-- testdb's own "postgres" database (see db-migrate.ts's DB_MIGRATE_CONTAINER), which has no
-- database named app at all.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_role')
\gexec
GRANT USAGE ON SCHEMA public TO :"runtime_role";

-- intake-email's "Record event" inserts a row per Gmail attachment and reads it back
-- (ON CONFLICT's own check needs SELECT too); daily-summary's "Query summary" reads it;
-- process-invoice's "Record duplicate"/"Record outcome" set its outcome once processing finishes.
GRANT SELECT, INSERT, UPDATE ON processed_events TO :"runtime_role";

-- process-invoice's "Save invoice" inserts a row once per event and reads it back on a replay;
-- "Save Drive link" updates it with the filed Drive id/url; daily-summary's "Query summary" reads
-- it. The id column is GENERATED ALWAYS AS IDENTITY: its implicit nextval() runs with no
-- privilege check on the backing sequence (proven empirically; see 003_drop_sequence_grant.sql),
-- so this role needs no grant on invoices_id_seq at all.
GRANT SELECT, INSERT, UPDATE ON invoices TO :"runtime_role";

-- "Save invoice" inserts each line item once; "Save Drive link" reads them back, ordered, for the
-- Sheets append. Nothing ever updates or deletes a line item once saved.
GRANT SELECT, INSERT ON invoice_items TO :"runtime_role";
