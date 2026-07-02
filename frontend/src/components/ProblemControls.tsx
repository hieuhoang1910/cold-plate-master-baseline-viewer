import { fmt, milliKW } from '../format'
import type { AppSchema, BaselineResult } from '../types'

// V2.1 — the "problem" knobs that sit above geometry: which coolant, and the
// max junction temperature the design must meet. The R_jc gate is derived from
// T_j,max (spec §19A) and shown live so it is never a magic number.
export function ProblemControls({
  schema, coolant, tjMaxC, live, onCoolant, onTjMax,
}: {
  schema: AppSchema
  coolant: string
  tjMaxC: number
  live: BaselineResult | null
  onCoolant: (name: string) => void
  onTjMax: (v: number) => void
}) {
  const tf = schema.targets.T_j_max_C ?? { default: 100, min: 40, max: 125, soft_target: 90 }
  const t = live?.targets
  const c = live?.coolant

  return (
    <div className="card problem">
      <h2>Problem &amp; targets</h2>

      <div className="pc-row">
        <label htmlFor="pc-coolant">Coolant</label>
        <select id="pc-coolant" value={coolant} onChange={(e) => onCoolant(e.target.value)}>
          {schema.coolants.map((p) => (
            <option key={p.name} value={p.name}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="pc-row">
        <label htmlFor="pc-tjmax">Max junction T<sub>j</sub></label>
        <input
          id="pc-tjmax" type="number" min={tf.min} max={tf.max} step={1}
          value={tjMaxC}
          onChange={(e) => onTjMax(Number(e.target.value))}
        />
        <span className="pc-unit">°C</span>
      </div>

      {t && (
        <div className="pc-derived">
          <div className="pc-line">
            <span>Derived R_jc gate</span>
            <b>{milliKW(t.R_jc_gate_K_W)} mK/W</b>
          </div>
          <div className="pc-line muted">
            <span>Coolant rise (½ caloric)</span>
            <span>{fmt(t.caloric_dT_K / 2, 2)} K</span>
          </div>
          <div className="pc-note">
            gate = ({fmt(tjMaxC, 0)} − {fmt(t.mean_coolant_C - t.caloric_dT_K / 2, 0)} inlet
            {' '}− {fmt(t.caloric_dT_K / 2, 1)}) / Q
          </div>
        </div>
      )}

      {c && (c.warnings.length > 0 || c.extrapolated) && (
        <div className="pc-warn">
          {c.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      {c && (
        <div className="pc-fluid muted">
          {c.label} @ {fmt(c.T_eval_C, 0)} °C · k {fmt(c.k_fluid_W_mK, 3)} · µ {fmt(c.mu_Pa_s * 1e3, 3)} mPa·s
        </div>
      )}
    </div>
  )
}
