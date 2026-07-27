/**
 * Transaction types — mirror APG EMPLOEE_PAYMENT_TYPE / PaymentTypes.csv
 *
 * Legacy notes:
 * - EPT_COL 1 → SALARY (Μισθός columns), EPT_COL 2 → OTHER (Λοιπά columns)
 * - Debit (Χρέωση) vs Credit (Πίστωση) is a UI grid choice, not locked by type
 * - EPT_IS_FOR_SUM → is_for_sum (counts toward totals)
 * - EPT_TYPE_PAY is legacy metadata (0/1/2), not a debit/credit flag
 */

/** Where the amount is shown on the ledger grid (Μισθός vs Λοιπά). */
export enum LedgerGroup {
  SALARY = 'SALARY',
  OTHER = 'OTHER',
}

/** UI side when posting an amount (grid Χρέωση / Πίστωση). */
export enum LedgerSide {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/** Physical column on the 4-column ledger grid. */
export enum LedgerColumn {
  SALARY_DEBIT = 'salary_debit',
  SALARY_CREDIT = 'salary_credit',
  OTHER_DEBIT = 'other_debit',
  OTHER_CREDIT = 'other_credit',
}

export interface TransactionType {
  id: number
  description: string
  ledger_group: LedgerGroup | 'SALARY' | 'OTHER'
  is_for_sum: boolean
  sort_order: number
  is_active?: boolean
  /** Legacy EPT_TYPE_PAY from APG (optional). */
  ept_type_pay?: number | null
}

export interface LedgerMovementForm {
  entry_date: string
  typeId: number | null
  description: string
  amount: string | number
  notes: string
  /** UI: Χρέωση vs Πίστωση — independent of ledger_group. */
  side: LedgerSide | 'DEBIT' | 'CREDIT'
  /** Derived from selected TransactionType.ledger_group */
  ledger_group?: LedgerGroup | 'SALARY' | 'OTHER' | null
  is_salary_type?: boolean
}

export interface LedgerGridRow {
  id: string
  tech_id: string
  source: 'PAYROLL' | 'PAYMENT'
  entry_date: string
  type: string
  description: string
  salary_debit: number
  salary_credit: number
  other_debit: number
  other_credit: number
  notes: string
  created_at?: string | null
}

export function isSalaryLedgerGroup(
  group: TransactionType['ledger_group'] | null | undefined
): boolean {
  return group === LedgerGroup.SALARY || group === 'SALARY'
}

/** Map EPT_COL (1|2) → LedgerGroup */
export function ledgerGroupFromEptCol(eptCol: number | string | null | undefined): LedgerGroup {
  return Number(eptCol) === 1 ? LedgerGroup.SALARY : LedgerGroup.OTHER
}

export function ledgerGroupLabel(
  group: TransactionType['ledger_group'] | null | undefined
): 'Μισθός' | 'Λοιπά' {
  return isSalaryLedgerGroup(group) ? 'Μισθός' : 'Λοιπά'
}

/** Target grid column from ledger_group + side. */
export function ledgerColumnFor(
  group: TransactionType['ledger_group'] | null | undefined,
  side: LedgerSide | 'DEBIT' | 'CREDIT'
): LedgerColumn {
  const salary = isSalaryLedgerGroup(group)
  const credit = side === LedgerSide.CREDIT || side === 'CREDIT'
  if (salary) return credit ? LedgerColumn.SALARY_CREDIT : LedgerColumn.SALARY_DEBIT
  return credit ? LedgerColumn.OTHER_CREDIT : LedgerColumn.OTHER_DEBIT
}

export function sideFromLedgerBucket(
  bucket: LedgerColumn | string | null | undefined
): LedgerSide {
  if (bucket === LedgerColumn.SALARY_CREDIT || bucket === LedgerColumn.OTHER_CREDIT) {
    return LedgerSide.CREDIT
  }
  return LedgerSide.DEBIT
}
