/** Εξαγωγή αναχθέντων (μικτών) ποσών τιμολογίου μήνα — μόνο τεχνικοί με τιμολόγιο. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { isTicketRestaurantRow } from './techLedger'
import { personnelIssuesInvoice } from './personnel'
import { MONTH_LABELS } from './payrollAnalysis'
import { resolveInvoiceTermsForMonth } from './techAgreementVersions'

/** Προσαύξηση φόρου 20% → factor 0.8 (ίδιο με Υπόλοιπο ΤΙΜ / Οδηγό). */
const INVOICE_GROSS_UP_FACTOR = 0.8

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
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

/** tech_id που κόβουν παραστατικό (payment_method invoice/mixed). */
function invoiceTechIdSet(personnel = []) {
  const set = new Set()
  for (const p of personnel || []) {
    if (!personnelIssuesInvoice(p)) continue
    if (p.tech_id != null && p.tech_id !== '') set.add(String(p.tech_id))
    if (p.id != null && p.id !== '') set.add(String(p.id))
  }
  return set
}

/**
 * Υπόλοιπο ΤΙΜ ανά τεχνικό (χρέωση − πίστωση).
 * Αξία = υπόλοιπο / 0.8 αν invoice_gross_up !== false, αλλιώς = υπόλοιπο.
 * @param {Map<string, boolean>|Record<string, boolean>|null} [grossUpByTechId]
 * @returns {Array<{ techId: string, name: string, invoiceBalance: number, grossAmount: number }>}
 */
export function aggregateMonthInvoiceGross(
  ledgerRows = [],
  personnel = [],
  factor = INVOICE_GROSS_UP_FACTOR,
  grossUpByTechId = null
) {
  const names = personnelNameByTechId(personnel)
  const invoiceTechs = invoiceTechIdSet(personnel)
  const byTech = new Map()
  const safeFactor = Number(factor) > 0 ? Number(factor) : INVOICE_GROSS_UP_FACTOR

  for (const row of ledgerRows || []) {
    if (isTicketRestaurantRow(row)) continue

    const techId = String(row.tech_id ?? '')
    if (!techId) continue
    if (invoiceTechs.size > 0 && !invoiceTechs.has(techId)) continue

    const debit = Number(row.invoice_amount) || 0
    const credit = Number(row.invoice_credit) || 0
    if (debit === 0 && credit === 0) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = {
        techId,
        name: names.get(techId) || techId,
        invoiceDebit: 0,
        invoiceCredit: 0,
        invoiceBalance: 0,
        grossAmount: 0,
      }
      byTech.set(techId, slot)
    }
    slot.invoiceDebit = round2(slot.invoiceDebit + debit)
    slot.invoiceCredit = round2(slot.invoiceCredit + credit)
  }

  const rows = []
  for (const slot of byTech.values()) {
    const balance = round2(slot.invoiceDebit - slot.invoiceCredit)
    slot.invoiceBalance = balance
    if (balance <= 0) continue
    const applyGrossUp = resolveInvoiceGrossUp(slot.techId, grossUpByTechId)
    slot.grossAmount = applyGrossUp ? round2(balance / safeFactor) : balance
    rows.push(slot)
  }

  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

/** null/missing → true (backwards compatible). */
function resolveInvoiceGrossUp(techId, grossUpByTechId) {
  if (!grossUpByTechId) return true
  const id = String(techId)
  if (grossUpByTechId instanceof Map) {
    if (!grossUpByTechId.has(id)) return true
    return grossUpByTechId.get(id) !== false
  }
  if (Object.prototype.hasOwnProperty.call(grossUpByTechId, id)) {
    return grossUpByTechId[id] !== false
  }
  return true
}

export function invoiceExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Timologia_${m}_${y}.xlsx`
}

/**
 * Excel: Ονοματεπώνυμο · Αξία Τιμολογίου (€)
 * = Υπόλοιπο ΤΙΜ / 0.8 αν invoice_gross_up, αλλιώς = Υπόλοιπο ΤΙΜ
 * @param {{ month: number, year: number, personnel?: object[] }} opts
 */
export async function exportMonthInvoicesToExcel({ month, year, personnel = [] }) {
  const m = Number(month)
  const y = Number(year)
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error('Μη έγκυρος μήνας/έτος για εξαγωγή τιμολογίων')
  }

  const ledgerRows = await fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
    q.eq('month', m).eq('year', y)
  )

  /** tech_id → versions[] · όροι από ιστορικό μήνα, όχι live mirror. */
  const versionsByTech = new Map()
  try {
    const versionRows = await fetchAllRows(diasClient, 'tech_agreement_versions')
    for (const row of versionRows || []) {
      const id = String(row?.tech_id ?? '')
      if (!id) continue
      if (!versionsByTech.has(id)) versionsByTech.set(id, [])
      versionsByTech.get(id).push(row)
    }
  } catch {
    /* missing table → fallback defaults κάτω */
  }

  const earningsFallbackByTech = new Map()
  try {
    const earningsRows = await fetchAllRows(diasClient, 'tech_earnings')
    for (const row of earningsRows || []) {
      const id = String(row?.tech_id ?? '')
      if (!id) continue
      earningsFallbackByTech.set(id, {
        invoice_gross_up: row.invoice_gross_up !== false,
        extra: row.extra ?? '',
      })
    }
  } catch {
    /* ignore */
  }

  const grossUpByTechId = new Map()
  const techIds = new Set()
  for (const row of ledgerRows || []) {
    const id = String(row?.tech_id ?? '')
    if (id) techIds.add(id)
  }
  for (const id of techIds) {
    const terms = resolveInvoiceTermsForMonth(
      versionsByTech.get(id) || [],
      y,
      m,
      earningsFallbackByTech.get(id) || null
    )
    grossUpByTechId.set(id, terms.invoiceGrossUp)
  }

  const rows = aggregateMonthInvoiceGross(
    ledgerRows,
    personnel,
    INVOICE_GROSS_UP_FACTOR,
    grossUpByTechId
  )
  if (rows.length === 0) {
    throw new Error('Δεν βρέθηκε υπόλοιπο τιμολογίου για τεχνικούς με τιμολόγιο αυτόν τον μήνα')
  }

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')
  const title = `ΤΙΜΟΛΟΓΙΑ · ${monthTitle} ${y}`

  const titleCell = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 18, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center' },
    },
  }

  const header = ['Ονοματεπώνυμο', 'Αξία Τιμολογίου (€)']
  const aoa = [[titleCell], header]

  let totGross = 0
  for (const r of rows) {
    aoa.push([r.name, r.grossAmount])
    totGross = round2(totGross + r.grossAmount)
  }
  aoa.push(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ', totGross])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
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
  for (let r = 3; r <= lastRow; r += 1) {
    const cell = sheet[`B${r}`]
    if (cell && typeof cell.v === 'number') {
      cell.t = 'n'
      cell.z = '0.00'
    }
  }

  sheet['!cols'] = [{ wch: 36 }, { wch: 22 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Τιμολόγια')

  const filename = invoiceExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename }
}

function temporaryPersonnelList(personnel = []) {
  return (personnel || []).filter(
    (p) => String(p?.employment_type || '') === 'temporary' && p.is_active !== false
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

/**
 * Έκτακτοι με τιμολόγιο: καθαρό Υπόλοιπο ΤΙΜ + ΦΠΑ 24% (χωρίς /0.8).
 */
export function aggregateMonthTemporaryInvoiceNet(ledgerRows = [], personnel = []) {
  const temps = temporaryPersonnelList(personnel).filter((p) => personnelIssuesInvoice(p))
  const names = personnelNameByTechId(temps)
  const ids = techIdSetFromList(temps)
  const byTech = new Map()

  for (const row of ledgerRows || []) {
    if (isTicketRestaurantRow(row)) continue
    const techId = String(row.tech_id ?? '')
    if (!techId || !ids.has(techId)) continue

    const debit = Number(row.invoice_amount) || 0
    const credit = Number(row.invoice_credit) || 0
    if (debit === 0 && credit === 0) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = { techId, name: names.get(techId) || techId, net: 0 }
      byTech.set(techId, slot)
    }
    slot.net = round2(slot.net + debit - credit)
  }

  const rows = []
  for (const slot of byTech.values()) {
    if (slot.net <= 0) continue
    rows.push({
      techId: slot.techId,
      name: slot.name,
      net: slot.net,
      vat: round2(slot.net * 0.24),
    })
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

/**
 * Έκτακτοι μετρητά (χωρίς τιμολόγιο): υπόλοιπο Λοιπών (χρέωση − πίστωση).
 */
export function aggregateMonthTemporaryCash(ledgerRows = [], personnel = []) {
  const temps = temporaryPersonnelList(personnel).filter((p) => !personnelIssuesInvoice(p))
  const names = personnelNameByTechId(temps)
  const ids = techIdSetFromList(temps)
  const byTech = new Map()

  for (const row of ledgerRows || []) {
    if (isTicketRestaurantRow(row)) continue
    const techId = String(row.tech_id ?? '')
    if (!techId || !ids.has(techId)) continue

    const debit = Number(row.other_debit) || 0
    const credit = Number(row.other_credit) || 0
    if (debit === 0 && credit === 0) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = { techId, name: names.get(techId) || techId, amount: 0 }
      byTech.set(techId, slot)
    }
    slot.amount = round2(slot.amount + debit - credit)
  }

  const rows = []
  for (const slot of byTech.values()) {
    if (slot.amount <= 0) continue
    rows.push({ techId: slot.techId, name: slot.name, amount: slot.amount })
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

export function temporaryExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Ektaktoi_${m}_${y}.xlsx`
}

function styleTitleCell(sheet, title, colSpan) {
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colSpan - 1 } }]
  sheet['!rows'] = [{ hpt: 30 }]
  sheet.A1 = {
    v: title,
    t: 's',
    s: {
      font: { bold: true, sz: 18, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center' },
    },
  }
}

/**
 * Excel έκτακτων: φύλλο Τιμολόγια (καθαρό + ΦΠΑ) · φύλλο Μετρητά (ποσό).
 */
export async function exportMonthTemporaryToExcel({ month, year, personnel = [] }) {
  const m = Number(month)
  const y = Number(year)
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error('Μη έγκυρος μήνας/έτος για εξαγωγή έκτακτων')
  }

  const ledgerRows = await fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
    q.eq('month', m).eq('year', y)
  )

  const invoiceRows = aggregateMonthTemporaryInvoiceNet(ledgerRows, personnel)
  const cashRows = aggregateMonthTemporaryCash(ledgerRows, personnel)

  if (invoiceRows.length === 0 && cashRows.length === 0) {
    throw new Error('Δεν βρέθηκαν ποσά έκτακτων (τιμολόγιο ή μετρητά) για αυτόν τον μήνα')
  }

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')
  const workbook = XLSX.utils.book_new()

  // — Φύλλο Τιμολόγια —
  {
    const title = `ΕΚΤΑΚΤΟΙ ΤΙΜΟΛΟΓΙΑ · ${monthTitle} ${y}`
    const aoa = [
      [
        {
          v: title,
          t: 's',
          s: {
            font: { bold: true, sz: 18, name: 'Calibri' },
            alignment: { horizontal: 'center', vertical: 'center' },
          },
        },
      ],
      ['Ονοματεπώνυμο', 'Καθαρό ΤΙΜ (€)', 'ΦΠΑ 24% (€)', 'Τελικό (€)'],
    ]
    let totNet = 0
    let totVat = 0
    let totFinal = 0
    for (const r of invoiceRows) {
      const final = round2(r.net + r.vat)
      aoa.push([r.name, r.net, r.vat, final])
      totNet = round2(totNet + r.net)
      totVat = round2(totVat + r.vat)
      totFinal = round2(totFinal + final)
    }
    if (invoiceRows.length > 0) {
      aoa.push(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ', totNet, totVat, totFinal])
    } else {
      aoa.push(['— Καμία εγγραφή —', '', '', ''])
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    styleTitleCell(sheet, title, 4)
    const lastRow = aoa.length
    for (let r = 3; r <= lastRow; r += 1) {
      for (const col of ['B', 'C', 'D']) {
        const cell = sheet[`${col}${r}`]
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n'
          cell.z = '0.00'
        }
      }
    }
    sheet['!cols'] = [{ wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(workbook, sheet, 'Τιμολόγια')
  }

  // — Φύλλο Μετρητά —
  {
    const title = `ΕΚΤΑΚΤΟΙ ΜΕΤΡΗΤΑ · ${monthTitle} ${y}`
    const aoa = [
      [
        {
          v: title,
          t: 's',
          s: {
            font: { bold: true, sz: 18, name: 'Calibri' },
            alignment: { horizontal: 'center', vertical: 'center' },
          },
        },
      ],
      ['Ονοματεπώνυμο', 'Ποσό (€)'],
    ]
    let tot = 0
    for (const r of cashRows) {
      aoa.push([r.name, r.amount])
      tot = round2(tot + r.amount)
    }
    if (cashRows.length > 0) {
      aoa.push(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ', tot])
    } else {
      aoa.push(['— Καμία εγγραφή —', ''])
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    styleTitleCell(sheet, title, 2)
    const lastRow = aoa.length
    for (let r = 3; r <= lastRow; r += 1) {
      const cell = sheet[`B${r}`]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '0.00'
      }
    }
    sheet['!cols'] = [{ wch: 36 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(workbook, sheet, 'Μετρητά')
  }

  const filename = temporaryExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return {
    rowCount: invoiceRows.length + cashRows.length,
    invoiceCount: invoiceRows.length,
    cashCount: cashRows.length,
    filename,
  }
}
