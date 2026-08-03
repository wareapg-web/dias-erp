-- DIAS ERP — τύπος 95 «Εκταμίευση Δανείου» (ταμειακή εγγραφή · μετράει στα σύνολα)
-- Τρέξε στο DIAS SQL Editor μετά το 26_loan_installment_type.sql.

insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (95, 'Εκταμίευση Δανείου', 'OTHER', true, 95, 0, true)
on conflict (id) do update set
  description = excluded.description,
  ledger_group = excluded.ledger_group,
  is_for_sum = excluded.is_for_sum,
  sort_order = excluded.sort_order,
  is_active = true;
