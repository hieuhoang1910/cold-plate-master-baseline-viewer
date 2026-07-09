const DASH = '—'

export function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return DASH
  return Number(v).toFixed(digits)
}

/** K/W -> mK/W display string. */
export function milliKW(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return DASH
  return (v * 1000).toFixed(digits)
}

/** Pa -> kPa display string. */
export function kPa(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return DASH
  return (v / 1000).toFixed(digits)
}

/** Integer with thousands separators (for large mm² areas etc.). */
export function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return DASH
  return Math.round(v).toLocaleString('en-US')
}

/** 0..1 -> percent string. */
export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return DASH
  return (v * 100).toFixed(digits) + '%'
}

/** True when a KPI status string starts with PASS or SCREENING_ONLY:PASS. */
export function isPass(status: string): boolean {
  return status === 'PASS' || status.endsWith(':PASS') || status.includes('PASS')
}

export function isScreening(status: string): boolean {
  return status.startsWith('SCREENING_ONLY')
}
