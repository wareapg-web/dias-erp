/** tech_ledger_view helpers — Μηνιαία Ανάλυση καρτέλας */

import { formatElNumber, parseElNumber } from './numberFormat'
import { isLoanInstallmentRow } from './loanUi'

export function monthDateRange(year, month) {
  const y = Number(year)
  const m = Number(month)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

export function ledgerTypeLabel(type) {
  const map = {
    BASE_SALARY: 'Μισθός',
    HOURLY_RATE: 'Ωρομίσθιο',
    OVERTIME: 'Υπερωρίες',
    BONUS: 'Bonus',
    HOLIDAY: 'Αργίες',
    NIGHT: 'Νυχτερινά',
    OVERNIGHT: 'Διανυκτέρευση',
    TRAVEL: 'Μετακίνηση',
    METRO: 'Μετρό',
    TICKET: 'Ticket',
    ADVANCE: 'Έναντι',
    SETTLEMENT: 'Εξόφληση Τιμολογίου',
    SETTLEMENT_1: 'Εξόφληση Μισθού',
    SETTLEMENT_2: 'Εξόφληση Λοιπών',
    EXPENSES: 'Έξοδα',
    BONUS_PAYOUT: 'Πληρωμή Bonus',
  }
  return map[type] || type || '—'
}

export function formatLedgerAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return formatElNumber(n)
}

function fmtLedgerNum(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return digits === 0 ? '0' : '0,00'
  return formatElNumber(n, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function earningsAmount(earningsForm, prefix) {
  const amount = Number(earningsForm?.[`${prefix}_amount`])
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

/** Ώρες × τιμή (Υπερωρίες, Αργίες, Νυχτερινά) — ποιοτική επεξήγηση, όχι ποσό. */
function hoursDescription(hours, rate) {
  const h = Number(hours) || 0
  const r = Number(rate) || 0
  if (h === 0) return ''
  if (r > 0) return `${fmtLedgerNum(h)} ώρα/ες x ${fmtLedgerNum(r)} €`
  return `${fmtLedgerNum(h)} ώρα/ες`
}

/** Ακέραια ποσότητα × τιμή (Μετρό, Διανυκτέρευση). */
function countDescription(count, rate) {
  const c = Math.round(Number(count) || 0)
  const r = Number(rate) || 0
  if (c === 0) return ''
  if (r > 0) return `${fmtLedgerNum(c)} x ${fmtLedgerNum(r)} €`
  return fmtLedgerNum(c, 0)
}

/** True αν το κείμενο είναι σκέτο ποσό (€) χωρίς μαθηματική επεξήγηση. */
export function isBareEuroText(text) {
  const s = String(text || '').trim()
  if (!s) return false
  // "1.200,00 €" / "1200.00" / "100 €" — χωρίς "x" / "ώρα"
  if (/[x×]|ώρα|ημέρ/i.test(s)) return false
  return /^[\d.,\s]+€?$/.test(s)
}

/**
 * Περιγραφή για template / preview — ΜΟΝΟ ποιοτικά:
 * μαθηματική επεξήγηση (ώρες/μονάδες × τιμή). Ποτέ σκέτο ποσό €.
 * Σταθερά (Μισθός, Bonus, Ticket) → κενό· το ποσό πάει στις 4 ledger στήλες.
 */
export function buildLedgerDescriptionForType(type, { summary, earningsForm } = {}) {
  if (!type) return ''
  const id = Number(type.id)
  const s = summary || {}
  const e = earningsForm || {}

  switch (id) {
    case 7:
      return hoursDescription(s.overtimeHours, earningsAmount(e, 'overtime'))
    case 8:
      return hoursDescription(s.holidayHours, earningsAmount(e, 'holiday'))
    case 9:
      return hoursDescription(s.nightHours, earningsAmount(e, 'night'))
    case 22:
      return countDescription(s.overnightDays, earningsAmount(e, 'overnight'))
    case 25:
      return countDescription(s.metroDays, earningsAmount(e, 'metro'))
    default:
      // Μισθός / Bonus / Ticket / εξοφλήσεις κλπ. — χωρίς κείμενο ποσού στην Περιγραφή
      return ''
  }
}

/**
 * Υπολογισμένο ποσό από Αποδοχές + ώρες Admin (για prefill modal / preview στήλης).
 * Δεν μπαίνει στην Περιγραφή.
 */
export function buildLedgerAmountForType(type, { summary, earningsForm } = {}) {
  if (!type) return 0
  const id = Number(type.id)
  const s = summary || {}
  const e = earningsForm || {}
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

  switch (id) {
    case 3:
      return round2(earningsAmount(e, 'salary'))
    case 4:
      return round2(earningsAmount(e, 'bonus'))
    case 41:
      return round2(earningsAmount(e, 'bonus_plus'))
    case 24:
      return round2(earningsAmount(e, 'ticket'))
    case 7:
      return round2((Number(s.overtimeHours) || 0) * earningsAmount(e, 'overtime'))
    case 8:
      return round2((Number(s.holidayHours) || 0) * earningsAmount(e, 'holiday'))
    case 9:
      return round2((Number(s.nightHours) || 0) * earningsAmount(e, 'night'))
    case 22:
      return round2(Math.round(Number(s.overnightDays) || 0) * earningsAmount(e, 'overnight'))
    case 25:
      return round2(Math.round(Number(s.metroDays) || 0) * earningsAmount(e, 'metro'))
    default:
      return 0
  }
}

/** Ημ/νία + ώρα εισαγωγής κίνησης (στήλη Εισαγωγή — read-only, από created_at). */
export function formatLedgerImportAt(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('el-GR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Περιγραφή στο grid: μόνο ποιοτικά (τύπος ώρες×τιμή ή ελεύθερο κείμενο).
 * Σκέτα ποσά € αποκλείονται — πάνε στις 4 λογιστικές στήλες.
 */
export function ledgerDescriptionForRow(row, context = {}) {
  if (!row) return ''

  if (row.__template) {
    if (row.__type) {
      return buildLedgerDescriptionForType(row.__type, context) || ''
    }
    return ''
  }

  const fromDb = String(row.description || '').trim()
  if (fromDb && !isBareEuroText(fromDb)) return fromDb
  return ''
}

/** Ποσό από τις ledger στήλες (μη μηδενική, συμπεριλαμβανομένων αρνητικών). */
export function extractLedgerAmount(row) {
  if (!row) return { amount: 0, bucket: 'salary_debit' }
  const cols = [
    ['salary_debit', Number(row.salary_debit) || 0],
    ['salary_credit', Number(row.salary_credit) || 0],
    ['other_debit', Number(row.other_debit) || 0],
    ['other_credit', Number(row.other_credit) || 0],
    ['invoice_amount', Number(row.invoice_amount) || 0],
    ['invoice_credit', Number(row.invoice_credit) || 0],
  ]
  const hit = cols.find(([, v]) => v !== 0)
  if (!hit) return { amount: 0, bucket: 'salary_debit' }
  return { amount: hit[1], bucket: hit[0] }
}

function isSalaryBucket(bucket) {
  return String(bucket || '').startsWith('salary')
}

/** Stable key for a ledger grid row. */
export function ledgerRowKey(row) {
  if (row?._gridKey) return row._gridKey
  if (!row?.id) return null
  return `${row.source || 'PAYROLL'}-${row.id}`
}

/** Normalize DB / locale dates for <input type="date">. */
export function normalizeEntryDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = new Date(value)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

/** Form state από ledger row (ή κενό για INSERT). */
export function movementFormFromRow(row) {
  if (!row) {
    return {
      id: null,
      source: 'PAYROLL',
      entry_date: new Date().toISOString().slice(0, 10),
      type: '',
      description: '',
      amount: '',
      notes: '',
      side: 'DEBIT',
      ledger_group: null,
      is_salary_type: false,
      post_to_invoice: false,
    }
  }
  const { amount, bucket } = extractLedgerAmount(row)
  const side =
    bucket === 'salary_credit' ||
    bucket === 'other_credit' ||
    bucket === 'invoice_credit'
      ? 'CREDIT'
      : 'DEBIT'
  const ledger_group =
    bucket === 'invoice_amount' || bucket === 'invoice_credit'
      ? 'INVOICE'
      : isSalaryBucket(bucket)
        ? 'SALARY'
        : 'OTHER'
  return {
    id: row.id,
    source: row.source || 'PAYROLL',
    entry_date: normalizeEntryDate(row.entry_date),
    type: row.type || '',
    description: row.description || '',
    amount: amount === 0 ? '' : String(amount),
    notes: row.notes || '',
    side,
    ledger_group,
    is_salary_type: isSalaryBucket(bucket),
    post_to_invoice: bucket === 'invoice_amount' || bucket === 'invoice_credit',
  }
}

export function parseMovementAmount(value) {
  if (value === '' || value == null) throw new Error('Συμπλήρωσε ποσό')
  const n = parseElNumber(value)
  if (n == null || !Number.isFinite(n)) throw new Error('Μη έγκυρο ποσό')
  return n
}

/** Ticket Restaurant (EPT_ID 24) — ανεξάρτητη παροχή, εκτός υπολοίπων εξόφλησης. */
export function isTicketRestaurantRow(row) {
  if (!row) return false
  const id = Number(row.ept_id ?? row.__type?.id)
  if (id === 24) return true
  const label = `${row.type || ''} ${row.__type?.description || ''} ${row.description || ''}`.toLowerCase()
  return label.includes('ticket')
}

/** Ποσό γραμμής Ticket από τις στήλες ledger (μία μη-μηδενική στήλη συνήθως). */
export function ticketRestaurantAmountFromRow(row) {
  if (!row) return 0
  const { amount } = extractLedgerAmount(row)
  return Math.round((Number(amount) || 0) * 100) / 100
}

/**
 * Άθροισμα Ticket Restaurant ανά μήνα για ένα έτος (12 θέσεις, 0-based).
 * Δεν συμμετέχει σε Σ/Π/Υ — μόνο για τη γραμμή μήτρας.
 */
export function aggregateTicketRestaurantByMonth(ledgerRows = [], year) {
  const byMonth = Array.from({ length: 12 }, () => 0)
  const y = Number(year)
  for (const row of ledgerRows || []) {
    if (!isTicketRestaurantRow(row)) continue
    const { year: yy, month: mm } = ledgerRowPeriod(row)
    if (yy !== y || mm < 1 || mm > 12) continue
    byMonth[mm - 1] =
      Math.round((byMonth[mm - 1] + ticketRestaurantAmountFromRow(row)) * 100) / 100
  }
  return byMonth
}

/** Λογιστική περίοδος γραμμής view · fallback από entry_date. */
export function ledgerRowPeriod(row) {
  const month = Number(row?.month)
  const year = Number(row?.year)
  if (month >= 1 && month <= 12 && Number.isFinite(year) && year > 0) {
    return { year, month }
  }
  const dateStr = String(row?.entry_date || row?.reference_date || '')
  if (/^\d{4}-\d{2}/.test(dateStr)) {
    const [yy, mm] = dateStr.split('-').map(Number)
    return { year: yy, month: mm }
  }
  return { year: 0, month: 0 }
}

/** month/year από εγγραφή payrolls (period YYYY-MM ή year/month columns). */
function payrollRowMonthYear(payroll) {
  const period = String(payroll?.period || '')
  if (/^\d{4}-\d{2}/.test(period)) {
    const [yy, mm] = period.split('-').map(Number)
    return { year: yy, month: mm }
  }
  return {
    year: Number(payroll?.year) || 0,
    month: Number(payroll?.month) || 0,
  }
}

/**
 * Ετήσια μήτρα: Σ/Π/Υ από tech_ledger_view · Ticket από payrolls (hybrid).
 * Type 94: μετράει στα Υ (λογιστική κράτηση) · εξαιρείται από το Π (όχι cash-out).
 * Γραμμή «Δάνειο»: πληροφοριακό άθροισμα δόσεων 94 (όλες οι κατηγορίες) · δεν αλλάζει Σ/Π/Υ.
 * Ticket: γραμμή μήτρας από payrolls · Σ της μήτρας το συμπεριλαμβάνει (εξαίρεση) ·
 * Π/Υ και computeLedgerBalances μένουν χωρίς Ticket.
 *
 * @param {object[]} ledgerRows
 * @param {number} year
 * @param {object[]} yearPayrolls — εγγραφές payrolls (ήδη φιλτραρισμένες ή όχι) για Ticket
 */
export function buildLedgerYearMatrix(ledgerRows = [], year, yearPayrolls = []) {
  const y = Number(year)
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    sigma: 0,
    pi: 0,
    yM: 0,
    yL: 0,
    yTim: 0,
    ticket: 0,
    loan: 0,
    loanCount: 0,
    salaryDebit: 0,
    salaryCredit: 0,
    otherDebit: 0,
    otherCredit: 0,
    invoiceDebit: 0,
    invoiceCredit: 0,
    loanInstallmentsCredit: 0,
  }))

  for (const row of ledgerRows || []) {
    const { year: yy, month: mm } = ledgerRowPeriod(row)
    if (yy !== y || mm < 1 || mm > 12) continue
    const slot = months[mm - 1]

    // Ticket μόνο από payrolls — ledger ticket rows δεν μετράνε στη μήτρα
    if (isTicketRestaurantRow(row)) continue

    const sd = Number(row.salary_debit) || 0
    const sc = Number(row.salary_credit) || 0
    const od = Number(row.other_debit) || 0
    const oc = Number(row.other_credit) || 0
    const id = Number(row.invoice_amount) || 0
    const ic = Number(row.invoice_credit) || 0

    slot.salaryDebit += sd
    slot.salaryCredit += sc
    slot.otherDebit += od
    slot.otherCredit += oc
    slot.invoiceDebit += id
    slot.invoiceCredit += ic

    // Type 94: μετράει στα Υ · εξαιρείται από το Pi (όχι πραγματικό cash-out)
    if (isLoanInstallmentRow(row)) {
      const loanAmt = sc + oc + ic
      slot.loanInstallmentsCredit += loanAmt
      slot.loanCount += 1
    }
  }

  const round2 = (n) => Math.round(n * 100) / 100

  for (const slot of months) {
    const monthPayrolls = (yearPayrolls || []).filter((p) => {
      const { year: py, month: pm } = payrollRowMonthYear(p)
      return py === y && pm === slot.month
    })
    const ticketVals = monthPayrolls.map(
      (p) => Number(p.ticket_restaurant) || Number(p.ticket_amount) || 0
    )
    slot.ticket = round2(ticketVals.length ? Math.max(...ticketVals) : 0)
    slot.loan = round2(slot.loanInstallmentsCredit || 0)

    // Σ μήτρας = ledger χρεώσεις + Ticket (εξαίρεση) · Π/Υ χωρίς Ticket
    slot.sigma = round2(
      slot.salaryDebit + slot.otherDebit + slot.invoiceDebit + slot.ticket
    )
    slot.pi = round2(
      slot.salaryCredit +
        slot.otherCredit +
        slot.invoiceCredit -
        (slot.loanInstallmentsCredit || 0)
    )
    slot.yM = round2(slot.salaryDebit - slot.salaryCredit)
    slot.yL = round2(slot.otherDebit - slot.otherCredit)
    slot.yTim = round2(slot.invoiceDebit - slot.invoiceCredit)
  }

  const totals = months.reduce(
    (acc, m) => ({
      sigma: round2(acc.sigma + m.sigma),
      pi: round2(acc.pi + m.pi),
      yM: round2(acc.yM + m.yM),
      yL: round2(acc.yL + m.yL),
      yTim: round2(acc.yTim + m.yTim),
      ticket: round2(acc.ticket + m.ticket),
      loan: round2(acc.loan + m.loan),
      loanCount: acc.loanCount + (m.loanCount || 0),
    }),
    { sigma: 0, pi: 0, yM: 0, yL: 0, yTim: 0, ticket: 0, loan: 0, loanCount: 0 }
  )

  const monthsWithEarnings = months.filter((m) => m.sigma > 0)
  const avg =
    monthsWithEarnings.length > 0
      ? round2(totals.sigma / monthsWithEarnings.length)
      : 0

  const selectedSettled = (month) => {
    const m = months[month - 1]
    if (!m || m.sigma <= 0) return false
    return Math.abs(m.yM) + Math.abs(m.yL) + Math.abs(m.yTim) < 0.015
  }

  const yearSettled =
    totals.sigma > 0 && Math.abs(totals.yM) + Math.abs(totals.yL) + Math.abs(totals.yTim) < 0.015

  return { months, totals, avg, selectedSettled, yearSettled }
}

/**
 * Υπόλοιπα από γραμμές ledger μήνα (όπως εμφανίζονται στο grid).
 * Υπόλοιπο (Μ) = Μισθός Χρ. − Μισθός Πιστ.
 * Υπόλοιπο (Λ) = Λοιπά Χρ. − Λοιπά Πιστ.
 * Υπόλοιπο (ΤΙΜ) = invoice_amount (Χρ.) − invoice_credit (Πιστ.).
 * Υπόλοιπο = (Μ) + (Λ) + (ΤΙΜ).
 * Ticket Restaurant δεν συμμετέχει.
 * (tech_earnings.extra είναι % για τον Οδηγό Τιμολογίου — όχι μέρος των balances.)
 *
 * @param {object[]} rows
 */
export function computeLedgerBalances(rows = []) {
  let salaryDebit = 0
  let salaryCredit = 0
  let otherDebit = 0
  let otherCredit = 0
  let invoiceDebit = 0
  let invoiceCredit = 0
  let y1 = 0
  let y2 = 0

  for (const r of rows) {
    if (isTicketRestaurantRow(r)) continue

    salaryDebit += Number(r.salary_debit) || 0
    salaryCredit += Number(r.salary_credit) || 0
    otherDebit += Number(r.other_debit) || 0
    otherCredit += Number(r.other_credit) || 0
    invoiceDebit += Number(r.invoice_amount) || 0
    invoiceCredit += Number(r.invoice_credit) || 0

    if (r.type === 'SETTLEMENT_1') {
      y1 += Number(r.salary_credit) || Number(r.invoice_credit) || 0
    }
    if (r.type === 'SETTLEMENT_2') y2 += Number(r.other_credit) || 0
  }

  const round2 = (n) => Math.round(n * 100) / 100
  const balance1 = round2(salaryDebit - salaryCredit)
  const balance2 = round2(otherDebit - otherCredit)
  const invoice = round2(invoiceDebit - invoiceCredit)

  return {
    balance1,
    balance2,
    invoice,
    balance: round2(balance1 + balance2 + invoice),
    y1: round2(y1),
    y2: round2(y2),
  }
}
