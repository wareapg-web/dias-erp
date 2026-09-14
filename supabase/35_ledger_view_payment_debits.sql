-- DIAS ERP — tech_ledger_view: χρεώσεις από payment_entries (εκταμίευση δανείου 95)
-- Τρέξε στο DIAS SQL Editor ΜΕΤΑ το 29_loan_batch_id.sql.
--
-- Πρόβλημα:
--   Το view είχε invoice_amount = 0 για όλες τις πληρωμές.
--   Παράλληλα, αν salary_credit=0 και payment_type ∈ (ADVANCE/SETTLEMENT/SETTLEMENT_1),
--   το amount έπεφτε σε salary_credit (Μισθός Πιστ.).
--   Αποτέλεσμα: εκταμίευση δανείου σε Τιμολόγιο Χρ. εμφανιζόταν ως Μισθός Πιστ.
--
-- Διόρθωση:
--   1) coalesce(pay.invoice_amount, 0) αντί για σταθερό 0
--   2) Legacy amount→credit fallback μόνο όταν ΟΛΕΣ οι φυσικές debit/credit στήλες είναι 0
--
-- ΣΗΜΑΝΤΙΚΟ: DROP VIEW πριν την αλλαγή.

comment on column public.payment_entries.invoice_amount is
  'Τιμολόγιο Χρ. από πληρωμές (π.χ. εκταμίευση δανείου 95) · όχι εξόφληση (βλ. invoice_credit)';

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
  pe.created_at,
  coalesce(
    pe.month,
    extract(month from pe.reference_date)::int
  ) as month,
  coalesce(
    pe.year,
    extract(year from pe.reference_date)::int
  ) as year,
  null::integer as type_id,
  null::uuid as loan_batch_id
from public.payroll_entries pe

union all

select
  pay.id,
  pay.tech_id,
  'PAYMENT'::text as source,
  pay.payment_date as entry_date,
  pay.payment_type as type,
  coalesce(pay.description, '') as description,
  coalesce(pay.salary_debit, 0) as salary_debit,
  coalesce(
    nullif(pay.salary_credit, 0),
    case
      -- Μη κάνεις fallback αν υπάρχει οποιαδήποτε φυσική χρέωση/πίστωση
      when coalesce(pay.salary_debit, 0) <> 0 then 0
      when coalesce(pay.other_debit, 0) <> 0 then 0
      when coalesce(pay.invoice_amount, 0) <> 0 then 0
      when coalesce(pay.invoice_credit, 0) <> 0 then 0
      when coalesce(pay.other_credit, 0) <> 0 then 0
      when pay.payment_type in ('ADVANCE', 'SETTLEMENT', 'SETTLEMENT_1') then pay.amount
      else 0
    end
  ) as salary_credit,
  coalesce(pay.other_debit, 0) as other_debit,
  coalesce(
    nullif(pay.other_credit, 0),
    case
      when coalesce(pay.salary_debit, 0) <> 0 then 0
      when coalesce(pay.other_debit, 0) <> 0 then 0
      when coalesce(pay.invoice_amount, 0) <> 0 then 0
      when coalesce(pay.invoice_credit, 0) <> 0 then 0
      when coalesce(pay.salary_credit, 0) <> 0 then 0
      when pay.payment_type in ('EXPENSES', 'BONUS_PAYOUT', 'SETTLEMENT_2') then pay.amount
      else 0
    end
  ) as other_credit,
  coalesce(pay.invoice_amount, 0) as invoice_amount,
  coalesce(pay.invoice_credit, 0) as invoice_credit,
  coalesce(pay.notes, '') as notes,
  pay.created_at,
  coalesce(
    pay.month,
    extract(month from coalesce(pay.payment_date, pay.entry_date))::int
  ) as month,
  coalesce(
    pay.year,
    extract(year from coalesce(pay.payment_date, pay.entry_date))::int
  ) as year,
  pay.type_id,
  pay.loan_batch_id
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on view public.tech_ledger_view is
  'Ledger · payroll + payments · payment invoice_amount (Χρ.) + credits · loan_batch_id';
