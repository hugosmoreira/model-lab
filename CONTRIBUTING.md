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
- Follow the design tokens in `apps/web/app/globals.css` — no new hex values
  without a token, JetBrains Mono for machine-generated values.
- Evidence before verdict: failures are preserved and shown, score sources are
  labeled (objective / browser / LLM-judge / human), and nothing may hide
  methodology to make a cleaner headline.
- The runner self-test (`pnpm dlx tsx runners/build-arena/src/selftest.ts`) must
  pass — it exercises a full mock run including the injected-failure path.

## Dev setup

See the README quickstart. The demo scenario (`run_8f3ac21e`) works with zero
keys; real-provider testing needs at least one API key in `.env`.
