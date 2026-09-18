# Deploying Model Lab

Model Lab needs one long-lived Node process, Chromium and persistent local disk.
The supported release profile is a single Linux amd64 container with SQLite and
a volume. Memory storage is an ephemeral fixture workspace; Supabase remains
experimental. Serverless and horizontally scaled deployment are unsupported.
The [release plan](RELEASE_PLAN.md) records candidate verification and publication
gates; a local Docker build is not a published or certified release.

The API has no authentication or rate limiting. Read the [security policy](../SECURITY.md)
before providing keys or remote access.

## Public demo: keyless and read-only

```bash
docker build -t model-lab:local .
docker run --rm --init -p 127.0.0.1:3000:3000 -v model-lab-data:/data \
  -e MODEL_LAB_MOCK_PROVIDERS=1 \
  -e MODEL_LAB_READ_ONLY=1 \
  model-lab:local
```

Put an HTTPS reverse proxy in front of this loopback binding for a hosted demo.
No provider or service-role keys belong in this profile. The SQLite volume starts
empty. Publish only deliberately selected, reviewed results; never copy an entire
private operator data directory into a public demo. Historical example evidence
is labeled with its original methodology.

All run, vote and annotation mutations return 403. Read pages and exports remain
available, and `/api/health/store` reports `readOnly: true`. Artifact previews show
captured PNGs. A keyless empty instance is a valid demo, not a fabricated benchmark.

## Private instance: authenticated access

Provide authentication at the reverse proxy for the entire application, including
API and event routes. Configure the one external origin explicitly; the app does
not trust arbitrary forwarded-host headers. For a local writable mock rehearsal:

```bash
docker run --rm --init -p 127.0.0.1:3000:3000 -v model-lab-data:/data \
  -e MODEL_LAB_APP_ORIGIN=http://localhost:3000 \
  -e MODEL_LAB_MOCK_PROVIDERS=1 \
  model-lab:local
```

Open exactly `http://localhost:3000`. In an authenticated HTTPS installation,
set `MODEL_LAB_APP_ORIGIN=https://your-host.example` instead. Same-origin JSON
requests are required on write APIs. This origin check is not authentication.

To enable real providers, remove forced mock mode and inject only the required
keys through your host's secret configuration. Do not put credentials in the
Dockerfile, image, repository or published command history. Budget limits govern
estimated admission; they do not guarantee the provider's invoice total.

An Ollama endpoint runs locally without a cloud key when forced mock mode is off.
Set `OLLAMA_BASE_URL` to an address reachable by the container. On Docker Desktop
this is commonly `http://host.docker.internal:11434/v1`. Restrict access to that
service according to your deployment network.

## Runtime and storage

The Dockerfile pins its Node base and Chrome Headless Shell archive, installs
browser system libraries, builds the app, and runs as UID/GID 1000. Browser version
gates reject older executables before artifact execution. A named
volume inherits writable `/data` permissions on first creation. A bind mount must
already permit UID 1000 to read and write it. Use `--init` to reap browser children.
The image health check calls `/api/health/store`.

| Setting | Container default | Purpose |
| --- | --- | --- |
| `MODEL_LAB_STORE` | `sqlite` | Metadata persistence |
| `MODEL_LAB_DATA_DIR` | `/data` | Artifacts, raw output, screenshots, local run snapshots and bundles |
| `MODEL_LAB_SQLITE_PATH` | `/data/model-lab.db` | SQLite metadata and associated journal files |
| `MODEL_LAB_APP_ORIGIN` | unset | Required exact public origin for non-loopback writes |
| `MODEL_LAB_MOCK_PROVIDERS` | unset | Set `1` for a provider-free rehearsal |
| `MODEL_LAB_READ_ONLY` | unset | Set `1` to deny mutations |

SQLite and artifact paths are independent outside the container; changing the data
directory does not relocate an explicitly configured SQLite database. Back up both.
See [the environment example](../.env.example) for all settings and startup precedence.
Supabase stores metadata, not artifact files; see [its setup guide](SUPABASE_SETUP.md).

One web process may share the local SQLite store with the checkout CLI. Owner
records and heartbeats distinguish an active run from a stopped process. On a
subsequent reconciliation, stale owned runs become `partial` with an interruption
event. Ambiguous live process IDs and legacy runs without owner records cannot be
safely classified automatically. Recovery preserves local evidence but does not
rehydrate every partial snapshot into database samples or retry provider requests.
This is a single-host design, not a distributed job queue.

Chromium can use substantial memory and CPU. The synthetic release smoke records
observed image/runtime measurements in its report; these are not production sizing
guarantees. Choose container limits and concurrency using representative workloads.

## Backup, restore and promotion

Stop writes and the application before copying the volume, including SQLite and
its sidecars plus all evidence. Restore to a separate volume first, start read-only,
and check health, recorded results and an exported bundle. Retain the original
backup when changing versions. Roll back the application together with a compatible
data snapshot; never assume an older build can safely open newer storage.

[Release operations](RELEASE_OPERATIONS.md) contains the executable image, restart,
backup/restore and publication checks. Publishing a GitHub repository or GHCR image
does not host the application. A public hosted demo is a separate deployment step.
