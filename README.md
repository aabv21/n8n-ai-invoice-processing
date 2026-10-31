# Magdaport AI Invoice Processing

**Demo**

An n8n workflow that reads supplier invoices from Gmail, extracts them with Claude, files each PDF in Google Drive, lists it in Google Sheets, and flags doubtful ones for review.

## Status

In progress: local runtime and toolchain.

### What works now

- A strict TypeScript toolchain: `typecheck`, `lint`, and `test` scripts.
- The local runtime: Postgres and n8n in Docker Compose, with separate, least-privilege database roles for n8n and the application, and the app database's time zone set to `America/Bogota`.
- The application schema (`db/schema.sql`): `invoices`, `invoice_items`, and `processed_events`.
- A config template (`config/config.example.json`) for the values the workflows will read at runtime.

## Quick start

```bash
cp .env.example .env
cp config/config.example.json config/config.json
npm ci
docker compose up -d --wait
npm test
```

Fill in the generated secrets in `.env` before bringing up the stack (see `.env.example` for what's required).

## License

MIT — see [LICENSE](./LICENSE).
