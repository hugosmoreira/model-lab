# Contributing

Model Lab is early and moving fast — contributions are welcome, especially in
these extension points (each is deliberately behind a small interface):

- **Provider adapters** (`runners/build-arena/src/providers/`) — reuse the
  OpenAI-compatible adapter where applicable; native protocols implement the
  streaming `Provider` interface, receipt limits and terminal usage semantics.
- **Challenge packs** (`benchmark-packs/<slug>/pack.json`) — a build-arena
  challenge (prompt + browser checks) or an eval pack (tasks + objective scorer:
  exact-match, contains, json-field).
- **Browser checks** (`runners/build-arena/src/checks/`) — new named assertions
  against generated artifacts.
- **Share templates** (`apps/web/components/share/ShareCard.tsx`) — new export
  card layouts (self-contained theme tokens; methodology footer is mandatory).
- **Store backends** (`packages/store/`) — implement the `RunStore` interface;
  run the conformance suite.

## Ground rules

- `pnpm -r typecheck` must pass; TypeScript strict, no `any` leaks.
- `pnpm lint` and `pnpm format:check` must pass (ESLint flat config + Prettier,
  both run in CI). `pnpm format` fixes formatting.
- `pnpm test` must pass. It runs the store conformance suite (memory + SQLite),
  runner/provider/budget tests, browser boundaries and check taxonomy, replay,
  web regression tests and the end-to-end mock selftest. Provider calls are
  synthetic; browser controls are exercised with local trap services and Chromium.
- Follow the design tokens in `apps/web/app/globals.css` — no new hex values
  without a token, JetBrains Mono for machine-generated values.
- Evidence before verdict: failures are preserved and shown, score sources are
  labeled (objective / browser / LLM-judge / human), and nothing may hide
  methodology to make a cleaner headline.
- Nothing personal in committed files: no keys (the app scrubs them, check
  anyway), no absolute local paths, no fixtures copied from private runs
  without the author's consent.

## Dev setup

See the README quickstart. The demo scenario (`run_8f3ac21e`) works with zero
keys. Set `MODEL_LAB_MOCK_PROVIDERS=1` for a provider-free development session.
Cloud providers need their respective keys; local Ollama needs a reachable local
server, not a cloud key. Copy `.env.example` for configuration. Node 22.13+ and
the pinned pnpm 10 patch (`corepack enable`) are required.

```bash
pnpm install --frozen-lockfile
pnpm browser:install
pnpm dev             # http://localhost:3000
pnpm -r typecheck && pnpm lint && pnpm format:check && pnpm test
```

Before opening a pull request, run the same gates CI runs
(`.github/workflows/ci.yml`) and fill in the evidence section of the PR
template. Scoring or check changes need a before/after on a real artifact.

Linux also needs `pnpm --filter @model-lab/build-arena-runner exec playwright
install-deps chromium`. Use a current security-patched Node 22 release. The managed
browser's version and archive hashes are in `runners/build-arena/browser-runtime.json`;
the runner rejects older versions and never falls back to an unverified browser.

Changes to browser launch flags or Playwright versions must rerun the HTTP,
WebSocket and native WebRTC trap regressions on the supported image platform.
Container changes must pass the image, restart/restore, advisory and secret gates
in [release operations](docs/RELEASE_OPERATIONS.md). Keep synthetic local reports
under ignored `artifacts-data`; never copy private run files into a test fixture.
