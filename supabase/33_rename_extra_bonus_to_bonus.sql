-- DIAS ERP — Extra Bonus (id 5) → γενικό χειροκίνητο «Bonus»
-- Τρέξε στο DIAS SQL Editor (μετά το 32_rename_bonus_to_salary_remainder.sql).
-- Δεν αγγίζει id 4 (Υπόλοιπο Μισθού) ούτε id 41 (Bonus +).

update public.transaction_types
set description = 'Bonus'
where id = 5;
