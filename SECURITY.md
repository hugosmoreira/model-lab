# Security

Model Lab executes untrusted model-generated code and holds provider API keys.
These are the invariants the codebase maintains — regressions against them are
security bugs.

## Reporting a vulnerability

Please do not open a public issue for anything exploitable. Use GitHub's
private reporting instead: **Security → Report a vulnerability** on the
repository, or the direct link
<https://github.com/hugosmoreira/model-lab/security/advisories/new>. You will
get an acknowledgement within a few days and a fix or a mitigation before any
public disclosure. Hardening ideas that are not exploitable are welcome as
ordinary issues.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Generated code is hostile until proven otherwise

- Artifacts render only inside `<iframe sandbox="allow-scripts">` — never
  `allow-same-origin` — with an injected CSP of `default-src 'none'` (inline
  script/style only, `img-src data:`).
- Browser checks run the artifact in Playwright with **all network requests
  aborted**, a 30-second watchdog, and a 2MB size cap. Pixel measurements run in
  a separate browser context that never loads artifact HTML, so an artifact
  cannot shadow the canvas APIs the checks read.
- Model output (responses, console lines, judge commentary) is rendered as text
  nodes only. No `dangerouslySetInnerHTML` anywhere in the app.
- Artifact downloads are served `Content-Disposition: attachment`.
- Path segments derived from run/model identifiers are sanitized before any
  filesystem access; run IDs are format-validated before touching disk.

## Keys never reach the client

- Provider keys and the Supabase service-role key live in server-side env only —
  no `NEXT_PUBLIC_` secrets, and the browser never talks to providers or Supabase.
- Error messages and logs are scrubbed of key-shaped strings before persistence
  or display.
- The Supabase schema ships RLS deny-by-default; only the server's service role
  reads or writes.
- Exported run bundles record paths relative to the data directory, never the
  exporter's absolute filesystem layout.

## Spend safety

- Every run has a hard budget ceiling enforced by the runner (generation and
  judge calls both count); hitting it ends the run as `partial`, never bills on.
- A forced mock mode (`MODEL_LAB_MOCK_PROVIDERS=1`) is guaranteed to make zero
  network calls and spend nothing — including the judge.

## What the app does not do

Model Lab is a local-first tool and ships **no authentication and no rate
limiting** on its HTTP API. Anyone who can reach `POST /api/runs` on a running
instance can start runs against whatever keys that instance holds, bounded only
by the per-run budget ceiling. Do not expose an instance that holds real
provider keys to the public internet without putting authentication in front of
it; a public demo should run keyless with `MODEL_LAB_MOCK_PROVIDERS=1`.
