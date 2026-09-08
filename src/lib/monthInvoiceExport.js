/** Εξαγωγή αναχθέντων (μικτών) ποσών τιμολογίου μήνα — μόνο τεχνικοί με τιμολόγιο. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { isTicketRestaurantRow } from './techLedger'
import { personnelIssuesInvoice } from './personnel'
import { MONTH_LABELS } from './payrollAnalysis'

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
 * Υπόλοιπο ΤΙΜ ανά τεχνικό (χρέωση − πίστωση) · Αξία = υπόλοιπο / 0.8
 * Ίδιο με το chip «Υπόλοιπο (ΤΙΜ)» + προσαύξηση.
 * @returns {Array<{ techId: string, name: string, invoiceBalance: number, grossAmount: number }>}
 */
export function aggregateMonthInvoiceGross(
  ledgerRows = [],
  personnel = [],
  factor = INVOICE_GROSS_UP_FACTOR
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
    slot.grossAmount = round2(balance / safeFactor)
    rows.push(slot)
  }

  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

export function invoiceExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Timologia_${m}_${y}.xlsx`
}

/**
 * Excel: Ονοματεπώνυμο · Αξία Τιμολογίου (€) = Υπόλοιπο ΤΙΜ / 0.8
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

  const rows = aggregateMonthInvoiceGross(ledgerRows, personnel, INVOICE_GROSS_UP_FACTOR)
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
