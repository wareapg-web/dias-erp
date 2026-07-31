-- DIAS ERP — χειροκίνητες ώρες υπαλλήλων γραφείου (Εντός γραφείου)
-- Τρέξε στο DIAS SQL Editor.

create table if not exists public.work_hours (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null,
  work_date date not null,
  time_start text,
  time_end text,
  worked_hours numeric(8, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_hours_tech_date_uidx unique (tech_id, work_date)
);

create index if not exists work_hours_tech_idx on public.work_hours (tech_id);
create index if not exists work_hours_date_idx on public.work_hours (work_date);
create index if not exists work_hours_tech_date_idx on public.work_hours (tech_id, work_date);

alter table public.work_hours enable row level security;

drop policy if exists work_hours_anon_all on public.work_hours;
create policy work_hours_anon_all
  on public.work_hours for all to anon using (true) with check (true);

drop policy if exists work_hours_authenticated_all on public.work_hours;
create policy work_hours_authenticated_all
  on public.work_hours for all to authenticated using (true) with check (true);

comment on table public.work_hours is
  'Ημερήσιες ώρες γραφείου (time_start/time_end → worked_hours, στρογγυλοποίηση μισάωρο)';
