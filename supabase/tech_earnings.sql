-- DIAS ERP: αποδοχές ανά τεχνικό (tab «Αποδοχές»)
-- Τρέξε αυτό στο Supabase SQL Editor του DIAS project (xiaunaoqurveoargdtpm).

create table if not exists public.tech_earnings (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  tech_name text,

  -- Ποσό / > από / Ελάχιστο ανά τύπο (όπως παλιό ERP)
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

  accountant_amount numeric(12, 2) not null default 0,

  driver_allowance numeric(12, 2) not null default 0,

  bank_account text,
  bank_name text,
  issues_invoice boolean not null default false,
  extra text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tech_earnings_tech_id_unique unique (tech_id)
);

create index if not exists tech_earnings_tech_name_idx on public.tech_earnings (tech_name);

alter table public.tech_earnings enable row level security;

drop policy if exists "tech_earnings_anon_all" on public.tech_earnings;
create policy "tech_earnings_anon_all"
  on public.tech_earnings
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "tech_earnings_authenticated_all" on public.tech_earnings;
create policy "tech_earnings_authenticated_all"
  on public.tech_earnings
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.tech_earnings is 'Αποδοχές υπαλλήλου (ρυθμοί/ποσά) — DIAS ERP tab Αποδοχές';
