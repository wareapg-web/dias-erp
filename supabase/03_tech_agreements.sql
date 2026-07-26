-- DIAS ERP — tech_agreements (mirror APG EMPLOEE_MISTO, normalized history)
-- Τρέξε στο DIAS SQL Editor (όχι Admin).

create table if not exists public.tech_agreements (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null references public.personnel (tech_id) on update cascade on delete restrict,
  type_code text not null,
  amount numeric(12, 2) not null default 0,
  up_from numeric(12, 2),
  minimum numeric(12, 2),
  is_active boolean not null default true,
  valid_from date not null default (current_date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tech_agreements_type_code_check check (
    type_code in (
      'BASE_SALARY',
      'HOURLY_RATE',
      'OVERTIME',
      'BONUS',
      'HOLIDAY',
      'NIGHT',
      'OVERNIGHT',
      'TRAVEL',
      'METRO',
      'TICKET'
    )
  )
);

create index if not exists tech_agreements_tech_id_idx on public.tech_agreements (tech_id);
create index if not exists tech_agreements_type_code_idx on public.tech_agreements (type_code);
create index if not exists tech_agreements_active_idx on public.tech_agreements (tech_id, is_active);

-- Ένα μόνο ενεργό record ανά (tech_id, type_code)
drop index if exists tech_agreements_one_active_per_type;
create unique index tech_agreements_one_active_per_type
  on public.tech_agreements (tech_id, type_code)
  where (is_active = true);

alter table public.tech_agreements enable row level security;

drop policy if exists tech_agreements_anon_all on public.tech_agreements;
create policy tech_agreements_anon_all on public.tech_agreements
  for all to anon using (true) with check (true);

drop policy if exists tech_agreements_authenticated_all on public.tech_agreements;
create policy tech_agreements_authenticated_all on public.tech_agreements
  for all to authenticated using (true) with check (true);

-- RPC: deactivate previous active of same type, then insert (single transaction)
create or replace function public.add_tech_agreement(
  p_tech_id text,
  p_type_code text,
  p_amount numeric,
  p_up_from numeric default null,
  p_minimum numeric default null,
  p_valid_from date default current_date
)
returns public.tech_agreements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.tech_agreements;
begin
  if p_tech_id is null or length(trim(p_tech_id)) = 0 then
    raise exception 'tech_id is required';
  end if;
  if p_type_code is null or length(trim(p_type_code)) = 0 then
    raise exception 'type_code is required';
  end if;
  if p_amount is null then
    raise exception 'amount is required';
  end if;

  update public.tech_agreements
  set
    is_active = false,
    updated_at = now()
  where tech_id = trim(p_tech_id)
    and type_code = upper(trim(p_type_code))
    and is_active = true;

  insert into public.tech_agreements (
    tech_id,
    type_code,
    amount,
    up_from,
    minimum,
    is_active,
    valid_from
  )
  values (
    trim(p_tech_id),
    upper(trim(p_type_code)),
    p_amount,
    p_up_from,
    p_minimum,
    true,
    coalesce(p_valid_from, current_date)
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.add_tech_agreement(text, text, numeric, numeric, numeric, date)
  to anon, authenticated;

comment on table public.tech_agreements is 'Normalized rate agreements — mirror APG EMPLOEE_MISTO (history via is_active)';
comment on function public.add_tech_agreement is 'Deactivate previous active agreement for (tech_id, type_code) then insert new row';
