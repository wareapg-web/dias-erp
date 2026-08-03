/**
 * Υπολογισμός μήνα — Εισαγωγή στην Οικονομική Ανάλυση από Αποδοχές.
 * Δημιουργεί payroll_entries μόνο για πεδία με ποσό > 0 και auto_transfer_settings[key] === true.
 */

import { diasClient } from './supabase'
import { monthDateRange } from './techLedger'
import { personnelIssuesInvoice, routesExtrasToInvoice } from './personnel'
import { parseElNumber } from './numberFormat'
import {
  isSalaryLedgerGroup,
  payrollTypeCodeFromDescription,
} from './transactionTypes'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function parseAmount(value) {
  if (value === '' || value == null) return 0
  return parseElNumber(value) ?? 0
}

/**
 * Form/DB field → transaction_types.id
 * 3 Μισθός · 4 Bonus · 41 Bonus + · 21 Επίδομα Οδηγού · 23 Λογιστής
 */
export const TRANSFER_MAPPING = {
  salary_amount: 3,
  bonus_amount: 4,
  bonus_plus_amount: 41,
  driver_allowance: 21,
  accountant_amount: 23,
}

/** Fallback αν λείπει το id από τη βάση — match σε description. */
const TRANSFER_LABEL_FALLBACK = {
  salary_amount: 'Μισθός',
  bonus_amount: 'Bonus',
  bonus_plus_amount: 'Bonus +',
  driver_allowance: 'Επίδομα Οδηγού',
  accountant_amount: 'Λογιστής',
}

function resolveTypeForTransferKey(transferKey, transactionTypes = []) {
  const typeId = TRANSFER_MAPPING[transferKey]
  const byId = new Map((transactionTypes || []).map((t) => [Number(t.id), t]))
  if (typeId != null && byId.has(Number(typeId))) {
    return byId.get(Number(typeId))
  }
  const label = TRANSFER_LABEL_FALLBACK[transferKey]
  if (!label) return null
  const needle = label.trim().toLowerCase()
  return (
    (transactionTypes || []).find(
      (t) => String(t.description || '').trim().toLowerCase() === needle
    ) || null
  )
}

function amountForTransferKey(earningsForm, transferKey) {
  if (transferKey === 'accountant_amount') {
    return parseAmount(earningsForm?.accountant_amount)
  }
  return parseAmount(earningsForm?.[transferKey])
}

function isTransferEnabled(settings, transferKey) {
  return settings?.[transferKey] === true
}

/** Κανονικοποίηση ledger_group τύπου (SALARY | OTHER). */
function typeLedgerGroup(type) {
  return String(type?.ledger_group || 'OTHER').toUpperCase()
}

/**
 * invoice|mixed: ό,τι είναι OTHER (Λοιπά) → Τιμολόγιο.
 * Μόνο SALARY μένει χωρίς invoice_amount.
 * Το transferKey salary_amount εξαιρείται πάντα.
 */
export function shouldPostLineToInvoice(line, postExtrasToInvoice) {
  if (!postExtrasToInvoice) return false
  if (line.transferKey === 'salary_amount') return false
  const group = typeLedgerGroup(line.type)
  if (group === 'SALARY') return false
  // OTHER (και άγνωστο/κενό → Λοιπά)
  return true
}

/**
 * Γραμμές προς εισαγωγή: ποσό > 0 + checkbox true (+ invoice gate για λογιστή).
 */
export function resolveMonthImportLines({
  earningsForm,
  agreements = [],
  transactionTypes = [],
  issuesInvoice = null,
}) {
  void agreements
  const lines = []
  const settings = earningsForm?.auto_transfer_settings || {}
  const canInvoice =
    issuesInvoice === true ||
    (issuesInvoice == null && earningsForm?.issues_invoice === true)

  for (const transferKey of Object.keys(TRANSFER_MAPPING)) {
    if (!isTransferEnabled(settings, transferKey)) continue

    if (transferKey === 'accountant_amount' && !canInvoice) continue

    const amount = round2(amountForTransferKey(earningsForm, transferKey))
    if (!(amount > 0)) continue

    const type = resolveTypeForTransferKey(transferKey, transactionTypes)
    if (!type) continue

    const ledgerGroup = typeLedgerGroup(type)
    lines.push({
      typeId: Number(type.id),
      type,
      label: type.description || TRANSFER_LABEL_FALLBACK[transferKey] || transferKey,
      amount,
      ledgerGroup,
      isSalary: ledgerGroup === 'SALARY' || isSalaryLedgerGroup(type.ledger_group),
      transferKey,
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

function rowInvoiceAmount(row) {
  return Math.abs(Number(row?.invoice_amount) || 0)
}

/**
 * Insert payroll rows for the selected month. Skips types that already have
 * a payroll entry in that month. Returns { inserted, skipped, lines }.
 * Αν υπάρχει ήδη OTHER γραμμή χωρίς invoice_amount σε υπάλληλο invoice|mixed,
 * κάνει UPDATE ώστε να δρομολογηθεί στο Τιμολόγιο (διορθώνει παλιά inserts).
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

  const postExtrasToInvoice = routesExtrasToInvoice(tech)

  const lines = resolveMonthImportLines({
    earningsForm,
    agreements,
    transactionTypes,
    issuesInvoice: personnelIssuesInvoice(tech),
  })
  if (!lines.length) {
    throw new Error(
      'Δεν βρέθηκαν επιλεγμένα ποσά στις Αποδοχές (checkbox + ποσό > 0) για εισαγωγή.'
    )
  }

  const { from, to } = monthDateRange(year, month)
  const entryDate = from
  const existing = (existingLedgerRows || []).filter((r) => {
    const d = String(r.entry_date || '')
    return d >= from && d <= to && String(r.source || 'PAYROLL') === 'PAYROLL'
  })

  const toInsert = []
  const toRepair = []
  const skipped = []

  for (const line of lines) {
    const existingRow = existing.find((r) => entryMatchesType(r, line.type))
    if (existingRow) {
      const wantInvoice = shouldPostLineToInvoice(line, postExtrasToInvoice)
      const hasInvoice = rowInvoiceAmount(existingRow) > 0.005
      if (
        wantInvoice &&
        !hasInvoice &&
        existingRow.id != null &&
        String(existingRow.source || 'PAYROLL') === 'PAYROLL'
      ) {
        toRepair.push({
          id: existingRow.id,
          amount: line.amount,
          label: line.label,
        })
      } else {
        skipped.push(line.label)
      }
      continue
    }
    toInsert.push(line)
  }

  if (!toInsert.length && !toRepair.length) {
    return {
      inserted: 0,
      repaired: 0,
      skipped,
      lines,
      message: `Υπάρχουν ήδη εγγραφές για: ${skipped.join(', ')}.`,
    }
  }

  const rows = toInsert.map((line) => {
    const toInvoice = shouldPostLineToInvoice(line, postExtrasToInvoice)
    const isSalary = Boolean(line.isSalary) || line.transferKey === 'salary_amount'
    return {
      tech_id: String(tech.id),
      reference_date: entryDate,
      month: Number(month),
      year: Number(year),
      type_code: payrollTypeCodeFromDescription(line.type.description),
      description: null,
      notes: 'Αυτόματη εισαγωγή μήνα από Αποδοχές/Συμφωνίες',
      amount: line.amount,
      invoice_amount: toInvoice ? line.amount : 0,
      is_salary_type: isSalary && !toInvoice,
    }
  })

  if (rows.length) {
    const { error } = await diasClient.from('payroll_entries').insert(rows)
    if (error) throw error
  }

  for (const repair of toRepair) {
    const { error } = await diasClient
      .from('payroll_entries')
      .update({
        invoice_amount: repair.amount,
        is_salary_type: false,
      })
      .eq('id', repair.id)
    if (error) throw error
  }

  const parts = []
  if (rows.length) parts.push(`Εισήχθησαν ${rows.length} γραμμές`)
  if (toRepair.length) {
    parts.push(
      `διορθώθηκαν ${toRepair.length} στο Τιμολόγιο (${toRepair.map((r) => r.label).join(', ')})`
    )
  }
  parts.push(`για ${from.slice(0, 7)}.`)

  return {
    inserted: rows.length,
    repaired: toRepair.length,
    skipped,
    lines: [...toInsert, ...toRepair],
    message: parts.join(' '),
  }
}
