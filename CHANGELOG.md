# Changelog

All notable changes to Model Lab are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

## 0.2.0-rc.2 — 2026-09-22

- Add operator UI framing protection and browser response headers. This does
  not replace authentication for remote private deployments.
- Stop inserting fixture votes while reading the comparison queue, including
  read-only mode and failed vote reads. Explicit demo seeding retains its votes;
  an existing empty vote table now stays empty.
- Redact Google key, Supabase secret and complete JWT shapes in provider/store
  diagnostics before truncation. Redaction remains best effort; no live
  credential exposure or key validity was established by this verification.
- Verify all eleven claims in the recent local audit and record the remaining
  evidence gaps in [the follow-up report](docs/SECURITY_AUDIT_VERIFICATION-2026-09-22.md).
- Bind source-installed development and production servers to `127.0.0.1` by
  default. Previously, Next's default listener accepted connections on all
  interfaces; forgeable request headers did not establish a local caller.
  Explicit remote bindings still require an authenticated proxy and configured
  application origin. Container port-binding requirements are unchanged.
- Add an actual Next socket regression and a synthetic WebGL shader, pixel and
  screenshot check to the container release rehearsal.

## 0.2.0-rc.1 — 2026-09-20

[Source prerelease published](https://github.com/hugosmoreira/model-lab/releases/tag/v0.2.0-rc.1)
at `2026-09-20T03:29:52Z` (September 19 in America/Los_Angeles). Container
publication remains blocked by native advisory and binary redistribution gates.

### Added

- Shared mutation-origin checks, captured-only artifact previews, bounded browser
  diagnostics and provider streams, and budget reservations before every paid
  request. Regression fixtures cover hostile HTML, HTTP/WebSocket/WebRTC egress,
  incomplete provider streams, concurrent requests, retries and cancellation.
- Immutable full-identity evidence paths, creation-time configuration, and a
  versioned replay contract with exact raw/artifact/screenshot references and hashes.
- Cross-backend evaluation validation, atomic final votes, a SQLite concurrency
  regression, and the experimental Supabase `0002_evaluation_integrity.sql` migration.
- Single-host interrupted-run reconciliation, common web/CLI environment loading,
  and provider-free health checks in forced mock mode.
- An unprivileged Linux image, image-layer sentinel tests, restart/restore checks,
  offline redacted tree/history secret scanning and a manually gated GHCR workflow.
  Publication and repository settings remain separate maintainer operations.
- A production-only runtime dependency install, preserving the web server and
  source CLI while excluding development tooling from every image layer.
- A separate manual source-release workflow that verifies the exact tagged
  commit and prepares a draft source archive with checksums. Container publishing
  retains its full native advisory and distribution gates.

- CI on GitHub Actions: typecheck, lint, format check, store conformance,
  runner unit tests, the check-taxonomy regression, the mock selftest, and a
  production build — all zero-spend.
- `pnpm test` at the root: store conformance on memory and SQLite, runner unit
  tests for finish-reason normalization and check scoring, the check-taxonomy
  regression, and the end-to-end mock selftest.
- ESLint (flat config, Next.js preset for the app, typescript-eslint for the
  packages) and Prettier, both enforced in CI.
- Community files: code of conduct, issue and pull request templates,
  citation metadata, a public roadmap with known issues, Dependabot.
- A root `.env.example` documenting every variable the code reads, including
  the judge and output-cap settings.
- `MODEL_LAB_READ_ONLY=1`: an instance that serves results but answers 403 to
  new runs, votes, and annotations, for public demos. `/api/health/store`
  reports it.
- A Dockerfile (Node base plus the headless Chromium shell) and
  `docs/DEPLOY.md` with a read-only demo profile and a private profile.
- The Build Arena grid shows each build's real captured frame when the run has
  one, falling back to the identity-coloured placeholder only for fixtures.
- Tests for order-swapped pairwise decisions and conservative budget admission,
  including uncertain usage retained after incomplete streams. Admission limits
  are estimates, not a guarantee of the provider's invoice.
- `RunModel.visualSource` (`human` · `browser` · `objective`): every score
  says where it came from. Rows stored before the field existed are inferred
  from the run mode when read.
- Samples per model is selectable in the New Run wizard (1, 2, 3 or 5).
- A null baseline endpoint, `baseline/blank-html`: a deterministic document
  that renders nothing, so any run can show the floor of every scorer. Free,
  keyless, always the mock; excluded from the CLI's `--fail-under` gate.
- Live provider health: `GET /api/providers/health` probes each provider's
  model list with the server's key (read-only, free, cached for a minute);
  the Providers page uses it on a persistent store, with a working "Test
  connection" button, and `pnpm cli models --check` prints the same.
- A command line: `pnpm cli run --pack … --models …` with `--samples`,
  `--budget`, `--fail-under`, `--mock`, `--no-judge`, `--store`; plus
  `pnpm cli models` and `pnpm cli packs`. Runs go through the same service as
  the UI, so they persist and show up there. `POST /api/runs` accepts an
  optional `maxBudgetUsd`.
- Run provenance: the runner records Node version, platform, runner version,
  the Chromium build the checks executed in, the model id each provider
  reported serving, each local model's quantization from the registry, and
  the hardware named by `MODEL_LAB_LOCAL_HARDWARE`. It ships in the bundle's
  `manifest.json` and README, and the reproducibility strip shows it when the
  run data is local. The selftest asserts it.

### Fixed

- Artifact policy placement and popup/network bypasses; WebRTC requires native
  Chromium UDP restrictions and a deny-only TCP proxy in addition to request routes.
- Nested dotenv files and local state leaking into container build layers.
- Full-identity storage collisions, shared frame-analyzer races and sample aliasing
  in blank-canvas detection. Legacy evidence remains readable without rewriting it.
- Missing runs falling back to demo data, fabricated live dashboard statistics,
  mixed score-source labels, missing values presented as zero, and blind pair
  identities appearing in unfinished vote history.
- Incomplete provider usage incorrectly releasing reserved output spend, and
  repeated HTTP bundle downloads permanently duplicating evidence and export logs.
- Localhost spelling differences in Next.js rejecting legitimate loopback writes.

- A browser-derived number was shown under "VISUAL" and "VISUAL (HUMAN)"
  labels on the arena grid, the results cards, the artifact viewer and the
  share card, next to "no human rating yet". Those places now show a human
  rating only when one exists; the share card's score column is labelled
  `VISUAL·HUMAN`, `JUDGE·RUBRIC` or `BROWSER·CAPABILITY` by what it holds, and
  the results scatter names its y axis.

### Changed

- Playwright is pinned to 1.63.0. `pnpm browser:install` verifies a separately
  pinned Chrome Headless Shell 153.0.8010.52 archive; artifact execution rejects
  older browsers. Managed downloads support Windows x64 and Linux x64.
- pnpm is pinned to 10.34.5. The image uses the updated Debian 13 Node 22 base,
  runs Node directly, and excludes unused Sharp decoders, Xvfb and package-manager
  installers from its active runtime. Native-library advisory and binary-license
  review remain publication gates.
- The Linux image replaces Debian's older Expat with unmodified upstream 2.8.4,
  built from a verified archive in a separate stage. Upstream tests, binary ABI,
  actual browser loading, every-layer exclusion of old libraries, and retained
  license/source/build provenance are checked. Raw distro advisory matches remain
  visible for review; other native findings are unresolved.
- Next.js 15.5.25 (patches two critical advisories in 15.5.22); postcss,
  nanoid, and sharp pinned past their advisories; adm-zip replaced by fflate.
- Node 22.13 or newer is now declared and enforced (`node:sqlite` unflagged).
- `interaction.wasd` probes one key at a time and compares the frame after
  each, so opposite keys can no longer cancel out into "no visible state
  change" on a busy machine.
- Exported bundles record the bundle directory relative to the data root
  instead of the exporter's absolute path.
- SECURITY.md names a private reporting channel and states plainly that the
  HTTP API ships without authentication.
- The top bar shows the "demo data" chip and the fixture statistics only for
  the in-memory demo workspace; a live instance shows how many providers have
  a key, a "read-only" chip when applicable, and a disabled New Run button in
  read-only mode.

## 0.1.0 — 2026-08-03 (historical development checkpoint)

Original feature set; this heading does not establish a published GitHub release.
Its security and evidence limitations are documented in the project audit.

- Build Arena runs: identical prompt, temperature, token budget, and retry
  policy across 2–8 endpoints; cloud (Anthropic, OpenAI, DeepSeek, Gemini,
  OpenRouter) and local (Ollama) side by side; a hard budget ceiling.
- 12 Playwright checks in a gate / capability / diagnostic taxonomy, with
  pixel-level render detection in an isolated analyzer context.
- LLM judge that sees the rendered frame: per-build rubric plus pairwise
  comparison in both presentation orders; order-reversed verdicts are flagged
  and excluded from the tally.
- Human 0–10 ratings through an append-only annotation trail.
- Truncation reported as a harness limit (`finishReason: "length"`) with
  reasoning-token accounting, never as a model failure.
- Persistence behind one interface: memory, SQLite (`node:sqlite`), Supabase.
- Live run page over SSE, Sample Explorer, Artifact Viewer with a locked
  sandbox, Share Studio exports (PNG/SVG/CSV/JSON + alt text), reproducible
  run bundles with fingerprints.
- Example judged three-way run committed at `docs/example-run/run_f0520023`.
