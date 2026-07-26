-- DIAS ERP — payroll_entries (δεδουλευμένα) + tech_ledger_view (χρεοπίστωση)
-- Τρέξε στο DIAS SQL Editor.

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  tech_id text not null references public.personnel (tech_id) on update cascade on delete restrict,
  reference_date date not null default (current_date),
  type_code text not null,
  description text,
  amount numeric(12, 2) not null default 0,
  is_salary_type boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists payroll_entries_tech_idx on public.payroll_entries (tech_id);
create index if not exists payroll_entries_date_idx on public.payroll_entries (reference_date desc);
create index if not exists payroll_entries_tech_date_idx on public.payroll_entries (tech_id, reference_date);

alter table public.payroll_entries enable row level security;

drop policy if exists payroll_entries_anon_all on public.payroll_entries;
create policy payroll_entries_anon_all on public.payroll_entries
  for all to anon using (true) with check (true);

drop policy if exists payroll_entries_authenticated_all on public.payroll_entries;
create policy payroll_entries_authenticated_all on public.payroll_entries
  for all to authenticated using (true) with check (true);

-- Expand payment_type allow-list for ledger credit buckets
do $$
begin
  alter table public.payment_entries drop constraint if exists payment_entries_payment_type_check;
  alter table public.payment_entries
    add constraint payment_entries_payment_type_check
    check (
      payment_type in (
        'ADVANCE',
        'SETTLEMENT',
        'SETTLEMENT_1',
        'SETTLEMENT_2',
        'EXPENSES',
        'BONUS_PAYOUT'
      )
    );
exception
  when others then
    raise notice 'payment_type check update skipped: %', sqlerrm;
end $$;

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
  ''::text as notes,
  pe.created_at
from public.payroll_entries pe

union all

select
  pay.id,
  pay.tech_id,
  'PAYMENT'::text as source,
  pay.payment_date as entry_date,
  pay.payment_type as type,
  coalesce(pay.notes, '') as description,
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

comment on table public.payroll_entries is 'Accruals / δεδουλευμένα (Χρεώσεις) for tech ledger';
comment on view public.tech_ledger_view is 'Unified ledger: payroll_entries (debit) UNION payment_entries (credit)';
