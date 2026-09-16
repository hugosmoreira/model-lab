# Roadmap and known issues

Model Lab is complete enough to run judged benchmarks end to end, and honest
about what it does not do yet. This page is the single place for both. Items
are unordered inside each section; open an issue or a discussion to argue for
moving one up.

## Known issues

These are real defects in the current scoring story. None of them changes a
recorded result, but each one is a reason to read a headline with care.

- **`visualScore` is three constructs in one field.** The runner derives it
  from the browser capability ratio (×10), the results loader overrides it
  with a human rating when one exists, and the share card labels it
  `VISUAL·HUMAN`. The three should be separate, separately labelled fields.
- **Every judged run so far is n=1.** The New Run wizard hard-locks
  `samplesPerModel`; the README's own limitations section says n=1 is an
  anecdote. Unlocking it and publishing an n=3 run is the next benchmarking
  milestone.
- **No null baseline.** Nothing establishes what an empty or trivial artifact
  scores, so there is no floor to compare a weak build against.
- **Provenance gaps.** The served model snapshot, the Chromium version that
  ran the checks, and local GPU / quantization are not recorded in the run
  manifest. A `seed` is silently dropped for providers that do not support it
  (the gpt-5 family, Anthropic) instead of being flagged in the fingerprint.
- **Gemini token accounting under-reports.** Google's OpenAI-compatible surface
  omits reasoning tokens from usage, so cost derived from it is a lower bound;
  `finishReason` remains reliable.
- **The demo workspace is illustrative.** The seeded demo run (`run_8f3ac21e`)
  and the Mission Control fixtures use placeholder model IDs and made-up
  history so every screen has content with zero keys. Real endpoints and real
  runs replace them as soon as a key is present; treat the demo as a tour, not
  as data.

## Planned

- **Leaderboard** across runs with the same pack version and fingerprint
  family, always showing n.
- **Judge Lab**: inspect judge prompts, reruns with a different judge model,
  agreement statistics between judge, browser checks, and human ratings.
- **Formal eval-engine adapters** (Inspect, OpenBench) so objective packs can
  run under an established harness.
- **A CLI** (`model-lab run --pack … --models …`) for scripted and CI use, and
  a `--fail-under` gate.
- **More packs**: a second build-arena challenge that is not a raycaster, and
  larger objective packs.
- **Live provider health checks** on the Providers page, and a head-to-head
  queue for runs with more than one sample.
- **A slimmer container image**: the current one builds on the full Playwright
  base image (all three browsers) and weighs about 4 GB; a Chromium-only base
  would roughly halve that.

## Done since 0.1.0

- Read-only mode (`MODEL_LAB_READ_ONLY=1`) for public demo instances.
- A Dockerfile and [deployment guide](DEPLOY.md) with a demo profile and a
  private profile.
- The Build Arena grid shows the real captured frame of every build instead of
  a placeholder scene.
- The top bar labels the demo workspace as demo data and, on a live instance,
  shows only facts about that environment.

## Not planned

- A hosted, multi-tenant service. Model Lab is local-first by design: your
  keys, your GPU, your data directory.
- Ranking models by a single composite number. Scores stay labelled by source
  and are shown with n; the tool exists to make that evidence visible, not to
  collapse it.
