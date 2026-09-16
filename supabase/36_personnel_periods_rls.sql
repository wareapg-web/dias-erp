-- DIAS ERP — fix Supabase Advisor: rls_disabled_in_public on personnel_periods
-- Τρέξε στο DIAS SQL Editor (project DIAS-ERP).
-- Ενεργοποιεί RLS με ανοιχτές πολιτική anon (ίδιο μοντέλο με τους υπόλοιπους πίνακες).

alter table public.personnel_periods enable row level security;

drop policy if exists personnel_periods_anon_all on public.personnel_periods;
create policy personnel_periods_anon_all on public.personnel_periods
  for all to anon using (true) with check (true);

drop policy if exists personnel_periods_authenticated_all on public.personnel_periods;
create policy personnel_periods_authenticated_all on public.personnel_periods
  for all to authenticated using (true) with check (true);
