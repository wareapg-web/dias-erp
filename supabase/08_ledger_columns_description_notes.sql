-- DIAS ERP — tech_ledger_view: ξεχωριστά type / description (ώρες) / notes
-- Τρέξε στο DIAS SQL Editor μετά το 05 (και 07).

alter table public.payroll_entries
  add column if not exists notes text;

alter table public.payment_entries
  add column if not exists description text;

create or replace view public.tech_ledger_view
with (security_invoker = true)
as
select
  pe.id,
  pe.tech_id,
  'PAYROLL'::text as source,
  pe.reference_date as entry_date,
  pe.type_code as type,
  coalesce(pe.description, '') as description,
  case when pe.is_salary_type then pe.amount else 0 end as salary_debit,
  0::numeric(12, 2) as salary_credit,
  case when not pe.is_salary_type then pe.amount else 0 end as other_debit,
  0::numeric(12, 2) as other_credit,
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
    when pay.payment_type in ('ADVANCE', 'SETTLEMENT', 'SETTLEMENT_1') then pay.amount
    else 0
  end as salary_credit,
  0::numeric(12, 2) as other_debit,
  case
    when pay.payment_type in ('EXPENSES', 'BONUS_PAYOUT', 'SETTLEMENT_2') then pay.amount
    else 0
  end as other_credit,
  coalesce(pay.notes, '') as notes,
  pay.created_at
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on column public.payroll_entries.description is 'Περιγραφή ώρων/ποσοτήτων (π.χ. 168.50 ώρα/ες x 12.00 €)';
comment on column public.payroll_entries.notes is 'Ελεύθερο κείμενο σημειώσεων';
comment on view public.tech_ledger_view is 'Ledger grid: type=κωδικός τύπου, description=ανάλυση ώρων, notes=σημειώσεις';
