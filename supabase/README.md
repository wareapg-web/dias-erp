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
- `supabase/07_transaction_types_ledger_group.sql` (ledger_group SALARY|OTHER + seed από PaymentTypes.csv)
- `supabase/08_ledger_columns_description_notes.sql` (type / description ώρων / notes στο tech_ledger_view)
- `supabase/09_ledger_invoice_column.sql` (στήλη invoice_amount · Τιμολόγιο Χρ.-Πιστ.)
- `supabase/10_personnel_card_fields.sql` (διεύθυνση, ΑΦΜ, κινητό, τράπεζα, κ.λπ. καρτέλας παλιού ERP)
- `supabase/11_personnel_periods.sql` (ιστορικό συμβάσεων / περίοδοι απασχόλησης)
- `supabase/12_update_agreements_constraint.sql` (ACCOUNTANT στις συμφωνές · χωρίς contractor στο employment_type)
- `supabase/13_payrolls_ticket_restaurant.sql` (ticket_restaurant στο payrolls · μήτρα Ticket)
- `supabase/14_tech_earnings_accountant.sql` (accountant_amount στις Αποδοχές · γραμμή Λογιστής)
- `supabase/16_payrolls_dedupe_and_unique.sql` (cleanup διπλών + unique tech_id+period)
- `supabase/17_personnel_area_zipcode.sql` (περιοχή + Τ.Κ. στην καρτέλα υπαλλήλου)
- `supabase/18_add_driver_allowance.sql` (Επίδομα οδηγού · tech_earnings + payrolls)
- `supabase/19_work_hours.sql` (ώρες γραφείου · Εντός γραφείου)
- `supabase/20_auto_transfer_settings.sql` (JSONB checkboxes Αποδοχές → Δημιουργία)
- `supabase/21_invoice_credit.sql` (Τιμολόγιο Πιστ. · `payment_entries.invoice_credit` + view Χρ./Πιστ.)
- `supabase/22_ledger_view_physical_credits.sql` (view: φυσικές salary/other/invoice_credit + legacy fallback)
- `supabase/23_ledger_view_accounting_period.sql` (view: month/year λογιστική περίοδος · ανεξάρτητα από entry_date)
- `supabase/24_rename_settlement_type_labels.sql` (91/92/93 → Εξόφληση Μισθού/Λοιπών/Τιμολογίου)
- `supabase/25_payment_entries_type_id.sql` (payment_entries.type_id + view · TIM → 93)
- `supabase/26_loan_installment_type.sql` (transaction_types id 94 · Δόση Δανείου)
- `supabase/27_loan_disbursement_type.sql` (transaction_types id 95 · Εκταμίευση Δανείου)
- `supabase/28_uncheck_bonus_plus_transfer.sql` (ξετικάρισμα Bonus+ auto_transfer)
- `supabase/29_loan_batch_id.sql` (`payment_entries.loan_batch_id` + view · σειρά δανείου)
- `supabase/30_fixed_expense_settings.sql` (JSONB Βασικό/Μεταβλητό στις Αποδοχές)

### Φωτογραφίες προφίλ (Cloudflare R2 μέσω Edge Function)

1. Deploy: `supabase functions deploy upload-r2-photo --project-ref <DIAS_PROJECT_REF>`
2. Secrets στο DIAS project:
   ```bash
   supabase secrets set R2_ENDPOINT_URL=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... R2_PUBLIC_BASE_URL=...
   ```
3. Στο UI καρτέλας: «Ανέβασμα φωτο (R2)» → συμπίεση → Edge Function → URL στο `photo_url` → **Αποθήκευση** για DB.
4. R2 key: `personnel/profile/{techId}/{timestamp}-{uuid}.jpg`
5. `verify_jwt = false` στο `supabase/config.toml` (το DIAS login είναι Admin project).

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
