import { useEffect, useState } from 'react'
import { sweep } from '../api'
import { fmt } from '../format'
import type { ProblemOpts } from '../design'
import type { Enforcement } from '../manufacturing'
import { OBJECTIVES, buildSweepRequest, objectiveOf, sweepVarsFor, varLabel, varUnit } from '../optimizer'
import type { Basis, BaselineResult, DesignState, SavedDesign, SweepPoint, SweepResult } from '../types'
import { Heatmap } from './Heatmap'
import { Pareto } from './Pareto'

export function OptimizerPanel({
  design, basis, opts, mode, candidates, current, onLoadOptimum, onAddCandidates,
}: {
  design: DesignState | null
  basis: Basis
  opts: ProblemOpts
  mode: Enforcement
  candidates: BaselineResult[]
  current: BaselineResult | null
  onLoadOptimum: (p: Partial<DesignState>) => void
  onAddCandidates: (entries: SavedDesign[]) => void
}) {
  const [xVar, setXVar] = useState('fin_thickness_mm')
  const [yVar, setYVar] = useState('channel_gap_mm')
  const [objective, setObjective] = useState('R_jc_K_W')
  const [result, setResult] = useState<SweepResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Family-aware sweep variables (fin vs TPMS sheet vs pin). The chosen X/Y are
  // clamped to the valid set so switching family never sweeps a no-op variable.
  const vars = sweepVarsFor(design)
  const keys = vars.map((v) => v.key)
  const xEff = keys.includes(xVar) ? xVar : (keys[0] ?? xVar)
  const yEff = keys.includes(yVar) && yVar !== xEff ? yVar : (keys.find((k) => k !== xEff) ?? xEff)

  const run = () => {
    if (!design) return
    setLoading(true)
    setErr(null)
    sweep(buildSweepRequest(design, basis, xEff, yEff, objective, opts, 24, mode))
      .then(setResult)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }

  // Re-sweep on open, variable/objective change, when the design (family)
  // changes, or when the problem (coolant / targets / budgets / mode) changes.
  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xEff, yEff, objective, design?.design_id, design?.family, design?.tpms_type,
    design?.process_route, mode, JSON.stringify(opts)])

  if (!design) {
    return <div className="muted" style={{ padding: 14 }}>The optimizer works on viewable designs (fin, gyroid, pin) — select one.</div>
  }

  const o = result?.optimum
  // Any swept point can be loaded into the sliders, not just the ★ optimum —
  // click a heatmap cell or a Pareto point to try that (x, y) combination.
  const loadPoint = (x: number, y: number) => {
    if (!result) return
    onLoadOptimum({ [result.x_var]: x, [result.y_var]: y } as Partial<DesignState>)
  }
  const loadOpt = () => {
    if (!result || !o) return
    loadPoint(o.x, o.y)
  }

  // Take the top-N sweep points (Pareto front, ranked by the objective) and add
  // them as named candidates in the left list — each a full design you can tune.
  const addTop = (n: number) => {
    if (!result || !design) return
    const dir = result.objective_dir
    const pool = (result.pareto.length ? result.pareto : result.grid)
      .filter((p) => p.feasible && p.objective != null)
    const sorted = [...pool].sort((a, b) =>
      dir === 'max' ? b.objective! - a.objective! : a.objective! - b.objective!)
    const short = objectiveOf(result.objective).short
    const entries: SavedDesign[] = sorted.slice(0, n).map((pt: SweepPoint, i) => ({
      name: `opt-${short}-${i + 1}`,
      design: { ...design, [result.x_var]: pt.x, [result.y_var]: pt.y } as DesignState,
    }))
    if (entries.length) onAddCandidates(entries)
  }

  return (
    <div className="opt">
      <div className="opt-controls">
        <label>X&nbsp;
          <select value={xEff} onChange={(e) => setXVar(e.target.value)}>
            {vars.map((v) => <option key={v.key} value={v.key} disabled={v.key === yEff}>{v.label}</option>)}
          </select>
        </label>
        <label>Y&nbsp;
          <select value={yEff} onChange={(e) => setYVar(e.target.value)}>
            {vars.map((v) => <option key={v.key} value={v.key} disabled={v.key === xEff}>{v.label}</option>)}
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
          // T_j margin in °C at TDP: (gate − R_jc) × Q. Engineers think in
          // degrees of headroom, not mK/W.
          const gate = result!.gates?.limit_R_jc_K_W
          const Q = Number(basis.operating.heat_load_W ?? 450)
          const marginC = (gate != null && o.R_jc_K_W != null)
            ? (gate - o.R_jc_K_W) * Q : null
          return (
            <>
              <span className="opt-optval">
                best <b>{fmt((o.objective ?? 0) * ob.scale, ob.digits)}</b> {ob.unit} ·{' '}
                {varLabel(result!.x_var)} {fmt(o.x, 3)} {varUnit(result!.x_var)} ·{' '}
                {varLabel(result!.y_var)} {fmt(o.y, 3)} {varUnit(result!.y_var)}
                {result!.objective !== 'R_jc_K_W' && o.R_jc_K_W != null &&
                  <> · R_jc {fmt(o.R_jc_K_W * 1000, 2)} mK/W</>}
                {marginC != null && (
                  <> · T_j margin <b style={{ color: marginC >= 0 ? 'var(--pass)' : 'var(--fail)' }}>
                    {marginC >= 0 ? '+' : ''}{fmt(marginC, 1)} °C</b> @ {fmt(Q, 0)} W</>
                )}
              </span>
              <button className="opt-load" onClick={loadOpt}>load optimum → sliders</button>
              <button className="opt-load" onClick={() => addTop(5)}
                title="Add the 5 best sweep points as named candidates in the left list, then fine-tune each">
                ★ add top 5 → candidates
              </button>
            </>
          )
        })()}
      </div>

      {result?.gates && (
        <div className="opt-note muted">
          constrained by the project&apos;s budgets: R_jc ≤ {fmt((result.gates.limit_R_jc_K_W ?? 0) * 1000, 1)} mK/W
          {' '}· ΔP ≤ {fmt((result.gates.limit_deltaP_Pa ?? 0) / 1000, 0)} kPa
          {' '}· pump ≤ {fmt(result.gates.limit_pump_W ?? 0, 1)} W — ★ = best point that fits all three
          {result.mfg_enforce && <> <b>and</b> the {result.mfg_enforce === 'enforce' ? 'recommended' : 'absolute'} manufacturing bounds</>}
        </div>
      )}
      {/* V3.3 §35F — the price of manufacturability: ★ (compliant) vs ☆ (gates-only) */}
      {result?.optimum && result.optimum_unconstrained
        && (result.optimum.x !== result.optimum_unconstrained.x || result.optimum.y !== result.optimum_unconstrained.y)
        && result.optimum.R_jc_K_W != null && result.optimum_unconstrained.R_jc_K_W != null && (
        <div className="opt-note opt-mfgprice">
          ☆ unconstrained best would be R_jc {fmt(result.optimum_unconstrained.R_jc_K_W * 1000, 2)} mK/W
          {' '}({varLabel(result.x_var)} {fmt(result.optimum_unconstrained.x, 3)} · {varLabel(result.y_var)} {fmt(result.optimum_unconstrained.y, 3)}, mfg {result.optimum_unconstrained.mfg ?? '—'})
          {' '}→ manufacturability costs <b>
          +{fmt((result.optimum.R_jc_K_W - result.optimum_unconstrained.R_jc_K_W) * 1000, 2)} mK/W</b>
          {' '}(+{fmt((result.optimum.R_jc_K_W - result.optimum_unconstrained.R_jc_K_W) * Number(basis.operating.margin_heat_load_W ?? 575), 1)} K @ margin load)
        </div>
      )}
      {o && !o.feasible && (
        <div className="opt-note" style={{ color: 'var(--warn)' }}>
          ⚠ no swept point meets the budgets — showing the best overall instead.
          Relax the targets in the Design Studio or widen the sweep.
        </div>
      )}

      {err && <div className="error" style={{ padding: 8 }}>sweep error: {err}</div>}

      {result && (
        <div className="opt-charts">
          <div className="opt-chart">
            <div className="opt-cap">
              {objectiveOf(result.objective).label} heatmap · {varLabel(result.x_var)} × {varLabel(result.y_var)}{' '}
              <span className="muted">green = better · ★ optimum · ☆ gates-only · dim = gate fail / mfg FAIL / marginal · click a cell → sliders</span>
            </div>
            <Heatmap result={result} onPick={loadPoint} />
          </div>
          <div className="opt-chart">
            <div className="opt-cap">
              Pareto · R_jc vs pump{' '}
              <span className="muted">● grid · ◆ candidates · ○ current · ★ optimum · — floor/gate · click a point → sliders</span>
            </div>
            <Pareto result={result} candidates={candidates} current={current} onPick={loadPoint} />
          </div>
        </div>
      )}
    </div>
  )
}
