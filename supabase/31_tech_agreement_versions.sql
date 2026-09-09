-- DIAS ERP — Full snapshot versioning για Συμφωνίες (Master)
-- Mirror παραμένει public.tech_earnings
-- Τρέξε στο DIAS SQL Editor ΜΕΤΑ τα 20/30 (auto_transfer / fixed_expense).

create table if not exists public.tech_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null references public.personnel (tech_id) on update cascade on delete restrict,
  start_date date not null,
  end_date date,
  earnings_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tech_agreement_versions_dates_check check (
    end_date is null or end_date >= start_date
  )
);

create index if not exists tech_agreement_versions_tech_id_idx
  on public.tech_agreement_versions (tech_id);

create index if not exists tech_agreement_versions_tech_start_idx
  on public.tech_agreement_versions (tech_id, start_date desc);

-- Μία ενεργή συμφωνία ανά τεχνικό (end_date IS NULL)
drop index if exists tech_agreement_versions_one_active;
create unique index tech_agreement_versions_one_active
  on public.tech_agreement_versions (tech_id)
  where (end_date is null);

alter table public.tech_agreement_versions enable row level security;

drop policy if exists tech_agreement_versions_anon_all on public.tech_agreement_versions;
create policy tech_agreement_versions_anon_all on public.tech_agreement_versions
  for all to anon using (true) with check (true);

drop policy if exists tech_agreement_versions_authenticated_all on public.tech_agreement_versions;
create policy tech_agreement_versions_authenticated_all on public.tech_agreement_versions
  for all to authenticated using (true) with check (true);

comment on table public.tech_agreement_versions is
  'Master ιστορικό συμφωνιών: πλήρες earnings snapshot ανά περίοδο. end_date NULL = ενεργή.';
comment on column public.tech_agreement_versions.earnings_snapshot is
  'JSON UI state αποδοχών (_v, ποσά, auto_transfer_settings, fixed_expense_settings, …).';

-- Νέα συμφωνία: κλείνει την προηγούμενη ενεργή και εισάγει νέα
create or replace function public.create_tech_agreement_version(
  p_tech_id text,
  p_start_date date,
  p_snapshot jsonb
)
returns public.tech_agreement_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tech text := trim(p_tech_id);
  v_start date := coalesce(p_start_date, current_date);
  v_row public.tech_agreement_versions;
begin
  if v_tech is null or length(v_tech) = 0 then
    raise exception 'tech_id is required';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'earnings_snapshot object is required';
  end if;

  update public.tech_agreement_versions
  set
    end_date = greatest(v_start - 1, start_date),
    updated_at = now()
  where tech_id = v_tech
    and end_date is null;

  insert into public.tech_agreement_versions (
    tech_id,
    start_date,
    end_date,
    earnings_snapshot
  )
  values (
    v_tech,
    v_start,
    null,
    p_snapshot
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_tech_agreement_version(text, date, jsonb)
  to anon, authenticated;

comment on function public.create_tech_agreement_version is
  'Κλείνει ενεργή συμφωνία (end_date = start-1) και εισάγει νέα ενεργή με πλήρες snapshot.';

-- Patch μόνο operational toggles: Mirror tech_earnings + ενεργό Master snapshot
create or replace function public.patch_active_agreement_toggles(
  p_tech_id text,
  p_auto_transfer_settings jsonb,
  p_fixed_expense_settings jsonb
)
returns public.tech_agreement_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tech text := trim(p_tech_id);
  v_row public.tech_agreement_versions;
  v_auto jsonb := coalesce(p_auto_transfer_settings, '{}'::jsonb);
  v_fixed jsonb := coalesce(p_fixed_expense_settings, '{}'::jsonb);
begin
  if v_tech is null or length(v_tech) = 0 then
    raise exception 'tech_id is required';
  end if;

  update public.tech_earnings
  set
    auto_transfer_settings = v_auto,
    fixed_expense_settings = v_fixed,
    updated_at = now()
  where tech_id = v_tech;

  update public.tech_agreement_versions
  set
    earnings_snapshot =
      coalesce(earnings_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'auto_transfer_settings', v_auto,
        'fixed_expense_settings', v_fixed
      ),
    updated_at = now()
  where tech_id = v_tech
    and end_date is null
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.patch_active_agreement_toggles(text, jsonb, jsonb)
  to anon, authenticated;

comment on function public.patch_active_agreement_toggles is
  'Ενημερώνει μόνο toggles σε tech_earnings και στο ενεργό agreement snapshot (χωρίς νέα έκδοση).';
