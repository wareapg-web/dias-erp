-- DIAS ERP — fixed_expense_settings στις Αποδοχές (Βασικό vs Μεταβλητό)
-- Τρέξε στο DIAS SQL Editor ΜΕΤΑ το 20_auto_transfer_settings.sql.

alter table public.tech_earnings
  add column if not exists fixed_expense_settings jsonb not null default '{}'::jsonb;

comment on column public.tech_earnings.fixed_expense_settings is
  'JSON checkboxes Βασικό/Στάνταρ μηνιαίο έξοδο ανά τύπο αποδοχής, π.χ. {"salary":true,"overtime":false}. Checked = βασικό · unchecked = μεταβλητό.';
