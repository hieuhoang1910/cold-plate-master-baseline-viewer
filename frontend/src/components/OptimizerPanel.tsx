import { useEffect, useState } from 'react'
import { sweep } from '../api'
import { fmt } from '../format'
import { OBJECTIVES, SWEEP_VARS, buildSweepRequest, objectiveOf, varLabel, varUnit } from '../optimizer'
import type { Basis, BaselineResult, DesignState, SweepResult } from '../types'
import { Heatmap } from './Heatmap'
import { Pareto } from './Pareto'

export function OptimizerPanel({
  design, basis, candidates, current, onLoadOptimum,
}: {
  design: DesignState | null
  basis: Basis
  candidates: BaselineResult[]
  current: BaselineResult | null
  onLoadOptimum: (p: Partial<DesignState>) => void
}) {
  const [xVar, setXVar] = useState('fin_thickness_mm')
  const [yVar, setYVar] = useState('channel_gap_mm')
  const [objective, setObjective] = useState('R_jc_K_W')
  const [result, setResult] = useState<SweepResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = () => {
    if (!design) return
    setLoading(true)
    setErr(null)
    sweep(buildSweepRequest(design, basis, xVar, yVar, objective))
      .then(setResult)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }

  // Re-sweep on open, variable/objective change, or when a different design is selected.
  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xVar, yVar, objective, design?.design_id])

  if (!design) {
    return <div className="muted" style={{ padding: 14 }}>The optimizer works on wavy/straight fin designs — select one.</div>
  }

  const o = result?.optimum
  const loadOpt = () => {
    if (!result || !o) return
    onLoadOptimum({ [result.x_var]: o.x, [result.y_var]: o.y } as Partial<DesignState>)
  }

  return (
    <div className="opt">
      <div className="opt-controls">
        <label>X&nbsp;
          <select value={xVar} onChange={(e) => setXVar(e.target.value)}>
            {SWEEP_VARS.map((v) => <option key={v.key} value={v.key} disabled={v.key === yVar}>{v.label}</option>)}
          </select>
        </label>
        <label>Y&nbsp;
          <select value={yVar} onChange={(e) => setYVar(e.target.value)}>
            {SWEEP_VARS.map((v) => <option key={v.key} value={v.key} disabled={v.key === xVar}>{v.label}</option>)}
          </select>
        </label>
        <label>Optimize&nbsp;
          <select value={objective} onChange={(e) => setObjective(e.target.value)}>
            {OBJECTIVES.map((o) => <option key={o.key} value={o.key}>{o.dir === 'max' ? 'max ' : 'min '}{o.label}</option>)}
          </select>
        </label>
        <button className="opt-run" onClick={run}>{loading ? 'sweeping…' : '↻ refresh'}</button>
        {o && (() => {
          const ob = objectiveOf(result!.objective)
          return (
            <>
              <span className="opt-optval">
                best <b>{fmt((o.objective ?? 0) * ob.scale, ob.digits)}</b> {ob.unit} ·{' '}
                {varLabel(result!.x_var)} {fmt(o.x, 3)} {varUnit(result!.x_var)} ·{' '}
                {varLabel(result!.y_var)} {fmt(o.y, 3)} {varUnit(result!.y_var)}
                {result!.objective !== 'R_jc_K_W' && o.R_jc_K_W != null &&
                  <> · R_jc {fmt(o.R_jc_K_W * 1000, 2)} mK/W</>}
              </span>
              <button className="opt-load" onClick={loadOpt}>load optimum → sliders</button>
            </>
          )
        })()}
      </div>

      {err && <div className="error" style={{ padding: 8 }}>sweep error: {err}</div>}

      {result && (
        <div className="opt-charts">
          <div className="opt-chart">
            <div className="opt-cap">
              {objectiveOf(result.objective).label} heatmap · {varLabel(result.x_var)} × {varLabel(result.y_var)}{' '}
              <span className="muted">green = better · ★ optimum · dim = gate fail</span>
            </div>
            <Heatmap result={result} />
          </div>
          <div className="opt-chart">
            <div className="opt-cap">
              Pareto · R_jc vs pump{' '}
              <span className="muted">● grid · ◆ candidates · ○ current · ★ optimum · — floor/gate</span>
            </div>
            <Pareto result={result} candidates={candidates} current={current} />
          </div>
        </div>
      )}
    </div>
  )
}
