# Supabase setup for Model Lab

Model Lab is local-first: the default `memory` store needs no setup, and
`MODEL_LAB_STORE=sqlite` persists runs to a local file. Use Supabase when you
want hosted metadata. This backend remains experimental until its migrations
and runtime behavior have been validated on your isolated project. Artifact
files remain local, so sharing metadata does not make multiple independent
servers share complete run evidence.

## 1. Create the project

Any region. Note the **Project URL** and the **service_role** key
(Settings → API). The service-role key is server-only — it will never be
exposed to the browser; the web app talks to Supabase exclusively from
Next.js server code and the runner.

## 2. Apply the schema

Apply [0001_init.sql](../supabase/migrations/0001_init.sql), then
[0002_evaluation_integrity.sql](../supabase/migrations/0002_evaluation_integrity.sql)
(or use `supabase db push` with the CLI). The first migration enables
deny-by-default RLS; only the server's service role reads/writes. The second
validates new evaluation references and prevents changing a final vote.
Existing orphaned historical annotations are retained for audit purposes.

## 3. Preserve local evidence

There is no Supabase Storage bucket integration. Keep `MODEL_LAB_DATA_DIR` on
persistent local storage and include it in backups: it contains raw outputs,
screenshots, runner snapshots and bundles. Artifact source is also recorded in
the metadata store; that does not replace the local evidence directory.

## 4. Environment variables

Put these in the workspace-root `.env` **or** `apps/web/.env.local` (both are
gitignored and both are loaded; the apps/web file wins on conflicts):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret-key>          # server-only, never NEXT_PUBLIC_
MODEL_LAB_STORE=supabase                        # "memory" (default) | "sqlite" | "supabase"
```

Key naming note: on newer Supabase projects the API keys page shows a
**publishable** key (`sb_publishable_…`) and a **secret** key (`sb_secret_…`).
Use the **secret** key as `SUPABASE_SERVICE_ROLE_KEY` (on older projects this
is the `service_role` JWT). The publishable/anon key is useless to Model Lab —
the schema is RLS deny-by-default and the browser never talks to Supabase.

Provider keys also live here, server-side only (the full list is in
[`.env.example`](../.env.example)):

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
OPENROUTER_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
```

## Security invariants (do not relax)

- No `NEXT_PUBLIC_` Supabase variables. The browser never talks to Supabase.
- Keys are never logged; provider responses are scrubbed before persisting.
- `samples`, `artifacts`, `run_events` are insert-only from the app; score
  corrections go through the append-only `annotations` table.
