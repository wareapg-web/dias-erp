-- DIAS ERP — Μετονομασία τύπου 21 «Επίδομα Οδηγού» → «Άλλο Επίδομα».
-- Η στήλη driver_allowance (tech_earnings / payrolls) μένει ως έχει.

update public.transaction_types
set description = 'Άλλο Επίδομα'
where id = 21;

select id, description, ledger_group
from public.transaction_types
where id in (13, 21);
