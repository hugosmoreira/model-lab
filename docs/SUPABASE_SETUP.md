# Supabase setup for Model Lab

The app is local-first and runs entirely on fixtures until persistence is wired
(Phase 2). When you're ready, prepare Supabase like this:

## 1. Create the project

Any region. Note the **Project URL** and the **service_role** key
(Settings → API). The service-role key is server-only — it will never be
exposed to the browser; the web app talks to Supabase exclusively from
Next.js server code and the runner.

## 2. Apply the schema

Open the SQL editor and run [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
(or use `supabase db push` with the CLI). It creates all tables with
deny-by-default RLS (single-user MVP: only the service role reads/writes).

## 3. Create the storage bucket

Storage → New bucket → name **`artifacts`**, **private**. It holds artifact
HTML files, immutable raw model outputs, screenshots, and run bundles.

## 4. Environment variables

Create `apps/web/.env.local` (gitignored) with:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server-only, never NEXT_PUBLIC_
MODEL_LAB_STORE=supabase                        # "memory" (default) | "supabase"
```

Provider keys (Phase 2 runner) also live here, server-side only:

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
