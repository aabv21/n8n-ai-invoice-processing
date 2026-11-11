# Magdaport AI Invoice Processing

**Demo**

An n8n workflow that reads supplier invoices from Gmail, extracts them with Claude, files each PDF in Google Drive, lists it in Google Sheets, and flags doubtful ones for review.

**Status:** complete and verified offline, through the unit, workflow, and database suites and the local stack. The [live checks](#live-checks) below run once the Google and Anthropic accounts are connected.

## Video

Added after recording.

![Architecture: Gmail feeds gmail-entry and intake-email; process-invoice saves each invoice to Postgres, files the PDF in Google Drive, lists it in Google Sheets, and labels the email; extract-invoice calls Anthropic](docs/diagrams/architecture.svg)

## What it does

- Polls Gmail every minute for mail labeled `Invoices` with a PDF attachment, and records each attachment once, so a re-delivered email is never processed twice.
- Reads each PDF's text layer locally and sends it to Claude Haiku 5.5 as text, or sends the PDF itself when it has no usable text, such as a scan.
- Checks totals, line items, dates, and the model's confidence, and retries a doubtful invoice once on Claude Sonnet 5.5.
- Saves the invoice and its line items in Postgres, once per email and once per supplier invoice number, so a re-sent invoice becomes a `Duplicate`.
- Files the PDF in Google Drive under `Invoices/<yyyy>/<mm>`, lists the invoice and its items in Google Sheets, and labels the email `Processed`, `Review`, or `Duplicate`.
- Emails the team a summary at 18:00 Bogota time: counts, totals by supplier, the invoices to review, what falls due in the next 7 days, and any event that didn't finish.

[docs/architecture.md](docs/architecture.md) explains each part, every failure mode and its recovery, the scaling limits, and the design decisions. [docs/red-team.md](docs/red-team.md) treats the invoice PDF as untrusted input.

## Quick start

```bash
pnpm install --frozen-lockfile
node scripts/init-env.ts
cp config/config.example.json config/config.json
docker compose up -d --wait
pnpm run setup
```

`init-env.ts` writes `.env` with fresh local secrets and leaves the Anthropic, Google, and n8n API values blank. `pnpm run setup` applies the database migrations, imports the credentials whose `.env` values are set, and publishes every workflow whose trigger has its credential. Then, once:

1. Fill in `config/config.json` (see [Configuration](#configuration)), including `team_email`, which ships as a placeholder too. `Check config` rejects it while any `REPLACE_ME` placeholder remains, naming the key.
2. Fill in `ANTHROPIC_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`, and run `pnpm run setup` again to import them.
3. In n8n (`http://localhost:5678`), open the Gmail, Google Drive, and Google Sheets credentials and sign in with the demo Google account.
4. Run `pnpm run setup` once more. It publishes `gmail-entry`, which it held back until the Gmail credential existed.

## Configuration

### Google Cloud project and OAuth client

Create a Google Cloud project, enable the Gmail, Google Drive, and Google Sheets APIs, and create an OAuth client of type "Web application" with the redirect URI n8n shows on its Google credentials (`http://localhost:5678/rest/oauth2-credential/callback`). Its ID and secret go in `.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

Publish the OAuth consent screen to **Production**. In Testing, Google expires the refresh token after 7 days, and the poll and the daily summary stop until someone signs in again. The Gmail and Drive credentials keep n8n's default scopes, which are broader than this pipeline needs; [docs/architecture.md](docs/architecture.md#security-untrusted-documents-secrets-and-retention) lists them and the production step that narrows them.

### Gmail labels and filter

Create four labels: `Invoices`, `Processed`, `Review`, and `Duplicate`. Add a filter that matches `has:attachment filename:pdf` and applies `Invoices`. The trigger only sees mail that arrives after its last poll, so the label must be on an email when it arrives; labeling older mail by hand does nothing.

### Reading the label IDs

The workflows address labels by ID, not name. In n8n, create a scratch workflow with one Gmail node (resource Label, operation Get Many) on the Gmail credential, run it, copy the `id` of `Processed`, `Review`, and `Duplicate` into `gmail.label_ids`, and delete the scratch workflow.

### Drive root folder

Create a folder, for example `Invoices`, and copy its ID from the URL (`https://drive.google.com/drive/folders/<id>`) into `google.drive_root_folder_id`. The pipeline creates `<yyyy>/<mm>` folders under it.

### The spreadsheet

Create a spreadsheet with two tabs, named as `google.invoices_tab` and `google.items_tab` say (`Invoices` and `Items` by default), and copy its ID from the URL into `google.spreadsheet_id`. Row 1 of each tab holds these exact headers, one per column, in this order:

- `Invoices`: `invoice_id, received_at, supplier, supplier_tax_id, invoice_number, issue_date, due_date, currency, subtotal, tax, total, status, review_reasons, pdf_link, email_id`
- `Items`: `item_key, invoice_id, invoice_number, line_no, description, quantity, unit_price, line_total`

Both tabs are written by key (`invoice_id` and `item_key`), so a retried run updates its rows instead of adding new ones.

### Anthropic

Put the API key in `.env` as `ANTHROPIC_API_KEY`, then set a monthly spend limit in the Anthropic console. Nothing in this repo caps total spend.

### The n8n API key

`pnpm run cost` reads executions through n8n's public API. Create a key in n8n under Settings → n8n API and put it in `.env` as `N8N_API_KEY`.

### `config.json` keys

| Key | Meaning | Example |
|---|---|---|
| `team_email` | Where the daily summary and error alerts go; the example ships `REPLACE_ME`, so it must be set | `team@example.com` |
| `team_locale` | The team emails' language, `en` or `es`; missing means `en` | `en` |
| `gmail.label_ids.processed` | Label ID for a finished invoice | `Label_123456789` |
| `gmail.label_ids.review` | Label ID for an invoice a person must check | `Label_234567891` |
| `gmail.label_ids.duplicate` | Label ID for a re-sent invoice | `Label_345678912` |
| `google.drive_root_folder_id` | The Drive folder that holds `<yyyy>/<mm>` | the folder's ID |
| `google.spreadsheet_id` | The spreadsheet with both tabs | the spreadsheet's ID |
| `google.invoices_tab` | The invoice tab's name | `Invoices` |
| `google.items_tab` | The line-item tab's name | `Items` |
| `ai.default_model` | The first extraction model | `claude-haiku-5-5` |
| `ai.retry_model` | The model for the one retry of a `review` verdict; `''` turns the retry off | `claude-sonnet-5-5` |
| `ai.effort` | Thinking effort, `low`, `medium`, or `high` | `low` |
| `extraction.min_text_chars_per_page` | Non-whitespace characters per page for the text path | `100` |
| `extraction.max_pages` | Pages above which a PDF goes to review with no AI call | `20` |
| `extraction.max_text_chars` | Extracted characters above which a PDF goes to review with no AI call | `60000` |
| `validation.totals_tolerance` | How far subtotal plus tax may drift from the total, in the invoice's currency | `1` |
| `validation.min_confidence` | Model confidence below which an invoice goes to review | `0.8` |

### Team email language

The daily summary and the error alert render in the language `team_locale` names: `en`, the default when the key is missing, or `es` (neutral Latin American Spanish, Colombian business register). `checkConfig` (`src/lib/config.ts`) rejects any other value. Each email's strings live in a `{ en, es }` table in `src/lib/strings.ts`; dates use Luxon's `setLocale`, and money uses `en-US` or `es-CO` separators through `formatMoney` (`src/lib/format.ts`). Escaping is the same in both languages.

**Adding a language:** add its key to both tables in `src/lib/strings.ts` (`tests/lib/strings.test.ts` checks that every key has a non-empty value), add it to `TEAM_LOCALE_VALUES` and the `Config['team_locale']` union in `src/lib/config.ts` and to `NUMBER_LOCALE` in `src/lib/format.ts`, then run `pnpm run build:workflows` and `pnpm test`.

### Upgrading an existing config

`config.json` is gitignored, so an older copy doesn't pick up new keys:

- **`team_locale`** is optional; a missing key reads as `en`.
- **`extraction.max_text_chars`** is required; copy `60000` from `config/config.example.json`. `Check config` names the key until it's there.
- **`REPLACE_ME`**: a config that still holds the example's placeholder in any key now fails `Check config`, naming the key, instead of failing later at Gmail or Drive.

After pulling a change to `compose.yaml`, run `docker compose up -d --wait` to recreate the containers under the current hardening; the named volumes stay. Add the queue-mode flags if you run that stack.

### Swapping the model provider

The text path's model is one Anthropic Chat Model sub-node under the Information Extractor in `extract-invoice`, so another provider means swapping that node. The PDF path is Anthropic-specific: it posts a Messages API body with a document block and structured output, which would need rewriting for another provider.

## Test scenarios

`samples/` holds six generated invoices and `samples/expected.json`, the result each should produce:

| # | File | Path | Status | Label | Note |
|---|---|---|---|---|---|
| 1 | `invoice-01-two-items.pdf` | text | `ok` | `Processed` | COP, two items |
| 2 | `invoice-02-ten-items.pdf` | text | `ok` | `Processed` | COP, ten items over three pages |
| 3 | `invoice-03-usd.pdf` | text | `ok` | `Processed` | USD |
| 4 | `invoice-04-scanned.pdf` | vision | `ok` | `Processed` | Image only, no text layer |
| 5 | `invoice-05-bad-totals.pdf` | text | `review` | `Review` | `totals_mismatch`: the printed total disagrees with its lines |
| 6 | `invoice-06-copy-of-01.pdf` | none | duplicate | `Duplicate` | A byte-for-byte copy of #1 |

### Send the samples

1. Run `pnpm run samples -- --base-date $(TZ=America/Bogota date +%F)`, so the due dates fall in the summary's next 7 days.
2. From the demo Gmail account, send each PDF to the same account, one per email. The filter labels each `Invoices`.
3. Send #6 last, once #1 shows `Processed`. Copies that land in the same poll don't race, since `intake-email` processes them one after the other, but whichever comes first in the poll becomes the original, so the scenario check would compare the wrong files.
4. Run `pnpm run scenarios -- --since <ISO time before step 2>`. It compares what the pipeline recorded against `samples/expected.json` and prints one `PASS` or `FAIL` per sample.

The adversarial fixtures in `samples/adversarial/` (`pnpm run adversarial -- --base-date …`) aren't part of `pnpm run scenarios`. Each one is compared by hand against its safe labels and outcomes in `samples/adversarial/expected.json`, through the procedure in [docs/red-team.md](docs/red-team.md).

### Verified offline

- **Code nodes, queries, and workflows:** every generated Code node, run as n8n's sandbox runs it; every workflow's wiring and settings, read from the committed JSON; and every query in `db/queries/` against a disposable Postgres as the runtime role, including a racing duplicate and the daily summary's window. [docs/testing.md](docs/testing.md) lists each suite.
- **The local stack:** `pnpm run setup` and `pnpm run export` round-trip every workflow unchanged, and `node scripts/check-db.ts` proves the runtime role's grants and denials.
- **Through the dev harness, with no Google or Anthropic account:** `process-invoice` saves an unreadable PDF once as a review row and stops at Drive; `intake-email` records each attachment once, carries the PDF binary into `process-invoice`, relabels an octet-stream PDF as `application/pdf`, and fails its batch once at `Fail the batch` when a call fails; `summary-preview` renders an escaped summary from real Postgres, including the list of unfinished events; and a half-filled `config.json` is rejected before any AI call.
- **CI** runs the unit, workflow, and database suites, ShellCheck, gitleaks, `pnpm audit`, actionlint, zizmor, CodeQL, and a job that boots n8n and Postgres and calls `summary-preview` end to end.

### Live checks

These need the connected Google and Anthropic accounts. Each row is one check, in the order to run them, with its exact command, or the manual action where none exists. SQL runs as the app user through a here-string (`<<<`, in bash or zsh). The dev harness labels nothing real: a fake message ID makes the final Gmail label call fail, as row 12 expects.

| # | Check | Command or action | Expected |
|---|---|---|---|
| 1 | Credentials import | `pnpm run setup` on a `.env` with every value filled | Anthropic, Gmail, Google Drive, and Google Sheets import, with no `skip` |
| 2 | Publish after sign-in | `pnpm run setup` again, after signing in to Gmail, Drive, and Sheets | No `hold gmail-entry.json` line |
| 3 | Gmail filter | Email a PDF to the demo account | It arrives labeled `Invoices` |
| 4 | OAuth Production | The Google Cloud consent screen | "In production"; seven days later, `daily-summary` still sends |
| 5 | Samples | `pnpm run samples -- --base-date $(TZ=America/Bogota date +%F)` and `pnpm run adversarial -- --base-date $(TZ=America/Bogota date +%F)`; send the six samples, then `pnpm run scenarios -- --since <ISO>` | Six `PASS` |
| 6 | Paths | `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -c "SELECT drive_file_name, extraction_path, model, attempts, status FROM invoices ORDER BY id"'` | #4 `vision`, the rest `text` |
| 7 | Request shape | #4's `extract-invoice` execution in n8n, and the text path's `Claude` sub-node | The PDF request sends `thinking: {type: adaptive}` and `output_config`, with no `temperature`, `top_p`, or `top_k`; the `Claude` sub-node shows no sampling options; the schema's type arrays and `format: date` raise no 400 or parse error on either path |
| 8 | Sonnet retry | The query from row 6, for #5 | `attempts = 2`, `model = claude-sonnet-5-5`, `status = review` |
| 9 | Drive and Sheets | The Drive root folder and the spreadsheet | 5 files under `Invoices/<yyyy>/<mm>`, named as in `samples/expected.json`; 5 `Invoices` rows and 19 `Items` rows; each `pdf_link` opens |
| 10 | Labels | The six sample emails | #1–#4 `Processed`, #5 `Review`, #6 `Duplicate` |
| 11 | Two PDFs in one email | Send `adv-usd-restatement.pdf` and `adv-implausible-line.pdf` in one email | Two events (`:attachment_0` and `:attachment_1`) and two rows |
| 12 | Octet-stream | Delete #2: `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "DELETE FROM processed_events WHERE file_name = 'invoice-02-ten-items.pdf'; DELETE FROM invoices WHERE invoice_number = 'SA-77812';"`, and trash its Drive file and its Sheets rows. Then `node scripts/dev-call.ts intake-email "{\"message_id\":\"live-octet\",\"file_name\":\"invoice-02-ten-items.pdf\",\"mime_type\":\"application/octet-stream\",\"pdf_base64\":\"$(base64 -i samples/invoice-02-ten-items.pdf)\"}"`. Clean up with `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "DELETE FROM processed_events WHERE event_id = 'live-octet:attachment_0'; DELETE FROM invoices WHERE source_event_id = 'live-octet:attachment_0';"`, and trash the new Drive file and its Sheets rows | The Drive file's type is PDF; the label call then fails on the fake message ID, so `intake-email` stops at `Fail the batch`, as expected |
| 13 | Redelivery | `MSG1=$(docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "SELECT split_part(event_id, ':', 1) FROM processed_events WHERE file_name = 'invoice-01-two-items.pdf' ORDER BY received_at LIMIT 1;")`, then `node scripts/dev-call.ts intake-email "{\"message_id\":\"$MSG1\",\"file_name\":\"invoice-01-two-items.pdf\",\"mime_type\":\"application/pdf\",\"pdf_base64\":\"$(base64 -i samples/invoice-01-two-items.pdf)\"}"`, then `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "SELECT count(*) FROM processed_events WHERE file_name = 'invoice-01-two-items.pdf';"` | The count is still 1, and no new `process-invoice` execution appears |
| 14 | ensure-folder | `node scripts/dev-call.ts ensure-folder '{"parent_id":"<drive_root_folder_id>","name":"2099"}'`, twice | The same `folder_id` both times; trash the `2099` folder afterwards |
| 15 | Error alert | `node scripts/dev-call.ts extract-invoice '{"event_id":"live-error","path":"bogus"}'`, then again with `team_locale: "es"` | `[Magdaport demo] Workflow failed: extract-invoice`, then `[Demo Magdaport] Falló el flujo: extract-invoice` |
| 16 | Invalid Anthropic key, then replay | In n8n, set the Anthropic credential's API key to `invalid`, and email `samples/adversarial/adv-implausible-line.pdf` to the demo account. 30 minutes later, `node scripts/dev-call.ts summary-preview "{\"run_at\":\"$(date -u +%FT%TZ)\",\"dry_run\":true}"`. Restore the key, open the failed `Process invoice` execution in n8n's executions list and choose **Retry with original workflow**, then `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "SELECT event_id, outcome FROM processed_events WHERE file_name = 'adv-implausible-line.pdf' ORDER BY received_at;"` | Alerts arrive and `intake-email` stops at `Fail the batch`; the preview lists `adv-implausible-line.pdf` under the unfinished line; after the retry, the newest row's outcome is `duplicate`, since row 11 saved the same invoice |
| 17 | too_many_pages | Set `extraction.max_pages: 1` in `config/config.json`; `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "DELETE FROM processed_events WHERE file_name = 'invoice-02-ten-items.pdf'; DELETE FROM invoices WHERE invoice_number = 'SA-77812';"`, and trash #2's Drive file and its Sheets rows; resend #2 by email; then restore `20` and clean up the same way | `review` with `too_many_pages` |
| 18 | Summary content | After the samples and before the drills: `node scripts/dev-call.ts summary-preview "{\"run_at\":\"$(date -u +%FT%TZ)\",\"dry_run\":false}"`, then again with `team_locale: "es"` | `Arrived: 6 \| OK: 4 \| Review: 1 \| Duplicates: 1`, in both languages; the 18:00 run arrives on its own |
| 19 | Cost | `pnpm run cost -- --since <ISO>` | The "all" total is within 5% of the Anthropic console for the same window; the table goes in [Cost per invoice](#cost-per-invoice) |
| 20 | Queue mode | `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2`, wait 15 s, then `docker inspect --format '{{.Name}} {{.HostConfig.SecurityOpt}} {{.HostConfig.CapDrop}}' $(docker compose -f compose.yaml -f compose.queue.yaml ps -q)` | `no-new-privileges` everywhere, and `CapDrop [ALL]` on `n8n` and the workers |
| 21 | Overlapping executions in queue mode | With the queue stack from row 20: `MSG3=$(docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "SELECT split_part(event_id, ':', 1) FROM processed_events WHERE file_name = 'invoice-03-usd.pdf' ORDER BY received_at LIMIT 1;")`; delete #3 with `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "DELETE FROM processed_events WHERE file_name = 'invoice-03-usd.pdf'; DELETE FROM invoices WHERE invoice_number = 'INV-3307';"`, and trash #3's Drive file and its 1 `Invoices` and 3 `Items` rows; record two events with `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "INSERT INTO processed_events (source, event_id, file_name) VALUES ('gmail', 'race-a:attachment_0', 'invoice-03-usd.pdf'), ('gmail', 'race-b:attachment_0', 'invoice-03-usd.pdf');"`; run both calls at once with `for e in race-a race-b; do node scripts/dev-call.ts process-invoice "{\"event_id\":\"${e}:attachment_0\",\"message_id\":\"$MSG3\",\"file_name\":\"invoice-03-usd.pdf\",\"received_at\":\"$(date -u +%FT%TZ)\",\"pdf_base64\":\"$(base64 -i samples/invoice-03-usd.pdf)\"}" & done; wait`; then `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "SELECT pe.event_id, pe.outcome, pe.invoice_id, (SELECT count(*) FROM invoices WHERE invoice_number = 'INV-3307') AS invoice_rows FROM processed_events pe WHERE pe.event_id LIKE 'race-%' ORDER BY 1;"` | `invoice_rows` is 1; one event is `ok` and the other `duplicate`, both with the same `invoice_id`; #3's email carries `Processed` and `Duplicate`, never `Review`; the executions show in `docker compose -f compose.yaml -f compose.queue.yaml logs n8n-worker`. The two saves overlap only when both extractions finish within milliseconds of each other; `tests/db/queries.test.ts` pins that exact interleaving |
| 22 | Restart mid-execution | `docker compose restart n8n` while an extraction runs | The event shows as unfinished; recover it with AGENTS.md's "Recovering stuck events" |
| 23 | Red team | Each `samples/adversarial/` PDF, one per email, the duplicate pair in order | Each label and saved row falls in its safe set in `samples/adversarial/expected.json`; the genuine re-send is labeled `Duplicate` |
| 24 | Red team, parked | A long-text fixture under `max_text_chars`, and the off-schema phishing fixture | The Sheets write succeeds or fails loudly (the 50,000-character cell limit); the phishing fixture's error email echoes nothing harmful |
| 25 | Spend limit | The Anthropic console | A monthly limit is set; the amount is the account owner's decision |
| 26 | One failed attachment in a batch | `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "DELETE FROM processed_events WHERE file_name IN ('invoice-01-two-items.pdf', 'invoice-05-bad-totals.pdf', 'invoice-06-copy-of-01.pdf'); DELETE FROM invoices WHERE invoice_number IN ('BE-2041', 'MB-5520');"`, and trash #1's and #5's Drive files and Sheets rows; set `ai.retry_model` to `claude-no-such-model` in `config/config.json`; email `invoice-01-two-items.pdf` and `invoice-05-bad-totals.pdf` together in one email; then `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "SELECT file_name, outcome, invoice_id IS NOT NULL FROM processed_events WHERE file_name IN ('invoice-01-two-items.pdf', 'invoice-05-bad-totals.pdf');"`; restore `claude-sonnet-5-5` and retry #5's failed `Process invoice` execution | #1 is labeled `Processed` with outcome `ok`; #5's retry fails on the unknown model, so its outcome stays empty with no invoice; the `intake-email` alert names `Fail the batch` with "process-invoice failed for 1 attachment(s) in this batch"; after the restore and retry, #5 gets `Review` |
| 27 | Clean clone | Clear the Sheets rows (keep the headers), trash `Invoices/<yyyy>`, run `docker compose exec -T postgres sh -c 'psql -U "$APP_DB_USER" -d app -At' <<< "DELETE FROM processed_events; DELETE FROM invoices;"`, then `gh repo clone aabv21/n8n-ai-invoice-processing "$(mktemp -d)/magdaport-check"` and follow [Quick start](#quick-start) exactly | Six `PASS` from `pnpm run scenarios` |

## Cost per invoice

An estimate, measured in the live run with `pnpm run cost -- --since <ISO>` and priced from `scripts/lib/pricing.ts`:

| Path | Average tokens (in / out) | Average USD | Retries |
|---|---|---|---|
| text | Pending: measured in the live run (`pnpm run cost`) | Pending: measured in the live run (`pnpm run cost`) | Pending: measured in the live run (`pnpm run cost`) |
| vision | Pending: measured in the live run (`pnpm run cost`) | Pending: measured in the live run (`pnpm run cost`) | Pending: measured in the live run (`pnpm run cost`) |
| all | Pending: measured in the live run (`pnpm run cost`) | Pending: measured in the live run (`pnpm run cost`) | Pending: measured in the live run (`pnpm run cost`) |
| Model per step | Claude Haiku 5.5 first, with a Claude Sonnet 5.5 step-up on `review`; kept or changed from the live results | | |

## Design decisions and production notes

[docs/architecture.md](docs/architecture.md#design-decisions-each-over-its-alternative) gives each decision with the alternative it beat. In short:

- **Haiku first, Sonnet only on review:** Sonnet costs far more per token, so it runs once, only when a check fails.
- **Routing by text density:** a PDF with a usable text layer costs only text tokens; scans take the PDF path.
- **Postgres as the system of record:** one statement saves an invoice once per event and turns a re-sent invoice into a duplicate; Sheets and the label read the saved row back.
- **An idempotency gate in the database:** one `INSERT … ON CONFLICT DO NOTHING` per attachment, so two runs can't both pass.
- **Code nodes built from tested TypeScript:** every Code node, query, prompt, and schema is generated from source, and CI fails on stale JSON.
- **The PDF request's timeout:** 120 s with 3 tries, kept. The worst case is 2 attempts × 3 tries × 120 s = 12 minutes for one invoice, and a timed-out call may still be billed.
- **Production steps left out of the demo:** narrower OAuth scopes, a Redis password for queue mode, and unpublishing the dev harness; see [docs/architecture.md](docs/architecture.md#security-untrusted-documents-secrets-and-retention).

### When you'd need queue mode

The default stack runs n8n as one process, which is enough for this demo's traffic. `compose.queue.yaml` adds Redis and `n8n-worker` containers when:

- **A backlog arrives at once**, such as after a vacation or a bulk resend, and workers should split it.
- **The AI calls get long**, so a worker busy on one extraction shouldn't block the next poll.
- **Workers should scale on their own**, with `--scale n8n-worker=N`, while the main process keeps polling.

The cost is a Redis container and the workers to run and monitor. Start it with `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2`, wait 15 s, and return with `docker compose -f compose.yaml -f compose.queue.yaml down && docker compose up -d --wait`. [docs/architecture.md](docs/architecture.md#where-the-default-stack-stops-scaling) records the verified queue-mode run.

## Limitations

Each item links to its row in the [failure table](docs/architecture.md#failure-modes-behavior-detection-and-recovery) where it has one, with the behavior, detection, and recovery. [AGENTS.md](AGENTS.md#recovering-stuck-events) has the commands for a stuck event.

- **New mail only:** the Gmail trigger sees mail that arrives after its last poll; a label added by hand to older mail is never picked up.
- **No DIAN electronic invoice:** the ZIP and XML a Colombian e-invoice carries aren't read; only the PDF is.
- **Duplicate detection depends on the model's reading** of the supplier tax ID and invoice number; a misread number makes a re-sent invoice look new.
- **A poor text layer takes the text path**, even when its text is wrong, and consistently wrong values can pass the checks.
- **Two first uploads in a month can race** and create two month folders with the same name.
- **The PDF path is Anthropic-specific**; only the text path swaps providers by changing one node.
- **A broken `config.json` silences error emails**, since `error-handler` loads the same file to find the team address.
- **Redis has no password in queue mode**, and is reachable only on the Compose network; set one before production use.
- **A Drive upload retry can leave a duplicate file**, and the saved link then points at the newer copy.
- **An Information Extractor parse failure fails the run** instead of becoming a review row, and a retry alone repeats it.
- **An extraction failure leaves the event unfinished**, with no invoice row, until someone retries the failed execution.
- **A lost `Record event` response strands its attachment**, which shows only as unfinished, with no error email.
- **One failure sends one alert per failed execution in the chain:** an extraction failure from a live poll alerts from `extract-invoice`, `process-invoice`, `intake-email` (at `Fail the batch`, once every attachment had its call), and `gmail-entry`. Count incidents by execution.
- **The 18:00 cron fails every day until a Gmail credential exists**, since `Email summary` and the error alert both need Gmail.
- **A missed 18:00 run is skipped**, not caught up, so its 24 hours never appear in a report.
- **A call right after n8n restarts can run the previous published version**; wait 15 s past `/healthz`.
- **The Code-node build patches esbuild's `__defProp` helper**, because n8n's Task Runner replaces `Object.defineProperty`; an esbuild update that changes that helper fails the build until the patch is updated.
- **Migration `002` builds its index with a plain `CREATE INDEX`**, which blocks writes while it runs; brief at this volume, but a large table needs `CONCURRENTLY`.
- **`testdb` uses trust auth**: it's opt-in, bound to `127.0.0.1`, tmpfs-backed, and never holds real data.
- **`load-config` returns only `{ config }`**, so each caller merges it back onto its own item.
- **Sample PDFs use Helvetica**, a WinAnsi standard font, so sample text is limited to WinAnsi characters.
- **Some dependency updates need a hand review:** Dependabot skips `@types/node` past Node's LTS major, TypeScript 7, n8n minor and major releases, and Postgres majors (see `.github/dependabot.yml`).

## License

MIT — see [LICENSE](./LICENSE).
