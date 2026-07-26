-- =============================================================================
-- DIAS ERP — Bootstrap από μηδέν (άδεια βάση)
-- Τρέξε ΟΛΟ στο SQL Editor του DIAS project (όχι του Admin App).
-- =============================================================================
-- Αρχιτεκτονική bridge:
--   Admin App  → techs, assignments, daily_status, jobs  (ώρες / προσωπικό)
--   DIAS ERP   → οικονομικά (αποδοχές, μισθοδοσίες, πληρωμές)
-- Το dias-erp κάνει login στο Admin για να διαβάζει προσωπικό & ώρες.
-- Εδώ φτιάχνουμε μόνο τους πίνακες του DIAS.
-- =============================================================================

-- 1) Κατάλογος προσωπικού στο DIAS (προαιρετικός καθρέφτης / ERP master)
--    tech_id = id από Admin techs (κείμενο), ώστε να δένουμε αποδοχές/πληρωμές.
create table if not exists public.personnel (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  tech_name text not null,
  code text,
  last_name text,
  first_name text,
  hire_date date,
  photo_url text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_tech_id_unique unique (tech_id)
);

create index if not exists personnel_tech_name_idx on public.personnel (tech_name);

-- 2) Αποδοχές ανά υπάλληλο (tab «Αποδοχές»)
create table if not exists public.tech_earnings (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  tech_name text,

  salary_amount numeric(12, 2) not null default 0,
  salary_from numeric(12, 2) not null default 0,
  salary_min numeric(12, 2) not null default 0,

  bonus_amount numeric(12, 2) not null default 0,
  bonus_from numeric(12, 2) not null default 0,
  bonus_min numeric(12, 2) not null default 0,

  overtime_amount numeric(12, 2) not null default 0,
  overtime_from numeric(12, 2) not null default 8,
  overtime_min numeric(12, 2) not null default 0,

  holiday_amount numeric(12, 2) not null default 0,
  holiday_from numeric(12, 2) not null default 0,
  holiday_min numeric(12, 2) not null default 0,

  night_amount numeric(12, 2) not null default 0,
  night_from numeric(12, 2) not null default 0,
  night_min numeric(12, 2) not null default 0,

  overnight_amount numeric(12, 2) not null default 0,
  overnight_from numeric(12, 2) not null default 0,
  overnight_min numeric(12, 2) not null default 0,

  ticket_amount numeric(12, 2) not null default 0,
  ticket_from numeric(12, 2) not null default 0,
  ticket_min numeric(12, 2) not null default 0,

  metro_amount numeric(12, 2) not null default 0,
  metro_from numeric(12, 2) not null default 0,
  metro_min numeric(12, 2) not null default 0,

  bonus_plus_amount numeric(12, 2) not null default 0,
  bonus_plus_from numeric(12, 2) not null default 0,
  bonus_plus_min numeric(12, 2) not null default 0,

  bank_account text,
  bank_name text,
  issues_invoice boolean not null default false,
  extra text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tech_earnings_tech_id_unique unique (tech_id)
);

create index if not exists tech_earnings_tech_name_idx on public.tech_earnings (tech_name);

-- 3) Αποθηκευμένες μισθοδοσίες περιόδου (Οριστική Αποθήκευση ERP)
create table if not exists public.payrolls (
  id uuid primary key default gen_random_uuid(),
  tech_id text,
  tech_name text,
  period text not null,
  year int,
  month int,
  days numeric(10, 2),
  hours numeric(12, 2),
  overtime_hours numeric(12, 2),
  night_hours numeric(12, 2),
  holiday_hours numeric(12, 2),
  weekend_bonus numeric(12, 2),
  metro_days numeric(10, 2),
  overnight_days numeric(10, 2),
  repo_days numeric(10, 2),
  leave_days numeric(10, 2),
  sick_days numeric(10, 2),
  amount numeric(12, 2),
  paid_amount numeric(12, 2),
  settlement_1 numeric(12, 2) default 0,
  settlement_2 numeric(12, 2) default 0,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payrolls_period_idx on public.payrolls (period);
create index if not exists payrolls_tech_id_idx on public.payrolls (tech_id);

-- 4) Λίστα πληρωμών / κινήσεις ledger (tabs Ανάλυση + Λίστα Πληρωμών)
create table if not exists public.payment_entries (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  tech_name text,
  entry_date date,
  entry_type text not null,
  month int,
  year int,
  description text,
  salary_debit numeric(12, 2) not null default 0,
  salary_credit numeric(12, 2) not null default 0,
  other_debit numeric(12, 2) not null default 0,
  other_credit numeric(12, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists payment_entries_tech_idx on public.payment_entries (tech_id);
create index if not exists payment_entries_year_month_idx on public.payment_entries (year, month);

-- =============================================================================
-- RLS (ανοιχτό για bridge — θα σφίξουμε αργότερα)
-- =============================================================================
alter table public.personnel enable row level security;
alter table public.tech_earnings enable row level security;
alter table public.payrolls enable row level security;
alter table public.payment_entries enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['personnel', 'tech_earnings', 'payrolls', 'payment_entries']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true)',
      t || '_anon_all', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
