/** Εξαγωγή δεδουλευμένων (χρεώσεις) μήνα σε Excel — μόνο μόνιμοι. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { isTicketRestaurantRow } from './techLedger'
import { isLoanDisbursementRow, isLoanInstallmentRow } from './loanUi'
import {
  earningsKeyFromLedgerRow,
  normalizeFixedExpenseSettings,
} from './techEarnings'
import { MONTH_LABELS } from './payrollAnalysis'
import { isTemporaryPersonnel } from './personnel'

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

/**
 * Πάντα μεταβλητά στο ΚΟΣΤΟΣ (ανεξάρτητα από ticks Αποδοχών):
 * - Bonus id 5 (πρώην Extra Bonus) · Bonus+ id 41
 * - Εκταμίευση δανείου id 95
 * Υπόλοιπο Μισθού (id 4) ΔΕΝ μπαίνει εδώ — ακολουθεί τα ticks.
 */
function isAlwaysVariableRow(row) {
  if (!row) return false
  if (isLoanDisbursementRow(row)) return true
  const tid = Number(row.type_id ?? row.ept_id)
  if (tid === 5 || tid === 41 || tid === 95) return true
  const key = earningsKeyFromLedgerRow(row)
  if (key === 'manual_bonus' || key === 'bonus_plus') return true
  return false
}

function permanentPersonnelList(personnel = []) {
  return (personnel || []).filter(
    (p) => !isTemporaryPersonnel(p) && p.is_active !== false
  )
}

function techIdSetFromList(list = []) {
  const set = new Set()
  for (const p of list) {
    if (p.tech_id != null && p.tech_id !== '') set.add(String(p.tech_id))
    if (p.id != null && p.id !== '') set.add(String(p.id))
  }
  return set
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
  if (!earningsKey) return false
  const settings =
    settingsByTech.get(String(techId)) || normalizeFixedExpenseSettings(null)
  return settings[earningsKey] === true
}

function emptySlot(techId, name) {
  return {
    techId,
    name,
    fixedSalary: 0,
    fixedOther: 0,
    fixedInvoice: 0,
    varOther: 0,
    varInvoice: 0,
    ticket: 0,
    total: 0,
  }
}

/**
 * Μόνιμοι: χρεώσεις μήνα χωρισμένες σε Σταθερά (Μισθός/Λοιπά/ΤΙΜ) και Μεταβλητά (Λοιπά/ΤΙΜ).
 * Bonus (id 5, πρώην Extra Bonus) + Bonus+ + εκταμίευση δανείου (95) → πάντα μεταβλητά.
 * Υπόλοιπο Μισθού (id 4) → σύμφωνα με ticks. Δόσεις (94) εκτός (μόνο πίστωση).
 * Ticket ενημερωτικό — εκτός πληρωτέου.
 */
export function aggregateMonthDebits(
  ledgerRows = [],
  personnel = [],
  fixedSettingsByTech = new Map(),
  ticketByTech = new Map()
) {
  const permanents = permanentPersonnelList(personnel)
  const names = personnelNameByTechId(permanents)
  const permanentIds = techIdSetFromList(permanents)
  const byTech = new Map()

  for (const row of ledgerRows || []) {
    if (isTicketRestaurantRow(row)) continue
    // Δόσεις 94: μόνο πίστωση — δεν μπαίνουν στο ΚΟΣΤΟΣ (η εκταμίευση 95 καλύπτει το ποσό)
    if (isLoanInstallmentRow(row)) continue
    if (!hasDebit(row)) continue

    const techId = String(row.tech_id ?? '')
    if (!techId) continue
    if (permanentIds.size > 0 && !permanentIds.has(techId)) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = emptySlot(techId, names.get(techId) || techId)
      byTech.set(techId, slot)
    }

    const salary = Number(row.salary_debit) || 0
    const other = Number(row.other_debit) || 0
    const invoice = Number(row.invoice_amount) || 0

    const alwaysVar = isAlwaysVariableRow(row)
    const earningsKey = earningsKeyFromLedgerRow(row)
    const fixed =
      !alwaysVar && isFixedForTech(fixedSettingsByTech, techId, earningsKey)

    if (salary > 0) {
      if (!alwaysVar && (fixed || earningsKey === 'salary')) {
        slot.fixedSalary = round2(slot.fixedSalary + salary)
      } else {
        slot.varOther = round2(slot.varOther + salary)
      }
    }
    if (other > 0) {
      if (fixed) slot.fixedOther = round2(slot.fixedOther + other)
      else slot.varOther = round2(slot.varOther + other)
    }
    if (invoice > 0) {
      if (fixed) slot.fixedInvoice = round2(slot.fixedInvoice + invoice)
      else slot.varInvoice = round2(slot.varInvoice + invoice)
    }

    slot.total = round2(
      slot.fixedSalary +
        slot.fixedOther +
        slot.fixedInvoice +
        slot.varOther +
        slot.varInvoice
    )
  }

  for (const slot of byTech.values()) {
    slot.ticket = round2(ticketByTech.get(String(slot.techId)) || 0)
  }

  return Array.from(byTech.values())
    .filter((r) => r.total > 0 || r.ticket > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

export function monthExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Misthodosia_${m}_${y}.xlsx`
}

function styleHeaderCell(sheet, addr, value) {
  sheet[addr] = {
    v: value,
    t: 's',
    s: {
      font: { bold: true, name: 'Calibri', sz: 11 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    },
  }
}

/**
 * Excel μόνιμων: Σταθερά (Μισθός/Λοιπά/Τιμολόγιο) · Μεταβλητά (λοιπά/τιμολόγιο) · Ticket · Πληρωτέο.
 * @param {{ month: number, year: number, personnel?: object[] }} opts
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
    throw new Error('Δεν βρέθηκαν χρεώσεις μόνιμων για αυτόν τον μήνα')
  }

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')
  const title = `${monthTitle} ${y}`

  const aoa = [
    [title, '', '', '', '', '', '', ''],
    ['Ονοματεπώνυμο', 'Σταθερά (€)', '', '', 'Μεταβλητά (€)', '', 'Ticket Restaurant (€)', 'Συνολικό Πληρωτέο (€)'],
    ['', 'Μισθός', 'Λοιπά', 'Τιμολόγιο', 'Λοιπά', 'Τιμολόγιο', '', ''],
  ]

  let totFixedSalary = 0
  let totFixedOther = 0
  let totFixedInvoice = 0
  let totVarOther = 0
  let totVarInvoice = 0
  let totTicket = 0
  let totAll = 0

  for (const r of rows) {
    aoa.push([
      r.name,
      r.fixedSalary,
      r.fixedOther,
      r.fixedInvoice,
      r.varOther,
      r.varInvoice,
      r.ticket,
      r.total,
    ])
    totFixedSalary = round2(totFixedSalary + r.fixedSalary)
    totFixedOther = round2(totFixedOther + r.fixedOther)
    totFixedInvoice = round2(totFixedInvoice + r.fixedInvoice)
    totVarOther = round2(totVarOther + r.varOther)
    totVarInvoice = round2(totVarInvoice + r.varInvoice)
    totTicket = round2(totTicket + r.ticket)
    totAll = round2(totAll + r.total)
  }

  aoa.push([
    'ΓΕΝΙΚΟ ΣΥΝΟΛΟ',
    totFixedSalary,
    totFixedOther,
    totFixedInvoice,
    totVarOther,
    totVarInvoice,
    totTicket,
    totAll,
  ])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 1, c: 6 }, e: { r: 2, c: 6 } },
    { s: { r: 1, c: 7 }, e: { r: 2, c: 7 } },
  ]
  sheet['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 20 }]

  sheet.A1 = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 18, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center' },
    },
  }

  styleHeaderCell(sheet, 'A2', 'Ονοματεπώνυμο')
  styleHeaderCell(sheet, 'B2', 'Σταθερά (€)')
  styleHeaderCell(sheet, 'E2', 'Μεταβλητά (€)')
  styleHeaderCell(sheet, 'G2', 'Ticket Restaurant (€)')
  styleHeaderCell(sheet, 'H2', 'Συνολικό Πληρωτέο (€)')
  styleHeaderCell(sheet, 'B3', 'Μισθός')
  styleHeaderCell(sheet, 'C3', 'Λοιπά')
  styleHeaderCell(sheet, 'D3', 'Τιμολόγιο')
  styleHeaderCell(sheet, 'E3', 'Λοιπά')
  styleHeaderCell(sheet, 'F3', 'Τιμολόγιο')

  const lastRow = aoa.length
  const numCols = ['B', 'C', 'D', 'E', 'F', 'G', 'H']
  for (let r = 4; r <= lastRow; r += 1) {
    for (const col of numCols) {
      const cell = sheet[`${col}${r}`]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '0.00'
      }
    }
  }

  sheet['!cols'] = [
    { wch: 36 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Δεδουλευμένα')

  const filename = monthExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename }
}
