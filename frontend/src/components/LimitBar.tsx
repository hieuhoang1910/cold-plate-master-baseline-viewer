import { fmt } from '../format'

/**
 * A value-vs-limit bar. Bar fills to (value / limit); green when within the
 * gate, red when over. Used for R_jc, ΔP, and pump power.
 */
export function LimitBar({
  label, value, limit, display, unit,
}: {
  label: string
  value: number | null | undefined
  limit: number
  display?: string
  unit: string
}) {
  const v = value ?? NaN
  const frac = Number.isFinite(v) && limit > 0 ? v / limit : 0
  const pass = Number.isFinite(v) && v <= limit
  const width = Math.max(0, Math.min(1, frac)) * 100
  const color = pass ? 'var(--pass)' : 'var(--fail)'
  return (
    <div className="limitbar">
      <div className="lb-top">
        <span className="muted">{label}</span>
        <span className="tabular">
          {display ?? fmt(v)} <span className="muted">{unit}</span>
          {'  '}
          <span className="muted">/ {limit >= 1000 ? limit / 1000 + 'k' : limit}</span>
        </span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  )
}
