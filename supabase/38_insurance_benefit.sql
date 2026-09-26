-- DIAS ERP — Ασφάλιση (ίδια λογική με Ticket Restaurant)
-- Τρέξε στο DIAS SQL Editor μετά τα υπάρχοντα migrations.

-- tech_earnings: ποσό / από / ελάχιστο (όπως ticket_*)
alter table public.tech_earnings
  add column if not exists insurance_amount numeric(12, 2) not null default 0,
  add column if not exists insurance_from numeric(12, 2) not null default 0,
  add column if not exists insurance_min numeric(12, 2) not null default 0;

comment on column public.tech_earnings.insurance_amount is
  'Ασφάλιση — ποσό πακέτου αποδοχών (ανεξάρτητο από Σ ledger)';

-- payrolls: ιστορικό ανά μήνα (όπως ticket_restaurant)
alter table public.payrolls
  add column if not exists insurance numeric(12, 2) not null default 0;

comment on column public.payrolls.insurance is
  'Ασφάλιση ποσό μήνα (από tech_earnings.insurance_amount κατά Οριστική Αποθήκευση) — εκτός Σ / πληρωτέου';

-- transaction_types id 26 — ledger γραμμές αποκλείονται από υπόλοιπα όπως Ticket 24
insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (26, 'Ασφάλιση', 'OTHER', false, 26, 0, true)
on conflict (id) do update
set description = excluded.description,
    ledger_group = excluded.ledger_group,
    is_for_sum = excluded.is_for_sum,
    is_active = true;
