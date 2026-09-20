# Security

Model Lab executes untrusted generated code and can use paid provider credentials.
The supported deployment is a trusted, single-host installation. The release
checks and remaining gates are recorded in [the release plan](docs/RELEASE_PLAN.md).

## Reporting a vulnerability

Send suspected vulnerabilities privately to **info@webstudiolabs.com**. Do not
include credentials or private benchmark outputs. GitHub's
[Security → Report a vulnerability](https://github.com/hugosmoreira/model-lab/security/advisories/new)
is also available; private vulnerability reporting is enabled and its setting
was verified for the public source release.
Please avoid public exploit reports until the maintainer has assessed them.

## Supported versions

The published source prerelease `0.2.0-rc.1` contains security changes that are
absent from the historical 0.1.0 implementation. Container publication remains
blocked. See the changelog and release plan before choosing a version.

## Generated artifacts

- The web application displays captured PNG evidence. It does not execute
  generated HTML in the user's browser. Missing captures are explicitly unavailable.
- The runner fulfills artifact HTML locally with a response-header CSP and an
  opaque sandbox origin. Inline scripts and styles and data images are allowed;
  connections, forms, embedded frames, workers and objects are denied.
- Context-wide HTTP and WebSocket controls apply before a page is created.
  Service workers, popups and downloads are restricted. Chromium disables direct
  WebRTC UDP and routes TCP through a private deny-only proxy, including loopback;
  QUIC and external DNS resolution are disabled. Controlled HTTP, WebSocket, UDP
  STUN and TCP TURN traps test these paths. Re-run these regressions after browser
  or platform changes. These controls depend on Chromium behavior and are not a
  certified OS sandbox or protection against browser vulnerabilities.
- Artifact execution uses a SHA-pinned Chrome Headless Shell installed by
  `pnpm browser:install`, and checks its minimum patched version before opening
  artifact pages. An executable override remains version-gated. No artifact-time
  download or fallback to Playwright's older bundled browser occurs.
- Each artifact has private frame-analysis state, a 30-second watchdog and a
  2 MiB source limit. Cancellation closes its contexts. Diagnostic retention is
  limited to 100 entries of 400 UTF-8 bytes each, with aggregate counters;
  excessive events terminate the check. These are retention limits, not a cap
  on transient browser IPC memory or renderer memory use.
- Downloads are attachments; output and commentary are rendered as text.
  New evidence uses full identity hashes and write-once files. Screenshot reads
  require a recorded reference inside the expected evidence directory.

Run the container with resource limits appropriate to the workload and keep
Node, Chromium and dependencies patched. Generated programs can consume CPU and
memory until termination; the tool is not a public arbitrary-code execution service.

## Requests and credentials

The application ships **no authentication or rate limiting**. Put authentication
in front of the entire application, including APIs and event streams, before
allowing remote access to a private instance. Read APIs expose stored results.

All three mutation APIs require JSON and the configured exact application origin.
Without `MODEL_LAB_APP_ORIGIN`, only matching loopback requests are accepted.
Forwarded headers do not establish trust. Non-browser HTTP clients must send the
same Origin header; the CLI calls the service directly. This prevents browser
cross-origin writes; a direct HTTP client can forge Origin, so it is not authentication.
Read-only mode rejects all three mutations before processing their bodies.

Provider keys and Supabase service credentials remain server-side. Docker build
exclusions cover nested dotenv files, databases and generated state, and release
checks inspect every image layer using synthetic sentinels. Error redaction is
best effort. Raw outputs, prompts, screenshots and annotations can contain private
information even when no API key is present: review deliberately selected data
before publishing it. Do not expose an operator's whole data volume as a demo.

## Provider limits and spending

Provider receipt has idle and total deadlines, frame and aggregate byte limits,
bounded error bodies, and cancellation. Generation and judge consumers enforce
their own output limits. Every paid request, including retries and judge fallbacks,
requires a shared conservative budget reservation before dispatch. Failed or
incompletely accounted requests retain uncertainty rather than becoming free.

The budget is an **admission estimate**, not a guaranteed invoice ceiling.
Tokenization, upstream usage reports, prices and unreported reasoning can differ
from estimates. Configure provider-side limits as appropriate. Unknown cloud
pricing is rejected for paid admission. Local and deterministic mock endpoints
have zero configured provider cost.

`MODEL_LAB_MOCK_PROVIDERS=1` prevents provider generation, judging and health
probes from making provider requests. The application still serves its own UI and
uses local browser checks. A public demo should be keyless, forced mock and
read-only.

## Persistence and release scope

Memory and single-host SQLite have automated conformance coverage. Supabase is
experimental; its metadata migrations require isolated live integration testing
before production claims. Artifacts remain on local disk with every backend.
Back up both SQLite and evidence while writes are stopped. Interrupted-run
recovery identifies stale owners and records a partial run; it does not restart
paid requests automatically. See [deployment](docs/DEPLOY.md) for the limits.
