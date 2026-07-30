-- DIAS ERP — update agreements + employment_type constraints
-- Τρέξε στο DIAS SQL Editor μετά τα 01–11.

-- 1) tech_agreements: επίτρεψε ACCOUNTANT (Λογιστής)
alter table public.tech_agreements
  drop constraint if exists tech_agreements_type_code_check;

alter table public.tech_agreements
  add constraint tech_agreements_type_code_check check (
    type_code in (
      'BASE_SALARY',
      'HOURLY_RATE',
      'OVERTIME',
      'BONUS',
      'HOLIDAY',
      'NIGHT',
      'OVERNIGHT',
      'TRAVEL',
      'METRO',
      'TICKET',
      'ACCOUNTANT'
    )
  );

comment on constraint tech_agreements_type_code_check on public.tech_agreements is
  'Επιτρεπτοί τύποι συμφωνίας · ACCOUNTANT = Λογιστής (μόνο με issues_invoice)';

-- 2) personnel: χωρίς contractor (UI: Μόνιμος / Έκτακτος μόνο)
alter table public.personnel
  drop constraint if exists personnel_employment_type_check;

alter table public.personnel
  add constraint personnel_employment_type_check
  check (employment_type in ('permanent', 'temporary'));

comment on constraint personnel_employment_type_check on public.personnel is
  'permanent | temporary (contractor αφαιρέθηκε από το UI)';
