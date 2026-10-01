-- DIAS ERP — τύποι μερικής πληρωμής Μισθού / Λοιπών (97 / 98)
-- Τρέξε στο DIAS SQL Editor μετά το 39_invoice_partial_payment_type.sql.

insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (97, 'Πληρωμή Μισθού', 'SALARY', false, 97, 0, true),
  (98, 'Πληρωμή Λοιπών', 'OTHER', false, 98, 0, true)
on conflict (id) do update set
  description = excluded.description,
  ledger_group = excluded.ledger_group,
  is_for_sum = excluded.is_for_sum,
  sort_order = excluded.sort_order,
  is_active = true;
