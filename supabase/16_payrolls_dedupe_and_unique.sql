-- DIAS ERP — καθαρισμός διπλών payrolls + unique (tech_id, period)
-- Τρέξε ΟΛΟ στο DIAS SQL Editor (αντί για το 15 αν απέτυχε το index).

-- 1) Cleanup: κράτα μόνο την πιο πρόσφατη εγγραφή ανά tech_id + period
delete from public.payrolls p
using public.payrolls newer
where p.tech_id is not null
  and newer.tech_id is not null
  and p.tech_id = newer.tech_id
  and p.period = newer.period
  and p.id <> newer.id
  and (
    p.created_at < newer.created_at
    or (p.created_at = newer.created_at and p.id::text < newer.id::text)
  );

-- 2) Unique index
create unique index if not exists payrolls_tech_period_uidx
  on public.payrolls (tech_id, period)
  where tech_id is not null;

comment on index public.payrolls_tech_period_uidx is
  'Ένα σετ μισθοδοσίας ανά υπάλληλο και μήνα (period)';
