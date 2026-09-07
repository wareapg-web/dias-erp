-- DIAS ERP — ξετικάρισμα «Bonus +» (auto_transfer) για ΟΛΟΥΣ τους τεχνικούς
-- Τρέξε στο DIAS Supabase → SQL Editor.
-- Δεν μηδενίζει το ποσό bonus_plus_amount · μόνο το checkbox μεταφοράς (Δημιουργία).

update public.tech_earnings
set
  auto_transfer_settings = jsonb_set(
    coalesce(auto_transfer_settings, '{}'::jsonb),
    '{bonus_plus_amount}',
    'false'::jsonb,
    true
  ),
  updated_at = now()
where coalesce((auto_transfer_settings->>'bonus_plus_amount')::boolean, false) = true;

-- Έλεγχος: πρέπει να επιστρέφει 0 γραμμές με true
-- select tech_id, tech_name, auto_transfer_settings->>'bonus_plus_amount' as bonus_plus_checked
-- from public.tech_earnings
-- where coalesce((auto_transfer_settings->>'bonus_plus_amount')::boolean, false) = true;
