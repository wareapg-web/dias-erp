/** Εξαγωγή έργων (assignments) μήνα/έτους σε Excel — μόνο μόνιμοι με Admin. */

import * as XLSX from 'xlsx-js-style'
import { adminClient, fetchAllRows } from './supabase'
import { MONTH_LABELS } from './payrollAnalysis'
import { isTemporaryPersonnel } from './personnel'

function permanentFieldTechs(personnel = [], adminTechs = []) {
  const techs = []
  for (const p of personnel || []) {
    if (isTemporaryPersonnel(p)) continue
    if (p.is_active === false) continue
    if (p.in_office === true) continue

    const displayName =
      String(p.tech_name || '').trim() ||
      [p.last_name, p.first_name].filter(Boolean).join(' ').trim() ||
      String(p.tech_id || p.id || '—')

    const adminId = p.admin_tech_id || p.tech_id
    const adminTech =
      (adminTechs || []).find((t) => String(t.id) === String(adminId)) ||
      (adminTechs || []).find(
        (t) =>
          String(t.name || '')
            .toLowerCase()
            .trim() === String(p.tech_name || '').toLowerCase().trim()
      ) ||
      null

    const adminName = String(adminTech?.name || '').trim()
    if (!adminName) continue

    techs.push({
      displayName,
      adminName,
      adminNameKey: adminName.toLowerCase(),
    })
  }
  return techs
}

function dateRangeForScope(month, year, scope) {
  const y = Number(year)
  if (scope === 'year') {
    return { from: `${y}-01-01`, to: `${y}-12-31` }
  }
  const m = Number(month)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

/**
 * Μόνιμοι: διακριτά ονόματα έργων από Admin assignments (μόνο μέρες με ανάθεση).
 * @returns {Array<{ name: string, jobs: string }>}
 */
export function aggregateJobsByTech(assignments = [], jobs = [], fieldTechs = []) {
  const jobNames = new Map()
  for (const j of jobs || []) {
    const id = j.group_id ?? j.groupId
    if (id == null || id === '') continue
    jobNames.set(String(id), String(j.name || id).trim() || String(id))
  }

  const byAdmin = new Map()
  for (const t of fieldTechs) {
    byAdmin.set(t.adminNameKey, {
      name: t.displayName,
      jobSet: new Set(),
    })
  }

  for (const a of assignments || []) {
    const techKey = String(a.tech || '')
      .toLowerCase()
      .trim()
    if (!techKey) continue
    const slot = byAdmin.get(techKey)
    if (!slot) continue

    const jobId = a.job_id ?? a.jobId
    if (jobId == null || jobId === '') continue
    const title = jobNames.get(String(jobId)) || String(jobId)
    if (title) slot.jobSet.add(title)
  }

  return Array.from(byAdmin.values())
    .map((slot) => ({
      name: slot.name,
      jobs: Array.from(slot.jobSet).sort((a, b) => a.localeCompare(b, 'el')).join(', '),
    }))
    .filter((r) => r.jobs.length > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'))
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

function applyDataCellStyle(cell, { zebra = false, bold = false, align = 'left' } = {}) {
  if (!cell) return
  cell.s = {
    ...(cell.s || {}),
    font: { bold: !!bold, name: 'Calibri', sz: 11 },
    alignment: { horizontal: align, vertical: 'center', wrapText: align === 'left' },
    border: CELL_BORDER,
    ...(zebra ? { fill: { patternType: 'solid', fgColor: { rgb: 'CBD5E1' } } } : {}),
  }
}

export function jobsExportFilename(month, year, scope = 'month') {
  const y = Number(year) || new Date().getFullYear()
  if (scope === 'year') return `Jobs_${y}.xlsx`
  const m = String(Number(month) || 0).padStart(2, '0')
  return `Jobs_${m}_${y}.xlsx`
}

/**
 * Excel μόνιμων: Ονοματεπώνυμο · Έργα (από Αναλυτικά / Admin assignments).
 * @param {{ month: number, year: number, personnel?: object[], adminTechs?: object[], scope?: 'month'|'year' }} opts
 */
export async function exportJobsToExcel({
  month,
  year,
  personnel = [],
  adminTechs = [],
  scope = 'month',
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

  const fieldTechs = permanentFieldTechs(personnel, adminTechs)
  if (fieldTechs.length === 0) {
    throw new Error('Δεν βρέθηκαν μόνιμοι με σύνδεση Admin για έργα')
  }

  const { from, to } = dateRangeForScope(m, y, useYear ? 'year' : 'month')

  const [assignmentRows, jobRows] = await Promise.all([
    fetchAllRows(adminClient, 'assignments', (q) =>
      q.select('tech, job_id, date_iso').gte('date_iso', from).lte('date_iso', to)
    ),
    fetchAllRows(adminClient, 'jobs', (q) => q.select('group_id, name')),
  ])

  const rows = aggregateJobsByTech(assignmentRows, jobRows, fieldTechs)
  if (rows.length === 0) {
    throw new Error(
      useYear
        ? `Δεν βρέθηκαν αναθέσεις έργων για το ${y}`
        : `Δεν βρέθηκαν αναθέσεις έργων για ${MONTH_LABELS[m - 1] || m} ${y}`
    )
  }

  const monthTitle = useYear
    ? String(y)
    : `${String(MONTH_LABELS[m - 1] || `Μήνας ${m}`).toLocaleUpperCase('el-GR')} ${y}`
  const title = `JOBS · ${monthTitle}`

  const aoa = [
    [title, ''],
    ['Ονοματεπώνυμο', 'Έργα'],
  ]
  for (const r of rows) {
    aoa.push([r.name, r.jobs])
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
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
  if (!sheet.B1) sheet.B1 = { v: '', t: 's' }
  sheet.B1.s = {
    ...(sheet.B1.s || {}),
    border: {
      top: { style: 'medium', color: { rgb: '334155' } },
      bottom: { style: 'medium', color: { rgb: '334155' } },
      left: { style: 'medium', color: { rgb: '334155' } },
      right: { style: 'medium', color: { rgb: '334155' } },
    },
  }

  styleHeaderCell(sheet, 'A2', 'Ονοματεπώνυμο')
  styleHeaderCell(sheet, 'B2', 'Έργα')

  const lastRow = aoa.length
  for (let r = 3; r <= lastRow; r += 1) {
    const zebra = (r - 3) % 2 === 1
    const nameCell = sheet[`A${r}`]
    const jobsCell = sheet[`B${r}`]
    if (nameCell) applyDataCellStyle(nameCell, { zebra, align: 'left' })
    if (jobsCell) applyDataCellStyle(jobsCell, { zebra, align: 'left' })
  }

  sheet['!cols'] = [{ wch: 32 }, { wch: 80 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'JOBS')

  const filename = jobsExportFilename(m, y, useYear ? 'year' : 'month')
  XLSX.writeFile(workbook, filename)

  return { rowCount: rows.length, filename, scope: useYear ? 'year' : 'month' }
}
