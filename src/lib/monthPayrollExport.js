/** Εξαγωγή δεδουλευμένων (χρεώσεις) μήνα σε Excel — όλο το προσωπικό. */

import * as XLSX from 'xlsx'
import { diasClient, fetchAllRows } from './supabase'
import { isTicketRestaurantRow } from './techLedger'
import { isLoanDisbursementRow, isLoanInstallmentRow } from './loanUi'
import {
  earningsKeyFromLedgerRow,
  normalizeFixedExpenseSettings,
} from './techEarnings'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function hasDebit(row) {
  return (
    (Number(row?.salary_debit) || 0) > 0 ||
    (Number(row?.other_debit) || 0) > 0 ||
    (Number(row?.invoice_amount) || 0) > 0
  )
}

/** Δάνεια 94/95 ή λεκτικό δανείου — εκτός export. */
function isLoanExcludedRow(row) {
  if (!row) return false
  if (isLoanInstallmentRow(row) || isLoanDisbursementRow(row)) return true
  const tid = Number(row.type_id)
  if (tid === 94 || tid === 95) return true
  const text = `${row.notes || ''} ${row.type || ''} ${row.description || ''}`.toLowerCase()
  return /δάνει|δανειο|δάνεια|δανεια/.test(text)
}

function personnelNameByTechId(personnel = []) {
  const map = new Map()
  for (const p of personnel || []) {
    const name =
      String(p.tech_name || '').trim() ||
      [p.last_name, p.first_name].filter(Boolean).join(' ').trim() ||
      String(p.tech_id || p.id || '—')
    if (p.tech_id != null && p.tech_id !== '') {
      map.set(String(p.tech_id), name)
    }
    if (p.id != null && p.id !== '') {
      map.set(String(p.id), name)
    }
  }
  return map
}

/**
 * Φόρτωση fixed_expense_settings ανά tech_id από tech_earnings.
 * @returns {Map<string, object>}
 */
export async function loadFixedExpenseSettingsByTech() {
  const rows = await fetchAllRows(diasClient, 'tech_earnings')
  const map = new Map()
  for (const row of rows || []) {
    const id = String(row.tech_id ?? '')
    if (!id) continue
    map.set(id, normalizeFixedExpenseSettings(row.fixed_expense_settings))
  }
  return map
}

function isFixedForTech(settingsByTech, techId, earningsKey) {
  // Άγνωστος τύπος → μεταβλητό
  if (!earningsKey) return false
  const settings =
    settingsByTech.get(String(techId)) || normalizeFixedExpenseSettings(null)
  return settings[earningsKey] === true
}

/**
 * Ομαδοποίηση χρεώσεων μήνα ανά τεχνικό · Μισθός/Λοιπά/ΤΙΜ + Βασικά/Μεταβλητά.
 * @returns {Array<{
 *   techId: string,
 *   name: string,
 *   sumSalary: number,
 *   sumOther: number,
 *   sumInvoice: number,
 *   sumFixed: number,
 *   sumVariable: number,
 *   total: number
 * }>}
 */
export function aggregateMonthDebits(
  ledgerRows = [],
  personnel = [],
  fixedSettingsByTech = new Map()
) {
  const names = personnelNameByTechId(personnel)
  const byTech = new Map()

  for (const row of ledgerRows || []) {
    if (!hasDebit(row)) continue
    if (isTicketRestaurantRow(row)) continue
    if (isLoanExcludedRow(row)) continue

    const techId = String(row.tech_id ?? '')
    if (!techId) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = {
        techId,
        name: names.get(techId) || techId,
        sumSalary: 0,
        sumOther: 0,
        sumInvoice: 0,
        sumFixed: 0,
        sumVariable: 0,
        total: 0,
      }
      byTech.set(techId, slot)
    }

    const salary = Number(row.salary_debit) || 0
    const other = Number(row.other_debit) || 0
    const invoice = Number(row.invoice_amount) || 0
    const debit = round2(salary + other + invoice)

    slot.sumSalary = round2(slot.sumSalary + salary)
    slot.sumOther = round2(slot.sumOther + other)
    slot.sumInvoice = round2(slot.sumInvoice + invoice)

    const earningsKey = earningsKeyFromLedgerRow(row)
    if (isFixedForTech(fixedSettingsByTech, techId, earningsKey)) {
      slot.sumFixed = round2(slot.sumFixed + debit)
    } else {
      slot.sumVariable = round2(slot.sumVariable + debit)
    }

    slot.total = round2(slot.sumSalary + slot.sumOther + slot.sumInvoice)
  }

  return Array.from(byTech.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

export function monthExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Misthodosia_${m}_${y}.xlsx`
}

/**
 * Φόρτωση ledger μήνα + Excel download.
 * @param {{ month: number, year: number, personnel?: object[] }} opts
 * @returns {Promise<{ rowCount: number, filename: string }>}
 */
export async function exportMonthPayrollToExcel({ month, year, personnel = [] }) {
  const m = Number(month)
  const y = Number(year)
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error('Μη έγκυρος μήνας/έτος για εξαγωγή')
  }

  const [ledgerRows, fixedSettingsByTech] = await Promise.all([
    fetchAllRows(diasClient, 'tech_ledger_view', (q) => q.eq('month', m).eq('year', y)),
    loadFixedExpenseSettingsByTech().catch((err) => {
      // Αν λείπει η στήλη (migration 30), συνέχισε με defaults (Μισθός=βασικό)
      console.warn('[month export] fixed_expense_settings', err?.message || err)
      return new Map()
    }),
  ])

  const rows = aggregateMonthDebits(ledgerRows, personnel, fixedSettingsByTech)
  if (rows.length === 0) {
    throw new Error('Δεν βρέθηκαν χρεώσεις (δεδουλευμένα) για αυτόν τον μήνα')
  }

  const header = [
    'Ονοματεπώνυμο',
    'Χρέωση Μισθού (€)',
    'Χρέωση Λοιπών (€)',
    'Χρέωση Τιμολογίου (€)',
    'Βασικά (€)',
    'Μεταβλητά (€)',
    'Συνολικό Πληρωτέο (€)',
  ]

  const aoa = [header]
  let totSalary = 0
  let totOther = 0
  let totInvoice = 0
  let totFixed = 0
  let totVariable = 0
  let totAll = 0

  for (const r of rows) {
    aoa.push([
      r.name,
      r.sumSalary,
      r.sumOther,
      r.sumInvoice,
      r.sumFixed,
      r.sumVariable,
      r.total,
    ])
    totSalary = round2(totSalary + r.sumSalary)
    totOther = round2(totOther + r.sumOther)
    totInvoice = round2(totInvoice + r.sumInvoice)
    totFixed = round2(totFixed + r.sumFixed)
    totVariable = round2(totVariable + r.sumVariable)
    totAll = round2(totAll + r.total)
  }

  aoa.push([
    'ΓΕΝΙΚΟ ΣΥΝΟΛΟ',
    totSalary,
    totOther,
    totInvoice,
    totFixed,
    totVariable,
    totAll,
  ])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  const lastRow = aoa.length
  const numCols = ['B', 'C', 'D', 'E', 'F', 'G']
  for (let r = 2; r <= lastRow; r += 1) {
    for (const col of numCols) {
      const addr = `${col}${r}`
      const cell = sheet[addr]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '0.00'
      }
    }
  }

  sheet['!cols'] = [
    { wch: 36 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Δεδουλευμένα')

  const filename = monthExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename }
}
