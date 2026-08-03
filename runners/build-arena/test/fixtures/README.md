# Regression fixtures — the "renders nothing" defect

Two **real, unmodified** artifacts, copied byte-for-byte out of the stored run
data (`$MODEL_LAB_DATA_DIR/artifacts/0cf7/…`, default
`artifacts-data/artifacts/0cf7/…`). Do not edit them: their value is that a
model actually produced them.

| fixture | provenance | what it does |
|---|---|---|
| `renders-nothing.html` | run **`run_0cf7aa08`**, endpoint **`ollama/qwen3.5-abliterated`**, sample 1, 2026-08-02T18:16:08Z, pack `raycaster-oneshot@v1.3` · source `artifacts/0cf7/qwen3.5-ablitera/raycaster.html` (17,756 bytes) | Paints a two-stop **sky gradient**, a two-stop **floor gradient**, a title/HUD strip and an **all-black minimap canvas**. **No walls are ever drawn.** It also throws once (`Cannot read properties of undefined (reading '223')`). |
| `renders-walls.html` | run **`run_0cf7aa08`**, endpoint **`anthropic/claude-sonnet-4-6`**, sample 1, same run · source `artifacts/0cf7/claude-sonnet-4-/raycaster.html` (11,558 bytes) | A working raycaster: textured brick and stone walls with visible mortar lines, a drawn minimap, responsive WASD, clean console. |

Reference screenshots of both are in the run data at
`$MODEL_LAB_DATA_DIR/screenshots/0cf7/{qwen3.5-ablitera,claude-sonnet-4-}-s1.png`.

## Why this pair

`run_0cf7aa08`'s stored 12-check trace scored them **9/12** and **11/12** — two
points apart, for a build that drew nothing versus one that drew a room. The
empty build collected passes for `canvas.renders` ("static frame (non-blank)" —
a gradient is non-blank), `minimap.present` (the black canvas is in the DOM),
`screenshot.captured`, `fps.stable` and `a11y.contrast`, plus a `warn` on
`textures.applied` ("low variance (10 tones)").

`test/check-taxonomy.test.mjs` runs the current `runBrowserChecks` against both
and fails the build unless the empty one scores **0 capability** on a failed
`canvas.renders` gate while the working one keeps a clear majority.

## Expected outcome

```
renders-nothing.html   canvas.renders  FAIL (gate)
                       "no vertical structure — gradient only (column σ 0.4, detail 0.7)"
                       capability 0/5 — remaining capability checks recorded "skipped"

renders-walls.html     all 4 gates PASS
                       canvas.renders "static frame · vertical structure (column σ 32.1, detail 2.9)"
                       capability 4/5 (minimap.present fails: this build's minimap is
                       painted onto the main canvas, so there is no element to find)
```

The exact pass counts may shift if the thresholds in `CHECK_THRESHOLDS` are
retuned; the assertions are written as bounds (`0`, `>= 3`, `gap >= 3`) rather
than exact values so honest retuning does not break them, but the **gap** is the
property that must never regress.

## Note on the wider brief

The "scored 11/12, exactly level with a working claude build" framing refers to
`run_f0520023`, where the qwen build and the claude build both landed 11/12.
That qwen artifact genuinely renders a wall (flat-shaded, with a real minimap),
so it is *not* usable as a "renders nothing" fixture. The artifact that truly
draws no walls is this one, from `run_0cf7aa08`, and there it scored 9/12
against claude's 11/12.
