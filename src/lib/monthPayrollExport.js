/** Εξαγωγή δεδουλευμένων (χρεώσεις) μήνα σε Excel — όλο το προσωπικό. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { isTicketRestaurantRow } from './techLedger'
import { isLoanDisbursementRow, isLoanInstallmentRow } from './loanUi'
import {
  earningsKeyFromLedgerRow,
  normalizeFixedExpenseSettings,
} from './techEarnings'
import { MONTH_LABELS } from './payrollAnalysis'

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
 * Ticket Restaurant ανά tech_id από payrolls (μήνας/έτος).
 * Αν υπάρχουν πολλαπλά records, κρατάει το μεγαλύτερο ποσό.
 * @returns {Promise<Map<string, number>>}
 */
export async function loadTicketByTechForMonth(month, year) {
  const m = Number(month)
  const y = Number(year)
  const map = new Map()

  let rows = []
  try {
    rows = await fetchAllRows(diasClient, 'payrolls', (q) =>
      q.eq('month', m).eq('year', y)
    )
  } catch (err) {
    // Fallback: φίλτρο μέσω period YYYY-MM αν λείπουν month/year columns
    try {
      const period = `${y}-${String(m).padStart(2, '0')}`
      rows = await fetchAllRows(diasClient, 'payrolls', (q) => q.eq('period', period))
    } catch (err2) {
      console.warn('[month export] payrolls ticket', err2?.message || err?.message || err2)
      return map
    }
  }

  for (const p of rows || []) {
    const techId = String(p.tech_id ?? '')
    if (!techId) continue
    const ticket = round2(Number(p.ticket_restaurant) || Number(p.ticket_amount) || 0)
    if (ticket <= 0) continue
    const prev = map.get(techId) || 0
    if (ticket > prev) map.set(techId, ticket)
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
 *   ticket: number,
 *   total: number
 * }>}
 */
export function aggregateMonthDebits(
  ledgerRows = [],
  personnel = [],
  fixedSettingsByTech = new Map(),
  ticketByTech = new Map()
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
        ticket: 0,
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

    // Πληρωτέο = μόνο μετρητά (χωρίς Ticket)
    slot.total = round2(slot.sumSalary + slot.sumOther + slot.sumInvoice)
  }

  for (const slot of byTech.values()) {
    slot.ticket = round2(ticketByTech.get(String(slot.techId)) || 0)
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

  const [ledgerRows, fixedSettingsByTech, ticketByTech] = await Promise.all([
    fetchAllRows(diasClient, 'tech_ledger_view', (q) => q.eq('month', m).eq('year', y)),
    loadFixedExpenseSettingsByTech().catch((err) => {
      // Αν λείπει η στήλη (migration 30), συνέχισε με defaults (Μισθός=βασικό)
      console.warn('[month export] fixed_expense_settings', err?.message || err)
      return new Map()
    }),
    loadTicketByTechForMonth(m, y).catch((err) => {
      console.warn('[month export] ticket payrolls', err?.message || err)
      return new Map()
    }),
  ])

  const rows = aggregateMonthDebits(
    ledgerRows,
    personnel,
    fixedSettingsByTech,
    ticketByTech
  )
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
    'Ticket Restaurant (€)',
    'Συνολικό Πληρωτέο (€)',
  ]

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`)
    .toLocaleUpperCase('el-GR')
  const title = `${monthTitle} ${y}`

  const titleCell = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 18, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
    },
  }

  const aoa = [[titleCell], header]
  let totSalary = 0
  let totOther = 0
  let totInvoice = 0
  let totFixed = 0
  let totVariable = 0
  let totTicket = 0
  let totAll = 0

  for (const r of rows) {
    aoa.push([
      r.name,
      r.sumSalary,
      r.sumOther,
      r.sumInvoice,
      r.sumFixed,
      r.sumVariable,
      r.ticket,
      r.total,
    ])
    totSalary = round2(totSalary + r.sumSalary)
    totOther = round2(totOther + r.sumOther)
    totInvoice = round2(totInvoice + r.sumInvoice)
    totFixed = round2(totFixed + r.sumFixed)
    totVariable = round2(totVariable + r.sumVariable)
    totTicket = round2(totTicket + r.ticket)
    totAll = round2(totAll + r.total)
  }

  aoa.push([
    'ΓΕΝΙΚΟ ΣΥΝΟΛΟ',
    totSalary,
    totOther,
    totInvoice,
    totFixed,
    totVariable,
    totTicket,
    totAll,
  ])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  // Τίτλος μήνα/έτους: merged A1:H1, κεντραρισμένο, bold, μεγαλύτερη γραμματοσειρά
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }]
  sheet['!rows'] = [{ hpt: 30 }]
  sheet.A1 = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 18, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center' },
    },
  }

  const lastRow = aoa.length
  const numCols = ['B', 'C', 'D', 'E', 'F', 'G', 'H']
  // Δεδομένα από γραμμή 3 (1=τίτλος, 2=headers)
  for (let r = 3; r <= lastRow; r += 1) {
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
    { wch: 20 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Δεδουλευμένα')

  const filename = monthExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename }
}
