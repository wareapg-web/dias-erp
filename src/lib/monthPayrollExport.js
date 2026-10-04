/** Εξαγωγή δεδουλευμένων (χρεώσεις) μήνα σε Excel — μόνο μόνιμοι. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { isInformationalBenefitRow } from './techLedger'
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

/** period YYYY-MM ή year/month στήλες — ίδια λογική με μήτρα. */
function payrollMatchesMonth(payroll, month, year) {
  const m = Number(month)
  const y = Number(year)
  const period = String(payroll?.period || '')
  if (/^\d{4}-\d{2}/.test(period)) {
    return Number(period.slice(0, 4)) === y && Number(period.slice(5, 7)) === m
  }
  return Number(payroll?.year) === y && Number(payroll?.month) === m
}

/**
 * Ticket + Ασφάλιση ανά tech_id από payrolls (μήνας).
 * Προτιμά period=YYYY-MM (όπως η αποθήκευση ERP) · συμπληρώνει με month/year.
 * Αν υπάρχουν πολλαπλά records, κρατάει το μεγαλύτερο ποσό ανά πεδίο.
 * @returns {Promise<{ ticketByTech: Map<string, number>, insuranceByTech: Map<string, number> }>}
 */
export async function loadPayrollBenefitsByTechForMonth(month, year) {
  const m = Number(month)
  const y = Number(year)
  const period = `${y}-${String(m).padStart(2, '0')}`
  const ticketByTech = new Map()
  const insuranceByTech = new Map()

  let rows = []
  try {
    rows = await fetchAllRows(diasClient, 'payrolls', (q) => q.eq('period', period))
  } catch {
    rows = []
  }

  // Fallback / συμπλήρωμα όταν period κενό ή παλιές γραμμές μόνο με month/year
  if (!(rows || []).length) {
    try {
      rows = await fetchAllRows(diasClient, 'payrolls', (q) =>
        q.eq('month', m).eq('year', y)
      )
    } catch (err) {
      console.warn('[month export] payrolls benefits', err?.message || err)
      return { ticketByTech, insuranceByTech }
    }
  } else {
    try {
      const byYm = await fetchAllRows(diasClient, 'payrolls', (q) =>
        q.eq('month', m).eq('year', y)
      )
      const seen = new Set((rows || []).map((r) => String(r.id || '')))
      for (const r of byYm || []) {
        const id = String(r.id || '')
        if (id && seen.has(id)) continue
        if (!payrollMatchesMonth(r, m, y)) continue
        rows.push(r)
        if (id) seen.add(id)
      }
    } catch {
      /* ignore */
    }
  }

  for (const p of rows || []) {
    if (!payrollMatchesMonth(p, m, y)) continue
    const techId = String(p.tech_id ?? '')
    if (!techId) continue

    const ticket = round2(Number(p.ticket_restaurant) || Number(p.ticket_amount) || 0)
    if (ticket > 0) {
      const prev = ticketByTech.get(techId) || 0
      if (ticket > prev) ticketByTech.set(techId, ticket)
    }

    const insurance = round2(Number(p.insurance) || Number(p.insurance_amount) || 0)
    if (insurance > 0) {
      const prev = insuranceByTech.get(techId) || 0
      if (insurance > prev) insuranceByTech.set(techId, insurance)
    }
  }

  return { ticketByTech, insuranceByTech }
}

/**
 * Ticket Restaurant ανά tech_id από payrolls (μήνας/έτος).
 * @returns {Promise<Map<string, number>>}
 */
export async function loadTicketByTechForMonth(month, year) {
  const { ticketByTech } = await loadPayrollBenefitsByTechForMonth(month, year)
  return ticketByTech
}

/**
 * Ασφάλιση ανά tech_id από payrolls (μήνας/έτος) — ίδια λογική με Ticket.
 * @returns {Promise<Map<string, number>>}
 */
export async function loadInsuranceByTechForMonth(month, year) {
  const { insuranceByTech } = await loadPayrollBenefitsByTechForMonth(month, year)
  return insuranceByTech
}

/**
 * Fallback Ticket / Ασφάλιση από tech_earnings (όπως μήτρα όταν payrolls=0).
 * @returns {Promise<{ ticketByTech: Map<string, number>, insuranceByTech: Map<string, number> }>}
 */
export async function loadEarningsBenefitsByTech() {
  const ticketByTech = new Map()
  const insuranceByTech = new Map()
  try {
    const rows = await fetchAllRows(diasClient, 'tech_earnings')
    for (const row of rows || []) {
      const id = String(row.tech_id ?? '')
      if (!id) continue
      const ticket = round2(Number(row.ticket_amount) || 0)
      if (ticket > 0) ticketByTech.set(id, ticket)
      const insurance = round2(Number(row.insurance_amount) || 0)
      if (insurance > 0) insuranceByTech.set(id, insurance)
    }
  } catch (err) {
    console.warn('[month export] earnings benefits', err?.message || err)
  }
  return { ticketByTech, insuranceByTech }
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
    insurance: 0,
    total: 0,
  }
}

/** Lookup ποσού από map με tech_id ή aliases προσωπικού (id / tech_id). */
function benefitAmountForTech(map, techId, aliasIds = []) {
  const primary = round2(map.get(String(techId)) || 0)
  if (primary > 0) return primary
  for (const alt of aliasIds) {
    const n = round2(map.get(String(alt)) || 0)
    if (n > 0) return n
  }
  return 0
}

/**
 * Μόνιμοι: χρεώσεις μήνα χωρισμένες σε Σταθερά (Μισθός/Λοιπά/ΤΙΜ) και Μεταβλητά (Λοιπά/ΤΙΜ).
 * Bonus (id 5, πρώην Extra Bonus) + Bonus+ + εκταμίευση δανείου (95) → πάντα μεταβλητά.
 * Υπόλοιπο Μισθού (id 4) → σύμφωνα με ticks. Δόσεις (94) εκτός (μόνο πίστωση).
 * Ticket / Ασφάλιση ενημερωτικά — εκτός πληρωτέου.
 * Βάση: payrolls · fallback tech_earnings (ίδια λογική με μήτρα).
 */
export function aggregateMonthDebits(
  ledgerRows = [],
  personnel = [],
  fixedSettingsByTech = new Map(),
  ticketByTech = new Map(),
  insuranceByTech = new Map(),
  earningsTicketByTech = new Map(),
  earningsInsuranceByTech = new Map()
) {
  const permanents = permanentPersonnelList(personnel)
  const names = personnelNameByTechId(permanents)
  const permanentIds = techIdSetFromList(permanents)
  /** tech_id ledger → [aliases] για lookup payrolls/earnings */
  const aliasesByTech = new Map()
  for (const p of permanents) {
    const keys = []
    if (p.tech_id != null && p.tech_id !== '') keys.push(String(p.tech_id))
    if (p.id != null && p.id !== '') keys.push(String(p.id))
    const primary = keys[0]
    if (!primary) continue
    aliasesByTech.set(primary, keys)
    for (const k of keys) aliasesByTech.set(k, keys)
  }
  const byTech = new Map()

  const ensureSlot = (techId) => {
    const id = String(techId || '')
    if (!id) return null
    if (permanentIds.size > 0 && !permanentIds.has(id)) return null
    const aliases = aliasesByTech.get(id) || [id]
    for (const k of aliases) {
      const existing = byTech.get(k)
      if (existing) {
        for (const a of aliases) byTech.set(a, existing)
        return existing
      }
    }
    const primary = aliases[0] || id
    const nameKey = aliases.find((k) => names.has(k)) || primary
    const slot = emptySlot(primary, names.get(nameKey) || primary)
    for (const a of aliases) byTech.set(a, slot)
    return slot
  }

  for (const row of ledgerRows || []) {
    if (isInformationalBenefitRow(row)) continue
    // Δόσεις 94: μόνο πίστωση — δεν μπαίνουν στο ΚΟΣΤΟΣ (η εκταμίευση 95 καλύπτει το ποσό)
    if (isLoanInstallmentRow(row)) continue
    if (!hasDebit(row)) continue

    const techId = String(row.tech_id ?? '')
    if (!techId) continue
    const slot = ensureSlot(techId)
    if (!slot) continue

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

  // Slot και για όσους έχουν ticket/ασφάλιση στο payrolls μήνα (χωρίς άλλες χρεώσεις)
  for (const techId of new Set([...ticketByTech.keys(), ...insuranceByTech.keys()])) {
    ensureSlot(techId)
  }

  for (const slot of byTech.values()) {
    const aliases = aliasesByTech.get(String(slot.techId)) || [String(slot.techId)]
    const fromPayrollTicket = benefitAmountForTech(ticketByTech, slot.techId, aliases)
    const fromPayrollInsurance = benefitAmountForTech(insuranceByTech, slot.techId, aliases)
    // Fallback Αποδοχές μόνο αν υπάρχει δραστηριότητα μήνα (όπως μήτρα)
    const allowEarningsFallback = slot.total > 0 || fromPayrollTicket > 0 || fromPayrollInsurance > 0
    slot.ticket =
      fromPayrollTicket > 0
        ? fromPayrollTicket
        : allowEarningsFallback
          ? benefitAmountForTech(earningsTicketByTech, slot.techId, aliases)
          : 0
    slot.insurance =
      fromPayrollInsurance > 0
        ? fromPayrollInsurance
        : allowEarningsFallback
          ? benefitAmountForTech(earningsInsuranceByTech, slot.techId, aliases)
          : 0
  }

  // Αποφυγή διπλών slot αν μπήκαν aliases
  const seen = new Set()
  const unique = []
  for (const slot of byTech.values()) {
    if (seen.has(slot)) continue
    seen.add(slot)
    unique.push(slot)
  }

  return unique
    .filter((r) => r.total > 0 || r.ticket > 0 || r.insurance > 0)
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
      border: {
        top: { style: 'thin', color: { rgb: '334155' } },
        bottom: { style: 'thin', color: { rgb: '334155' } },
        left: { style: 'thin', color: { rgb: '334155' } },
        right: { style: 'thin', color: { rgb: '334155' } },
      },
      fill: { patternType: 'solid', fgColor: { rgb: 'E2E8F0' } },
    },
  }
}

const CELL_BORDER = {
  top: { style: 'thin', color: { rgb: '94A3B8' } },
  bottom: { style: 'thin', color: { rgb: '94A3B8' } },
  left: { style: 'thin', color: { rgb: '94A3B8' } },
  right: { style: 'thin', color: { rgb: '94A3B8' } },
}

function applyDataCellStyle(cell, { zebra = false, bold = false, align = 'right' } = {}) {
  if (!cell) return
  cell.s = {
    ...(cell.s || {}),
    font: { bold: !!bold, name: 'Calibri', sz: 11 },
    alignment: { horizontal: align, vertical: 'center' },
    border: CELL_BORDER,
    ...(zebra
      ? { fill: { patternType: 'solid', fgColor: { rgb: 'CBD5E1' } } }
      : {}),
  }
}

/**
 * Excel μόνιμων: Σταθερά (Μισθός/Λοιπά/Τιμολόγιο/σύνολο) · Μεταβλητά (Λοιπά/Τιμολόγιο/σύνολο) · Ticket · Ασφάλιση · Πληρωτέο.
 * @param {{ month: number, year: number, personnel?: object[] }} opts
 */
export async function exportMonthPayrollToExcel({ month, year, personnel = [] }) {
  const m = Number(month)
  const y = Number(year)
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error('Μη έγκυρος μήνας/έτος για εξαγωγή')
  }

  const [ledgerRows, fixedSettingsByTech, payrollBenefits, earningsBenefits] =
    await Promise.all([
      fetchAllRows(diasClient, 'tech_ledger_view', (q) => q.eq('month', m).eq('year', y)),
      loadFixedExpenseSettingsByTech().catch((err) => {
        console.warn('[month export] fixed_expense_settings', err?.message || err)
        return new Map()
      }),
      loadPayrollBenefitsByTechForMonth(m, y).catch((err) => {
        console.warn('[month export] payroll benefits', err?.message || err)
        return { ticketByTech: new Map(), insuranceByTech: new Map() }
      }),
      loadEarningsBenefitsByTech().catch((err) => {
        console.warn('[month export] earnings benefits', err?.message || err)
        return { ticketByTech: new Map(), insuranceByTech: new Map() }
      }),
    ])

  const rows = aggregateMonthDebits(
    ledgerRows,
    personnel,
    fixedSettingsByTech,
    payrollBenefits.ticketByTech,
    payrollBenefits.insuranceByTech,
    earningsBenefits.ticketByTech,
    earningsBenefits.insuranceByTech
  )
  if (rows.length === 0) {
    throw new Error('Δεν βρέθηκαν χρεώσεις μόνιμων για αυτόν τον μήνα')
  }

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')
  const title = `${monthTitle} ${y}`

  // A: όνομα · B–E σταθερά · F–H μεταβλητά · I ticket · J ασφάλιση · K πληρωτέο
  const aoa = [
    [title, '', '', '', '', '', '', '', '', '', ''],
    [
      'Ονοματεπώνυμο',
      'Σταθερά (€)',
      '',
      '',
      '',
      'Μεταβλητά (€)',
      '',
      '',
      'Ticket Restaurant (€)',
      'Ασφάλιση (€)',
      'Συνολικό Πληρωτέο (€)',
    ],
    ['', 'Μισθός', 'Λοιπά', 'Τιμολόγιο', 'Σύνολο Σταθερών', 'Λοιπά', 'Τιμολόγιο', 'Σύνολο Μεταβλητών', '', '', ''],
  ]

  let totFixedSalary = 0
  let totFixedOther = 0
  let totFixedInvoice = 0
  let totFixedSum = 0
  let totVarOther = 0
  let totVarInvoice = 0
  let totVarSum = 0
  let totTicket = 0
  let totInsurance = 0
  let totAll = 0

  for (const r of rows) {
    const fixedSum = round2(r.fixedSalary + r.fixedOther + r.fixedInvoice)
    const varSum = round2(r.varOther + r.varInvoice)
    aoa.push([
      r.name,
      r.fixedSalary,
      r.fixedOther,
      r.fixedInvoice,
      fixedSum,
      r.varOther,
      r.varInvoice,
      varSum,
      r.ticket,
      r.insurance,
      r.total,
    ])
    totFixedSalary = round2(totFixedSalary + r.fixedSalary)
    totFixedOther = round2(totFixedOther + r.fixedOther)
    totFixedInvoice = round2(totFixedInvoice + r.fixedInvoice)
    totFixedSum = round2(totFixedSum + fixedSum)
    totVarOther = round2(totVarOther + r.varOther)
    totVarInvoice = round2(totVarInvoice + r.varInvoice)
    totVarSum = round2(totVarSum + varSum)
    totTicket = round2(totTicket + r.ticket)
    totInsurance = round2(totInsurance + r.insurance)
    totAll = round2(totAll + r.total)
  }

  aoa.push([
    'ΓΕΝΙΚΟ ΣΥΝΟΛΟ',
    totFixedSalary,
    totFixedOther,
    totFixedInvoice,
    totFixedSum,
    totVarOther,
    totVarInvoice,
    totVarSum,
    totTicket,
    totInsurance,
    totAll,
  ])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } }, // Σταθερά
    { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } }, // Μεταβλητά
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }, // Ονοματεπώνυμο
    { s: { r: 1, c: 8 }, e: { r: 2, c: 8 } }, // Ticket
    { s: { r: 1, c: 9 }, e: { r: 2, c: 9 } }, // Ασφάλιση
    { s: { r: 1, c: 10 }, e: { r: 2, c: 10 } }, // Πληρωτέο
  ]
  sheet['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 22 }]

  sheet.A1 = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 18, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '334155' } },
        bottom: { style: 'medium', color: { rgb: '334155' } },
        left: { style: 'medium', color: { rgb: '334155' } },
        right: { style: 'medium', color: { rgb: '334155' } },
      },
    },
  }
  // Πλαίσιο σε όλο το merge του τίτλου (A1:K1) — Excel δείχνει border σε κάθε κελί
  for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
    const addr = `${col}1`
    if (!sheet[addr]) sheet[addr] = { v: '', t: 's' }
    sheet[addr].s = {
      ...(sheet[addr].s || {}),
      border: {
        top: { style: 'medium', color: { rgb: '334155' } },
        bottom: { style: 'medium', color: { rgb: '334155' } },
        left: { style: 'medium', color: { rgb: '334155' } },
        right: { style: 'medium', color: { rgb: '334155' } },
      },
    }
  }

  styleHeaderCell(sheet, 'A2', 'Ονοματεπώνυμο')
  styleHeaderCell(sheet, 'B2', 'Σταθερά (€)')
  styleHeaderCell(sheet, 'F2', 'Μεταβλητά (€)')
  styleHeaderCell(sheet, 'I2', 'Ticket Restaurant (€)')
  styleHeaderCell(sheet, 'J2', 'Ασφάλιση (€)')
  styleHeaderCell(sheet, 'K2', 'Συνολικό Πληρωτέο (€)')
  styleHeaderCell(sheet, 'B3', 'Μισθός')
  styleHeaderCell(sheet, 'C3', 'Λοιπά')
  styleHeaderCell(sheet, 'D3', 'Τιμολόγιο')
  styleHeaderCell(sheet, 'E3', 'Σύνολο Σταθερών')
  styleHeaderCell(sheet, 'F3', 'Λοιπά')
  styleHeaderCell(sheet, 'G3', 'Τιμολόγιο')
  styleHeaderCell(sheet, 'H3', 'Σύνολο Μεταβλητών')

  const lastRow = aoa.length
  const numCols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']
  // Δεδομένα: γραμμές 4 … lastRow-1 · σύνολο: lastRow · zebra ανά δεύτερη γραμμή δεδομένων
  for (let r = 4; r <= lastRow; r += 1) {
    const isTotal = r === lastRow
    const dataIndex = r - 4 // 0-based μεταξύ data rows
    const zebra = !isTotal && dataIndex % 2 === 1

    const nameCell = sheet[`A${r}`]
    if (nameCell) {
      applyDataCellStyle(nameCell, { zebra, bold: isTotal, align: 'left' })
    }

    for (const col of numCols) {
      const cell = sheet[`${col}${r}`]
      if (!cell) continue
      if (typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '0.00'
      }
      applyDataCellStyle(cell, { zebra, bold: isTotal, align: 'right' })
    }
  }

  sheet['!cols'] = [
    { wch: 36 },
    { wch: 11 },
    { wch: 11 },
    { wch: 12 },
    { wch: 14 },
    { wch: 11 },
    { wch: 12 },
    { wch: 15 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Δεδουλευμένα')

  const filename = monthExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename }
}
