-- DIAS ERP — τύπος 94 «Δόση Δανείου» για LoanModal
-- Τρέξε στο DIAS SQL Editor (μετά το 25_payment_entries_type_id.sql αν υπάρχει type_id).

insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (94, 'Δόση Δανείου', 'OTHER', false, 94, 0, true)
on conflict (id) do update set
  description = excluded.description,
  ledger_group = excluded.ledger_group,
  is_for_sum = excluded.is_for_sum,
  sort_order = excluded.sort_order,
  is_active = true;
