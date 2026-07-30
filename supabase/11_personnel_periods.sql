-- DIAS ERP — ιστορικό συμβάσεων / περίοδοι απασχόλησης
-- Τρέξε στο DIAS SQL Editor μετά τα 01 + 02 + 10.

create table if not exists public.personnel_periods (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references public.personnel (id) on delete cascade,
  start_date date not null,
  end_date date,
  employment_type text not null default 'permanent'
    check (employment_type in ('permanent', 'temporary')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_periods_dates_chk check (
    end_date is null or end_date >= start_date
  )
);

create index if not exists personnel_periods_personnel_id_idx
  on public.personnel_periods (personnel_id);

create index if not exists personnel_periods_start_date_idx
  on public.personnel_periods (personnel_id, start_date);

comment on table public.personnel_periods is
  'Ιστορικό συμβάσεων υπαλλήλου. Η κάρτα hire_date/end_date καθρεφτίζει την πιο πρόσφατη περίοδο.';

comment on column public.personnel_periods.start_date is 'Από (πρόσληψη περιόδου)';
comment on column public.personnel_periods.end_date is 'Μέχρι (λήξη)· null = ανοιχτή/ενεργή περίοδος';

-- TODO: Enforce non-overlapping ranges per personnel_id with a GiST exclusion constraint
-- (requires btree_gist). Until then, app validates via findPeriodOverlapError().
-- Example:
--   create extension if not exists btree_gist;
--   alter table public.personnel_periods
--     add constraint personnel_periods_no_overlap
--     exclude using gist (
--       personnel_id with =,
--       daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
--     );
