## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Kind of change

- [ ] Provider adapter
- [ ] Benchmark pack or browser check
- [ ] Scoring / judge / persistence
- [ ] UI
- [ ] Docs, CI, tooling

## Evidence

<!-- Paste the relevant output. CI runs the same gates; this is for the parts CI cannot see. -->

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm lint` and `pnpm format:check` pass
- [ ] `pnpm test` passes (store conformance, runner unit tests, check-taxonomy regression, selftest)
- [ ] For UI changes: a screenshot, and no new hex values outside `apps/web/app/globals.css`
- [ ] For scoring or check changes: a before/after on a real artifact, with the run id

## Methodology

- [ ] Failures are preserved and shown, never hidden to make a cleaner headline
- [ ] Every score is labelled with its source (objective / browser / LLM judge / human)
- [ ] No secret, absolute local path, or personal data in committed files or fixtures
