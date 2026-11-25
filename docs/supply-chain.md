# Supply chain

Package management is pnpm, pinned in `package.json`'s `packageManager` to an exact `11.x` version; never move to pnpm 12 (Dependabot's dependency-graph parser does not yet read its default two-document lockfile). `pnpm-workspace.yaml` holds the settings pnpm 11 no longer reads from `.npmrc`:

- `minimumReleaseAge: 4320`: refuses any package version (transitive included) published less than 3 days ago, so a newly compromised release can be caught and pulled first.
- `minimumReleaseAgeExclude: []`: overrides pnpm 11's default exclusion of `n8n`, `n8n-*`, and `@n8n/*`, so no package is exempt from the age gate.
- `trustPolicy: no-downgrade`: fails an install if a package's trust evidence (provenance or trusted publishing) regresses from an earlier release, or if the pinned pnpm itself would downgrade it.
- `blockExoticSubdeps: true`: only a direct dependency may resolve from a git or tarball URL.
- `strictDepBuilds: true` with `dangerouslyAllowAllBuilds: false`: a dependency's install or postinstall script fails the install unless `allowBuilds` approves it.
- `engineStrict: true`: a dependency whose `engines` range excludes this repo's Node fails the install instead of warning.
- `allowBuilds` lists only packages a real `pnpm install --frozen-lockfile` proved need their build script, each with a one-line reason. `esbuild: true` (its postinstall re-links the platform binary over the `bin/esbuild` shim) is the one entry; add another only after the same proof.

`tests/supply-chain.test.ts` reads these settings back through pnpm's effective config, so a misspelled or ignored key fails; [`docs/testing.md`](testing.md) lists every assertion it makes.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`) to update `pnpm-lock.yaml`, run the gate in AGENTS.md's "Definition of done", and commit both files together. If `minimumReleaseAge` refuses a version published too recently, wait it out or pin an older compatible version; don't work around it.

**Landing a security fix younger than the 3-day gate:**
1. Add a temporary `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml` for that one `name@version` (e.g. `"esbuild@0.28.3"`; the bare name would exempt every future version too), with a `#` comment naming the advisory ID and today's date.
2. Run `pnpm install` and merge as usual.
3. Remove the entry once that version is older than 3 days.

`tests/supply-chain.test.ts` asserts the exclusion list is empty, so it stays red for that PR on purpose, as the reminder for step 3; don't weaken the assertion. If that would make CI unmergeable, wait out the 3-day gate instead.

**Images** (`compose.yaml`, `compose.queue.yaml`) are pinned `name:tag@sha256:<digest>`, the multi-arch index digest from `docker buildx imagetools inspect name:tag`, so the same reference resolves on arm64 (local) and amd64 (CI). Dependabot keeps an existing digest current but won't add one, so a tag bump needs the digest re-resolved the same way and the tag reviewed by hand.

**CI** installs with `pnpm/setup` (pinned by commit SHA), then `actions/setup-node` with `cache: pnpm`, then `pnpm install --frozen-lockfile`, then `pnpm audit --audit-level=high`.

**Bumping pinned CI tools and zizmor by hand.** The `docker run` images in `.github/workflows/ci.yml` (`koalaman/shellcheck`, `zricethezav/gitleaks`, `rhysd/actionlint`) are pinned by multi-arch digest the same way, and `tests/supply-chain.test.ts` checks every `docker run` image across `.github/workflows/*.yml`. zizmor installs with `pip install --require-hashes -r .github/zizmor-requirements.txt`. To bump it, change the version there, then replace every `--hash=sha256:...` line with each wheel's and the sdist's hash, from PyPI's JSON API (`https://pypi.org/pypi/zizmor/<version>/json`, `urls[].digests.sha256`) or from `pip download zizmor==<version> --no-deps -d <dir>` and `pip hash` on each downloaded file. zizmor has no runtime dependencies, so that one requirement is all there is.

**The `n8n` job** boots the real stack and proves a workflow executes; [`docs/testing.md`](testing.md)'s "What CI runs" lists its steps and what CI leaves out. Its `docker compose down -v` teardown is safe because CI's volumes are disposable.

**Dependabot** (`.github/dependabot.yml`) adds a cooldown to every ecosystem on top of GitHub's own default: `npm` (which also covers the pnpm lockfile) waits 14 days for a major and 7 for a minor or patch, and `github-actions` and `docker-compose` a flat `default-days: 7`, since neither has a universal semver convention. Every version PR is therefore past pnpm's 3-day `minimumReleaseAge` gate. Security updates skip the cooldown.
