-- DIAS ERP — Έλεγχος RLS / grants (READ-ONLY)
-- Τρέξε στο DIAS SQL Editor. Δεν αλλάζει τίποτα · μόνο αναφορές.
-- Αναμενόμενο μετά το 37_dias_strict_authenticated_rls.sql:
--   · πολιτικές μόνο *_authenticated_all (όχι *_anon_all)
--   · anon χωρίς privileges στους πίνακες ERP
--   · tech_ledger_view: select μόνο σε authenticated

-- 1) Πολιτικές ανά πίνακα
select
  tablename,
  policyname,
  roles,
  cmd,
  qual as using_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 2) Υπάρχουν ακόμα ανοιχτές anon πολιτικές; (θέλουμε 0 γραμμές)
select
  tablename,
  policyname,
  roles
from pg_policies
where schemaname = 'public'
  and (
    policyname ilike '%anon%'
    or 'anon' = any (roles)
  )
order by tablename, policyname;

-- 3) Table privileges για anon / authenticated
select
  c.relname as table_name,
  ag.grantee,
  ag.privilege_type
from information_schema.role_table_grants ag
join pg_class c on c.relname = ag.table_name
join pg_namespace n on n.oid = c.relnamespace and n.nspname = ag.table_schema
where ag.table_schema = 'public'
  and ag.grantee in ('anon', 'authenticated', 'public')
  and c.relkind in ('r', 'v')
  and c.relname in (
    'personnel',
    'tech_earnings',
    'payrolls',
    'payment_entries',
    'payroll_entries',
    'transaction_types',
    'tech_agreements',
    'tech_agreement_versions',
    'work_hours',
    'personnel_periods',
    'tech_ledger_view'
  )
order by c.relname, ag.grantee, ag.privilege_type;

-- 4) RLS ενεργό στους κύριους πίνακες;
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
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
  )
order by c.relname;
