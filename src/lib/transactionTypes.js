/** transaction_types — APG EMPLOEE_PAYMENT_TYPE mirror */

/** type_pay === 1 → Χρέωση / payroll_entries · type_pay === 2 → Πίστωση / payment_entries */
export function isPaymentTypePay(typePay) {
  return Number(typePay) === 2
}

/** col_index === 1 → Μισθός · αλλιώς Λοιπά */
export function isSalaryColIndex(colIndex) {
  return Number(colIndex) === 1
}

/**
 * Προσωρινό map description → payment_entries.payment_type enum.
 * Κανόνας (όπως ζητήθηκε):
 *   περιέχει '1' ή 'Έναντι' → SETTLEMENT_1
 *   περιέχει '2' → SETTLEMENT_2
 *   αλλιώς → ADVANCE
 */
export function paymentTypeCodeFromDescription(description) {
  const d = String(description || '')
  const lower = d.toLowerCase()
  if (lower.includes('έναντι') || lower.includes('εναντι') || d.includes('1')) {
    return 'SETTLEMENT_1'
  }
  if (d.includes('2')) return 'SETTLEMENT_2'
  return 'ADVANCE'
}

export function payrollTypeCodeFromDescription(description) {
  return String(description || '').trim() || 'Κίνηση'
}
