-- DIAS ERP — payment_entries module (Πληρωμές)
-- Compatible with bootstrap table if already exists; adds simplified columns + FK.

create table if not exists public.payment_entries (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  tech_name text,
  payment_date date not null default (current_date),
  amount numeric(12, 2) not null default 0,
  payment_type text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.payment_entries
  add column if not exists payment_date date,
  add column if not exists amount numeric(12, 2),
  add column if not exists payment_type text,
  add column if not exists notes text,
  add column if not exists tech_name text,
  add column if not exists created_at timestamptz default now();

-- Backfill from legacy ledger columns (01_dias_bootstrap) if present
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_entries' and column_name = 'entry_date'
  ) then
    execute $u$
      update public.payment_entries
      set payment_date = coalesce(payment_date, entry_date, current_date)
      where payment_date is null
    $u$;
  else
    update public.payment_entries
    set payment_date = coalesce(payment_date, current_date)
    where payment_date is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_entries' and column_name = 'entry_type'
  ) then
    execute $u$
      update public.payment_entries
      set payment_type = coalesce(nullif(trim(payment_type), ''), entry_type, 'SETTLEMENT')
      where payment_type is null or trim(payment_type) = ''
    $u$;
  else
    update public.payment_entries
    set payment_type = coalesce(nullif(trim(payment_type), ''), 'SETTLEMENT')
    where payment_type is null or trim(payment_type) = '';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_entries' and column_name = 'salary_credit'
  ) then
    execute $u$
      update public.payment_entries
      set amount = coalesce(
        amount,
        nullif(salary_credit, 0),
        nullif(other_credit, 0),
        nullif(salary_debit, 0),
        nullif(other_debit, 0),
        0
      )
      where amount is null
    $u$;
  else
    update public.payment_entries set amount = coalesce(amount, 0) where amount is null;
  end if;
end $$;

alter table public.payment_entries alter column payment_date set default current_date;
alter table public.payment_entries alter column amount set default 0;

update public.payment_entries set payment_date = current_date where payment_date is null;
update public.payment_entries set amount = 0 where amount is null;
update public.payment_entries set payment_type = 'SETTLEMENT' where payment_type is null or trim(payment_type) = '';

alter table public.payment_entries alter column payment_date set not null;
alter table public.payment_entries alter column amount set not null;
alter table public.payment_entries alter column payment_type set not null;

-- Legacy entry_type was NOT NULL — relax so new inserts need only payment_* columns
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_entries' and column_name = 'entry_type'
  ) then
    begin
      alter table public.payment_entries alter column entry_type drop not null;
    exception when others then null;
    end;
    begin
      alter table public.payment_entries alter column entry_type set default 'SETTLEMENT';
    exception when others then null;
    end;
  end if;
end $$;

do $$
begin
  alter table public.payment_entries drop constraint if exists payment_entries_payment_type_check;
  alter table public.payment_entries
    add constraint payment_entries_payment_type_check
    check (payment_type in ('ADVANCE', 'SETTLEMENT', 'EXPENSES'));
exception
  when others then
    raise notice 'payment_type check skipped: %', sqlerrm;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_entries_tech_id_fkey'
  ) then
    alter table public.payment_entries
      add constraint payment_entries_tech_id_fkey
      foreign key (tech_id) references public.personnel (tech_id)
      on update cascade on delete restrict;
  end if;
exception
  when others then
    raise notice 'FK skipped (orphan tech_id or missing personnel): %', sqlerrm;
end $$;

create index if not exists payment_entries_tech_idx on public.payment_entries (tech_id);
create index if not exists payment_entries_payment_date_idx on public.payment_entries (payment_date desc);

alter table public.payment_entries enable row level security;

drop policy if exists payment_entries_anon_all on public.payment_entries;
create policy payment_entries_anon_all on public.payment_entries
  for all to anon using (true) with check (true);

drop policy if exists payment_entries_authenticated_all on public.payment_entries;
create policy payment_entries_authenticated_all on public.payment_entries
  for all to authenticated using (true) with check (true);
