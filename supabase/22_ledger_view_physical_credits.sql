-- DIAS ERP — tech_ledger_view: φυσικές στήλες credit + legacy fallback
-- Τρέξε στο DIAS SQL Editor ΜΕΤΑ το 21_invoice_credit.sql.
--
-- Μοντέλο payment_entries:
--   salary_credit / other_credit / invoice_credit = άμεσες στήλες εξόφλησης
--   Legacy: αν οι στήλες είναι 0, fallback σε amount + payment_type (παλιά δεδομένα)
--
-- ΣΗΜΑΝΤΙΚΟ: DROP VIEW πρώτα.

-- Βεβαιώσου ότι υπάρχουν οι φυσικές στήλες (bootstrap / παλιά schema)
alter table public.payment_entries
  add column if not exists salary_debit numeric(12, 2) not null default 0,
  add column if not exists salary_credit numeric(12, 2) not null default 0,
  add column if not exists other_debit numeric(12, 2) not null default 0,
  add column if not exists other_credit numeric(12, 2) not null default 0,
  add column if not exists invoice_credit numeric(12, 2) not null default 0;

comment on column public.payment_entries.salary_credit is
  'Εξόφληση (Μ) — Μισθός Πιστ.';
comment on column public.payment_entries.other_credit is
  'Εξόφληση (Λ) — Λοιπά Πιστ.';
comment on column public.payment_entries.invoice_credit is
  'Εξόφληση (ΤΙΜ) — Τιμολόγιο Πιστ.';

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
  coalesce(pay.salary_debit, 0) as salary_debit,
  -- Φυσική στήλη πρώτα · αλλιώς legacy από amount + payment_type
  coalesce(
    nullif(pay.salary_credit, 0),
    case
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
      when coalesce(pay.invoice_credit, 0) <> 0 then 0
      when coalesce(pay.salary_credit, 0) <> 0 then 0
      when pay.payment_type in ('EXPENSES', 'BONUS_PAYOUT', 'SETTLEMENT_2') then pay.amount
      else 0
    end
  ) as other_credit,
  0::numeric(12, 2) as invoice_amount,
  coalesce(pay.invoice_credit, 0) as invoice_credit,
  coalesce(pay.notes, '') as notes,
  pay.created_at
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on view public.tech_ledger_view is
  'Ledger: payroll debits + payment credits από φυσικές στήλες (με legacy fallback amount/payment_type)';
