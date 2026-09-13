-- DIAS ERP — μετονομασία τύπου id 4: Bonus → Υπόλοιπο Μισθού
-- Τρέξε στο DIAS SQL Editor.
-- Δεν αλλάζει keys/στήλες (bonus_amount κλπ.) ούτε το id 41 (Bonus +).
-- Id 5 μετονομάζεται ξεχωριστά στο 33_rename_extra_bonus_to_bonus.sql.

update public.transaction_types
set description = 'Υπόλοιπο Μισθού'
where id = 4;
