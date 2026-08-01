# Model Lab

> Run reproducible LLM comparisons, inspect live artifacts, and export publication-ready results.

Model Lab is a local-first, open-source **LLM Benchmark & Build Arena**: send the same
benchmark or one-shot build challenge to several models under identical configuration,
watch the run live, inspect every sample, artifact, and failure, and export trustworthy
visual reports that trace back to a reproducible run bundle.

**Status:** early development. The full audit and implementation plan lives in
[`docs/REPO_AUDIT_AND_FRONTEND_PLAN.md`](docs/REPO_AUDIT_AND_FRONTEND_PLAN.md);
product research in the design handoff bundle.

## Workspace

| Path | What |
|---|---|
| `apps/web` | Next.js app (UI + local API routes) |
| `packages/schemas` | Shared typed domain schemas, event contract, and demo fixtures |
| `runners/` | Run execution adapters (native Build Arena; formal engines later) |
| `benchmark-packs/` | Versioned benchmark / challenge pack definitions |
| `docs/` | Audit, plan, and methodology documents |

## Development

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm typecheck
pnpm build
```

## Principles

Evidence before verdict · samples before aggregate scores · exact configuration before
model hype · objective checks before model judges · partial failure is still useful data ·
every share image traces back to a run.

## License

MIT
