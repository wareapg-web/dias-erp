-- DIAS ERP — transaction_types (mirror APG EMPLOEE_PAYMENT_TYPE)
-- Τρέξε στο DIAS SQL Editor.

create table if not exists public.transaction_types (
  id serial primary key,
  description text not null,
  type_pay int,
  col_index int,
  is_for_sum boolean not null default true,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists transaction_types_sort_idx
  on public.transaction_types (sort_order, id);

create index if not exists transaction_types_active_idx
  on public.transaction_types (is_active);

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

-- Seed provisional mapping (θα ευθυγραμμιστεί με real EMPLOEE_PAYMENT_TYPE rows)
-- type_pay: 1 = Χρέωση / payroll_entries, 2 = Πίστωση / payment_entries  (TODO: verify vs APG)
-- col_index: 1 = Μισθός, 2 = Λοιπά  (TODO: verify vs EPT_COL)
insert into public.transaction_types (id, description, type_pay, col_index, is_for_sum, sort_order)
values
  (1,  'Μισθός',           1, 1, true,  10),
  (2,  'Υπερωρίες',        1, 2, true,  20),
  (3,  'Νυχτερινά',        1, 2, true,  30),
  (4,  'Αργίες',            1, 2, true,  40),
  (5,  'Διανυκτέρευση',    1, 2, true,  50),
  (6,  'Bonus',            1, 2, true,  60),
  (7,  'Extra Bonus',      1, 2, true,  70),
  (8,  'Ticket Restaurant',1, 2, true,  80),
  (9,  'Μετρό',            1, 2, true,  90),
  (10, 'Επίδομα Οδηγού',   1, 2, true, 100),
  (11, 'Έναντι',           2, 1, true, 110),
  (12, 'Εξόφληση',         2, 1, true, 120),
  (13, 'Εξόφληση (1)',     2, 1, true, 130),
  (14, 'Εξόφληση (2)',     2, 2, true, 140),
  (15, 'Έξοδα',            2, 2, true, 150),
  (16, 'Πληρωμή Bonus',    2, 2, true, 160)
on conflict (id) do update set
  description = excluded.description,
  type_pay = excluded.type_pay,
  col_index = excluded.col_index,
  is_for_sum = excluded.is_for_sum,
  sort_order = excluded.sort_order;

select setval(
  pg_get_serial_sequence('public.transaction_types', 'id'),
  coalesce((select max(id) from public.transaction_types), 1)
);

comment on table public.transaction_types is 'Mirror APG EMPLOEE_PAYMENT_TYPE — drives ledger column + payroll vs payment';
comment on column public.transaction_types.type_pay is 'EPT_TYPE_PAY — TODO verify: 1=debit/payroll, 2=credit/payment';
comment on column public.transaction_types.col_index is 'EPT_COL — TODO verify: 1=salary columns, 2=other columns';
