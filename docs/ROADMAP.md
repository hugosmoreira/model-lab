# Roadmap and known issues

Model Lab runs judged benchmarks end to end. The
[2026-09-17 audit](AUDIT-2026-09-17.md) found release blockers in execution
safety, spending controls, evidence integrity and product accuracy despite
passing tests and a successful production build. The `0.2.0-rc.1` candidate now
implements the repairs, with focused regressions and an independent patch review.
Integrated verification and publication status are tracked in the release plan.

Follow [RELEASE_PLAN.md](RELEASE_PLAN.md) for the implementation sequence,
acceptance tests, GitHub publication steps and progress record. The first
delivery target is a versioned GitHub release with a tested Docker install;
a read-only hosted demo follows when ready. Finish the exact-candidate checks
and publication packet before expanding the feature set.

## Release readiness — next

1. **Execution and request safety.** Enforce a trusted artifact policy and
   context-wide network controls, guard all write requests against cross-origin
   submissions, exclude nested secrets from Docker builds, and bound browser
   diagnostics and provider streams. Acceptance: hostile fixtures cannot send
   external requests; foreign-origin writes have no effects; sentinel secrets
   stay out of images; oversized or stalled streams terminate predictably.
2. **Spending and evidence integrity.** Reserve budget before generation and
   judge calls, use full identities for immutable artifact storage, isolate
   concurrent frame analysis, and validate annotations and final votes
   atomically. Acceptance: first, final, concurrent and retry calls respect
   admission limits; colliding prefixes cannot overwrite evidence; concurrent
   samples stay independent; invalid references and vote overwrites fail.
3. **Honest product and replay.** Separate demo, missing and failed data states;
   preserve blind pair identities and per-score sources; export a complete,
   versioned replay contract; correct persistence and startup documentation.
   Acceptance: unknown runs return 404; partial human ratings cannot relabel
   browser scores; missing values remain missing; bundles reconstruct their
   recorded configuration and fingerprint without secrets.
4. **Public release candidate.** Verify a clean install and container, browser
   interactions and accessibility, usable private reporting channels, and an
   n=3 example produced after the evidence fixes. Keep paid benchmarks deliberate
   and CI integration runs mocked.
5. **Feature expansion.** Resume the planned features below on the corrected
   contracts, retaining sample counts, score sources and uncertainty labels.

Implemented controls include shared mutation guards, recursive Docker exclusions,
captured-only UI previews, bounded provider streams and budget reservations,
full-identity evidence storage, atomic evaluation writes and versioned replay.
The plan records verification separately from publication; the audit remains a
historical record of the original defects.

## Known issues

Historical runs were produced before the evidence and measurement fixes. Their
stored files and methodology have not been rewritten. Do not reinterpret them
as new candidate-version measurements. Current limitations follow.

- **Single-host release scope.** Memory and SQLite are tested. Supabase remains
  experimental until its migrations and behavior pass isolated live tests.
- **Isolation and spending have explicit limits.** Browser network regressions
  exercise the bundled Chromium; this is not OS sandbox certification. Request
  budgets are conservative admission estimates, not guaranteed invoice ceilings.

- **Every published run so far is n=1.** The wizard now offers 1, 2, 3 or 5
  samples per model; publish an n=3 run after the evidence-integrity fixes.
- **Local hardware is self-reported.** The manifest carries the quantization
  of every local model from the registry, and the hardware only if the
  operator sets `MODEL_LAB_LOCAL_HARDWARE`; nothing detects the GPU. A `seed`
  is dropped for providers that do not support it (the gpt-5 family,
  Anthropic) — it is flagged per model as "unseeded", not in the fingerprint.
- **Gemini token accounting under-reports.** Google's OpenAI-compatible surface
  omits reasoning tokens from usage, so cost derived from it is a lower bound;
  `finishReason` remains reliable.
- **The memory workspace is illustrative.** The seeded run (`run_8f3ac21e`)
  uses placeholder identities and sample evidence. It is explicitly labeled;
  persistent stores start empty and unknown runs return 404. Treat fixtures as
  a product tour, not model-comparison evidence.

## Planned

- **Leaderboard** across runs with the same pack version and fingerprint
  family, always showing n.
- **Judge Lab**: inspect judge prompts, reruns with a different judge model,
  agreement statistics between judge, browser checks, and human ratings.
- **Formal eval-engine adapters** (Inspect, OpenBench) so objective packs can
  run under an established harness.
- **More packs**: a second build-arena challenge that is not a raycaster, and
  larger objective packs.
- **A head-to-head queue** for runs with more than one sample.
- **An installable `model-lab` binary.** The CLI exists (`pnpm cli …`) but
  runs from the checkout; a published package needs a build step for the
  runner.

## Done since 0.1.0

- **A null baseline.** The registry has a `baseline/blank-html` endpoint: a
  deterministic document that renders nothing, free, keyless, always the
  mock. Add it to any run to see the floor of every scorer next to the
  contenders (the selftest asserts it fails the render gate on every sample;
  the CLI's `--fail-under` gate ignores it).
- **Live provider health.** On a persistent store the Providers page probes
  each provider's model list with the server's key (`GET
  /api/providers/health`, cached for a minute, "Test connection" refreshes)
  and shows reachability, latency, model count and whether the key is set.
  The in-memory demo keeps its fixture cards. `pnpm cli models --check` does
  the same from the terminal.
- **A command line.** `pnpm cli run --pack … --models … [--samples n]
  [--budget usd] [--fail-under ratio]` starts a run through the same service
  the UI uses, streams its events, prints a capability / cost / latency
  summary with the served model ids, exports the bundle, and exits non-zero
  on a partial run or a failed gate. `pnpm cli models` and `pnpm cli packs`
  show what this environment can run.
- **An unprivileged container image** on the Node base with the headless Chromium
  shell, with layer checks and a synthetic restart/restore rehearsal.
- **Runs record their environment.** Node version, platform, runner version,
  the exact Chromium build the checks ran in, and the model id each provider
  reported serving are captured at run time, shipped in `manifest.json` and
  the bundle README, and shown in the reproducibility strip.
- **Scores carry their source.** `RunModel.visualSource` says whether a
  number came from a person, the browser checks, or an objective scorer. The
  arena grid, results cards, artifact viewer and share cards show a "visual"
  or "human" score only when a person rated the build; the share card's score
  column is labelled `VISUAL·HUMAN`, `JUDGE·RUBRIC` or `BROWSER·CAPABILITY`
  according to what it holds. Candidate fixes extend source and sample-count
  labels to Results charts, CSV, alt text and social drafts.
- **Samples per model is a choice** in the New Run wizard (1, 2, 3 or 5),
  defaulting to 1 with the anecdote warning next to it.
- Read-only mode (`MODEL_LAB_READ_ONLY=1`) for public demo instances.
- A Dockerfile and [deployment guide](DEPLOY.md) with a demo profile and a
  private profile.
- The Build Arena grid shows the real captured frame of every build instead of
  a placeholder scene.
- The top bar labels the in-memory workspace as demo data. Persistent dashboards
  use recorded data, remove fabricated metrics and show useful empty states.

## Not planned

- A hosted, multi-tenant service. Model Lab is local-first by design: your
  keys, your GPU, your data directory.
- Ranking models by a single composite number. Scores stay labelled by source
  and are shown with n; the tool exists to make that evidence visible, not to
  collapse it.
