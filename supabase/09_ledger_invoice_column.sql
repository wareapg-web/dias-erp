-- DIAS ERP — στήλη Τιμολόγιο Χρ.-Πιστ. στο ledger
-- Τρέξε στο DIAS SQL Editor μετά το 08.
-- ΣΗΜΑΝΤΙΚΟ: DROP VIEW πρώτα — το CREATE OR REPLACE δεν μπορεί να αλλάξει
-- σειρά/ονόματα στηλών (σφάλμα 42P16 για notes → invoice_amount).

alter table public.payroll_entries
  add column if not exists invoice_amount numeric(12, 2) not null default 0;

alter table public.payment_entries
  add column if not exists invoice_amount numeric(12, 2) not null default 0;

comment on column public.payroll_entries.invoice_amount is
  'Ποσό στη στήλη Τιμολόγιο Χρ.-Πιστ. (χρέωση) — για υπαλλήλους με τιμολόγιο';
comment on column public.payment_entries.invoice_amount is
  'Ποσό στη στήλη Τιμολόγιο Χρ.-Πιστ. (πίστωση) — για υπαλλήλους με τιμολόγιο';

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
    when coalesce(pay.invoice_amount, 0) <> 0 then 0
    when pay.payment_type in ('ADVANCE', 'SETTLEMENT', 'SETTLEMENT_1') then pay.amount
    else 0
  end as salary_credit,
  0::numeric(12, 2) as other_debit,
  case
    when coalesce(pay.invoice_amount, 0) <> 0 then 0
    when pay.payment_type in ('EXPENSES', 'BONUS_PAYOUT', 'SETTLEMENT_2') then pay.amount
    else 0
  end as other_credit,
  coalesce(pay.invoice_amount, 0) as invoice_amount,
  coalesce(pay.notes, '') as notes,
  pay.created_at
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on view public.tech_ledger_view is
  'Ledger grid: 4 κλασικές στήλες + invoice_amount (Τιμολόγιο Χρ.-Πιστ.)';
