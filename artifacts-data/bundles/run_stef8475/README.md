# Run bundle — run_stef8475

- benchmark: raycaster-oneshot v1.3
- fingerprint: fp_9d5825bcb1ab (sha256 of canonical config, 12-hex)
- prompt hash: 9aef3acc
- runner: build-arena-runner v0.1.0
- date: 2026-08-01 · 2 models × 2 samples

## Contents

| file | contents |
|---|---|
| manifest.json | run identity + provenance |
| benchmark.json | pack slug/version + verbatim challenge prompt |
| models.json | per-endpoint aggregates (RunModel[]) |
| samples.jsonl | one SampleResult per line |
| scores.json | per-endpoint score summary |
| artifacts/ | generated single-file HTML artifacts |
| screenshots/ | browser-check screenshots (PNG) |
| events.jsonl | full append-only RunEvent log |

## Replay

1. Recreate the RunnerConfig from benchmark.json + models.json
   (same pack version, prompt, temperature, seed, samplesPerModel).
2. `startRun(config)` with @model-lab/build-arena-runner — an identical
   config yields the same fingerprint, so results are comparable.
3. Artifacts are untrusted model output: open only inside a sandboxed
   iframe/viewer (network blocked). Never open them directly in a browser
   with network access.