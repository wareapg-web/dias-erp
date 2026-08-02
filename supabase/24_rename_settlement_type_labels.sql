-- DIAS ERP — μετονομασία τύπων εξόφλησης (91/92/93)
-- Τρέξε στο DIAS SQL Editor (μετά το 21_invoice_credit.sql αν υπάρχει το 93).

update public.transaction_types
set description = 'Εξόφληση Μισθού'
where id = 91;

update public.transaction_types
set description = 'Εξόφληση Λοιπών'
where id = 92;

update public.transaction_types
set description = 'Εξόφληση Τιμολογίου'
where id = 93;

-- Αν το 93 δεν υπάρχει ακόμα, δημιούργησέ το με το νέο όνομα
insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (93, 'Εξόφληση Τιμολογίου', 'OTHER', false, 93, 0, true)
on conflict (id) do update set
  description = excluded.description,
  is_active = true;
