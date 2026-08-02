# Architecture

Model Lab is a pnpm workspace. Boundaries are deliberate: the frontend never talks to
model providers, generated code never escapes the sandbox, and the run executor is
swappable behind one interface.

```
apps/web            Next.js 15 (App Router) — UI, local API routes, SSE event stream
packages/schemas    Zod domain contracts + typed demo fixtures (the single source of truth)
packages/store      RunStore interface with memory / SQLite / Supabase implementations
runners/build-arena Provider adapters, parallel executor, Playwright checks, LLM judge,
                    filesystem store, reproducible bundle writer
benchmark-packs/    Versioned challenge + eval pack definitions
```

## Run lifecycle

1. **Configure** (`/runs/new`) — pick mode, pack, 2–8 model endpoints, shared
   generation settings. Cost is estimated from per-endpoint pricing; a hard budget
   ceiling is part of the config.
2. **Execute** — `POST /api/runs` hands a config to the runner. Endpoints run in
   parallel (bounded by concurrency), samples sequentially per endpoint. Every step
   emits a typed `RunEvent`.
3. **Observe** — events fan out to three sinks: an in-memory ring buffer (so a late
   SSE subscriber replays from the start), the store, and the live UI at
   `/runs/:id/live` via `GET /api/runs/:id/events`.
4. **Score** — objective browser checks during the run; an optional judge phase after
   all endpoints finish; human ratings any time afterwards.
5. **Inspect & publish** — Results, Sample Explorer, Artifact Viewer, Share Studio,
   and a zipped run bundle at `GET /api/runs/:id/bundle`.

## Event contract

`run.created|started|partial|completed|cancelled` · `model.queued|started|rate_limited|failed|completed` ·
`sample.started|failed|scored` · `artifact.created` · `check.passed|failed|warn` ·
`browser.checks` · `judge.vote` · `token.usage` · `budget.status` · `sandbox.loaded` ·
`export.created`

A failed **sample** emits `sample.failed` — never `model.failed`. One failed sample
never halts its model, and one failed model never halts the run; the failure is
preserved as evidence and surfaced in the UI.

## Provider layer

One streaming `Provider` interface: `generate(req) → AsyncGenerator<delta | usage>`.
Implementations: native Anthropic, OpenAI-compatible (OpenAI, OpenRouter, DeepSeek,
Google's OpenAI surface, any custom base URL), Ollama for local models, and a
deterministic keyless mock used for tests and demos. An endpoint whose API key is
absent transparently falls back to the mock and is labeled `· mock` in the event
stream, so a partially-configured workspace still runs end to end.

The OpenAI-compatible adapter adapts its request shape when a server rejects legacy
parameters (e.g. `max_tokens` → `max_completion_tokens`), retrying at most once per
distinct complaint.

## Scoring

Four sources, always labeled separately — no score type is presented as another:

- **Objective / browser** — 12 named Playwright checks per artifact
  (`html.parses`, `page.loads`, `console.clean`, `canvas.renders`, `interaction.wasd`,
  `interaction.mouse`, `minimap.present`, `screenshot.captured`, `textures.applied`,
  `fps.stable`, `resize.handled`, `a11y.contrast`). Verified mode swaps these for
  objective task scorers (exact-match, contains, JSON-field).
- **LLM judge** — per-model rubric grading plus pairwise comparison of anonymized
  builds judged in *both* presentation orders. A verdict that flips under order-swap
  is flagged ⟲ and excluded from the aggregate tally. Judge spend counts against the
  run's budget ceiling.
- **Human** — 0–10 ratings written as append-only annotations; recorded scores are
  never mutated.

## Persistence

`RunStore` covers runs, run models, samples, artifacts, events, judge pairs, pairwise
votes, and annotations. Samples, artifacts, and events are insert-only; corrections go
through the annotation trail. Backends: in-memory (default, seeded with the demo
scenario), SQLite (`node:sqlite`), and Supabase (service role, RLS deny-by-default —
see [SUPABASE_SETUP.md](SUPABASE_SETUP.md)). Raw model outputs, artifacts, and
screenshots are written write-once to the runner's data directory.

## Reproducibility

Every run stores a content-addressed fingerprint over its canonical configuration,
plus prompt hash, exact endpoint identifiers, provider, generation parameters, runner
version, and git commit. The exported bundle contains `manifest.json`, `models.json`,
`benchmark.json`, `samples.jsonl`, `scores.json`, `artifacts/`, `screenshots/`, and a
README with replay instructions.

## Frontend conventions

Design tokens live in `apps/web/app/globals.css` — every color is a token; JetBrains
Mono for anything machine-generated (IDs, hashes, metrics, timestamps, logs), IBM Plex
Sans for prose. Model identity is a square dot in a fixed per-model color; status is
always a circular dot in a semantic color — identity colors never encode status.
Charts are inline SVG/DIV primitives (no chart library) and always display *n*.
Failed, missing (`—`), and true-zero values are visually and textually distinct.
