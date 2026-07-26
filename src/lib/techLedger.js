/** tech_ledger_view helpers — Μηνιαία Ανάλυση καρτέλας */

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
    SETTLEMENT: 'Εξόφληση',
    SETTLEMENT_1: 'Εξόφληση (1)',
    SETTLEMENT_2: 'Εξόφληση (2)',
    EXPENSES: 'Έξοδα',
    BONUS_PAYOUT: 'Πληρωμή Bonus',
  }
  return map[type] || type || '—'
}

export function formatLedgerAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return new Intl.NumberFormat('el-GR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Ποσό από τις 4 στήλες ledger (μη μηδενική, συμπεριλαμβανομένων αρνητικών). */
export function extractLedgerAmount(row) {
  if (!row) return { amount: 0, bucket: 'salary_debit' }
  const cols = [
    ['salary_debit', Number(row.salary_debit) || 0],
    ['salary_credit', Number(row.salary_credit) || 0],
    ['other_debit', Number(row.other_debit) || 0],
    ['other_credit', Number(row.other_credit) || 0],
  ]
  const hit = cols.find(([, v]) => v !== 0)
  if (!hit) return { amount: 0, bucket: 'salary_debit' }
  return { amount: hit[1], bucket: hit[0] }
}

export function isSalaryBucket(bucket) {
  return bucket === 'salary_debit' || bucket === 'salary_credit'
}

/** Form state από ledger row (ή κενό για INSERT). */
export function movementFormFromRow(row) {
  if (!row) {
    return {
      id: null,
      source: 'PAYROLL',
      entry_date: new Date().toISOString().slice(0, 10),
      type: 'HOLIDAY',
      description: '',
      amount: '',
      notes: '',
      is_salary_type: false,
    }
  }
  const { amount, bucket } = extractLedgerAmount(row)
  return {
    id: row.id,
    source: row.source || 'PAYROLL',
    entry_date: row.entry_date || new Date().toISOString().slice(0, 10),
    type: row.type || '',
    description: row.description || '',
    amount: String(amount),
    notes: row.notes || '',
    is_salary_type: isSalaryBucket(bucket),
  }
}

export function parseMovementAmount(value) {
  if (value === '' || value == null) throw new Error('Συμπλήρωσε ποσό')
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error('Μη έγκυρο ποσό')
  return n
}

/** Υπόλοιπα από γραμμές ledger μήνα */
export function computeLedgerBalances(rows = []) {
  let salaryDebit = 0
  let salaryCredit = 0
  let otherDebit = 0
  let otherCredit = 0
  let y1 = 0
  let y2 = 0

  for (const r of rows) {
    salaryDebit += Number(r.salary_debit) || 0
    salaryCredit += Number(r.salary_credit) || 0
    otherDebit += Number(r.other_debit) || 0
    otherCredit += Number(r.other_credit) || 0
    if (r.type === 'SETTLEMENT_1') y1 += Number(r.salary_credit) || 0
    if (r.type === 'SETTLEMENT_2') y2 += Number(r.other_credit) || 0
  }

  const round2 = (n) => Math.round(n * 100) / 100
  return {
    balance: round2(salaryDebit + otherDebit - salaryCredit - otherCredit),
    balance1: round2(salaryDebit - salaryCredit),
    balance2: round2(otherDebit - otherCredit),
    y1: round2(y1),
    y2: round2(y2),
  }
}
