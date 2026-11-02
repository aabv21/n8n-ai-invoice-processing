-- 001_runtime_role.sql originally granted USAGE, SELECT ON invoices_id_seq to the runtime role,
-- reasoning that an INSERT into invoices.id (GENERATED ALWAYS AS IDENTITY) needs it. That's wrong:
-- an identity column's implicit nextval() runs with no privilege check on its backing sequence at
-- all. Proven empirically on Postgres 17: a role holding only SELECT, INSERT on a table with a
-- GENERATED ALWAYS AS IDENTITY column, and no grant whatsoever on that column's sequence, still
-- inserts successfully. 001 has already run on CI's fresh volumes and on an upgraded local volume,
-- so this migration revokes what it granted, idempotently, rather than editing 001 after the fact.
\getenv runtime_role APP_RUNTIME_DB_USER
REVOKE ALL ON SEQUENCE invoices_id_seq FROM :"runtime_role";
