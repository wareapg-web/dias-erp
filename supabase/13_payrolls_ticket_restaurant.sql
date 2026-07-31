-- DIAS ERP — ιστορικό Ticket Restaurant ανά μήνα στο payrolls
-- Τρέξε στο DIAS SQL Editor (αν δεν έχει ήδη προστεθεί η στήλη).

alter table public.payrolls
  add column if not exists ticket_restaurant numeric(12, 2) not null default 0;

comment on column public.payrolls.ticket_restaurant is
  'Ticket Restaurant ποσό μήνα (από tech_earnings.ticket_amount κατά Οριστική Αποθήκευση) — ανεξάρτητο από Σ απολαβών / ledger';
