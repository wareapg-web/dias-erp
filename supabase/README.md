# DIAS ERP — άδεια βάση από την αρχή

## Τι πάει πού

| Σύστημα | Ρόλος |
|--------|--------|
| **Admin App Supabase** | Προσωπικό (`techs`), ώρες (`assignments`, `daily_status`), έργα (`jobs`). Το dias-erp κάνει **login** εκεί για ανάγνωση. |
| **DIAS Supabase** | Οικονομικά ERP: αποδοχές, μισθοδοσίες, πληρωμές. Ξεκινάει **άδειο** — τρέχεις το bootstrap SQL. |

Δεν αντιγράφουμε ακόμα τους techs μέσα στο DIAS για τη λίστα αριστερά· έρχονται από το Admin μετά το login. Στο DIAS αποθηκεύουμε με `tech_id` / `tech_name` του Admin.

## Βήμα 1 — Bootstrap DIAS

1. Άνοιξε το **DIAS** project στο [Supabase Dashboard](https://supabase.com/dashboard)
2. **SQL Editor** → New query
3. Επικόλλησε όλο το αρχείο `supabase/01_dias_bootstrap.sql`
4. **Run**

Δημιουργεί:
- `personnel` — προαιρετικός καθρέφτης προσωπικού
- `tech_earnings` — tab Αποδοχές
- `payrolls` — οριστική αποθήκευση μισθοδοσίας
- `payment_entries` — λίστα πληρωμών / ledger

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
2. Αριστερά εμφανίζονται οι τεχνικοί από Admin
3. Tab **Αποδοχές** → συμπλήρωση → **Αποθήκευση** (γράφει στο DIAS `tech_earnings`)
