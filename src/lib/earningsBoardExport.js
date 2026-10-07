/** Εξαγωγή Πίνακα Απολαβών (μήνας / έτος) σε Excel. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { buildLedgerYearMatrix } from './techLedger'
import { earningsFromDb } from './techEarnings'
import { parseElNumber } from './numberFormat'
import { MONTH_LABELS } from './payrollAnalysis'
import { loadPayrollBenefitsByTechForMonth } from './monthPayrollExport'
import { isTemporaryPersonnel } from './personnel'

const METRIC_COLS = [
  { key: 'sigma', label: 'Σ', field: 'sigma' },
  { key: 'yM', label: 'Υ (Μ)', field: 'yM' },
  { key: 'yL', label: 'Υ (Λ)', field: 'yL' },
  { key: 'yTim', label: 'Υ (ΤΙΜ)', field: 'yTim' },
  { key: 'ticket', label: 'Ticket Restaurant', field: 'ticket' },
  { key: 'insurance', label: 'Ασφάλιση', field: 'insurance' },
  { key: 'pi', label: 'Π', field: 'pi' },
  { key: 'salary', label: 'Μισθός', field: 'salaryDebit' },
  { key: 'other', label: 'Λοιπά', field: 'otherDebit' },
  { key: 'invoice', label: 'Τιμολόγιο', field: 'invoiceDebit' },
]

const COL_ORDER_KEY = 'dias-erp:earnings-board:col-order'
const ORDER_KEY = 'dias-erp:earnings-board:row-order'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function personDisplayName(p) {
  return (
    String(p?.tech_name || '').trim() ||
    [p?.last_name, p?.first_name].filter(Boolean).join(' ').trim() ||
    String(p?.tech_id || p?.id || '—')
  )
}

function personTechKeys(p) {
  const keys = new Set()
  if (p?.tech_id != null && p.tech_id !== '') keys.add(String(p.tech_id))
  if (p?.id != null && p.id !== '') keys.add(String(p.id))
  return keys
}

function permanentTargets(personnel = []) {
  return (personnel || [])
    .filter(
      (p) =>
        p &&
        p.is_active !== false &&
        !isTemporaryPersonnel(p) &&
        p.tech_id != null &&
        String(p.tech_id).trim() !== ''
    )
    .slice()
    .sort((a, b) =>
      personDisplayName(a).localeCompare(personDisplayName(b), 'el', {
        sensitivity: 'base',
      })
    )
}

function loadSavedColKeys() {
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY)
    if (!raw) return METRIC_COLS.map((c) => c.key)
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return METRIC_COLS.map((c) => c.key)
    const byKey = new Map(METRIC_COLS.map((c) => [c.key, c]))
    const ordered = []
    const seen = new Set()
    for (const key of parsed.map(String)) {
      if (byKey.has(key) && !seen.has(key)) {
        ordered.push(key)
        seen.add(key)
      }
    }
    for (const c of METRIC_COLS) {
      if (!seen.has(c.key)) ordered.push(c.key)
    }
    return ordered
  } catch {
    return METRIC_COLS.map((c) => c.key)
  }
}

function metricsForExport() {
  const byKey = new Map(METRIC_COLS.map((c) => [c.key, c]))
  return loadSavedColKeys()
    .map((k) => byKey.get(k))
    .filter(Boolean)
}

function loadSavedRowOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function applySavedOrder(list, savedIds) {
  if (!list?.length) return []
  const byId = new Map(list.map((r) => [String(r.techId), r]))
  const ordered = []
  const seen = new Set()
  for (const id of savedIds || []) {
    const row = byId.get(String(id))
    if (row && !seen.has(String(id))) {
      ordered.push(row)
      seen.add(String(id))
    }
  }
  for (const row of list) {
    const id = String(row.techId)
    if (!seen.has(id)) {
      ordered.push(row)
      seen.add(id)
    }
  }
  return ordered
}

function slotNumber(slot, field) {
  return round2(Number(slot?.[field]) || 0)
}

function emptyTotals() {
  return {
    sigma: 0,
    yM: 0,
    yL: 0,
    yTim: 0,
    ticket: 0,
    insurance: 0,
    pi: 0,
    salaryDebit: 0,
    otherDebit: 0,
    invoiceDebit: 0,
  }
}

function accumulateTotals(rows) {
  const acc = emptyTotals()
  for (const row of rows || []) {
    const s = row.month || {}
    acc.sigma += Number(s.sigma) || 0
    acc.yM += Number(s.yM) || 0
    acc.yL += Number(s.yL) || 0
    acc.yTim += Number(s.yTim) || 0
    acc.ticket += Number(s.ticket) || 0
    acc.insurance += Number(s.insurance) || 0
    acc.pi += Number(s.pi) || 0
    acc.salaryDebit += Number(s.salaryDebit) || 0
    acc.otherDebit += Number(s.otherDebit) || 0
    acc.invoiceDebit += Number(s.invoiceDebit) || 0
  }
  for (const k of Object.keys(acc)) acc[k] = round2(acc[k])
  return acc
}

const CELL_BORDER = {
  top: { style: 'thin', color: { rgb: '94A3B8' } },
  bottom: { style: 'thin', color: { rgb: '94A3B8' } },
  left: { style: 'thin', color: { rgb: '94A3B8' } },
  right: { style: 'thin', color: { rgb: '94A3B8' } },
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

function applyDataCellStyle(cell, { zebra = false, bold = false, align = 'right' } = {}) {
  if (!cell) return
  cell.s = {
    ...(cell.s || {}),
    font: { bold: !!bold, name: 'Calibri', sz: 11 },
    alignment: { horizontal: align, vertical: 'center' },
    border: CELL_BORDER,
    ...(zebra ? { fill: { patternType: 'solid', fgColor: { rgb: 'CBD5E1' } } } : {}),
  }
}

function colLetter(index0) {
  let n = index0 + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function buildBoardSheet({ title, rows, metrics }) {
  const headers = ['Υπάλληλος', ...metrics.map((m) => m.label)]
  const aoa = [[title, ...Array(metrics.length).fill('')], headers]

  for (const row of rows) {
    aoa.push([
      row.name,
      ...metrics.map((m) => slotNumber(row.month, m.field)),
    ])
  }

  const totals = accumulateTotals(rows)
  aoa.push([
    'Σύνολο',
    ...metrics.map((m) => slotNumber(totals, m.field)),
  ])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  const lastCol = metrics.length
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }]
  sheet['!rows'] = [{ hpt: 28 }, { hpt: 22 }]

  sheet.A1 = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 16, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '334155' } },
        bottom: { style: 'medium', color: { rgb: '334155' } },
        left: { style: 'medium', color: { rgb: '334155' } },
        right: { style: 'medium', color: { rgb: '334155' } },
      },
    },
  }
  for (let c = 1; c <= lastCol; c += 1) {
    const addr = `${colLetter(c)}1`
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

  for (let c = 0; c <= lastCol; c += 1) {
    styleHeaderCell(sheet, `${colLetter(c)}2`, headers[c])
  }

  const lastRow = aoa.length
  for (let r = 3; r <= lastRow; r += 1) {
    const zebra = (r - 3) % 2 === 1
    const isTotal = r === lastRow
    const nameCell = sheet[`A${r}`]
    if (nameCell) {
      applyDataCellStyle(nameCell, { zebra: !isTotal && zebra, bold: isTotal, align: 'left' })
    }
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = sheet[`${colLetter(c)}${r}`]
      if (!cell) continue
      cell.t = 'n'
      cell.z = '#,##0.00'
      applyDataCellStyle(cell, { zebra: !isTotal && zebra, bold: isTotal, align: 'right' })
    }
  }

  sheet['!cols'] = [
    { wch: 28 },
    ...metrics.map((m) => ({ wch: Math.max(12, String(m.label).length + 2) })),
  ]

  return sheet
}

function safeSheetName(label, fallback) {
  const raw = String(label || fallback || 'Sheet')
    .replace(/[\\/?*[\]]/g, '')
    .trim()
  return (raw || fallback || 'Sheet').slice(0, 31)
}

async function buildPersonBoardRows({
  targets,
  idSet,
  ledgerRows,
  earningsRows,
  benefitsByMonth,
  year,
}) {
  const y = Number(year)
  const ledgerByTech = new Map()
  for (const row of ledgerRows || []) {
    const techId = String(row.tech_id ?? '')
    if (!techId || !idSet.has(techId)) continue
    let list = ledgerByTech.get(techId)
    if (!list) {
      list = []
      ledgerByTech.set(techId, list)
    }
    list.push(row)
  }

  const earningsByTech = new Map()
  for (const row of earningsRows || []) {
    const techId = String(row.tech_id ?? '')
    if (!techId) continue
    earningsByTech.set(techId, row)
  }

  const monthCount = benefitsByMonth?.length || 12
  const byMonth = Array.from({ length: monthCount }, () => [])

  for (const person of targets) {
    const keys = personTechKeys(person)
    const primaryId = String(person.tech_id)
    const personLedger = []
    for (const k of keys) {
      const list = ledgerByTech.get(k)
      if (list) personLedger.push(...list)
    }

    let earningsRow = null
    for (const k of keys) {
      if (earningsByTech.has(k)) {
        earningsRow = earningsByTech.get(k)
        break
      }
    }
    const earningsForm = earningsRow ? earningsFromDb(earningsRow) : null

    const yearPayrolls = []
    for (let mi = 0; mi < monthCount; mi += 1) {
      const monthNum = monthCount === 12 ? mi + 1 : Number(benefitsByMonth[mi]?.month) || mi + 1
      const ben = benefitsByMonth[mi] || {
        ticketByTech: new Map(),
        insuranceByTech: new Map(),
      }
      let ticket = 0
      let insurance = 0
      for (const k of keys) {
        ticket = Math.max(ticket, Number(ben.ticketByTech?.get(k)) || 0)
        insurance = Math.max(insurance, Number(ben.insuranceByTech?.get(k)) || 0)
      }
      if (ticket > 0 || insurance > 0) {
        yearPayrolls.push({
          tech_id: primaryId,
          month: monthNum,
          year: y,
          period: `${y}-${String(monthNum).padStart(2, '0')}`,
          ticket_restaurant: ticket,
          ticket_amount: ticket,
          insurance,
          insurance_amount: insurance,
        })
      }
    }

    const matrix = buildLedgerYearMatrix(personLedger, y, yearPayrolls, {
      earningsTicketAmount: round2(parseElNumber(earningsForm?.ticket_amount) || 0),
      earningsInsuranceAmount: round2(parseElNumber(earningsForm?.insurance_amount) || 0),
      techIsTemporary: false,
      agreementVersions: [],
      earningsForm,
    })

    const name = personDisplayName(person)
    for (let mi = 0; mi < monthCount; mi += 1) {
      const monthNum = monthCount === 12 ? mi + 1 : Number(benefitsByMonth[mi]?.month) || mi + 1
      byMonth[mi].push({
        techId: primaryId,
        name,
        month: matrix.months[monthNum - 1] || null,
      })
    }
  }

  const savedOrder = loadSavedRowOrder()
  return byMonth.map((list) => applySavedOrder(list, savedOrder))
}

async function fetchEarningsBoardMonthRows({ personnel, year, month }) {
  const targets = permanentTargets(personnel)
  if (!targets.length) return []

  const idSet = new Set()
  for (const p of targets) {
    for (const k of personTechKeys(p)) idSet.add(k)
  }
  const idList = [...idSet]
  const y = Number(year)
  const m = Number(month)

  const [ledgerRows, earningsRows, benefits] = await Promise.all([
    fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
      q.eq('year', y).eq('month', m).in('tech_id', idList)
    ),
    fetchAllRows(diasClient, 'tech_earnings', (q) => q.in('tech_id', idList)).catch(
      () => []
    ),
    loadPayrollBenefitsByTechForMonth(m, y).catch(() => ({
      ticketByTech: new Map(),
      insuranceByTech: new Map(),
    })),
  ])

  const byMonth = await buildPersonBoardRows({
    targets,
    idSet,
    ledgerRows,
    earningsRows,
    benefitsByMonth: [{ ...benefits, month: m }],
    year: y,
  })
  return byMonth[0] || []
}

/**
 * Φορτώνει και τους 12 μήνες (μία φορά ledger/earnings) για εξαγωγή έτους.
 * @returns {Promise<Array<Array<{ techId: string, name: string, month: object }>>>}
 */
async function fetchEarningsBoardYearMonths({ personnel, year }) {
  const targets = permanentTargets(personnel)
  if (!targets.length) return Array.from({ length: 12 }, () => [])

  const idSet = new Set()
  for (const p of targets) {
    for (const k of personTechKeys(p)) idSet.add(k)
  }
  const idList = [...idSet]
  const y = Number(year)

  const [ledgerRows, earningsRows, ...benefitsList] = await Promise.all([
    fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
      q.eq('year', y).in('tech_id', idList)
    ),
    fetchAllRows(diasClient, 'tech_earnings', (q) => q.in('tech_id', idList)).catch(
      () => []
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      loadPayrollBenefitsByTechForMonth(i + 1, y)
        .then((b) => ({ ...b, month: i + 1 }))
        .catch(() => ({
          ticketByTech: new Map(),
          insuranceByTech: new Map(),
          month: i + 1,
        }))
    ),
  ])

  return buildPersonBoardRows({
    targets,
    idSet,
    ledgerRows,
    earningsRows,
    benefitsByMonth: benefitsList,
    year: y,
  })
}

export function earningsBoardExportFilename(month, year, scope = 'month') {
  const y = Number(year) || new Date().getFullYear()
  if (scope === 'year') return `Pinakas_Apolavon_${y}.xlsx`
  const m = String(Number(month) || 0).padStart(2, '0')
  return `Pinakas_Apolavon_${m}_${y}.xlsx`
}

/**
 * @param {{ month: number, year: number, personnel?: object[], scope?: 'month'|'year', rows?: object[] }} opts
 * rows: προαιρετικά ήδη φορτωμένες γραμμές για μήνα (αλλιώς fetch).
 */
export async function exportEarningsBoardToExcel({
  month,
  year,
  personnel = [],
  scope = 'month',
  rows: preloadedRows = null,
}) {
  const y = Number(year)
  const m = Number(month)
  const useYear = scope === 'year'
  if (!Number.isFinite(y)) {
    throw new Error('Μη έγκυρο έτος για εξαγωγή')
  }
  if (!useYear && (!Number.isFinite(m) || m < 1 || m > 12)) {
    throw new Error('Μη έγκυρος μήνας για εξαγωγή')
  }

  const metrics = metricsForExport()
  const workbook = XLSX.utils.book_new()
  let rowCount = 0

  if (useYear) {
    const byMonth = await fetchEarningsBoardYearMonths({ personnel, year: y })
    rowCount = byMonth[0]?.length || 0
    if (!rowCount) {
      throw new Error('Δεν βρέθηκαν ενεργοί μόνιμοι υπάλληλοι με tech_id')
    }
    for (let i = 0; i < 12; i += 1) {
      const monthLabel = MONTH_LABELS[i] || `Μήνας ${i + 1}`
      const title = `Πίνακας Απολαβών · ${monthLabel} ${y}`
      const sheet = buildBoardSheet({
        title,
        rows: byMonth[i] || [],
        metrics,
      })
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        safeSheetName(monthLabel, `M${i + 1}`)
      )
    }
  } else {
    const list =
      Array.isArray(preloadedRows) && preloadedRows.length
        ? applySavedOrder(preloadedRows, loadSavedRowOrder())
        : await fetchEarningsBoardMonthRows({ personnel, year: y, month: m })
    rowCount = list.length
    if (!rowCount) {
      throw new Error('Δεν βρέθηκαν ενεργοί μόνιμοι υπάλληλοι με tech_id')
    }
    const monthLabel = MONTH_LABELS[m - 1] || `Μήνας ${m}`
    const title = `Πίνακας Απολαβών · ${monthLabel} ${y}`
    const sheet = buildBoardSheet({ title, rows: list, metrics })
    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(monthLabel, 'Μήνας'))
  }

  const filename = earningsBoardExportFilename(m, y, useYear ? 'year' : 'month')
  XLSX.writeFile(workbook, filename)
  return { rowCount, filename, scope: useYear ? 'year' : 'month' }
}
