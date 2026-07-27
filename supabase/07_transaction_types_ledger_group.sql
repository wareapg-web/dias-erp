-- DIAS ERP — transaction_types: ledger_group (EPT_COL) + seed από PaymentTypes.csv
-- Τρέξε στο DIAS SQL Editor μετά το 06 (αν υπάρχει ήδη ο πίνακας).

do $$
begin
  create type public.ledger_group as enum ('SALARY', 'OTHER');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.transaction_types (
  id integer primary key,
  description text not null,
  ledger_group public.ledger_group not null default 'OTHER',
  is_for_sum boolean not null default true,
  sort_order numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Evolve από 06 (type_pay / col_index) αν υπάρχουν
alter table public.transaction_types
  add column if not exists ledger_group public.ledger_group,
  add column if not exists is_for_sum boolean default true,
  add column if not exists sort_order numeric default 0,
  add column if not exists is_active boolean default true,
  add column if not exists ept_type_pay int,
  add column if not exists created_at timestamptz default now();

-- Backfill ledger_group από παλιό col_index (EPT_COL)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transaction_types' and column_name = 'col_index'
  ) then
    execute $u$
      update public.transaction_types
      set ledger_group = case
        when col_index = 1 then 'SALARY'::public.ledger_group
        else 'OTHER'::public.ledger_group
      end
      where ledger_group is null
    $u$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transaction_types' and column_name = 'type_pay'
  ) then
    execute $u$
      update public.transaction_types
      set ept_type_pay = type_pay
      where ept_type_pay is null and type_pay is not null
    $u$;
  end if;
end $$;

update public.transaction_types
set ledger_group = 'OTHER'
where ledger_group is null;

alter table public.transaction_types
  alter column ledger_group set not null,
  alter column ledger_group set default 'OTHER'::public.ledger_group;

alter table public.transaction_types enable row level security;

drop policy if exists transaction_types_anon_select on public.transaction_types;
create policy transaction_types_anon_select on public.transaction_types
  for select to anon using (true);

drop policy if exists transaction_types_authenticated_select on public.transaction_types;
create policy transaction_types_authenticated_select on public.transaction_types
  for select to authenticated using (true);

drop policy if exists transaction_types_anon_all on public.transaction_types;
create policy transaction_types_anon_all on public.transaction_types
  for all to anon using (true) with check (true);

drop policy if exists transaction_types_authenticated_all on public.transaction_types;
create policy transaction_types_authenticated_all on public.transaction_types
  for all to authenticated using (true) with check (true);

create index if not exists transaction_types_sort_idx
  on public.transaction_types (sort_order, id);

create index if not exists transaction_types_ledger_group_idx
  on public.transaction_types (ledger_group);

-- Replace provisional seed με πραγματικά EPT_ID από PaymentTypes.csv
delete from public.transaction_types;

insert into public.transaction_types
  (id, description, ledger_group, is_for_sum, sort_order, ept_type_pay, is_active)
values
  -- SALARY (EPT_COL = 1)
  (3,  'Μισθός',                      'SALARY', true,  1,  0, true),
  (1,  'Εξόφληση',                    'SALARY', false, 13, 0, true),
  (91, 'Εξόφληση (1)',                 'SALARY', false, 91, 0, true),

  -- OTHER (EPT_COL = 2)
  (4,  'Bonus',                       'OTHER',  true,  2,  0, true),
  (41, 'Bonus +',                     'OTHER',  true,  2,  0, true),
  (5,  'Extra Bonus',                 'OTHER',  true,  3,  0, true),
  (6,  'Ώρες',                        'OTHER',  false, 4,  1, true),
  (7,  'Υπερωρίες',                   'OTHER',  false, 5,  1, true),
  (8,  'Αργίες',                       'OTHER',  false, 6,  1, true),
  (9,  'Νυκτερινά',                   'OTHER',  false, 7,  1, true),
  (11, 'Δώρο Πάσχα',                  'OTHER',  true,  8,  2, true),
  (12, 'Δώρο Χριστουγέννων',          'OTHER',  true,  9,  2, true),
  (13, 'Επίδομα Αδείας',              'OTHER',  true,  10, 2, true),
  (14, 'Εξόφληση επιδομάτων X + A',   'OTHER',  false, 10, 0, true),
  (21, 'Επιδομα Οδηγού',              'OTHER',  true,  11, 0, true),
  (10, 'Δανειο',                      'OTHER',  false, 12, 0, true),
  (2,  'Προκαταβολή',                 'OTHER',  false, 12, 0, true),
  (22, 'Διανυκτέρευση',               'OTHER',  true,  22, 1, true),
  (23, 'Λογιστής',                    'OTHER',  true,  23, 0, true),
  (24, 'Ticket Restaurant',           'OTHER',  false, 24, 0, true),
  (25, 'Μετρό',                       'OTHER',  true,  25, 1, true),
  (92, 'Εξόφληση (2)',                 'OTHER',  false, 92, 0, true);

-- Sync sequence αν υπάρχει (serial από 06) — αλλιώς no-op
do $$
declare
  seq text;
begin
  seq := pg_get_serial_sequence('public.transaction_types', 'id');
  if seq is not null then
    perform setval(seq, coalesce((select max(id) from public.transaction_types), 1));
  end if;
end $$;

comment on type public.ledger_group is 'EPT_COL: 1=SALARY (Μισθός), 2=OTHER (Λοιπά)';
comment on column public.transaction_types.ledger_group is 'UI column group — Salary vs Other (not debit/credit)';
comment on column public.transaction_types.is_for_sum is 'EPT_IS_FOR_SUM — counts toward totals';
comment on column public.transaction_types.ept_type_pay is 'Legacy EPT_TYPE_PAY from APG (not debit/credit lock)';
