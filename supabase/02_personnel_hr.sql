-- DIAS ERP — επέκταση personnel για HR master (μόνιμος/έκτακτος, αρχείο, link Admin)
-- Τρέξε στο DIAS SQL Editor (όχι Admin).

alter table public.personnel
  add column if not exists employment_type text not null default 'permanent',
  add column if not exists payment_method text not null default 'salary',
  add column if not exists end_date date,
  add column if not exists admin_tech_id text,
  add column if not exists archived_at timestamptz;

-- Έλεγχος επιτρεπτών τιμών (αν υπάρχει ήδη constraint, αγνόησε το error και συνέχισε)
do $$
begin
  alter table public.personnel
    drop constraint if exists personnel_employment_type_check;
  alter table public.personnel
    add constraint personnel_employment_type_check
    check (employment_type in ('permanent', 'temporary', 'contractor'));

  alter table public.personnel
    drop constraint if exists personnel_payment_method_check;
  alter table public.personnel
    add constraint personnel_payment_method_check
    check (payment_method in ('salary', 'invoice', 'mixed'));
exception
  when others then
    raise notice 'constraints skipped: %', sqlerrm;
end $$;

create index if not exists personnel_is_active_idx on public.personnel (is_active);
create index if not exists personnel_employment_type_idx on public.personnel (employment_type);
create index if not exists personnel_admin_tech_id_idx on public.personnel (admin_tech_id);

comment on column public.personnel.employment_type is 'permanent | temporary | contractor';
comment on column public.personnel.payment_method is 'salary | invoice | mixed';
comment on column public.personnel.admin_tech_id is 'Optional link to Admin App techs.id for hours bridge';
comment on column public.personnel.archived_at is 'Set when soft-deleted to archive';
