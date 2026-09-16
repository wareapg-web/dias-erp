-- DIAS ERP — Strict Authenticated RLS (ΚΛΕΙΔΩΜΑ anon)
-- ============================================================
-- Τρέξε ΜΟΝΟ στο DIAS-ERP project (SQL Editor), ΟΧΙ στο Admin.
-- Προϋπόθεση: Dual Sign-In στο frontend + χρήστες στο DIAS Auth.
-- Δεν αγγίζει auth.* / storage.* — μόνο public schema.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1) Πίνακες ERP: RLS on · drop παλιές πολιτικές · revoke anon · authenticated
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
  tables text[] := array[
    'personnel',
    'tech_earnings',
    'payrolls',
    'payment_entries',
    'payroll_entries',
    'transaction_types',
    'tech_agreements',
    'tech_agreement_versions',
    'work_hours',
    'personnel_periods'
  ];
begin
  foreach t in array tables
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip missing table: %', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- Drop ΟΛΕΣ τις υπάρχουσες πολιτικές στον πίνακα
    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from public', t);

    -- Authenticated: πλήρη πρόσβαση (εσωτερικό ERP)
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all',
      t
    );

    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) View tech_ledger_view — μόνο authenticated
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tech_ledger_view') is null then
    raise notice 'skip missing view: tech_ledger_view';
  else
    revoke all on table public.tech_ledger_view from anon;
    revoke all on table public.tech_ledger_view from public;
    grant select on table public.tech_ledger_view to authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) RPCs — revoke anon · grant authenticated
-- ---------------------------------------------------------------------------
do $$
begin
  -- add_tech_agreement(text, text, numeric, numeric, numeric, date)
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_tech_agreement'
  ) then
    revoke all on function public.add_tech_agreement(text, text, numeric, numeric, numeric, date) from anon;
    revoke all on function public.add_tech_agreement(text, text, numeric, numeric, numeric, date) from public;
    grant execute on function public.add_tech_agreement(text, text, numeric, numeric, numeric, date) to authenticated;
  end if;

  -- create_tech_agreement_version(text, date, jsonb)
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_tech_agreement_version'
  ) then
    revoke all on function public.create_tech_agreement_version(text, date, jsonb) from anon;
    revoke all on function public.create_tech_agreement_version(text, date, jsonb) from public;
    grant execute on function public.create_tech_agreement_version(text, date, jsonb) to authenticated;
  end if;

  -- patch_active_agreement_toggles(text, jsonb, jsonb)
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'patch_active_agreement_toggles'
  ) then
    revoke all on function public.patch_active_agreement_toggles(text, jsonb, jsonb) from anon;
    revoke all on function public.patch_active_agreement_toggles(text, jsonb, jsonb) from public;
    grant execute on function public.patch_active_agreement_toggles(text, jsonb, jsonb) to authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Sequences (αν υπάρχουν) — authenticated μόνο
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  for s in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from anon', s.relname);
    execute format('grant usage, select on sequence public.%I to authenticated', s.relname);
  end loop;
end $$;
