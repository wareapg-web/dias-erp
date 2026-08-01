/**
 * Υπολογισμός μήνα — Εισαγωγή στην Οικονομική Ανάλυση από Αποδοχές.
 * Δημιουργεί payroll_entries μόνο για πεδία με ποσό > 0 και auto_transfer_settings[key] === true.
 */

import { diasClient } from './supabase'
import { monthDateRange } from './techLedger'
import { personnelIssuesInvoice } from './personnel'
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
    const fromField = parseAmount(earningsForm?.accountant_amount)
    if (fromField > 0) return fromField
    const extra = String(earningsForm?.extra || '').trim()
    if (/^[\d.,]+$/.test(extra)) return parseAmount(extra)
    return 0
  }
  return parseAmount(earningsForm?.[transferKey])
}

function isTransferEnabled(settings, transferKey) {
  return settings?.[transferKey] === true
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

    lines.push({
      typeId: Number(type.id),
      type,
      label: type.description || TRANSFER_LABEL_FALLBACK[transferKey] || transferKey,
      amount,
      isSalary: isSalaryLedgerGroup(type.ledger_group),
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
