# DIAS ERP — άδεια βάση από την αρχή

## Τι πάει πού

| Σύστημα | Ρόλος |
|--------|--------|
| **Admin App Supabase** | Βάρδιες / ώρες (`techs`, `assignments`, `daily_status`, `jobs`). Login για ανάγνωση. |
| **DIAS Supabase** | **HR master** (`personnel`) + αποδοχές, μισθοδοσίες, πληρωμές. |

Το DIAS κρατάει το προσωπικό (μόνιμος/έκτακτος, τιμολόγιο, αρχείο). Το Admin μένει για όσους δουλεύουν βάρδιες· οι ώρες τραβιούνται όταν υπάρχει `admin_tech_id` / match.

## Βήμα 1 — Bootstrap DIAS

1. Άνοιξε το **DIAS** project στο [Supabase Dashboard](https://supabase.com/dashboard)
2. **SQL Editor** → New query
3. Επικόλλησε όλο το `supabase/01_dias_bootstrap.sql` → **Run**
4. Μετά τρέξε και το `supabase/02_personnel_hr.sql` (στήλες HR / αρχείο)

Δημιουργεί:
- `personnel` — κατάλογος υπαλλήλων DIAS
- `tech_earnings` — tab Αποδοχές (wide / bank)
- `tech_agreements` — tab Συμφωνίες (ιστορικό rates, `03_tech_agreements.sql`)
- `payrolls` — οριστική αποθήκευση μισθοδοσίας
- `payment_entries` — tab Πληρωμές (`04_payment_entries.sql`)

Μετά το bootstrap τρέξε και:
- `supabase/02_personnel_hr.sql`
- `supabase/03_tech_agreements.sql`
- `supabase/04_payment_entries.sql`
- `supabase/05_payroll_entries_and_ledger.sql`
- `supabase/06_transaction_types.sql`

## Βήμα 2 — Env

Στο `.env.local` του dias-erp πρέπει να υπάρχουν **δύο** καλώδια:

```env
VITE_ADMIN_SUPABASE_URL=...
VITE_ADMIN_SUPABASE_ANON_KEY=...
VITE_DIAS_SUPABASE_URL=...
VITE_DIAS_SUPABASE_ANON_KEY=...
```

## Βήμα 3 — Χρήση

1. Login με λογαριασμό **Admin**
2. Αριστερά: προσωπικό DIAS — **+ Νέος** ή **Από Admin** (μόνο βάρδιες)
3. Soft-delete → **Αρχείο** (όχι οριστική διαγραφή)
4. Tab **Αποδοχές** → αποθήκευση στο DIAS `tech_earnings`
