-- DIAS ERP — ένα payroll record ανά υπάλληλο + περίοδο
-- Τρέξε στο DIAS SQL Editor (μετά το cleanup διπλοεγγραφών αν χρειουν).

-- Προαιρετικό cleanup: κράτα την πιο πρόσφατη εγγραφή ανά tech_id + period
-- delete from public.payrolls p
-- using public.payrolls newer
-- where p.tech_id is not null
--   and p.tech_id = newer.tech_id
--   and p.period = newer.period
--   and p.created_at < newer.created_at;

create unique index if not exists payrolls_tech_period_uidx
  on public.payrolls (tech_id, period)
  where tech_id is not null;

comment on index public.payrolls_tech_period_uidx is
  'Ένα σετ μισθοδοσίας ανά υπάλληλο και μήνα (period)';
