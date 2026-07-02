import { milliKW, pct } from '../format'
import type { BaselineResult } from '../types'

/**
 * Horizontal stacked bar of the junction-to-coolant resistance:
 * R_base + R_TIM + R_conv = R_jc. Makes the "TIM+base dominate, convection is
 * only ~29%" story visible at a glance (spec §7).
 */
export function ResistanceStackup({ r }: { r: BaselineResult }) {
  const base = r.R_base_K_W
  const tim = r.R_TIM_K_W
  const conv = r.R_th_conv_K_W
  const total = r.R_jc_K_W || base + tim + conv
  const w = (x: number) => `${(x / total) * 100}%`

  return (
    <div>
      <div className="stack">
        <div className="seg" style={{ width: w(base), background: 'var(--rbase)' }} title="Base conduction" />
        <div className="seg" style={{ width: w(tim), background: 'var(--rtim)' }} title="TIM" />
        <div className="seg" style={{ width: w(conv), background: 'var(--rconv)' }} title="Convection" />
      </div>
      <div className="stack-legend">
        <div className="k"><span className="swatch" style={{ background: 'var(--rbase)' }} /> base {milliKW(base)} <span className="muted">({pct(base / total)})</span></div>
        <div className="k"><span className="swatch" style={{ background: 'var(--rtim)' }} /> TIM {milliKW(tim)} <span className="muted">({pct(tim / total)})</span></div>
        <div className="k"><span className="swatch" style={{ background: 'var(--rconv)' }} /> conv {milliKW(conv)} <span className="muted">({pct(conv / total)})</span></div>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Values in mK/W. Convection (the fin lever) is only {pct(r.conv_fraction)} of R_jc — TIM + base set the floor.
      </div>
    </div>
  )
}
