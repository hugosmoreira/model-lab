# Changelog

All notable changes to Model Lab are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
- A Dockerfile (Node base plus the headless Chromium shell, about 2 GB) and
  `docs/DEPLOY.md` with a read-only demo profile and a private profile.
- The Build Arena grid shows each build's real captured frame when the run has
  one, falling back to the identity-coloured placeholder only for fixtures.
- Tests for the two remaining README claims: the order-swapped pairwise
  decision (`decidePair`, pure) and the hard budget ceiling (a mock run that
  must stop as `partial` after its first sample).
- `RunModel.visualSource` (`human` · `browser` · `objective`): every score
  says where it came from. Rows stored before the field existed are inferred
  from the run mode when read.
- Samples per model is selectable in the New Run wizard (1, 2, 3 or 5).
- A command line: `pnpm cli run --pack … --models …` with `--samples`,
  `--budget`, `--fail-under`, `--mock`, `--no-judge`, `--store`; plus
  `pnpm cli models` and `pnpm cli packs`. Runs go through the same service as
  the UI, so they persist and show up there. `POST /api/runs` accepts an
  optional `maxBudgetUsd`.
- Run provenance: the runner records Node version, platform, runner version,
  the Chromium build the checks executed in, and the model id each provider
  reported serving. It ships in the bundle's `manifest.json` and README, and
  the reproducibility strip shows it when the run data is local. The selftest
  asserts it.

### Fixed

- A browser-derived number was shown under "VISUAL" and "VISUAL (HUMAN)"
  labels on the arena grid, the results cards, the artifact viewer and the
  share card, next to "no human rating yet". Those places now show a human
  rating only when one exists; the share card's score column is labelled
  `VISUAL·HUMAN`, `JUDGE·RUBRIC` or `BROWSER·CAPABILITY` by what it holds, and
  the results scatter names its y axis.

### Changed

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

## [0.1.0] — 2026-08-03

First complete version.

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

[Unreleased]: https://github.com/hugosmoreira/model-lab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hugosmoreira/model-lab/releases/tag/v0.1.0
