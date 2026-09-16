# Deploying Model Lab

Model Lab is a long-lived process, not a set of functions: runs execute inside
the server, the live page replays from an in-memory ring buffer, the browser
checks need a real Chromium, and artifacts and screenshots go to local disk.
Serverless hosts break all four. Deploy it as **one container with a volume**.

The API has **no authentication and no rate limiting** (see
[SECURITY.md](../SECURITY.md)). That decides which of the two profiles below
you run.

## Profile A — public demo (read-only, zero spend)

Serves the UI and any results in its data directory; refuses new runs, votes
and annotations; can never spend money because no key is present and every
provider is the deterministic mock.

```bash
docker build -t model-lab .
docker run --rm -p 3000:3000 -v model-lab-data:/data \
  -e MODEL_LAB_MOCK_PROVIDERS=1 \
  -e MODEL_LAB_READ_ONLY=1 \
  model-lab
```

`MODEL_LAB_READ_ONLY=1` makes `POST /api/runs`, `/votes` and `/annotations`
answer `403` with an explanation; every page and `GET` keeps working.
`/api/health/store` reports `readOnly: true`.

To show real results on a demo instance, copy a run's data directory into the
volume before starting, or start once without `MODEL_LAB_READ_ONLY` on a
trusted network, run the benchmark, then restart read-only.

## Profile B — private instance (real keys)

The same image with provider keys and the judge enabled. Put authentication in
front of it — Cloudflare Access, Tailscale, or basic auth at the reverse proxy —
and never expose it to the public internet as is.

```bash
docker run --rm -p 3000:3000 -v model-lab-data:/data \
  -e ANTHROPIC_API_KEY=... -e OPENAI_API_KEY=... \
  -e MODEL_LAB_STORE=sqlite \
  model-lab
```

Local models: point `OLLAMA_BASE_URL` at an Ollama server the container can
reach (on Docker Desktop, `http://host.docker.internal:11434/v1`). In practice
the GPU box is your own machine, so this profile usually runs there with
`pnpm build && pnpm --filter @model-lab/web start` rather than in a container.

## What the image contains

- Base: `mcr.microsoft.com/playwright:<version>-noble` — Node, Chromium and
  its system libraries. **The tag must match the `playwright` version in
  `pnpm-lock.yaml`**; bump them together.
- The production build of `apps/web` plus the runner and store packages, with
  dev dependencies pruned.
- Defaults: `MODEL_LAB_STORE=sqlite`, `MODEL_LAB_DATA_DIR=/data`,
  `MODEL_LAB_SQLITE_PATH=/data/model-lab.db`, port `3000`, a health check on
  `/api/health/store`.

Mount `/data` on a volume: it holds the SQLite database, artifacts, raw model
outputs, screenshots, and exported bundles.

## Hosts that fit

Any host that runs a container with a persistent volume: Fly.io (`fly launch`
picks up the Dockerfile; add a volume for `/data`), Railway, Render, or a
Hetzner box with Coolify. Give it at least 1 GB of memory — Chromium runs the
browser checks for every sample.

## Environment reference

See [`.env.example`](../.env.example) for every variable. The ones that matter
for deployment:

| Variable                   | Demo                | Private              |
| -------------------------- | ------------------- | -------------------- |
| `MODEL_LAB_MOCK_PROVIDERS` | `1`                 | unset                |
| `MODEL_LAB_READ_ONLY`      | `1`                 | unset                |
| provider keys              | none                | as needed            |
| `MODEL_LAB_STORE`          | `sqlite` (default)  | `sqlite` / `supabase`|
| `MODEL_LAB_DATA_DIR`       | `/data` (default)   | `/data` (default)    |
