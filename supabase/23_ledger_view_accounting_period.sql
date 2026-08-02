-- DIAS ERP — tech_ledger_view: λογιστική περίοδος (month/year) ≠ ημερομηνία συναλλαγής
-- Τρέξε στο DIAS SQL Editor ΜΕΤΑ το 22_ledger_view_physical_credits.sql.
--
-- Μοντέλο:
--   entry_date / payment_date / reference_date = πραγματική ημερομηνία συναλλαγής
--   month + year = λογιστική περίοδος (φίλτρο Ledger UI)
--
-- ΣΗΜΑΝΤΙΚΟ: DROP VIEW πρώτα (αλλαγή στηλών).

-- payroll_entries: στήλες περιόδου
alter table public.payroll_entries
  add column if not exists month int,
  add column if not exists year int;

create index if not exists payroll_entries_year_month_idx
  on public.payroll_entries (year, month);

-- Backfill από ημερομηνία όπου λείπει
update public.payroll_entries
set
  month = extract(month from reference_date)::int,
  year = extract(year from reference_date)::int
where month is null or year is null;

update public.payment_entries
set
  month = extract(month from coalesce(payment_date, entry_date, current_date))::int,
  year = extract(year from coalesce(payment_date, entry_date, current_date))::int
where month is null or year is null;

comment on column public.payroll_entries.month is
  'Λογιστικός μήνας (1–12) — ανεξάρτητος από reference_date';
comment on column public.payroll_entries.year is
  'Λογιστικό έτος — ανεξάρτητο από reference_date';
comment on column public.payment_entries.month is
  'Λογιστικός μήνας (1–12) — ανεξάρτητος από payment_date';
comment on column public.payment_entries.year is
  'Λογιστικό έτος — ανεξάρτητο από payment_date';

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
  ) as year
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
  pay.created_at,
  coalesce(
    pay.month,
    extract(month from coalesce(pay.payment_date, pay.entry_date))::int
  ) as month,
  coalesce(
    pay.year,
    extract(year from coalesce(pay.payment_date, pay.entry_date))::int
  ) as year
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on view public.tech_ledger_view is
  'Ledger: payroll + payment · entry_date = συναλλαγή · month/year = λογιστική περίοδος';
