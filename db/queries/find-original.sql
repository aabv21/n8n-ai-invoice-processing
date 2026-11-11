-- Reads back the invoice that already holds a duplicate's supplier tax ID and invoice number, in a
-- statement of its own. save-invoice.sql reports the original too, but when two copies of one
-- invoice save at the same moment, the losing statement's snapshot can't see the winner's row and
-- reports none. This statement starts after that save returned, so its snapshot sees every row
-- committed by then. Always one row: NULLs when no invoice holds the key, which the caller treats
-- as a conflict (fail closed). issue_date goes out as YYYY-MM-DD text, never a JS Date.
-- Parameters, in order:
-- first: supplier_tax_id (text, normalized)
-- second: invoice_number (text, normalized)
SELECT o.id, o.total, to_char(o.issue_date, 'YYYY-MM-DD') AS issue_date
FROM (SELECT 1) AS one
LEFT JOIN invoices o ON o.supplier_tax_id = $1 AND o.invoice_number = $2;
