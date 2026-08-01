-- DIAS ERP — auto_transfer_settings στις Αποδοχές (checkboxes → Δημιουργία)
-- Τρέξε στο DIAS SQL Editor.

alter table public.tech_earnings
  add column if not exists auto_transfer_settings jsonb not null default '{}'::jsonb;

comment on column public.tech_earnings.auto_transfer_settings is
  'JSON checkboxes για αυτόματη μεταφορά στη Δημιουργία, π.χ. {"salary_amount":true,"bonus_amount":false}';
