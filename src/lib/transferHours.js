/**
 * Μεταφορά Ωρών — από Admin βάρδιες (summary μήνα) → payroll_entries.
 * Κατηγορίες: Υπερωρίες, Αργίες, Νυχτερινά, Μετρό, Διανυκτέρευση → Λοιπά Χρ.
 */

import { diasClient } from './supabase'
import {
  buildLedgerAmountForType,
  buildLedgerDescriptionForType,
  monthDateRange,
} from './techLedger'
import { payrollTypeCodeFromDescription } from './transactionTypes'
import { routesExtrasToInvoice } from './personnel'

/** EPT_IDs από transaction_types (OTHER debit / Λοιπά Χρ.). */
export const HOUR_TRANSFER_SPECS = [
  { typeId: 7, label: 'Υπερωρίες' },
  { typeId: 8, label: 'Αργίες' },
  { typeId: 9, label: 'Νυχτερινά' },
  { typeId: 25, label: 'Μετρό' },
  { typeId: 22, label: 'Διανυκτέρευση' },
]

function entryMatchesType(row, type) {
  const desc = String(type?.description || '').trim().toLowerCase()
  const typeCode = String(row.type || row.type_code || '').trim().toLowerCase()
  if (desc && typeCode === desc) return true
  if (Number(row.ept_id) === Number(type?.id)) return true
  return false
}

/**
 * Υπολογίζει γραμμές προς μεταφορά από summary ωρών + τιμές Αποδοχών.
 * Παραλείπει ποσά ≤ 0 και τύπους που υπάρχουν ήδη στον μήνα.
 */
export function resolveHourTransferLines({
  summary,
  earningsForm,
  transactionTypes = [],
  existingLedgerRows = [],
  year,
  month,
}) {
  const byId = new Map((transactionTypes || []).map((t) => [Number(t.id), t]))
  const { from, to } = monthDateRange(year, month)
  const existing = (existingLedgerRows || []).filter((r) => {
    const d = String(r.entry_date || '')
    return d >= from && d <= to && String(r.source || 'PAYROLL') === 'PAYROLL'
  })

  const ctx = { summary: summary || {}, earningsForm: earningsForm || {} }
  const lines = []
  const skipped = []
  const missing = []

  for (const spec of HOUR_TRANSFER_SPECS) {
    const type = byId.get(Number(spec.typeId))
    if (!type) {
      missing.push(spec.label)
      continue
    }

    const amount = buildLedgerAmountForType(type, ctx)
    if (!(amount > 0)) {
      missing.push(spec.label)
      continue
    }

    if (existing.some((r) => entryMatchesType(r, type))) {
      skipped.push(type.description || spec.label)
      continue
    }

    const description = buildLedgerDescriptionForType(type, ctx) || null
    lines.push({
      typeId: Number(type.id),
      type,
      label: type.description || spec.label,
      amount,
      description,
    })
  }

  return { lines, skipped, missing, entryDate: from }
}

/**
 * Insert payroll_entries για ώρες μήνα (idempotent ανά τύπο).
 */
export async function transferHoursToLedger({
  tech,
  year,
  month,
  summary,
  earningsForm,
  transactionTypes,
  existingLedgerRows = [],
}) {
  if (!tech?.id) throw new Error('Δεν έχει επιλεγεί υπάλληλος')

  const { lines, skipped, missing, entryDate } = resolveHourTransferLines({
    summary,
    earningsForm,
    transactionTypes,
    existingLedgerRows,
    year,
    month,
  })

  if (!lines.length) {
    if (skipped.length) {
      return {
        inserted: 0,
        skipped,
        missing,
        message: `Οι ώρες έχουν ήδη μεταφερθεί: ${skipped.join(', ')}.`,
      }
    }
    throw new Error(
      'Δεν βρέθηκαν ώρες/ποσά για Υπερωρίες, Αργίες, Νυχτερινά, Μετρό ή Διανυκτέρευση στον επιλεγμένο μήνα (έλεγξε βάρδιες Admin και τιμές στις Αποδοχές).'
    )
  }

  const postExtrasToInvoice = routesExtrasToInvoice(tech)

  const rows = lines.map((line) => ({
    tech_id: String(tech.id),
    reference_date: entryDate,
    type_code: payrollTypeCodeFromDescription(line.type.description),
    description: line.description,
    notes: 'Μεταφορά ωρών από Admin',
    amount: line.amount,
    // invoice|mixed → view δρομολογεί στη στήλη Τιμολόγιο· αλλιώς Λοιπά Χρ.
    invoice_amount: postExtrasToInvoice ? line.amount : 0,
    is_salary_type: false,
  }))

  const { error } = await diasClient.from('payroll_entries').insert(rows)
  if (error) throw error

  const parts = [`Μεταφέρθηκαν ${rows.length} γραμμές (${entryDate.slice(0, 7)}).`]
  if (skipped.length) parts.push(`Παραλείφθηκαν (υπήρχαν): ${skipped.join(', ')}.`)
  return {
    inserted: rows.length,
    skipped,
    missing,
    lines,
    message: parts.join(' '),
  }
}
