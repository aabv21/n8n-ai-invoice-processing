# Diagrams

Edit only each `*.json` source, then regenerate its `*.html` page and `*.svg` export.

- `architecture`: the system diagram. [source](architecture.json), [page](architecture.html), [image](architecture.svg).
- `invoice-sequence`: the invoice sequence. [source](invoice-sequence.json), [page](invoice-sequence.html), [image](invoice-sequence.svg).
- `invoice-lifecycle`: the states an invoice event passes through (type `lifecycle`). [source](invoice-lifecycle.json), [page](invoice-lifecycle.html), [image](invoice-lifecycle.svg).
- `data-flow`: where invoice data goes (type `dataflow`). [source](data-flow.json), [page](data-flow.html), [image](data-flow.svg).

`*.delivery.json` receipts (one per diagram, written by `archify deliver`) hold local absolute paths and are gitignored; never force-add one.

## Regenerating a diagram

Regenerate a diagram after editing its source in `docs/diagrams/`, with [archify](https://github.com/tt-a1i/archify) v3.0.0 or later (Node.js, no install step; these sources were last checked against v3.2.0). Clone it outside this repo, so `pnpm run lint` never scans it: `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify ../archify`. Run from the repo root, since each source's `meta.output` path is relative to it. For the architecture diagram (type `architecture`):
  1. `node ../archify/archify/bin/archify.mjs validate architecture docs/diagrams/architecture.json --quality showcase --json` after every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
  2. `node ../archify/archify/bin/archify.mjs deliver architecture docs/diagrams/architecture.json docs/diagrams/architecture.html --quality showcase --json` writes the page, plus the gitignored `docs/diagrams/architecture.delivery.json` receipt.
  3. Open the page in a browser, choose **Export**, then **SVG**, and save over `docs/diagrams/architecture.svg`, which `README.md` and `docs/architecture.md` embed.
  4. Optionally, `node ../archify/archify/bin/archify.mjs visual-check docs/diagrams/architecture.html --json --out-dir ../archify-evidence` checks the page in a real browser at four desktop sizes, with screenshots outside the repo.

  For the other diagrams, run the same steps with their type (`sequence`, `lifecycle`, `dataflow`) and their own files.
