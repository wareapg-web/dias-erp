-- DIAS ERP — Επίδομα οδηγού (driver_allowance)
-- Τρέξε στο DIAS SQL Editor.

alter table public.tech_earnings
  add column if not exists driver_allowance numeric(12, 2) not null default 0;

alter table public.payrolls
  add column if not exists driver_allowance numeric(12, 2) not null default 0;

comment on column public.tech_earnings.driver_allowance is
  'Επίδομα οδηγού (σταθερό στις Αποδοχές)';
comment on column public.payrolls.driver_allowance is
  'Επίδομα οδηγού μήνα (από tech_earnings κατά Οριστική Αποθήκευση)';
