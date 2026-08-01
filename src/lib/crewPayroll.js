/**
 * Port of admin-app crewLogic payroll engine (main45.py / buildMonthlyPayroll).
 * Same rules: night hours, Greek holidays + Orthodox Easter, OT >8h, weekend 4h gift.
 */

function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

export function getOrthodoxEaster(year) {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  const julian = new Date(year, month - 1, day)
  julian.setDate(julian.getDate() + 13)
  return julian
}

function parseTime(t) {
  const parts = String(t || '').trim().split(':')
  if (parts.length < 2) return null
  const h = Number.parseInt(parts[0], 10)
  const m = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return { h, m }
}

function overlap(s, e, ws, we) {
  return Math.max(0, Math.min(e, we) - Math.max(s, ws))
}

/** global_calc_hours from main45.py
 * @param {object} [options]
 * @param {number} [options.otThreshold=8] κατώφλι υπερωρίας (π.χ. από Αποδοχές overtime_from)
 */
export function globalCalcHours(dateIso, tStart, tEnd, options = {}) {
  if (!tStart || !tEnd || tStart === '-' || tEnd === '-') {
    return { total: 0, night: 0, holiday: 0, overtime: 0 }
  }
  const t1 = parseTime(tStart)
  const t2 = parseTime(tEnd)
  if (!t1 || !t2) return { total: 0, night: 0, holiday: 0, overtime: 0 }

  let endMin = t2.h * 60 + t2.m
  const startMin = t1.h * 60 + t1.m
  if (endMin <= startMin) endMin += 24 * 60

  const totHrs = (endMin - startMin) / 60
  const sHrs = t1.h + t1.m / 60
  const eHrs = sHrs + totHrs
  const nightHrs = overlap(sHrs, eHrs, 0, 6) + overlap(sHrs, eHrs, 22, 30)

  const dt = new Date(dateIso + 'T12:00:00')
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
  const y = dt.getFullYear()
  const fixed = ['01-01', '01-06', '03-25', '05-01', '08-15', '10-28', '12-25', '12-26']
  const easter = getOrthodoxEaster(y)
  const fmt = (d) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const mobile = new Date(easter)
  mobile.setDate(mobile.getDate() - 48)
  const goodFriday = new Date(easter)
  goodFriday.setDate(goodFriday.getDate() - 2)
  const easterMon = new Date(easter)
  easterMon.setDate(easterMon.getDate() + 1)
  const holySpirit = new Date(easter)
  holySpirit.setDate(holySpirit.getDate() + 50)
  const mmdd = dateIso.slice(5)
  const isHoliday =
    fixed.includes(mmdd) ||
    [mobile, goodFriday, easterMon, holySpirit].some((d) => fmt(d) === mmdd)

  const thrRaw = Number(options?.otThreshold)
  const otThreshold = Number.isFinite(thrRaw) && thrRaw > 0 ? thrRaw : 8

  const holHrs = isWeekend || isHoliday ? totHrs : 0
  const otHrs = !isWeekend && !isHoliday ? Math.max(0, totHrs - otThreshold) : 0

  return { total: totHrs, night: nightHrs, holiday: holHrs, overtime: otHrs }
}

export function isMidnightCrossing(tStart, tEnd) {
  if (!tStart || !tEnd || tStart === '-' || tEnd === '-') return false
  return tEnd < tStart && tEnd !== '00:00'
}

export function nextDateIso(dateIso) {
  const d = new Date(dateIso + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizePayrollJobKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
}

function isEtairiaStatus(status) {
  const s = String(status || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  return s === 'ΕΤΑΙΡΙΑ' || s === 'ETAIRIA'
}

export function dailyStatusSlotKey(tech, dateIso, status) {
  return `${tech}\0${dateIso}\0${String(status || '').trim()}`
}

function mergeDailyStatusRows(rows) {
  if (rows.length === 1) return rows[0]
  const receiptUrls = []
  const seen = new Set()
  for (const row of rows) {
    for (const url of row.receiptUrls || []) {
      const trimmed = String(url || '').trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      receiptUrls.push(trimmed)
    }
  }
  const primary =
    rows.find((r) => (r.receiptUrls || []).length > 0) ||
    rows.find((r) => r.status?.trim() && r.status !== 'ΕΤΑΙΡΙΑ') ||
    rows.find((r) => r.tStart || r.tEnd) ||
    rows[0]
  return {
    ...primary,
    receiptUrls,
    receiptUrl: receiptUrls[0] ?? primary.receiptUrl ?? '',
  }
}

export function dailyStatusByTechDate(dailyStatus) {
  const groups = new Map()
  for (const row of dailyStatus) {
    const key = dailyStatusSlotKey(row.tech, row.dateIso, row.status)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  const merged = new Map()
  for (const [key, rows] of groups) {
    merged.set(key, rows.length === 1 ? rows[0] : mergeDailyStatusRows(rows))
  }
  return merged
}

function dailyStatusesOnDate(statusByKey, tech, dateIso) {
  const prefix = `${tech}\0${dateIso}\0`
  const rows = []
  for (const [key, row] of statusByKey) {
    if (key.startsWith(prefix)) rows.push(row)
  }
  return rows.sort((a, b) => a.status.localeCompare(b.status, 'el'))
}

export function isSchedulableTech(role) {
  const r = String(role || '').toUpperCase()
  return (
    r.includes('APG SA') ||
    r.includes('ΣΚΗΝ') ||
    r.includes('ΟΔΗΓ') ||
    r.includes('ΑΡΧ')
  )
}

function shiftTimeKey(timeStart, timeEnd) {
  return `${timeStart}|${timeEnd}`
}

/** Map raw Supabase rows → payroll engine shapes */
export function mapAssignmentRow(r) {
  return {
    id: r.id,
    jobId: r.job_id ?? r.jobId,
    tech: r.tech,
    dateIso: r.date_iso ?? r.dateIso,
    phase: r.phase || 'Play',
    timeStart: r.time_start ?? r.timeStart ?? '',
    timeEnd: r.time_end ?? r.timeEnd ?? '',
    metro: Boolean(r.metro),
    overnight: Boolean(r.overnight),
  }
}

export function mapDailyStatusRow(r) {
  const urls = Array.isArray(r.receipt_urls)
    ? r.receipt_urls
    : Array.isArray(r.receiptUrls)
      ? r.receiptUrls
      : []
  const receiptUrl = urls[0] ?? r.receipt_url ?? r.receiptUrl ?? ''
  return {
    id: r.id,
    dateIso: r.date_iso ?? r.dateIso,
    tech: r.tech,
    status: r.status || 'ΕΤΑΙΡΙΑ',
    tStart: r.t_start ?? r.tStart ?? '',
    tEnd: r.t_end ?? r.tEnd ?? '',
    metro: Boolean(r.metro),
    overnight: Boolean(r.overnight),
    receiptUrls: urls.length ? urls : receiptUrl ? [receiptUrl] : [],
    receiptUrl,
  }
}

export function mapJobRow(r) {
  return {
    groupId: r.group_id ?? r.groupId,
    name: r.name,
  }
}

export function mapTechRow(r) {
  return {
    id: r.id,
    name: r.name,
    role: r.role ?? '',
    is_active: r.is_active,
    base_salary: r.base_salary,
    overtime_rate: r.overtime_rate,
    initials: r.initials,
    photo_url: r.photo_url,
    hire_date: r.hire_date,
  }
}

/**
 * Port of export_payroll() / buildMonthlyPayroll from admin-app crewLogic.ts
 */
export function buildMonthlyPayroll(tech, year, month, assignments, jobs, dailyRows) {
  const targetPrefix = `${year}-${String(month).padStart(2, '0')}`
  const jobNames = new Map(jobs.map((j) => [j.groupId, j.name]))
  const techAssigns = assignments.filter(
    (a) => a.tech === tech.name && a.dateIso.startsWith(targetPrefix)
  )
  const assignByDate = new Map()
  for (const a of techAssigns) {
    const list = assignByDate.get(a.dateIso) ?? []
    list.push({
      dateIso: a.dateIso,
      jobName: jobNames.get(a.jobId) ?? a.jobId,
      phase: a.phase,
      timeStart: a.timeStart,
      timeEnd: a.timeEnd,
      metro: a.metro,
      overnight: a.overnight,
    })
    assignByDate.set(a.dateIso, list)
  }

  const statusByDate = dailyStatusByTechDate(
    dailyRows.filter((d) => d.tech === tech.name && d.dateIso.startsWith(targetPrefix))
  )

  const rows = []
  let sumTot = 0
  let sumNight = 0
  let sumHol = 0
  let sumOt = 0
  let sumBonus = 0
  let sumMetro = 0
  let sumOvernight = 0
  let sumDays = 0
  let sumRepo = 0
  let sumAdeia = 0
  let sumAsth = 0

  const daysInMonth = getDaysInMonth(new Date(year, month - 1, 1))
  const lastDayIso = `${targetPrefix}-${String(daysInMonth).padStart(2, '0')}`
  const spillovers = new Map()

  const emptyHourFields = () => ({
    workedHours: 0,
    nightHours: 0,
    overtime: 0,
    weekendHolidayHours: 0,
    weekendBonus: 0,
  })

  const queueSpillover = (dateIso, shift) => {
    const list = spillovers.get(dateIso) ?? []
    list.push(shift)
    spillovers.set(dateIso, list)
  }

  const emitTimedRow = (dIso, shift, state) => {
    const { timeStart, timeEnd } = shift
    if (!timeStart || !timeEnd || timeStart === '-' || timeEnd === '-') {
      rows.push({
        tech: tech.name,
        dateIso: dIso,
        jobOrStatus: shift.jobOrStatus,
        status: shift.status,
        phase: shift.phase,
        timeStart,
        timeEnd,
        metro: shift.metro,
        overnight: shift.overnight,
        receiptUrl: shift.receiptUrl,
        ...emptyHourFields(),
      })
      return state
    }

    const h = globalCalcHours(dIso, timeStart, timeEnd)
    const prevRunning = state.runningDailyHours
    const nextRunning = prevRunning + h.total

    let lineOt = 0
    if (!state.otExemptDay) {
      lineOt = Math.max(0, nextRunning - Math.max(8, prevRunning))
    }

    if (shift.metro) sumMetro += 1
    if (shift.overnight) sumOvernight += 1

    rows.push({
      tech: tech.name,
      dateIso: dIso,
      jobOrStatus: shift.jobOrStatus,
      status: shift.status,
      phase: shift.phase,
      timeStart,
      timeEnd,
      metro: shift.metro,
      overnight: shift.overnight,
      receiptUrl: shift.receiptUrl,
      workedHours: Math.round(h.total * 100) / 100,
      nightHours: Math.round(h.night * 100) / 100,
      overtime: Math.round(lineOt * 100) / 100,
      weekendHolidayHours: Math.round(h.holiday * 100) / 100,
      weekendBonus: 0,
    })

    return {
      runningDailyHours: nextRunning,
      otExemptDay: state.otExemptDay,
      dayTH: state.dayTH + h.total,
      dayNH: state.dayNH + h.night,
      dayHH: state.dayHH + h.holiday,
      dayOTH: state.dayOTH + lineOt,
      workedToday: true,
    }
  }

  const processPendingShift = (dIso, shift, claimedSlots, state) => {
    const tStart = shift.timeStart
    const tEnd = shift.timeEnd

    if (isMidnightCrossing(tStart, tEnd)) {
      const todayKey = shiftTimeKey(tStart, '24:00')
      if (claimedSlots.has(todayKey)) return state
      claimedSlots.add(todayKey)

      const continuationLabel = shift.jobOrStatus.includes('(Συνέχεια)')
        ? shift.jobOrStatus
        : `${shift.jobOrStatus} (Συνέχεια)`
      const tomorrowKey = shiftTimeKey('00:00', tEnd)
      const nextIso = nextDateIso(dIso)
      const existingSpill = spillovers.get(nextIso) ?? []
      const alreadyQueued = existingSpill.some(
        (s) => shiftTimeKey(s.timeStart, s.timeEnd) === tomorrowKey
      )
      if (!alreadyQueued) {
        queueSpillover(nextIso, {
          jobOrStatus: continuationLabel,
          status: shift.status,
          phase: shift.phase,
          timeStart: '00:00',
          timeEnd: tEnd,
          metro: false,
          overnight: false,
          receiptUrl: '',
        })
      }

      return emitTimedRow(dIso, { ...shift, timeEnd: '24:00' }, state)
    }

    const key = shiftTimeKey(tStart, tEnd)
    if (tStart && tEnd && tStart !== '-' && tEnd !== '-' && claimedSlots.has(key)) {
      return state
    }
    if (tStart && tEnd && tStart !== '-' && tEnd !== '-') {
      claimedSlots.add(key)
    }
    return emitTimedRow(dIso, shift, state)
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dIso = `${targetPrefix}-${String(day).padStart(2, '0')}`
    const jobsToday = assignByDate.get(dIso) ?? []
    const dailyToday = dailyStatusesOnDate(statusByDate, tech.name, dIso)

    const dt = new Date(dIso + 'T12:00:00')
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
    const dayProbe = globalCalcHours(dIso, '09:00', '17:00')
    const otExemptDay = dayProbe.holiday > 0

    const claimedSlots = new Set()
    let state = {
      runningDailyHours: 0,
      otExemptDay,
      dayTH: 0,
      dayNH: 0,
      dayHH: 0,
      dayOTH: 0,
      workedToday: false,
    }
    let dayStatusLabel = dailyToday[0]?.status ?? 'ΕΤΑΙΡΙΑ'

    const countStatusDay = (status) => {
      const stUp = status.toUpperCase()
      if (stUp.includes('ΡΕΠΟ')) sumRepo += 1
      else if (stUp.includes('ΑΔΕΙΑ')) sumAdeia += 1
      else if (stUp.includes('ΑΣΘΕΝ') || stUp.includes('ΑΝΑΡΡ')) sumAsth += 1
    }

    const todaySpillovers = spillovers.get(dIso) ?? []
    spillovers.delete(dIso)
    for (const spill of todaySpillovers) {
      dayStatusLabel = spill.status || dayStatusLabel
      state = processPendingShift(dIso, spill, claimedSlots, state)
    }

    if (jobsToday.length === 0) {
      if (dailyToday.length === 0) {
        if (!isWeekend && !state.workedToday) {
          rows.push({
            tech: tech.name,
            dateIso: dIso,
            jobOrStatus: 'ΕΤΑΙΡΙΑ',
            status: 'ΕΤΑΙΡΙΑ',
            phase: '-',
            timeStart: '',
            timeEnd: '',
            metro: false,
            overnight: false,
            receiptUrl: '',
            ...emptyHourFields(),
          })
        }
      } else {
        for (const sData of dailyToday) {
          const status = sData.status || 'ΕΤΑΙΡΙΑ'
          const ts = sData.tStart ?? ''
          const te = sData.tEnd ?? ''
          const hasContent = Boolean(ts || te || status !== 'ΕΤΑΙΡΙΑ')
          if (!isWeekend || hasContent) {
            dayStatusLabel = status
            state = processPendingShift(
              dIso,
              {
                jobOrStatus: status,
                status,
                phase: '-',
                timeStart: ts,
                timeEnd: te,
                metro: sData.metro,
                overnight: sData.overnight,
                receiptUrl: sData.receiptUrl ?? '',
              },
              claimedSlots,
              state
            )
            if (!ts && !te && status !== 'ΕΤΑΙΡΙΑ') countStatusDay(status)
          }
        }
      }
    } else {
      const usedDailyKeys = new Set()

      const takeMatchingDaily = (jobName) => {
        const jobKey = normalizePayrollJobKey(jobName)
        for (const d of dailyToday) {
          const key = dailyStatusSlotKey(tech.name, dIso, d.status)
          if (usedDailyKeys.has(key)) continue
          if (normalizePayrollJobKey(d.status) !== jobKey) continue
          usedDailyKeys.add(key)
          return d
        }
        return undefined
      }

      for (const r of jobsToday) {
        const matched = takeMatchingDaily(r.jobName)
        const rowStatus = matched?.status ?? 'ΕΤΑΙΡΙΑ'
        const timeStart = matched?.tStart || r.timeStart
        const timeEnd = matched?.tEnd || r.timeEnd
        const rowMetro = matched ? matched.metro : r.metro
        const rowOvernight = matched ? matched.overnight : r.overnight
        const rowReceiptUrl = matched?.receiptUrl ?? ''

        if (matched) dayStatusLabel = rowStatus

        state = processPendingShift(
          dIso,
          {
            jobOrStatus: r.jobName,
            status: rowStatus,
            phase: r.phase,
            timeStart,
            timeEnd,
            metro: rowMetro,
            overnight: rowOvernight,
            receiptUrl: rowReceiptUrl,
          },
          claimedSlots,
          state
        )
      }

      for (const sData of dailyToday) {
        const key = dailyStatusSlotKey(tech.name, dIso, sData.status)
        if (usedDailyKeys.has(key)) continue

        const status = sData.status || 'ΕΤΑΙΡΙΑ'
        const ts = sData.tStart ?? ''
        const te = sData.tEnd ?? ''
        const hasContent = Boolean(ts || te || status !== 'ΕΤΑΙΡΙΑ')
        if (!hasContent) continue

        dayStatusLabel = status
        state = processPendingShift(
          dIso,
          {
            jobOrStatus: isEtairiaStatus(status) ? status : `${status} (Εξτρά)`,
            status,
            phase: '-',
            timeStart: ts,
            timeEnd: te,
            metro: sData.metro,
            overnight: sData.overnight,
            receiptUrl: sData.receiptUrl ?? '',
          },
          claimedSlots,
          state
        )
        if (!ts && !te && status !== 'ΕΤΑΙΡΙΑ') countStatusDay(status)
      }
    }

    if (state.workedToday) {
      sumDays += 1
      let { dayTH, dayNH, dayHH, dayOTH } = state
      if (isWeekend && dayTH > 0 && dayTH < 4) {
        const diff = 4 - dayTH
        dayTH += diff
        dayHH += diff
        sumBonus += diff
        const bonusHrs = Math.round(diff * 100) / 100
        rows.push({
          tech: tech.name,
          dateIso: dIso,
          jobOrStatus: `Συμπλήρωμα 4ώρου Σ/Κ (+${Math.round(diff * 10) / 10}ω)`,
          status: dayStatusLabel,
          phase: '-',
          timeStart: '-',
          timeEnd: '-',
          metro: false,
          overnight: false,
          receiptUrl: '',
          workedHours: bonusHrs,
          nightHours: 0,
          overtime: 0,
          weekendHolidayHours: bonusHrs,
          weekendBonus: bonusHrs,
        })
      }
      sumTot += dayTH
      sumNight += dayNH
      sumHol += dayHH
      sumOt += dayOTH
    }
  }

  for (const [dateIso, list] of spillovers) {
    if (dateIso <= lastDayIso) continue
    const dayProbe = globalCalcHours(dateIso, '09:00', '17:00')
    let state = {
      runningDailyHours: 0,
      otExemptDay: dayProbe.holiday > 0,
      dayTH: 0,
      dayNH: 0,
      dayHH: 0,
      dayOTH: 0,
      workedToday: false,
    }
    const claimedSlots = new Set()
    for (const spill of list) {
      state = processPendingShift(dateIso, spill, claimedSlots, state)
    }
    if (state.workedToday) {
      sumTot += state.dayTH
      sumNight += state.dayNH
      sumHol += state.dayHH
      sumOt += state.dayOTH
    }
  }
  spillovers.clear()

  rows.sort((a, b) => {
    if (a.dateIso !== b.dateIso) return a.dateIso.localeCompare(b.dateIso)
    const timeA = a.timeStart || '24:00'
    const timeB = b.timeStart || '24:00'
    return timeA.localeCompare(timeB)
  })

  return {
    rows,
    summary: {
      tech: tech.name,
      totalHours: Math.round(sumTot * 100) / 100,
      holidayHours: Math.round(sumHol * 100) / 100,
      nightHours: Math.round(sumNight * 100) / 100,
      overtimeHours: Math.round(sumOt * 100) / 100,
      overnightDays: sumOvernight,
      metroDays: sumMetro,
      workDays: sumDays,
      repoDays: sumRepo,
      leaveDays: sumAdeia,
      sickDays: sumAsth,
      weekendBonus: Math.round(sumBonus * 100) / 100,
    },
  }
}

export function payrollTechs(techs) {
  return techs.filter((t) => t.is_active !== false && isSchedulableTech(t.role || ''))
}
