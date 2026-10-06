/** tech_ledger_view helpers — Μηνιαία Ανάλυση καρτέλας */

import { formatElNumber, parseElNumber } from './numberFormat'
import {
  extractLoanInstallmentProgress,
  isLoanDisbursementRow,
  isLoanInstallmentRow,
} from './loanUi'
import { resolveInvoiceTermsForMonth } from './techAgreementVersions'

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

/** Synthetic τύποι εξόφλησης/μερικής πληρωμής όταν λείπουν από DB. */
export function settlementTypeStub(typeId) {
  const id = Number(typeId)
  const stubs = {
    91: { id: 91, description: 'Εξόφληση Μισθού', ledger_group: 'SALARY', is_for_sum: false },
    92: { id: 92, description: 'Εξόφληση Λοιπών', ledger_group: 'OTHER', is_for_sum: false },
    93: { id: 93, description: 'Εξόφληση Τιμολογίου', ledger_group: 'OTHER', is_for_sum: false },
    96: { id: 96, description: 'Πληρωμή Τιμολογίου', ledger_group: 'OTHER', is_for_sum: false },
    97: { id: 97, description: 'Πληρωμή Μισθού', ledger_group: 'SALARY', is_for_sum: false },
    98: { id: 98, description: 'Πληρωμή Λοιπών', ledger_group: 'OTHER', is_for_sum: false },
  }
  const base = stubs[id]
  if (!base) return null
  return { ...base, is_active: true, __stub: true }
}

/** @deprecated use settlementTypeStub */
export function invoiceCreditTypeStub(typeId) {
  return settlementTypeStub(typeId)
}

/**
 * Κατηγορία εξόφλησης από type id.
 * @returns {'salary'|'other'|'invoice'|null}
 */
export function settlementCategoryFromTypeId(typeId) {
  const id = Number(typeId)
  if (id === 91 || id === 97) return 'salary'
  if (id === 92 || id === 98) return 'other'
  if (id === 93 || id === 96) return 'invoice'
  return null
}

/** full / partial type ids ανά κατηγορία. */
export function settlementTypeIdsForCategory(category) {
  const cat = String(category || '').toUpperCase()
  if (cat === 'SALARY') return { full: 91, partial: 97 }
  if (cat === 'INVOICE') return { full: 93, partial: 96 }
  if (cat === 'OTHER') return { full: 92, partial: 98 }
  return null
}

export function isSettlementFullTypeId(typeId) {
  const id = Number(typeId)
  return id === 91 || id === 92 || id === 93
}

export function isSettlementPartialTypeId(typeId) {
  const id = Number(typeId)
  return id === 96 || id === 97 || id === 98
}

export function isSettlementCreditTypeId(typeId) {
  return isSettlementFullTypeId(typeId) || isSettlementPartialTypeId(typeId)
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

function round2Money(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function fmtBreakdownEuro(n) {
  return `${fmtLedgerNum(round2Money(n), 2)} €`
}

/**
 * Μικτή ανάλυση τιμολογίου από καθαρό υπόλοιπο (ίδιο math με Οδηγό ΤΙΜ).
 * @returns {{ net: number, gross: number, vat: number, tax: number, payable: number, taxPercent: number, factor: number }|null}
 */
export function computeInvoiceGrossBreakdown(netAmount, taxPercent = 20) {
  const net = Number(netAmount) || 0
  if (!(net > 0)) return null
  const pct = Number(taxPercent)
  const safePct = Number.isFinite(pct) && pct > 0 ? pct : 20
  const factor = 1 - safePct / 100
  if (!(factor > 0)) return null
  const gross = round2Money(net / factor)
  const vat = round2Money(gross * 0.24)
  const tax = round2Money(gross * (safePct / 100))
  const payable = round2Money(gross + vat - tax)
  return { net, gross, vat, tax, payable, taxPercent: safePct, factor }
}

/** Πραγματική εξόφληση τιμολογίου (type 93) — ΟΧΙ μερική πληρωμή 96 · ΟΧΙ δάνεια 94/95. */
export function isInvoiceSettlementCreditRow(row) {
  if (!row || row.__template) return false
  if (isLoanInstallmentRow(row) || isLoanDisbursementRow(row)) return false

  const id = Number(row.type_id ?? row.ept_id ?? row.__type?.id)
  if (id === 94 || id === 95 || id === 96) return false
  if (id === 93) return true

  const t = String(row.type || row.__type?.description || '')
  if (t === 'SETTLEMENT' || /εξόφληση\s*τιμολογ/i.test(t)) {
    return (Number(row.invoice_credit) || 0) > 0
  }
  return false
}

/** Μερική πληρωμή τιμολογίου (type 96). */
export function isInvoicePartialPaymentCreditRow(row) {
  if (!row || row.__template) return false
  const id = Number(row.type_id ?? row.ept_id ?? row.__type?.id)
  if (id === 96) return true
  const t = String(row.type || row.__type?.description || '')
  return /πληρωμή\s*τιμολογ/i.test(t) && (Number(row.invoice_credit) || 0) > 0
}

export function descriptionHasInvoiceBreakdown(description) {
  const s = String(description || '')
  return /Αξία:\s*/i.test(s) && /Πληρωτέο:\s*/i.test(s)
}

/**
 * Display/save string: Αξία | ΦΠΑ | Παρ | Πληρωτέο
 */
export function buildInvoiceBreakdownString(netAmount, taxPercent = 20) {
  const b = computeInvoiceGrossBreakdown(netAmount, taxPercent)
  if (!b) return ''
  return `Αξία: ${fmtBreakdownEuro(b.gross)} | ΦΠΑ: ${fmtBreakdownEuro(b.vat)} | Παρ: ${fmtBreakdownEuro(b.tax)} | Πληρωτέο: ${fmtBreakdownEuro(b.payable)}`
}

/** Αν δεν υπάρχει ήδη breakdown · κενό → αυτούσιο · αλλιώς append σε παρένθεση. */
export function mergeInvoiceBreakdownDescription(existingDescription, netAmount, taxPercent = 20) {
  const breakdown = buildInvoiceBreakdownString(netAmount, taxPercent)
  if (!breakdown) {
    const raw = String(existingDescription || '').trim()
    return raw && !isBareEuroText(raw) ? raw : null
  }
  const raw = String(existingDescription || '').trim()
  if (!raw || isBareEuroText(raw)) return breakdown
  if (descriptionHasInvoiceBreakdown(raw)) return raw
  return `${raw} (${breakdown})`
}

/** Μερική πληρωμή: απλό λεκτικό «πληρωμή 375» (χωρίς Αξία/ΦΠΑ/…). */
export function buildPartialPaymentDescription(displayAmount) {
  const n = Number(displayAmount)
  if (!Number.isFinite(n) || !(n > 0)) return ''
  const rounded = Math.round(n * 100) / 100
  const text =
    Math.abs(rounded - Math.round(rounded)) < 0.001
      ? String(Math.round(rounded))
      : rounded.toLocaleString('el-GR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
  return `πληρωμή ${text}`
}

/** @deprecated use buildPartialPaymentDescription */
export function buildInvoicePartialPaymentDescription(displayAmount) {
  return buildPartialPaymentDescription(displayAmount)
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
    case 26:
      return round2(earningsAmount(e, 'insurance'))
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
 * Fallback: εξόφληση ΤΙΜ χωρίς description → ανάλυση Αξία/ΦΠΑ/Παρ/Πληρωτέο (display-only).
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
  const usableDb = fromDb && !isBareEuroText(fromDb) ? fromDb : ''

  const allowBreakdown =
    context.invoiceGrossUp !== false &&
    context.techIsTemporary !== true &&
    context.simpleVatOnly !== true &&
    isInvoiceSettlementCreditRow(row)

  if (allowBreakdown && !descriptionHasInvoiceBreakdown(usableDb)) {
    const net = Number(row.invoice_credit) || 0
    const breakdown = buildInvoiceBreakdownString(net, context.taxPercent ?? 20)
    if (breakdown) {
      return usableDb ? `${usableDb} (${breakdown})` : breakdown
    }
  }

  return usableDb
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
  const id = Number(row.ept_id ?? row.type_id ?? row.__type?.id)
  if (id === 24) return true
  const label = `${row.type || ''} ${row.__type?.description || ''} ${row.description || ''}`.toLowerCase()
  return label.includes('ticket')
}

/** Ασφάλιση (EPT_ID 26) — ίδια λογική με Ticket Restaurant. */
export function isInsuranceBenefitRow(row) {
  if (!row) return false
  const id = Number(row.ept_id ?? row.type_id ?? row.__type?.id)
  if (id === 26) return true
  const label = `${row.type || ''} ${row.__type?.description || ''} ${row.description || ''}`.toLowerCase()
  return label.includes('ασφάλισ') || label.includes('ασφαλισ') || label === 'insurance'
}

/** Παροχές τύπου Ticket/Ασφάλιση — εκτός Σ/Π/Υ και πίνακα κινήσεων μήνα. */
export function isInformationalBenefitRow(row) {
  return isTicketRestaurantRow(row) || isInsuranceBenefitRow(row)
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
 * Ετήσια μήτρα: Σ/Π/Υ από tech_ledger_view · Ticket/Ασφάλιση οπτικά μόνο σε μήνες με PAYROLL (Δημιουργία).
 * Εκταμίευση 95: μετράει στο Μ/Λ/ΤΙΜ (ανά κατηγορία) · γραμμή «Εκταμίευση» μόνο οπτική.
 * Δόση 94: κράτηση στο συρτάρι · γραμμή «Δάνειο» · ΔΕΝ μετράει στο Π.
 * Μισθός / Λοιπά / Τιμολόγιο: χρέωση − κράτηση δόσης μόνο (όχι εξοφλήσεις) —
 * ώστε να φαίνεται τι είχες σύνολο να πληρώσεις τον μήνα.
 * Υ (ΤΙΜ) / Τιμολόγιο / Π(ΤΙΜ): με προσαύξηση όταν εφαρμόζεται.
 * Σ = Μ + Λ + Τ (χρέωση − κράτηση · Τ με προσαύξηση) + Ticket + Ασφάλιση.
 *
 * @param {object[]} ledgerRows
 * @param {number} year
 * @param {object[]} yearPayrolls
 * @param {{
 *   earningsTicketAmount?: number,
 *   earningsInsuranceAmount?: number,
 *   agreementVersions?: object[],
 *   earningsForm?: object,
 *   techIsTemporary?: boolean,
 * }} [options]
 */
export function buildLedgerYearMatrix(ledgerRows = [], year, yearPayrolls = [], options = {}) {
  const y = Number(year)
  const earningsTicket = Math.round((Number(options?.earningsTicketAmount) || 0) * 100) / 100
  const earningsInsurance = Math.round((Number(options?.earningsInsuranceAmount) || 0) * 100) / 100
  const techIsTemporary = options?.techIsTemporary === true
  const agreementVersions = options?.agreementVersions || []
  const earningsForm = options?.earningsForm || null
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    sigma: 0,
    pi: 0,
    yM: 0,
    yL: 0,
    yTim: 0,
    ticket: 0,
    insurance: 0,
    loan: 0,
    loanCount: 0,
    loanProgress: '',
    disbursement: 0,
    disbursementCount: 0,
    salaryDebit: 0,
    salaryCredit: 0,
    otherDebit: 0,
    otherCredit: 0,
    invoiceDebit: 0,
    invoiceCredit: 0,
    loanInstallmentsCredit: 0,
    loanSalaryCredit: 0,
    loanOtherCredit: 0,
    loanInvoiceCredit: 0,
  }))

  /** Μήνες με payroll ledger (Δημιουργία / αποδοχές) — όχι payments-only. */
  const monthsWithPayrollLedger = new Set()

  for (const row of ledgerRows || []) {
    const { year: yy, month: mm } = ledgerRowPeriod(row)
    if (yy !== y || mm < 1 || mm > 12) continue
    const slot = months[mm - 1]

    // Ticket / Ασφάλιση μόνο από payrolls
    if (isInformationalBenefitRow(row)) continue

    if (String(row.source || '').toUpperCase() === 'PAYROLL') {
      monthsWithPayrollLedger.add(mm)
    }

    const sd = Number(row.salary_debit) || 0
    const sc = Number(row.salary_credit) || 0
    const od = Number(row.other_debit) || 0
    const oc = Number(row.other_credit) || 0
    const id = Number(row.invoice_amount) || 0
    const ic = Number(row.invoice_credit) || 0

    // Εκταμίευση 95: χρέωση στο συρτάρι (Μ/Λ/ΤΙΜ) + οπτική γραμμή
    if (isLoanDisbursementRow(row)) {
      const amt = sd + od + id
      slot.disbursement += amt
      slot.disbursementCount += 1
      slot.salaryDebit += sd
      slot.otherDebit += od
      slot.invoiceDebit += id
      continue
    }

    // Δόση 94: κράτηση στο συρτάρι + γραμμή Δάνειο · όχι στο Π
    if (isLoanInstallmentRow(row)) {
      slot.loanInstallmentsCredit += sc + oc + ic
      slot.loanCount += 1
      const progressLabel =
        extractLoanInstallmentProgress(row.notes) ||
        extractLoanInstallmentProgress(row.description)
      const frac = String(progressLabel).match(/(\d+)\s*\/\s*(\d+)/)
      if (frac) {
        const next = `${frac[1]}/${frac[2]}`
        const prev = String(slot.loanProgress || '').match(/^(\d+)\/(\d+)$/)
        // Κράτα τη μεγαλύτερη τρέχουσα δόση αν υπάρχουν πολλές στον μήνα
        if (
          !prev ||
          Number(frac[1]) > Number(prev[1]) ||
          (Number(frac[1]) === Number(prev[1]) && Number(frac[2]) >= Number(prev[2]))
        ) {
          slot.loanProgress = next
        }
      }
      slot.loanSalaryCredit += sc
      slot.loanOtherCredit += oc
      slot.loanInvoiceCredit += ic
      slot.salaryCredit += sc
      slot.otherCredit += oc
      slot.invoiceCredit += ic
      continue
    }

    slot.salaryDebit += sd
    slot.salaryCredit += sc
    slot.otherDebit += od
    slot.otherCredit += oc
    slot.invoiceDebit += id
    slot.invoiceCredit += ic
  }

  const round2 = (n) => Math.round(n * 100) / 100

  /** net → αξία με προσαύξηση (ίδιο factor με Οδηγό ΤΙΜ / BalanceChip). */
  const grossUpAmount = (amount, taxPercent) => {
    const n = Number(amount) || 0
    if (Math.abs(n) < 0.0005) return 0
    const pct = Number(taxPercent)
    const safePct = Number.isFinite(pct) && pct > 0 ? pct : 20
    const factor = 1 - safePct / 100
    if (!(factor > 0 && factor < 1)) return round2(n)
    return round2(n / factor)
  }

  for (const slot of months) {
    const monthPayrolls = (yearPayrolls || []).filter((p) => {
      const { year: py, month: pm } = payrollRowMonthYear(p)
      return py === y && pm === slot.month
    })
    // Ticket / Ασφάλιση: μόνο οπτικά σε μήνες με Δημιουργία (PAYROLL ledger).
    // Χωρίς payroll_entries → 0 στη μήτρα (ακόμα κι αν υπάρχει ποσό στα payrolls) · χωρίς DB write.
    let ticket = 0
    let insurance = 0
    if (monthsWithPayrollLedger.has(slot.month)) {
      const ticketVals = monthPayrolls.map(
        (p) => Number(p.ticket_restaurant) || Number(p.ticket_amount) || 0
      )
      ticket = round2(ticketVals.length ? Math.max(...ticketVals) : 0)
      if (!(ticket > 0) && earningsTicket > 0) ticket = earningsTicket

      const insuranceVals = monthPayrolls.map(
        (p) => Number(p.insurance) || Number(p.insurance_amount) || 0
      )
      insurance = round2(insuranceVals.length ? Math.max(...insuranceVals) : 0)
      if (!(insurance > 0) && earningsInsurance > 0) insurance = earningsInsurance
    }
    slot.ticket = ticket
    slot.insurance = insurance

    slot.loan = round2(slot.loanInstallmentsCredit || 0)
    slot.disbursement = round2(slot.disbursement || 0)

    const salaryDebit = round2(slot.salaryDebit)
    const salaryCredit = round2(slot.salaryCredit)
    const otherDebit = round2(slot.otherDebit)
    const otherCredit = round2(slot.otherCredit)
    const invoiceDebit = round2(slot.invoiceDebit)
    const invoiceCredit = round2(slot.invoiceCredit)
    const loanSal = round2(slot.loanSalaryCredit || 0)
    const loanOth = round2(slot.loanOtherCredit || 0)
    const loanInv = round2(slot.loanInvoiceCredit || 0)

    // Breakdown: χρέωση − μόνο κράτηση δόσης (όχι εξοφλήσεις) — τι είχες να πληρώσεις
    const salaryDue = round2(salaryDebit - loanSal)
    const otherDue = round2(otherDebit - loanOth)
    const invoiceDueNet = round2(invoiceDebit - loanInv)

    const terms = resolveInvoiceTermsForMonth(
      agreementVersions,
      y,
      slot.month,
      earningsForm
    )
    const applyGrossUp =
      !techIsTemporary &&
      terms.invoiceGrossUp !== false &&
      Number(terms.taxPercent) > 0

    // Τιμολόγιο breakdown: με προσαύξηση όπως Υ (ΤΙΜ) / chip
    const invoiceDue = applyGrossUp
      ? grossUpAmount(invoiceDueNet, terms.taxPercent)
      : invoiceDueNet

    slot.salaryDebit = salaryDue
    slot.otherDebit = otherDue
    slot.invoiceDebit = invoiceDue
    slot.salaryCredit = salaryCredit
    slot.otherCredit = otherCredit
    slot.invoiceCredit = invoiceCredit

    // Υ = χρέωση − όλες οι πιστώσεις (εξοφλήσεις + κράτηση)
    const yM = round2(salaryDebit - salaryCredit)
    const yL = round2(otherDebit - otherCredit)
    const yTimNet = round2(invoiceDebit - invoiceCredit)

    slot.yM = yM
    slot.yL = yL
    // Υ (ΤΙΜ): με προσαύξηση όπως το chip / Οδηγός
    slot.yTim = applyGrossUp ? grossUpAmount(yTimNet, terms.taxPercent) : yTimNet
    slot._yTimNet = yTimNet
    // Σ = Μ + Λ + Τ (Τ με προσαύξηση) + Ticket + Ασφάλιση
    slot.sigma = round2(salaryDue + otherDue + invoiceDue + ticket + insurance)
    // Π: Μ/Λ καθαρά · ΤΙΜ εξοφλήσεις με προσαύξηση · χωρίς δόσεις 94
    const salaryPay = round2(salaryCredit - loanSal)
    const otherPay = round2(otherCredit - loanOth)
    const invoicePayNet = round2(invoiceCredit - loanInv)
    const invoicePay = applyGrossUp
      ? grossUpAmount(invoicePayNet, terms.taxPercent)
      : invoicePayNet
    slot.pi = round2(salaryPay + otherPay + invoicePay)
  }

  const totals = months.reduce(
    (acc, m) => ({
      sigma: round2(acc.sigma + m.sigma),
      pi: round2(acc.pi + m.pi),
      yM: round2(acc.yM + m.yM),
      yL: round2(acc.yL + m.yL),
      yTim: round2(acc.yTim + m.yTim),
      ticket: round2(acc.ticket + m.ticket),
      insurance: round2(acc.insurance + m.insurance),
      loan: round2(acc.loan + m.loan),
      loanCount: acc.loanCount + (m.loanCount || 0),
      disbursement: round2(acc.disbursement + (m.disbursement || 0)),
      disbursementCount: acc.disbursementCount + (m.disbursementCount || 0),
      salaryDebit: round2(acc.salaryDebit + m.salaryDebit),
      otherDebit: round2(acc.otherDebit + m.otherDebit),
      invoiceDebit: round2(acc.invoiceDebit + m.invoiceDebit),
    }),
    {
      sigma: 0,
      pi: 0,
      yM: 0,
      yL: 0,
      yTim: 0,
      ticket: 0,
      insurance: 0,
      loan: 0,
      loanCount: 0,
      disbursement: 0,
      disbursementCount: 0,
      salaryDebit: 0,
      otherDebit: 0,
      invoiceDebit: 0,
    }
  )

  const monthsWithEarnings = months.filter((m) => m.sigma > 0)
  const avg =
    monthsWithEarnings.length > 0
      ? round2(totals.sigma / monthsWithEarnings.length)
      : 0

  const selectedSettled = (month) => {
    const m = months[month - 1]
    if (!m || m.sigma <= 0) return false
    const yTim = m._yTimNet != null ? m._yTimNet : m.yTim
    return Math.abs(m.yM) + Math.abs(m.yL) + Math.abs(yTim) < 0.015
  }

  const yearSettled =
    totals.sigma > 0 &&
    (() => {
      let yTimNetSum = 0
      for (const m of months) {
        yTimNetSum += Number(m._yTimNet != null ? m._yTimNet : m.yTim) || 0
      }
      return Math.abs(totals.yM) + Math.abs(totals.yL) + Math.abs(round2(yTimNetSum)) < 0.015
    })()

  return { months, totals, avg, selectedSettled, yearSettled }
}

/**
 * Υπόλοιπα από γραμμές ledger μήνα (όπως εμφανίζονται στο grid).
 * Υπόλοιπο (Μ) = Μισθός Χρ. − Μισθός Πιστ.
 * Υπόλοιπο (Λ) = Λοιπά Χρ. − Λοιπά Πιστ.
 * Υπόλοιπο (ΤΙΜ) = invoice_amount (Χρ.) − invoice_credit (Πιστ.).
 * invoiceDebit = ΤΙΜ Χρ. − κράτηση δόσης στο ΤΙΜ (βάση Οδηγού / ίδια με μήτρα πριν την προσαύξηση).
 * Υπόλοιπο = (Μ) + (Λ) + (ΤΙΜ).
 * Ticket Restaurant / Ασφάλιση δεν συμμετέχουν.
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
  let loanInvoiceCredit = 0
  let y1 = 0
  let y2 = 0

  for (const r of rows) {
    if (isInformationalBenefitRow(r)) continue

    const id = Number(r.invoice_amount) || 0
    const ic = Number(r.invoice_credit) || 0

    salaryDebit += Number(r.salary_debit) || 0
    salaryCredit += Number(r.salary_credit) || 0
    otherDebit += Number(r.other_debit) || 0
    otherCredit += Number(r.other_credit) || 0
    invoiceDebit += id
    invoiceCredit += ic

    if (isLoanInstallmentRow(r)) {
      loanInvoiceCredit += ic
    }

    if (r.type === 'SETTLEMENT_1') {
      y1 += Number(r.salary_credit) || Number(r.invoice_credit) || 0
    }
    if (r.type === 'SETTLEMENT_2') y2 += Number(r.other_credit) || 0
  }

  const round2 = (n) => Math.round(n * 100) / 100
  const balance1 = round2(salaryDebit - salaryCredit)
  const balance2 = round2(otherDebit - otherCredit)
  const invoice = round2(invoiceDebit - invoiceCredit)
  // Οδηγός / μήτρα: χρεώσεις μείον κράτηση δόσης ΤΙΜ (όχι εξοφλήσεις)
  const invoiceDueNet = round2(invoiceDebit - loanInvoiceCredit)

  return {
    balance1,
    balance2,
    invoice,
    invoiceDebit: invoiceDueNet,
    balance: round2(balance1 + balance2 + invoice),
    y1: round2(y1),
    y2: round2(y2),
  }
}
