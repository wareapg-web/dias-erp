-- DIAS ERP — αμοιβή Λογιστή στις Αποδοχές (tech_earnings)
-- Τρέξε στο DIAS SQL Editor.

alter table public.tech_earnings
  add column if not exists accountant_amount numeric(12, 2) not null default 0;

comment on column public.tech_earnings.accountant_amount is
  'Αμοιβή Λογιστή (μόνο για υπαλλήλους με τιμολόγιο) — ξεχωριστό από extra';
