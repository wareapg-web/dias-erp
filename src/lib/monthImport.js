/**
 * Υπολογισμός μήνα — Εισαγωγή στην Οικονομική Ανάλυση από Αποδοχές / Συμφωνίες.
 * Δημιουργεί payroll_entries για Μισθό, Bonus, Λογιστή (όπου υπάρχει ποσό > 0).
 */

import { diasClient } from './supabase'
import { monthDateRange } from './techLedger'
import { personnelIssuesInvoice } from './personnel'
import {
  isSalaryLedgerGroup,
  payrollTypeCodeFromDescription,
} from './transactionTypes'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function parseAmount(value) {
  if (value === '' || value == null) return 0
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function earningsAmount(form, key) {
  return parseAmount(form?.[`${key}_amount`])
}

function agreementAmount(agreements, codes) {
  const set = new Set(codes.map((c) => String(c).toUpperCase()))
  for (const row of agreements || []) {
    const code = String(row.type_code || '').toUpperCase()
    if (!set.has(code)) continue
    const n = parseAmount(row.amount)
    if (n > 0) return n
  }
  return 0
}

function accountantFromAgreements(agreements) {
  for (const row of agreements || []) {
    const code = String(row.type_code || '').toUpperCase()
    const label = String(row.type_code || '')
    if (
      code === 'ACCOUNTANT' ||
      code === 'LOGISTIS' ||
      code.includes('LOGIST') ||
      /λογιστ/i.test(label)
    ) {
      const n = parseAmount(row.amount)
      if (n > 0) return n
    }
  }
  return 0
}

/** Specs: type id in transaction_types → amount sources. */
export const MONTH_IMPORT_SPECS = [
  {
    typeId: 3,
    label: 'Μισθός',
    fromEarnings: (e) => earningsAmount(e, 'salary'),
    fromAgreements: (a) => agreementAmount(a, ['BASE_SALARY']),
  },
  {
    typeId: 4,
    label: 'Bonus',
    fromEarnings: (e) => earningsAmount(e, 'bonus'),
    fromAgreements: (a) => agreementAmount(a, ['BONUS']),
  },
  {
    typeId: 23,
    label: 'Λογιστής',
    // Μόνο με payment_method === 'invoice' (gate στο resolveMonthImportLines).
    // Πηγή: accountant_amount στις Αποδοχές, αλλιώς συμφωνία ACCOUNTANT / legacy extra.
    fromEarnings: (e) => {
      const fromField = Number(String(e?.accountant_amount ?? '').replace(',', '.'))
      if (Number.isFinite(fromField) && fromField > 0) return fromField
      // Legacy: αριθμητικό extra στις Αποδοχές
      const extra = String(e?.extra || '').trim()
      if (/^[\d.,]+$/.test(extra)) return parseAmount(extra)
      return 0
    },
    fromAgreements: accountantFromAgreements,
  },
]

export function resolveMonthImportLines({
  earningsForm,
  agreements = [],
  transactionTypes = [],
  issuesInvoice = null,
}) {
  const byId = new Map((transactionTypes || []).map((t) => [Number(t.id), t]))
  const lines = []
  // Gate από master personnel (payment_method), fallback στο earningsForm για συμβατότητα
  const canInvoice =
    issuesInvoice === true ||
    (issuesInvoice == null && earningsForm?.issues_invoice === true)

  for (const spec of MONTH_IMPORT_SPECS) {
    const type = byId.get(Number(spec.typeId))
    if (!type) continue

    // Λογιστής (23): μόνο αν εκδίδει τιμολόγιο (personnel.payment_method === 'invoice')
    if (Number(spec.typeId) === 23 && !canInvoice) continue

    let amount = round2(spec.fromEarnings?.(earningsForm) || 0)
    if (amount <= 0) amount = round2(spec.fromAgreements?.(agreements) || 0)
    if (amount <= 0) continue

    lines.push({
      typeId: Number(type.id),
      type,
      label: type.description || spec.label,
      amount,
      isSalary: isSalaryLedgerGroup(type.ledger_group),
    })
  }

  return lines
}

function entryMatchesType(row, type) {
  const desc = String(type?.description || '').trim().toLowerCase()
  const typeCode = String(row.type || row.type_code || '').trim().toLowerCase()
  if (desc && typeCode === desc) return true
  if (Number(row.ept_id) === Number(type?.id)) return true
  return false
}

/**
 * Insert payroll rows for the selected month. Skips types that already have
 * a payroll entry in that month. Returns { inserted, skipped, lines }.
 */
export async function importMonthFromAgreements({
  tech,
  year,
  month,
  earningsForm,
  agreements,
  transactionTypes,
  existingLedgerRows = [],
}) {
  if (!tech?.id) throw new Error('Δεν έχει επιλεγεί υπάλληλος')

  const lines = resolveMonthImportLines({
    earningsForm,
    agreements,
    transactionTypes,
    issuesInvoice: personnelIssuesInvoice(tech),
  })
  if (!lines.length) {
    throw new Error(
      'Δεν βρέθηκαν ποσά Μισθού / Bonus / Λογιστή στις Αποδοχές ή Συμφωνίες για εισαγωγή.'
    )
  }

  const { from, to } = monthDateRange(year, month)
  const entryDate = from
  const existing = (existingLedgerRows || []).filter((r) => {
    const d = String(r.entry_date || '')
    return d >= from && d <= to && String(r.source || 'PAYROLL') === 'PAYROLL'
  })

  const toInsert = []
  const skipped = []

  for (const line of lines) {
    const already = existing.some((r) => entryMatchesType(r, line.type))
    if (already) {
      skipped.push(line.label)
      continue
    }
    toInsert.push(line)
  }

  if (!toInsert.length) {
    return {
      inserted: 0,
      skipped,
      lines,
      message: `Υπάρχουν ήδη εγγραφές για: ${skipped.join(', ')}.`,
    }
  }

  const rows = toInsert.map((line) => ({
    tech_id: String(tech.id),
    reference_date: entryDate,
    type_code: payrollTypeCodeFromDescription(line.type.description),
    description: null,
    notes: 'Αυτόματη εισαγωγή μήνα από Αποδοχές/Συμφωνίες',
    amount: line.amount,
    invoice_amount: 0,
    is_salary_type: Boolean(line.isSalary),
  }))

  const { error } = await diasClient.from('payroll_entries').insert(rows)
  if (error) throw error

  return {
    inserted: rows.length,
    skipped,
    lines: toInsert,
    message: `Εισήχθησαν ${rows.length} γραμμές για ${from.slice(0, 7)}.`,
  }
}
