-- DIAS ERP — τύπος 96 «Πληρωμή Τιμολογίου» (μερική πίστωση ΤΙΜ · όχι εξόφληση)
-- Τρέξε στο DIAS SQL Editor μετά το 24_rename_settlement_type_labels.sql / 21_invoice_credit.sql.

insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (96, 'Πληρωμή Τιμολογίου', 'OTHER', false, 96, 0, true)
on conflict (id) do update set
  description = excluded.description,
  ledger_group = excluded.ledger_group,
  is_for_sum = excluded.is_for_sum,
  sort_order = excluded.sort_order,
  is_active = true;
