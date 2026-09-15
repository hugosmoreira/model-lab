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
- **Read-only mode** (`MODEL_LAB_READ_ONLY=1`) so a public demo instance can
  serve results without accepting new runs, votes, or annotations.
- **A CLI** (`model-lab run --pack … --models …`) for scripted and CI use, and
  a `--fail-under` gate.
- **More packs**: a second build-arena challenge that is not a raycaster, and
  larger objective packs.
- **Arena grid thumbnails** from the real screenshots, live provider health
  checks, and a head-to-head queue for runs with more than one sample.
- **Docker image** on the Playwright base image for one-command self-hosting.

## Not planned

- A hosted, multi-tenant service. Model Lab is local-first by design: your
  keys, your GPU, your data directory.
- Ranking models by a single composite number. Scores stay labelled by source
  and are shown with n; the tool exists to make that evidence visible, not to
  collapse it.
