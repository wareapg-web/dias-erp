-- DIAS ERP — Περιοχή & Τ.Κ. στην καρτέλα υπαλλήλου (personnel)
-- Τρέξε στο DIAS SQL Editor.

alter table public.personnel
  add column if not exists area text,
  add column if not exists zipcode varchar(20);

comment on column public.personnel.area is 'Περιοχή διεύθυνσης';
comment on column public.personnel.zipcode is 'Ταχυδρομικός κώδικας (Τ.Κ.)';
