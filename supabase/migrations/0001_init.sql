-- Model Lab — initial schema (mirrors packages/schemas contracts)
-- Apply in the Supabase SQL editor or via `supabase db push`.
-- Raw model outputs are immutable: rows in samples/artifacts/run_events are
-- INSERT-only from the app's perspective; annotations are the only append
-- stream that references scores after the fact.

create table if not exists providers (
  id            text primary key,            -- "anthropic", "ollama", ...
  name          text not null,
  kind          text not null check (kind in ('cloud','aggregator','local','custom')),
  is_local      boolean not null default false,
  status        text not null default 'disconnected'
                check (status in ('connected','disconnected','rate-limited')),
  health_latency_ms integer,
  models_available  integer,
  models_loaded     integer,
  last_tested_at    timestamptz,
  -- ONLY a masked preview is ever stored/served; real keys stay in env/keychain
  credential_masked text not null default 'not configured',
  credential_store  text not null default 'unset'
                check (credential_store in ('keychain','env','none','unset')),
  warning_message   text,
  local_endpoint    text,
  local_hardware    text
);

create table if not exists model_definitions (
  id                    text primary key,    -- "claude-sonnet-4-6"
  family                text not null,
  short_name            text not null,
  identity_color        text not null,
  context_window_tokens integer not null,
  capabilities          text[] not null default '{}',
  supports_seed         boolean not null default false
);

create table if not exists model_endpoints (
  id            text primary key,            -- "anthropic/claude-sonnet-4-6"
  model_id      text not null references model_definitions(id),
  provider_id   text not null references providers(id),
  deployment    text not null check (deployment in ('cloud','local','aggregator')),
  quantization  text,
  hardware      text,
  price_in_per_mtok_usd  numeric,
  price_out_per_mtok_usd numeric,
  status        text not null default 'healthy'
                check (status in ('healthy','loaded','not-loaded','rate-limited')),
  runs_count    integer not null default 0,
  reliability_pct numeric,
  avg_visual_score numeric,
  last_tested_at timestamptz
);

create table if not exists benchmark_packs (
  slug          text not null,
  version       text not null,
  name          text not null,
  kind          text not null check (kind in ('build-arena','eval')),
  source        text not null check (source in ('official','community','imported','custom')),
  description   text not null default '',
  task_count    integer not null default 1,
  browser_check_count integer,
  eval_scorer   text check (eval_scorer in ('OBJECTIVE','EXACT-MATCH','CODE-TEST','HYBRID')),
  scorers_summary text not null default '',
  est_cost_per_model_usd numeric,
  est_output_tokens_per_model integer,
  category      text,
  license       text not null default 'MIT',
  prompt        text,
  content_hash  text,                        -- pin imported packs (audit M-4)
  last_run_at   timestamptz,
  primary key (slug, version)
);

create table if not exists runs (
  id            text primary key,            -- "run_8f3ac21e"
  fingerprint   text not null,               -- content-addressed config hash (distinct from id)
  name          text not null,
  mode          text not null check (mode in ('build-arena','verified','performance','head-to-head','custom')),
  status        text not null check (status in ('queued','running','paused','partial','completed','cancelled','failed')),
  pack_slug     text not null,
  pack_version  text not null,
  prompt_hash   text not null,
  samples_per_model integer not null,
  model_count   integer not null,
  budget_ceiling_usd numeric not null,
  cost_spent_usd numeric not null default 0,
  est_cost_low_usd  numeric,
  est_cost_high_usd numeric,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  elapsed_sec   integer,
  runner_version text not null,
  git_commit    text,
  composite_browser_pct    integer not null default 50,
  composite_visual_pct     integer not null default 35,
  composite_efficiency_pct integer not null default 15,
  verdict_label text,
  verdict_narrative text,
  judge_reversal_count integer not null default 0,
  configuration jsonb not null default '{}'::jsonb   -- full RunConfiguration snapshot
);

create table if not exists run_models (
  run_id        text not null references runs(id) on delete cascade,
  endpoint_id   text not null references model_endpoints(id),
  status        text not null check (status in ('queued','generating','testing','scoring','completed','failed')),
  failed_sample_count integer not null default 0,
  progress_pct  numeric not null default 0,
  current_task  text,
  tokens_out    integer not null default 0,
  ttft_ms       integer,
  total_latency_ms integer,
  cost_usd      numeric not null default 0,
  visual_score_value numeric,
  visual_score_n     integer,
  tests_passed  integer,
  tests_total   integer,
  retries       integer not null default 0,
  unseeded      boolean not null default false,
  flag          text,
  primary key (run_id, endpoint_id)
);

create table if not exists samples (
  run_id        text not null references runs(id) on delete cascade,
  endpoint_id   text not null references model_endpoints(id),
  sample_index  integer not null,            -- 1-based within model
  global_index  integer not null,
  status        text not null check (status in ('queued','generating','testing','scoring','scored','failed')),
  score_value   numeric,                     -- null when failed or unscored
  score_failed  boolean not null default false,
  primary_scorer text check (primary_scorer in ('objective','browser','llm-judge','human','hybrid')),
  cost_usd      numeric not null default 0,
  latency_ms    integer,
  ttft_ms       integer,
  seed          integer,                     -- null = unseeded (unsupported)
  has_artifact  boolean not null default false,
  tokens_out    integer,
  raw_ref       text,                        -- storage path of the immutable raw output
  raw_excerpt   text not null default '',
  scorer_trace  jsonb not null default '[]'::jsonb,   -- BrowserTestResult[]
  judge_reversed boolean not null default false,
  human_reviewed boolean not null default false,
  human_note    text,
  primary key (run_id, endpoint_id, sample_index)
);

create table if not exists artifacts (
  run_id        text not null references runs(id) on delete cascade,
  endpoint_id   text not null references model_endpoints(id),
  sample_index  integer not null,
  path          text not null,               -- storage path: artifacts/<runPrefix>/<model>/<file>
  filename      text not null,
  size_kb       numeric not null,
  render_ok     boolean not null,
  is_best_of_model boolean not null default false,
  source_ref    text,                        -- storage path of the full single-file HTML
  source_inline text,                        -- small artifacts may inline (MVP)
  screenshot_ref text,
  console_lines jsonb not null default '[]'::jsonb,
  checks        jsonb not null default '[]'::jsonb,
  judge_commentary text,
  sandbox_isolated_origin boolean not null default true,
  sandbox_network_blocked boolean not null default true,
  sandbox_exec_limit_sec  integer not null default 30,
  sandbox_size_limit_mb   integer not null default 2,
  primary key (run_id, endpoint_id, sample_index)
);

create table if not exists run_events (
  id            bigint generated always as identity primary key,
  run_id        text not null references runs(id) on delete cascade,
  t             timestamptz not null,
  type          text not null,               -- validated app-side against RunEventType
  endpoint_id   text,
  sample_index  integer,
  level         text not null default 'info' check (level in ('info','success','warn','error')),
  message       text not null,
  payload       jsonb not null default '{}'::jsonb
);
create index if not exists run_events_run_idx on run_events (run_id, t);

create table if not exists judge_pairs (
  run_id        text not null references runs(id) on delete cascade,
  pair_index    integer not null,
  endpoint_a    text not null,
  endpoint_b    text not null,
  verdict_ab    text check (verdict_ab in ('A','B','tie')),
  verdict_ba    text check (verdict_ba in ('A','B','tie')),
  reversed      boolean not null default false,
  excluded_from_tally boolean not null default false,
  commentary    text,
  primary key (run_id, pair_index)
);

create table if not exists pairwise_votes (
  run_id        text not null references runs(id) on delete cascade,
  pair_index    integer not null,
  endpoint_a    text not null,
  endpoint_b    text not null,
  criterion     text not null,
  order_swapped boolean not null default false,
  vote          text check (vote in ('A','B','tie','skip')),
  confidence    text not null default 'med' check (confidence in ('low','med','high')),
  voted_at      timestamptz,
  final         boolean not null default false,
  primary key (run_id, pair_index)
);

-- Append-only audit trail: overrides never mutate samples
create table if not exists annotations (
  id            bigint generated always as identity primary key,
  run_id        text not null,
  endpoint_id   text not null,
  sample_index  integer not null,
  note          text not null,
  score_override numeric,
  author        text not null default 'local',
  at            timestamptz not null default now()
);

create table if not exists share_exports (
  id            bigint generated always as identity primary key,
  run_id        text not null references runs(id) on delete cascade,
  filename      text not null,
  template      text not null,
  aspect        text not null check (aspect in ('16:9','1:1','4:5')),
  theme         text not null check (theme in ('dark','light')),
  exported_at   timestamptz not null default now()
);

-- Storage: create a PRIVATE bucket named "artifacts" in the Supabase dashboard
-- (raw outputs, artifact HTML, screenshots, run bundles). The app accesses it
-- exclusively through the server-side service-role client — never from the
-- browser. Suggested layout:
--   artifacts/<runPrefix>/<modelShortName>/<filename>
--   raw/<runId>/<endpointId>/<sampleIndex>.txt
--   screenshots/<runId>/<endpointId>/<sampleIndex>.png
--   bundles/<runId>/manifest.json …

-- RLS: single-user MVP accesses the DB only through the server with the
-- service-role key, so enable RLS with no anon policies (deny-by-default):
alter table providers        enable row level security;
alter table model_definitions enable row level security;
alter table model_endpoints  enable row level security;
alter table benchmark_packs  enable row level security;
alter table runs             enable row level security;
alter table run_models       enable row level security;
alter table samples          enable row level security;
alter table artifacts        enable row level security;
alter table run_events       enable row level security;
alter table judge_pairs      enable row level security;
alter table pairwise_votes   enable row level security;
alter table annotations      enable row level security;
alter table share_exports    enable row level security;
