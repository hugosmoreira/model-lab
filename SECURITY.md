# Security

Model Lab executes untrusted model-generated code and holds provider API keys.
These are the invariants the codebase maintains — regressions against them are
security bugs; please report them via GitHub issues (or privately if sensitive).

## Generated code is hostile until proven otherwise

- Artifacts render only inside `<iframe sandbox="allow-scripts">` — never
  `allow-same-origin` — with an injected CSP of `default-src 'none'` (inline
  script/style only, `img-src data:`).
- Browser checks run the artifact in Playwright with **all network requests
  aborted**, a 30-second watchdog, and a 2MB size cap.
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

## Spend safety

- Every run has a hard budget ceiling enforced by the runner (generation and
  judge calls both count); hitting it ends the run as `partial`, never bills on.
- A forced mock mode (`MODEL_LAB_MOCK_PROVIDERS=1`) is guaranteed to make zero
  network calls and spend nothing — including the judge.
