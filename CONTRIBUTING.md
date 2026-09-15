# Contributing

Model Lab is early and moving fast — contributions are welcome, especially in
these extension points (each is deliberately behind a small interface):

- **Provider adapters** (`runners/build-arena/src/providers/`) — anything
  OpenAI-compatible is ~20 lines; native protocols implement the streaming
  `Provider` interface.
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
  the runner unit tests, the check-taxonomy regression against two real
  artifacts, and the end-to-end mock selftest including the injected-failure
  path. All of it is zero-spend and needs only Chromium.
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
keys; real-provider testing needs at least one API key in `.env` (copy
`.env.example`). Node 22.13+ and pnpm 10 (`corepack enable`) are required.

```bash
pnpm install --frozen-lockfile
pnpm --filter @model-lab/build-arena-runner exec playwright install chromium
pnpm dev             # http://localhost:3000
pnpm -r typecheck && pnpm lint && pnpm format:check && pnpm test
```

Before opening a pull request, run the same gates CI runs
(`.github/workflows/ci.yml`) and fill in the evidence section of the PR
template. Scoring or check changes need a before/after on a real artifact.
