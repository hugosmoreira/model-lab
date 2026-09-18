-- Apply after 0001_init.sql before running a server with evaluation writes.
-- NOT VALID preserves existing audit history while enforcing references for
-- every new/updated row. Historical orphans must be reviewed separately; this
-- migration does not discard or rewrite human corrections.
begin;

alter table public.annotations
  add constraint annotations_run_fk
    foreign key (run_id) references public.runs(id) not valid,
  add constraint annotations_participant_fk
    foreign key (run_id, endpoint_id)
    references public.run_models(run_id, endpoint_id) not valid,
  add constraint annotations_sample_fk
    foreign key (run_id, endpoint_id, sample_index)
    references public.samples(run_id, endpoint_id, sample_index) not valid;

alter table public.pairwise_votes
  add constraint pairwise_votes_participant_a_fk
    foreign key (run_id, endpoint_a)
    references public.run_models(run_id, endpoint_id) not valid,
  add constraint pairwise_votes_participant_b_fk
    foreign key (run_id, endpoint_b)
    references public.run_models(run_id, endpoint_id) not valid;

-- ON CONFLICT DO UPDATE locks the conflicting row before executing this
-- trigger. Two concurrent final writes cannot both replace an unfinished row:
-- the second writer sees final=true and receives the stable ML001 error.
create or replace function public.reject_final_vote_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.final then
    raise exception 'This pair already has a final vote.' using errcode = 'ML001';
  end if;
  return new;
end;
$$;

create trigger pairwise_votes_final_immutable
before update on public.pairwise_votes
for each row execute function public.reject_final_vote_update();

commit;
