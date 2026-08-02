-- DIAS ERP — invoice_credit (Τιμολόγιο Πιστ.) σε payment_entries + tech_ledger_view
-- Τρέξε στο DIAS SQL Editor μετά το 09_ledger_invoice_column.sql (και τα ενδιάμεσα).
--
-- Μοντέλο:
--   payroll_entries.invoice_amount  = Τιμολόγιο Χρ. (χρέωση / αποδοχές)
--   payment_entries.invoice_credit  = Τιμολόγιο Πιστ. (εξόφληση / πληρωμή)
--
-- ΣΗΜΑΝΤΙΚΟ: DROP VIEW πρώτα — αλλαγή στηλών στο view.

-- 1) Νέα στήλη πίστωσης τιμολογίου
alter table public.payment_entries
  add column if not exists invoice_credit numeric(12, 2) not null default 0;

comment on column public.payment_entries.invoice_amount is
  'Legacy / μη χρήση για νέες πιστώσεις — η χρέωση τιμολογίου μένει στο payroll_entries.invoice_amount';
comment on column public.payment_entries.invoice_credit is
  'Ποσό στη στήλη Τιμολόγιο Πιστ. (εξόφληση τιμολογίου)';

comment on column public.payroll_entries.invoice_amount is
  'Ποσό στη στήλη Τιμολόγιο Χρ. (χρέωση αποδοχών σε τιμολόγιο)';

-- 2) Μεταφορά παλιών payment invoice_amount → invoice_credit (ήταν λογική πίστωσης)
update public.payment_entries
set
  invoice_credit = coalesce(invoice_amount, 0),
  invoice_amount = 0
where coalesce(invoice_amount, 0) <> 0
  and coalesce(invoice_credit, 0) = 0;

-- 3) Προαιρετικός τύπος Εξόφληση Τιμολογίου για το κουμπί ΕΞΟΦΛΗΣΗ(ΤΙΜ)
insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  (93, 'Εξόφληση Τιμολογίου', 'OTHER', false, 93, 0, true)
on conflict (id) do update set
  description = excluded.description,
  ledger_group = excluded.ledger_group,
  is_for_sum = excluded.is_for_sum,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- 4) View: 4 κλασικές + invoice_amount (Χρ.) + invoice_credit (Πιστ.)
drop view if exists public.tech_ledger_view;

create view public.tech_ledger_view
with (security_invoker = true)
as
select
  pe.id,
  pe.tech_id,
  'PAYROLL'::text as source,
  pe.reference_date as entry_date,
  pe.type_code as type,
  coalesce(pe.description, '') as description,
  case
    when coalesce(pe.invoice_amount, 0) <> 0 then 0
    when pe.is_salary_type then pe.amount
    else 0
  end as salary_debit,
  0::numeric(12, 2) as salary_credit,
  case
    when coalesce(pe.invoice_amount, 0) <> 0 then 0
    when not pe.is_salary_type then pe.amount
    else 0
  end as other_debit,
  0::numeric(12, 2) as other_credit,
  coalesce(pe.invoice_amount, 0) as invoice_amount,
  0::numeric(12, 2) as invoice_credit,
  coalesce(pe.notes, '') as notes,
  pe.created_at
from public.payroll_entries pe

union all

select
  pay.id,
  pay.tech_id,
  'PAYMENT'::text as source,
  pay.payment_date as entry_date,
  pay.payment_type as type,
  coalesce(pay.description, '') as description,
  0::numeric(12, 2) as salary_debit,
  case
    when coalesce(pay.invoice_credit, 0) <> 0 then 0
    when coalesce(pay.invoice_amount, 0) <> 0 then 0
    when pay.payment_type in ('ADVANCE', 'SETTLEMENT', 'SETTLEMENT_1') then pay.amount
    else 0
  end as salary_credit,
  0::numeric(12, 2) as other_debit,
  case
    when coalesce(pay.invoice_credit, 0) <> 0 then 0
    when coalesce(pay.invoice_amount, 0) <> 0 then 0
    when pay.payment_type in ('EXPENSES', 'BONUS_PAYOUT', 'SETTLEMENT_2') then pay.amount
    else 0
  end as other_credit,
  0::numeric(12, 2) as invoice_amount,
  coalesce(pay.invoice_credit, 0) as invoice_credit,
  coalesce(pay.notes, '') as notes,
  pay.created_at
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on view public.tech_ledger_view is
  'Ledger grid: Μισθός/Λοιπά Χρ.-Πιστ. + Τιμολόγιο Χρ. (invoice_amount) + Τιμολόγιο Πιστ. (invoice_credit)';
