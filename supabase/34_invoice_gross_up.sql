-- DIAS ERP — Προαιρετική προσαύξηση φόρου (/0.8) ανά τεχνικό
-- Όρος παραστατικού στο live mirror tech_earnings · μπαίνει και στο earnings_snapshot (jsonb).
-- Τρέξε στο DIAS SQL Editor.

alter table public.tech_earnings
  add column if not exists invoice_gross_up boolean not null default true;

comment on column public.tech_earnings.invoice_gross_up is
  'Αν true: Οδηγός ΤΙΜ / Excel εφαρμόζουν προσαύξηση φόρου (÷ 0.8). Αν false: Αξία = καθαρό Υπόλοιπο ΤΙΜ.';
