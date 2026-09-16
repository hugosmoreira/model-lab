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

### Truncation is reported as a harness limit, not a model result

Every adapter reports a normalized `finishReason`, and `"length"` means *we* cut the
answer off at `maxOutputTokens`. Reasoning models make this easy to misread: their
hidden thinking is billed inside the same output budget, so a reasoner can spend the
entire cap thinking and return nothing at all. Adapters therefore also measure
reasoning tokens — from `completion_tokens_details.reasoning_tokens`, or by
measuring the `reasoning_content` / `reasoning` deltas that DeepSeek and OpenRouter
stream but never count.

A truncated sample emits its own `check.warn` and names the cap and the reasoning
spend in the failure message, so it can never be read as a model that violated the
artifact contract or shipped a broken document. The default cap for real runs is
32k (`MODEL_LAB_MAX_OUTPUT_TOKENS` overrides it).

Caveat: Google's OpenAI-compatible surface reports visible completion tokens only
and no reasoning breakdown, so token counts — and the cost derived from them —
under-count thinking on Gemini. `finishReason` remains reliable there.

### The judge looks at the rendered frame

The browser checks already capture a PNG of every artifact, so the judge is given
that capture alongside the source, and its prompt says which evidence it holds. A
grade derived from source alone is a *code* grade and is never presented as a
visual one: every `judge.vote` carries `sawRender`, and a source-only rubric grade
is prefixed `[graded from source only — no rendered capture seen]`.

Captures are swapped along with the source in the order-swapped pairwise leg —
otherwise the position-bias control would cover the text and leave the images
unswapped. A pair counts as seen only when *both* directions saw both frames.

If the judge model or server rejects an image, the identical call is retried
without it, vision is disabled for the rest of the phase, and every subsequent
vote records `sawRender: false`. A judge that could not see is never reported as
one that did.

Why this matters, from a real run (`run_0cf7aa08`): a local qwen build rendered no
walls at all — a sky gradient, a floor gradient, and a black minimap — and the 12
browser checks scored it 11/12, level with a working claude build that also scored
11/12. Grading the same qwen artifact from source scored it 3.2/10 on inferred
bugs; grading it with the capture scored it 2.1/10 and cited what was actually
missing on screen. The checks alone could not tell those two builds apart.

The checks can now. `canvas.renders`, `minimap.present`, and `textures.applied`
measure the captured frame's pixels rather than the DOM, and a raycaster frame has
to show vertical structure — column-to-column variation across the middle band —
which a smooth two-stop gradient has none of. That same qwen artifact now fails the
`canvas.renders` gate with "no vertical structure — gradient only", which zeroes its
headline score; the judge's capture-based grade is corroboration, no longer the only
thing that noticed.

## Scoring

Four sources, always labeled separately — no score type is presented as another:

- **Objective / browser** — 12 named Playwright checks per artifact, in three
  categories that answer different questions and are never averaged together:

  | category | checks | how it scores |
  | --- | --- | --- |
  | **gate** | `html.parses`, `page.loads`, `console.clean`, `canvas.renders` | correctness precondition — one failed gate means the artifact is broken, so the headline score is 0 and the reason names the gate |
  | **capability** | `interaction.wasd`, `interaction.mouse`, `minimap.present`, `textures.applied`, `resize.handled` | did the model build what the brief asked for — **this is the headline score**, capability passed / capability total |
  | **diagnostic** | `screenshot.captured`, `fps.stable`, `a11y.contrast` | reported, never scored |

  Diagnostics do not score because they measure the harness rather than the build:
  `screenshot.captured` says Playwright wrote a PNG, `fps.stable` says this machine's
  compositor kept up, and `a11y.contrast` samples DOM chrome rather than the 3D view —
  a model can neither earn nor lose them by building well. Verified mode swaps the
  whole set for objective task scorers (exact-match, contains, JSON-field).
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

The fingerprint identifies a configuration; it cannot identify where that
configuration ran. So the runner also records an **environment** alongside the run:
Node version, platform, runner version, the exact Chromium build the checks executed
in, and — per endpoint — the model identifier the provider reported serving (OpenAI
and Anthropic return the resolved id behind an alias such as `gpt-5-mini`). It ships
in `manifest.json`, is summarised in the bundle README, and appears in the
reproducibility strip of the run pages when the run's data directory is on the
machine serving the UI. Two bundles with the same fingerprint and different
environments are comparable configurations, not identical experiments.

## Frontend conventions

Design tokens live in `apps/web/app/globals.css` — every color is a token; JetBrains
Mono for anything machine-generated (IDs, hashes, metrics, timestamps, logs), IBM Plex
Sans for prose. Model identity is a square dot in a fixed per-model color; status is
always a circular dot in a semantic color — identity colors never encode status.
Charts are inline SVG/DIV primitives (no chart library) and always display *n*.
Failed, missing (`—`), and true-zero values are visually and textually distinct.
