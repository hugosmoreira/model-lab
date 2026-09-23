-- New-write resource bounds; do not rewrite or validate historical notes.
-- Stop application writers while applying migrations, in order.
begin;
lock table public.annotations in share row exclusive mode;
alter table public.runs add column annotation_count bigint not null default 0;
update public.runs r set annotation_count = (
  select count(*) from public.annotations a where a.run_id = r.id
);
create index annotations_run_idx on public.annotations (run_id);

-- A legacy orphan may have a run_id that a later import reuses. Such history
-- still consumes capacity when its parent is created after this migration.
create function public.initialize_annotation_count()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select count(*) into new.annotation_count from public.annotations where run_id = new.id;
  return new;
end;
$$;
create trigger runs_initialize_annotation_count
before insert on public.runs
for each row execute function public.initialize_annotation_count();

create function public.limit_annotation_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Mirrors ANNOTATION_LIMITS.textBytes. Store APIs also cap notes at 4,000
  -- UTF-16 units; octet_length protects direct SQL writes and multibyte text.
  if octet_length(new.run_id) + octet_length(new.endpoint_id) +
     octet_length(new.note) + octet_length(new.author) +
     octet_length(new.at::text) > 32768 then
    raise exception 'Annotation text exceeds 32 KiB.' using errcode = 'ML003';
  end if;
  -- Conditional UPDATE serializes admission; a separate lock+COUNT could use
  -- a stale snapshot. Rollback (including a later FK failure) refunds this slot.
  update public.runs set annotation_count = annotation_count + 1
    where id = new.run_id and annotation_count < 1000;
  if not found then
    if not exists (select 1 from public.runs where id = new.run_id) then
      raise exception 'Annotation run does not exist.' using errcode = '23503';
    end if;
    raise exception 'Run annotation limit reached.' using errcode = 'ML002';
  end if;
  return new;
end;
$$;

create trigger annotations_resource_limits
before insert on public.annotations
for each row execute function public.limit_annotation_insert();
commit;
