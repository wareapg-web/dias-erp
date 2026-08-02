-- DIAS ERP — payment_entries.type_id → σύνδεση με transaction_types (91/92/93)
-- Τρέξε στο DIAS SQL Editor ΜΕΤΑ το 23_ledger_view_accounting_period.sql (και 24 αν υπάρχει).

alter table public.payment_entries
  add column if not exists type_id integer references public.transaction_types (id);

comment on column public.payment_entries.type_id is
  'FK transaction_types · 91 Μισθού · 92 Λοιπών · 93 Τιμολογίου';

create index if not exists payment_entries_type_id_idx
  on public.payment_entries (type_id);

-- Backfill από φυσικές πιστώσεις / payment_type
update public.payment_entries
set type_id = 93
where type_id is null
  and (
    coalesce(invoice_credit, 0) <> 0
    or payment_type = 'SETTLEMENT'
  );

update public.payment_entries
set type_id = 91
where type_id is null
  and (
    coalesce(salary_credit, 0) <> 0
    or payment_type in ('SETTLEMENT_1', 'ADVANCE')
  );

update public.payment_entries
set type_id = 92
where type_id is null
  and (
    coalesce(other_credit, 0) <> 0
    or payment_type in ('SETTLEMENT_2', 'EXPENSES', 'BONUS_PAYOUT')
  );

-- Διόρθωση: SETTLEMENT με salary_credit (χωρίς invoice) → 91, όχι 93
update public.payment_entries
set type_id = 91
where payment_type = 'SETTLEMENT'
  and coalesce(invoice_credit, 0) = 0
  and coalesce(salary_credit, 0) <> 0;

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
  null::integer as type_id
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
  ) as year,
  pay.type_id
from public.payment_entries pay;

grant select on public.tech_ledger_view to anon, authenticated;

comment on view public.tech_ledger_view is
  'Ledger · type_id από payment_entries για σωστή ετικέτα (π.χ. 93 Εξόφληση Τιμολογίου)';
