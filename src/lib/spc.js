// SPC status calculation for variable-type checkpoints
// Returns: 'pass' | 'warning' | 'fail' | null
export function getSpcStatus(value, cp) {
  if (value === '' || value === null || value === undefined) return null
  const v = Number(value)
  const { lsl, usl, lcl, ucl } = cp

  if ((lsl !== null && lsl !== undefined && v < lsl) ||
      (usl !== null && usl !== undefined && v > usl)) return 'fail'

  if ((lcl !== null && lcl !== undefined && v < lcl) ||
      (ucl !== null && ucl !== undefined && v > ucl)) return 'warning'

  return 'pass'
}

export const STATUS_COLOR = {
  pass:    { bg: 'rgba(34,197,94,0.1)',  text: '#22c55e', border: 'rgba(34,197,94,0.3)',  label: 'IN CONTROL' },
  warning: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)', label: 'WARNING' },
  fail:    { bg: 'rgba(239,68,68,0.1)',  text: '#ef4444', border: 'rgba(239,68,68,0.3)',  label: 'OUT OF SPEC' },
}
