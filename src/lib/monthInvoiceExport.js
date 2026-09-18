/** Εξαγωγή ανάλυσης Οδηγού Τιμολογίου μήνα — μόνο τεχνικοί με τιμολόγιο. */

import * as XLSX from 'xlsx-js-style'
import { diasClient, fetchAllRows } from './supabase'
import { isTicketRestaurantRow, computeInvoiceGrossBreakdown } from './techLedger'
import { personnelIssuesInvoice, isTemporaryPersonnel } from './personnel'
import { MONTH_LABELS } from './payrollAnalysis'
import { resolveInvoiceTermsForMonth } from './techAgreementVersions'

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

/** tech_id μόνιμων που κόβουν παραστατικό (payment_method invoice/mixed). */
function invoiceTechIdSet(personnel = []) {
  const set = new Set()
  for (const p of personnel || []) {
    if (isTemporaryPersonnel(p)) continue
    if (!personnelIssuesInvoice(p)) continue
    if (p.tech_id != null && p.tech_id !== '') set.add(String(p.tech_id))
    if (p.id != null && p.id !== '') set.add(String(p.id))
  }
  return set
}

/**
 * Μόνιμοι με τιμολόγιο: άθροισμα ΤΙΜ Χρ. (χωρίς εξόφληση) → ανάλυση Οδηγού.
 * Αξία = net / (1 − tax%/100) αν invoice_gross_up, αλλιώς = net.
 * @param {Map<string, { invoiceGrossUp: boolean, taxPercent: number }>|null} [termsByTechId]
 * @returns {Array<{ techId: string, name: string, net: number, grossAmount: number, vat: number, tax: number, payable: number, taxPercent: number }>}
 */
export function aggregateMonthInvoiceGross(ledgerRows = [], personnel = [], termsByTechId = null) {
  const names = personnelNameByTechId(personnel)
  const invoiceTechs = invoiceTechIdSet(personnel)
  const byTech = new Map()

  for (const row of ledgerRows || []) {
    if (isTicketRestaurantRow(row)) continue

    const techId = String(row.tech_id ?? '')
    if (!techId) continue
    if (invoiceTechs.size > 0 && !invoiceTechs.has(techId)) continue

    const charge = Number(row.invoice_amount) || 0
    if (!(charge > 0)) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = {
        techId,
        name: names.get(techId) || techId,
        net: 0,
      }
      byTech.set(techId, slot)
    }
    slot.net = round2(slot.net + charge)
  }

  const rows = []
  for (const slot of byTech.values()) {
    if (!(slot.net > 0)) continue

    const terms = resolveTermsForTech(slot.techId, termsByTechId)
    const applyGrossUp = terms.invoiceGrossUp !== false
    const taxPercent = terms.taxPercent

    let grossAmount
    let vat
    let tax
    let payable

    if (applyGrossUp) {
      const b = computeInvoiceGrossBreakdown(slot.net, taxPercent)
      if (!b) continue
      grossAmount = b.gross
      vat = b.vat
      tax = b.tax
      payable = b.payable
    } else {
      // Χωρίς προσαύξηση: Αξία = ΤΙΜ Χρ. · ΦΠΑ/παρακράτηση επί της αξίας
      grossAmount = slot.net
      vat = round2(grossAmount * 0.24)
      tax = round2(grossAmount * (taxPercent / 100))
      payable = round2(grossAmount + vat - tax)
    }

    rows.push({
      techId: slot.techId,
      name: slot.name,
      net: slot.net,
      grossAmount,
      vat,
      tax,
      payable,
      taxPercent,
      invoiceGrossUp: applyGrossUp,
    })
  }

  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

/** null/missing → defaults (gross-up on, 20%). */
function resolveTermsForTech(techId, termsByTechId) {
  const defaults = { invoiceGrossUp: true, taxPercent: 20 }
  if (!termsByTechId) return defaults
  const id = String(techId)
  const t = termsByTechId instanceof Map ? termsByTechId.get(id) : termsByTechId[id]
  if (!t) return defaults
  const pct = Number(t.taxPercent)
  return {
    invoiceGrossUp: t.invoiceGrossUp !== false,
    taxPercent: Number.isFinite(pct) && pct > 0 ? pct : 20,
  }
}

export function invoiceExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Timologia_${m}_${y}.xlsx`
}

/**
 * Excel μόνιμων: Ονοματεπώνυμο · Αξία · ΦΠΑ 24% · Παρακράτηση · Πληρωτέο
 * Βάση = άθροισμα ΤΙΜ Χρ. (ανεξάρτητα εξόφλησης) · προσαύξηση όπου υπάρχει.
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

  const termsByTechId = new Map()
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
    termsByTechId.set(id, {
      invoiceGrossUp: terms.invoiceGrossUp,
      taxPercent: terms.taxPercent,
    })
  }

  const rows = aggregateMonthInvoiceGross(ledgerRows, personnel, termsByTechId)
  if (rows.length === 0) {
    throw new Error('Δεν βρέθηκαν χρεώσεις ΤΙΜ για τεχνικούς με τιμολόγιο αυτόν τον μήνα')
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

  const header = [
    'Ονοματεπώνυμο',
    'Αξία Τιμολογίου (€)',
    'ΦΠΑ 24% (€)',
    'Παρακράτηση Φόρου (€)',
    'Πληρωτέο (€)',
  ]
  const aoa = [[titleCell], header]

  let totGross = 0
  let totVat = 0
  let totTax = 0
  let totPayable = 0
  for (const r of rows) {
    aoa.push([r.name, r.grossAmount, r.vat, r.tax, r.payable])
    totGross = round2(totGross + r.grossAmount)
    totVat = round2(totVat + r.vat)
    totTax = round2(totTax + r.tax)
    totPayable = round2(totPayable + r.payable)
  }
  aoa.push(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ', totGross, totVat, totTax, totPayable])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]
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
    for (const col of ['B', 'C', 'D', 'E']) {
      const cell = sheet[`${col}${r}`]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '0.00'
      }
    }
  }

  sheet['!cols'] = [{ wch: 36 }, { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 14 }]

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
 * Έκτακτοι με τιμολόγιο: άθροισμα ΤΙΜ Χρ. (invoice_amount) ανά μήνα — χωρίς αφαίρεση εξόφλησης.
 * ΦΠΑ 24% · Τελικό Πληρωτέο = καθαρό + ΦΠΑ (χωρίς /0.8, χωρίς παρακράτηση).
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

    const charge = Number(row.invoice_amount) || 0
    if (!(charge > 0)) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = { techId, name: names.get(techId) || techId, net: 0 }
      byTech.set(techId, slot)
    }
    slot.net = round2(slot.net + charge)
  }

  const rows = []
  for (const slot of byTech.values()) {
    if (slot.net <= 0) continue
    const vat = round2(slot.net * 0.24)
    rows.push({
      techId: slot.techId,
      name: slot.name,
      net: slot.net,
      vat,
      payable: round2(slot.net + vat),
    })
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

/**
 * Έκτακτοι χωρίς τιμολόγιο: άθροισμα Λοιπά Χρ. (other_debit) ανά μήνα — χωρίς αφαίρεση εξόφλησης.
 */
export function aggregateMonthTemporaryOtherDebit(ledgerRows = [], personnel = []) {
  const temps = temporaryPersonnelList(personnel).filter((p) => !personnelIssuesInvoice(p))
  const names = personnelNameByTechId(temps)
  const ids = techIdSetFromList(temps)
  const byTech = new Map()

  for (const row of ledgerRows || []) {
    if (isTicketRestaurantRow(row)) continue
    const techId = String(row.tech_id ?? '')
    if (!techId || !ids.has(techId)) continue

    const charge = Number(row.other_debit) || 0
    if (!(charge > 0)) continue

    let slot = byTech.get(techId)
    if (!slot) {
      slot = { techId, name: names.get(techId) || techId, amount: 0 }
      byTech.set(techId, slot)
    }
    slot.amount = round2(slot.amount + charge)
  }

  const rows = []
  for (const slot of byTech.values()) {
    if (slot.amount <= 0) continue
    rows.push({ techId: slot.techId, name: slot.name, amount: slot.amount })
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
}

/** @deprecated use aggregateMonthTemporaryOtherDebit */
export function aggregateMonthTemporaryCash(ledgerRows = [], personnel = []) {
  return aggregateMonthTemporaryOtherDebit(ledgerRows, personnel)
}

export function temporaryExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Ektaktoi_${m}_${y}.xlsx`
}

export function temporaryOtherExportFilename(month, year) {
  const m = String(Number(month) || 0).padStart(2, '0')
  const y = Number(year) || new Date().getFullYear()
  return `Ektaktoi_Loipa_${m}_${y}.xlsx`
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
 * Excel έκτακτων με τιμολόγιο: καθαρό (ΤΙΜ Χρ.) + ΦΠΑ 24% + Τελικό Πληρωτέο.
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

  if (invoiceRows.length === 0) {
    throw new Error('Δεν βρέθηκαν ποσά ΤΙΜ Χρ. για έκτακτους με τιμολόγιο αυτόν τον μήνα')
  }

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')
  const workbook = XLSX.utils.book_new()

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
    ['Ονοματεπώνυμο', 'Καθαρό Σύνολο (€)', 'ΦΠΑ 24% (€)', 'Τελικό Πληρωτέο (€)'],
  ]
  let totNet = 0
  let totVat = 0
  let totPayable = 0
  for (const r of invoiceRows) {
    const payable = r.payable ?? round2(r.net + r.vat)
    aoa.push([r.name, r.net, r.vat, payable])
    totNet = round2(totNet + r.net)
    totVat = round2(totVat + r.vat)
    totPayable = round2(totPayable + payable)
  }
  aoa.push(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ', totNet, totVat, totPayable])

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
  sheet['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'Τιμολόγια')

  const filename = temporaryExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return {
    rowCount: invoiceRows.length,
    invoiceCount: invoiceRows.length,
    cashCount: 0,
    filename,
  }
}

/**
 * Excel έκτακτων χωρίς τιμολόγιο: άθροισμα Λοιπά Χρ. ανά μήνα.
 */
export async function exportMonthTemporaryOtherToExcel({ month, year, personnel = [] }) {
  const m = Number(month)
  const y = Number(year)
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error('Μη έγκυρος μήνας/έτος για εξαγωγή λοιπών')
  }

  const ledgerRows = await fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
    q.eq('month', m).eq('year', y)
  )

  const rows = aggregateMonthTemporaryOtherDebit(ledgerRows, personnel)
  if (rows.length === 0) {
    throw new Error('Δεν βρέθηκαν ποσά Λοιπά Χρ. για έκτακτους χωρίς τιμολόγιο αυτόν τον μήνα')
  }

  const monthTitle = String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')
  const title = `ΕΚΤΑΚΤΟΙ ΛΟΙΠΑ · ${monthTitle} ${y}`
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
    ['Ονοματεπώνυμο', 'Λοιπά Χρ. (€)'],
  ]
  let tot = 0
  for (const r of rows) {
    aoa.push([r.name, r.amount])
    tot = round2(tot + r.amount)
  }
  aoa.push(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ', tot])

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
  sheet['!cols'] = [{ wch: 36 }, { wch: 16 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Λοιπά')

  const filename = temporaryOtherExportFilename(m, y)
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename }
}
