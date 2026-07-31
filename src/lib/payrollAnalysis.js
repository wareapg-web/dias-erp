const MONTH_SHORT = [
  'Ιαν',
  'Φεβ',
  'Μαρ',
  'Απρ',
  'Μάι',
  'Ιούν',
  'Ιούλ',
  'Αύγ',
  'Σεπ',
  'Οκτ',
  'Νοέ',
  'Δεκ',
]

export const MONTH_LABELS = [
  'Ιανουάριος',
  'Φεβρουάριος',
  'Μάρτιος',
  'Απρίλιος',
  'Μάιος',
  'Ιούνιος',
  'Ιούλιος',
  'Αύγουστος',
  'Σεπτέμβριος',
  'Οκτώβριος',
  'Νοέμβριος',
  'Δεκέμβριος',
]

export { MONTH_SHORT }

export function splitTechName(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return { lastName: '-', firstName: '-' }
  if (parts.length === 1) return { lastName: parts[0], firstName: '-' }
  return { lastName: parts[0], firstName: parts.slice(1).join(' ') }
}

export function techPhotoUrl(tech) {
  if (!tech) return null
  return (
    tech.photo_url ||
    tech.photo ||
    tech.avatar_url ||
    tech.image_url ||
    tech.profile_photo ||
    null
  )
}

export function techHireDate(tech) {
  if (!tech) return null
  const raw =
    tech.hire_date || tech.hired_at || tech.date_hired || tech.proslipsi || tech.start_date
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  return d.toLocaleDateString('el-GR')
}

function parseClockToMinutes(value) {
  if (!value || value === '-') return null
  const match = String(value).match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function hoursBetween(timeStart, timeEnd) {
  const start = parseClockToMinutes(timeStart)
  const end = parseClockToMinutes(timeEnd)
  if (start == null || end == null) return 0
  let diff = end - start
  if (diff < 0) diff += 24 * 60
  return Math.round((diff / 60) * 100) / 100
}

function periodPrefix(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function estimateAmount(tech, workDays, hours) {
  const base = Number(tech?.base_salary) || 0
  const rate = Number(tech?.overtime_rate) || 0
  if (base > 0 && workDays > 0) return Math.round((base / 25) * workDays * 100) / 100
  if (rate > 0 && hours > 0) return Math.round(rate * hours * 100) / 100
  return 0
}

/**
 * Builds 12-month matrix + movements from Admin App assignments / daily_status.
 */
export function buildTechYearAnalysis(tech, year, assignments, jobs, dailyStatus) {
  const jobNames = new Map((jobs || []).map((j) => [j.group_id || j.groupId, j.name]))
  const techName = tech?.name

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const prefix = periodPrefix(year, month)
    const monthAssignments = (assignments || []).filter(
      (a) => a.tech === techName && String(a.date_iso || a.dateIso || '').startsWith(prefix)
    )
    const monthStatuses = (dailyStatus || []).filter(
      (d) => d.tech === techName && String(d.date_iso || d.dateIso || '').startsWith(prefix)
    )

    const workDates = new Set()
    let hours = 0

    for (const a of monthAssignments) {
      const dateIso = a.date_iso || a.dateIso
      if (dateIso) workDates.add(dateIso)
      hours += hoursBetween(a.time_start || a.timeStart, a.time_end || a.timeEnd)
    }

    for (const d of monthStatuses) {
      const status = String(d.status || '').toLowerCase()
      const dateIso = d.date_iso || d.dateIso
      if (dateIso && (status.includes('εργ') || status === 'work' || status === '')) {
        workDates.add(dateIso)
      }
      hours += hoursBetween(d.t_start || d.tStart, d.t_end || d.tEnd)
    }

    const days = workDates.size
    const amount = estimateAmount(tech, days, hours)

    return { month, days, hours: Math.round(hours * 100) / 100, amount }
  })

  const totals = months.reduce(
    (acc, m) => ({
      days: acc.days + m.days,
      hours: Math.round((acc.hours + m.hours) * 100) / 100,
      amount: Math.round((acc.amount + m.amount) * 100) / 100,
    }),
    { days: 0, hours: 0, amount: 0 }
  )

  return { months, totals, jobNames }
}

export function buildMonthMovements(tech, year, month, assignments, jobs, dailyStatus) {
  const prefix = periodPrefix(year, month)
  const techName = tech?.name
  const jobNames = new Map((jobs || []).map((j) => [j.group_id || j.groupId, j.name]))
  const rows = []

  for (const a of assignments || []) {
    const dateIso = a.date_iso || a.dateIso || ''
    if (a.tech !== techName || !dateIso.startsWith(prefix)) continue
    const hours = hoursBetween(a.time_start || a.timeStart, a.time_end || a.timeEnd)
    const jobId = a.job_id || a.jobId
    const timeStart = a.time_start || a.timeStart || ''
    const timeEnd = a.time_end || a.timeEnd || ''
    rows.push({
      id: `a-${a.id || dateIso}-${jobId}`,
      date: dateIso,
      tech: techName,
      type: 'Εργασία',
      description: jobNames.get(jobId) || jobId || 'Έργο',
      jobOrStatus: jobNames.get(jobId) || jobId || 'Έργο',
      phase: a.phase || '-',
      timeStart,
      timeEnd,
      amount: estimateAmount(tech, 1, hours),
      hours,
    })
  }

  for (const d of dailyStatus || []) {
    const dateIso = d.date_iso || d.dateIso || ''
    if (d.tech !== techName || !dateIso.startsWith(prefix)) continue
    const status = d.status || 'Κατάσταση'
    // Skip pure work placeholders already covered by assignments when status is empty
    if (!status) continue
    const timeStart = d.t_start || d.tStart || ''
    const timeEnd = d.t_end || d.tEnd || ''
    const hours = hoursBetween(timeStart, timeEnd)
    rows.push({
      id: `d-${d.id || dateIso}-${status}`,
      date: dateIso,
      tech: techName,
      type: 'Κατάσταση',
      description: status,
      jobOrStatus: status,
      phase: '-',
      timeStart,
      timeEnd,
      amount: estimateAmount(tech, status.toLowerCase().includes('εργ') ? 1 : 0, hours),
      hours,
    })
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return rows
}

export function formatEuro(value) {
  const n = Number(value) || 0
  return n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' })
}

/** Greek number without currency symbol (όπως παλιό ERP μήτρα). */
export function formatEuroPlain(value) {
  const n = Number(value) || 0
  if (!n) return ''
  return n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Ticket Restaurant στη μήτρα: ποσό αν > 0, αλλιώς παύλα. */
export function formatMatrixTicket(value) {
  const n = Number(value) || 0
  if (n <= 0) return '-'
  return formatEuroPlain(n)
}

function payrollMatchesTech(payroll, tech) {
  if (!tech || !payroll) return false
  return (
    String(payroll.tech_id ?? '') === String(tech.id ?? '') ||
    payroll.tech_name === tech.name ||
    payroll.technician_name === tech.name ||
    payroll.name === tech.name
  )
}

function payrollMonthYear(payroll) {
  const period = String(payroll.period || '')
  if (/^\d{4}-\d{2}/.test(period)) {
    const [y, m] = period.split('-')
    return { year: Number(y), month: Number(m) }
  }
  return {
    year: Number(payroll.year) || 0,
    month: Number(payroll.month) || 0,
  }
}

function moneyField(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') {
      const n = Number(row[key])
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

function isPayrollSettled(row) {
  const status = String(row.status || row.payment_status || row.state || '').toLowerCase()
  return (
    status.includes('εξοφλ') ||
    status.includes('paid') ||
    status.includes('settled') ||
    row.paid === true ||
    row.is_paid === true
  )
}

/**
 * Ετήσια μήτρα απολαβών όπως παλιό ERP:
 * Σ = σύνολο απολαβών μήνα, Π = πληρωμές, Υ(1)/Υ(2) = εξοφλήσεις.
 * Ticket Restaurant από payrolls.ticket_restaurant (ανεξάρτητο — ΔΕΝ μπαίνει στο Σ / totals.sigma).
 * Fallback: μόνο για τον selectedMonth χωρίς payroll row → tech_earnings.ticket_amount.
 */
export function buildSalaryYearMatrix(
  tech,
  year,
  payrolls = [],
  estimatedByMonth = [],
  ticketOptions = {}
) {
  const selectedMonth = Number(ticketOptions?.selectedMonth) || 0
  const earningsTicket = Math.round((Number(ticketOptions?.earningsTicketAmount) || 0) * 100) / 100

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const rows = (payrolls || []).filter((p) => {
      if (!payrollMatchesTech(p, tech)) return false
      const { year: y, month: m } = payrollMonthYear(p)
      return y === Number(year) && m === month
    })

    const sigmaSaved = rows.reduce(
      (sum, p) =>
        sum + moneyField(p, ['amount', 'total', 'salary', 'net_amount', 'gross', 'gross_amount']),
      0
    )
    let pi = rows.reduce(
      (sum, p) => sum + moneyField(p, ['paid_amount', 'payment_amount', 'pliromi']),
      0
    )
    const y1 = rows.reduce(
      (sum, p) => sum + moneyField(p, ['settlement_1', 'exofisi_1', 'exofili_1', 'y1']),
      0
    )
    const y2 = rows.reduce(
      (sum, p) => sum + moneyField(p, ['settlement_2', 'exofisi_2', 'exofili_2', 'y2']),
      0
    )

    const estimated = Number(estimatedByMonth[i]?.amount) || 0
    const sigma = sigmaSaved > 0 ? Math.round(sigmaSaved * 100) / 100 : estimated

    // Ticket: ένα ποσό/μήνα — ΟΧΙ άθροισμα πολλαπλών payroll rows
    let ticketSaved = 0
    for (const p of rows) {
      const t = moneyField(p, ['ticket_restaurant', 'ticket_amount'])
      if (t > ticketSaved) ticketSaved = t
    }
    let ticket = 0
    if (rows.length > 0) {
      // Υπάρχει payroll μήνα → μόνο η τιμή από payroll (ακόμα κι αν 0 → παύλα)
      ticket = Math.round(ticketSaved * 100) / 100
    } else if (month === selectedMonth && earningsTicket > 0) {
      ticket = earningsTicket
    }

    if (pi <= 0 && rows.length > 0) {
      if (rows.some(isPayrollSettled)) pi = sigmaSaved
      else if (sigmaSaved > 0) pi = sigmaSaved // αποθήκευση ERP = καταγεγραμμένη πληρωμή bridge
    }

    return {
      month,
      sigma: Math.round(sigma * 100) / 100,
      pi: Math.round(pi * 100) / 100,
      y1: Math.round(y1 * 100) / 100,
      y2: Math.round(y2 * 100) / 100,
      ticket,
      hasPayroll: rows.length > 0,
      provisional: sigmaSaved <= 0 && estimated > 0,
    }
  })

  const totals = months.reduce(
    (acc, m) => ({
      sigma: Math.round((acc.sigma + m.sigma) * 100) / 100,
      pi: Math.round((acc.pi + m.pi) * 100) / 100,
      y1: Math.round((acc.y1 + m.y1) * 100) / 100,
      y2: Math.round((acc.y2 + m.y2) * 100) / 100,
      // Σύνολο γραμμής Ticket — όχι μέσα στο sigma
      ticket: Math.round((acc.ticket + m.ticket) * 100) / 100,
    }),
    { sigma: 0, pi: 0, y1: 0, y2: 0, ticket: 0 }
  )

  const monthsWithPay = months.filter((m) => m.sigma > 0)
  const avg =
    monthsWithPay.length > 0
      ? Math.round((totals.sigma / monthsWithPay.length) * 100) / 100
      : 0

  const selectedSettled = (month) => {
    const m = months[month - 1]
    if (!m || m.sigma <= 0) return false
    return m.pi + m.y1 + m.y2 >= m.sigma - 0.01
  }

  const yearSettled =
    totals.sigma > 0 && totals.pi + totals.y1 + totals.y2 >= totals.sigma - 0.01

  return { months, totals, avg, selectedSettled, yearSettled }
}

export { estimateAmount }

