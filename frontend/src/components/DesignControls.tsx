import { fmt, pct } from '../format'
import { PIN_PATTERNS, ROUTES, TPMS_LAYOUTS, TPMS_TYPES, derived, familyPatch, isGyroid, isPinStructure, routeFloor } from '../design'
import { LMM_PROC, makeManufacturable, normalizeRoute, quickVerdict, routeRule, type Enforcement } from '../manufacturing'
import type { Basis, DesignState, MfgInfo } from '../types'
import { GreenCad } from './GreenCad'

function Slider({
  label, unit, min, max, step, value, digits, onChange, tiers, green,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  digits: number
  onChange: (v: number) => void
  // V3.3 two-tier manufacturability bands: red below abs, amber abs→rec
  tiers?: { abs: number; rec: number }
  /** green-state grid readout ("5.0 px" / "271 ly") — sliders hold FINAL mm,
   *  the printer and the ⇄ CAD tab speak green; showing both kills the
   *  unit-space confusion (final = green ÷ shrink) */
  green?: string
}) {
  const posPct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
  return (
    <div className="ds-row">
      <div className="ds-top">
        <span>{label}</span>
        <span className="ds-val">{fmt(value, digits)} <span className="muted">{unit}</span>
          {green && <span className="muted" title="green-state size on the printer grid (final × shrink); the ⇄ CAD tab's mm are green — sliders are final (sintered)"> · {green}</span>}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      {tiers && (
        <div className="ds-tiers" title={`red < ${fmt(tiers.abs, 3)} (not printable/cleanable) · amber < ${fmt(tiers.rec, 3)} (marginal) · ok ≥ ${fmt(tiers.rec, 3)} mm`}>
          <div className="ds-tier fail" style={{ width: `${posPct(tiers.abs)}%` }} />
          <div className="ds-tier marg" style={{ left: `${posPct(tiers.abs)}%`, width: `${posPct(tiers.rec) - posPct(tiers.abs)}%` }} />
          <div className="ds-tier ok" style={{ left: `${posPct(tiers.rec)}%`, width: `${100 - posPct(tiers.rec)}%` }} />
        </div>
      )}
    </div>
  )
}

const VERDICT_COLOR: Record<string, string> = {
  PASS: 'var(--accent2)', MARGINAL: 'var(--warn, #d9a441)', FAIL: 'var(--fail)',
}

export function DesignControls({
  design, basis, evaluating, mode, mfg, onPatch, onReset,
}: {
  design: DesignState
  basis: Basis
  evaluating: boolean
  mode: Enforcement
  mfg?: MfgInfo | null
  onPatch: (p: Partial<DesignState>) => void
  onReset: () => void
}) {
  const fl = routeFloor(design.process_route, mode)
  const rule = routeRule(design.process_route)
  const gyroid = isGyroid(design.family)
  const pin = isPinStructure(design.tpms_type)
  const isStraight = design.family === 'straight_fin'
  const isLmm = normalizeRoute(design.process_route) === 'LMM'
  const d = derived(design, basis)
  // instant client verdict while dragging; the API's verdict (KPI card) is authoritative
  const verdict = mfg?.verdict ?? quickVerdict(design)

  const fix = () => onPatch(makeManufacturable(design))

  return (
    <div className="card">
      <h2>
        Design — live tuning
        <span className="ds-verdict" style={{ color: VERDICT_COLOR[verdict] }}
          title={`${rule.label} · ${rule.grade} (${rule.source})`}>
          {verdict === 'PASS' ? '✓' : verdict === 'MARGINAL' ? '△' : '✗'} {verdict.toLowerCase()}
        </span>
        <span className={`ds-live ${evaluating ? 'busy' : ''}`}>{evaluating ? 'solving…' : '● live'}</span>
      </h2>

      <div className="ds-selects">
        <label>
          Family
          <select value={design.family} onChange={(e) => onPatch(familyPatch(e.target.value, design))}>
            <option value="wavy_fin">wavy_fin</option>
            <option value="straight_fin">straight_fin</option>
            <option value="gyroid_tpms">gyroid_tpms</option>
          </select>
        </label>
        <label>
          Process
          <select
            value={normalizeRoute(design.process_route)}
            onChange={(e) => {
              const f = routeFloor(e.target.value, mode)
              onPatch({
                process_route: e.target.value,
                fin_thickness_mm: Math.max(design.fin_thickness_mm, f.t),
                channel_gap_mm: Math.max(design.channel_gap_mm, f.b),
              })
            }}
          >
            {ROUTES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
      </div>

      {verdict !== 'PASS' && (
        <button className="ds-fix" onClick={fix}
          title={`Project onto the nearest rule-compliant point: t/b → recommended (${fmt(rule.wallRec, 2)}/${fmt(rule.gapRec, 2)} mm), trim H if aspect > ${rule.aspectMax}${isLmm ? ', snap to the 35/25 µm grid' : ''}. The KPI cost shows live — nothing is applied silently.`}>
          ⚒ make manufacturable → t ≥ {fmt(rule.wallRec, 2)} · b ≥ {fmt(rule.gapRec, 2)}
        </button>
      )}

      {gyroid ? (
        <>
          <div className="ds-selects">
            <label>
              Structure
              <select value={design.tpms_type} onChange={(e) => onPatch({ tpms_type: e.target.value })}>
                {TPMS_TYPES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
            </label>
            <label>
              Layout
              <select value={design.tpms_layout} onChange={(e) => onPatch({ tpms_layout: e.target.value })}>
                {TPMS_LAYOUTS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
            </label>
          </div>

          {pin ? (
            <>
              <div className="ds-selects">
                <label>
                  Pattern
                  <select value={design.pin_pattern} onChange={(e) => onPatch({ pin_pattern: e.target.value })}>
                    {PIN_PATTERNS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                  </select>
                </label>
              </div>
              <Slider label="Pin diameter" unit="mm" min={Math.max(0.2, mode === 'explore' ? 0.2 : fl.t)} max={2.0} step={0.05} digits={2}
                value={design.pin_diameter_mm} onChange={(v) => onPatch({ pin_diameter_mm: v })}
                tiers={{ abs: rule.wallAbs, rec: rule.wallRec }} />
              <Slider label="Pin pitch" unit="mm" min={0.5} max={4.0} step={0.05} digits={2}
                value={design.pin_pitch_mm} onChange={(v) => onPatch({ pin_pitch_mm: v })} />
            </>
          ) : (
            <>
              <div className="ds-selects">
                <label>
                  Mode
                  <select value={design.tpms_solid ? 'solid' : 'sheet'}
                    onChange={(e) => onPatch({ tpms_solid: e.target.value === 'solid' })}>
                    <option value="sheet">Sheet (shell)</option>
                    <option value="solid">Solid (network)</option>
                  </select>
                </label>
              </div>
              <Slider label="Cell grading (jet-adaptive)" unit="" min={0} max={1.0} step={0.05} digits={2}
                value={design.cell_grading} onChange={(v) => onPatch({ cell_grading: v })} />
              <Slider label="Unit cell" unit="mm" min={1.0} max={4.0} step={0.1} digits={2}
                value={design.unit_cell_mm} onChange={(v) => onPatch({ unit_cell_mm: v })} />
              <Slider label="Wall thickness" unit="mm" min={fl.t} max={0.3} step={0.01} digits={2}
                value={design.wall_thickness_mm} onChange={(v) => onPatch({ wall_thickness_mm: v })}
                tiers={{ abs: rule.wallAbs, rec: rule.wallRec }} />
            </>
          )}

          <Slider label="Void fraction" unit="" min={0.3} max={0.8} step={0.01} digits={2}
            value={design.void_fraction} onChange={(v) => onPatch({ void_fraction: v })} />
          <Slider label="Surface area density" unit="m²/m³" min={3000} max={15000} step={100} digits={0}
            value={design.surface_area_density_m2_m3} onChange={(v) => onPatch({ surface_area_density_m2_m3: v })} />
          <Slider label="Hydraulic diameter" unit="mm" min={0.1} max={1.0} step={0.01} digits={2}
            value={design.hydraulic_diameter_mm} onChange={(v) => onPatch({ hydraulic_diameter_mm: v })}
            tiers={{ abs: rule.gapAbs, rec: rule.gapRec }} />
          <Slider label="Flow rate" unit="L/min" min={1.0} max={4.0} step={0.05} digits={2}
            value={design.flow_lpm} onChange={(v) => onPatch({ flow_lpm: v })} />
          <div className="ds-note muted">
            <b>Geometry screening.</b> Structure, layout, mode &amp; grading drive the 3-D view only —
            no per-type analytical model yet. R_jc shown is the generic-surface placeholder from void,
            SA/V &amp; D_h (needs nTop-measured area + CFD to validate).
          </div>
        </>
      ) : (
        <>
          <Slider label="Fin thickness t" unit="mm" min={fl.t} max={0.3} step={0.005} digits={3}
            value={design.fin_thickness_mm} onChange={(v) => onPatch({ fin_thickness_mm: v })}
            tiers={{ abs: rule.wallAbs, rec: rule.wallRec }}
            green={isLmm ? `${fmt(design.fin_thickness_mm * LMM_PROC.shrinkXY / LMM_PROC.pixelMm, 1)} px` : undefined} />
          <Slider label="Channel gap b" unit="mm" min={fl.b} max={0.4} step={0.005} digits={3}
            value={design.channel_gap_mm} onChange={(v) => onPatch({ channel_gap_mm: v })}
            tiers={{ abs: rule.gapAbs, rec: rule.gapRec }}
            green={isLmm ? `${fmt(design.channel_gap_mm * LMM_PROC.shrinkXY / LMM_PROC.pixelMm, 1)} px` : undefined} />
          <Slider label="Fin height H" unit="mm" min={2.0} max={6.5} step={0.05} digits={2}
            value={design.fin_height_mm} onChange={(v) => onPatch({ fin_height_mm: v })}
            green={isLmm ? `${fmt(design.fin_height_mm * LMM_PROC.shrinkZ / LMM_PROC.layerMm, 1)} ly` : undefined} />
          {!isStraight && (
            <>
              <Slider label="Wave amplitude A" unit="mm" min={0} max={1.0} step={0.01} digits={2}
                value={design.wave_amplitude_mm} onChange={(v) => onPatch({ wave_amplitude_mm: v })}
                green={isLmm ? `${fmt(design.wave_amplitude_mm * LMM_PROC.shrinkXY / LMM_PROC.pixelMm, 1)} px` : undefined} />
              <Slider label="Wavelength λ" unit="mm" min={1.5} max={6.0} step={0.05} digits={2}
                value={design.wavelength_mm} onChange={(v) => onPatch({ wavelength_mm: v })}
                green={isLmm ? `${fmt(design.wavelength_mm * LMM_PROC.shrinkXY / LMM_PROC.pixelMm, 0)} px` : undefined} />
            </>
          )}
          <Slider label="Flow rate" unit="L/min" min={1.0} max={4.0} step={0.05} digits={2}
            value={design.flow_lpm} onChange={(v) => onPatch({ flow_lpm: v })} />
          <div className="ds-derived">
            <span>pitch <b>{fmt(d.pitch, 2)}</b></span>
            <span>fins <b>{d.finCount}</b></span>
            <span>open <b>{pct(d.openFrac, 0)}</b></span>
            {!isStraight && <span>χ <b>{fmt(d.chi, 2)}</b></span>}
            <span>AR <b style={{ color: d.pitch > 0 && design.fin_height_mm / design.channel_gap_mm > rule.aspectMax ? 'var(--warn, #d9a441)' : undefined }}>
              {fmt(design.fin_height_mm / design.channel_gap_mm, 0)}</b></span>
          </div>
          {isLmm && <GreenCad design={design} />}
        </>
      )}

      <button className="ds-reset" onClick={onReset}>reset to {design.design_id}</button>
    </div>
  )
}
