-- DIAS ERP — πεδία καρτέλας παλιού ERP (προσωπικά / επικοινωνία / τράπεζα)
-- Τρέξε στο DIAS SQL Editor μετά τα 01 + 02.

alter table public.personnel
  add column if not exists position_number text,
  add column if not exists address text,
  add column if not exists address_number text,
  add column if not exists phone text,
  add column if not exists mobile text,
  add column if not exists birth_date date,
  add column if not exists name_day text,
  add column if not exists id_number text,
  add column if not exists afm text,
  add column if not exists doy text,
  add column if not exists marital_status text,
  add column if not exists in_office boolean not null default false,
  add column if not exists bank_name text,
  add column if not exists iban text,
  add column if not exists bank_account_holder text;

comment on column public.personnel.position_number is 'Αριθμός θέσης τεχνικού (παλιό ERP)';
comment on column public.personnel.marital_status is 'Οικογενειακή κατάσταση';
comment on column public.personnel.in_office is 'Εντός γραφείου';
comment on column public.personnel.iban is 'IBAN λογαριασμού';
comment on column public.personnel.bank_name is 'EUROBANK | ALPHA BANK | ΠΕΙΡΑΙΩΣ | ΕΘΝΙΚΗ';
