import { fmt, pct } from '../format'
import { ROUTES, derived, familyPatch, isGyroid, routeFloor } from '../design'
import type { Basis, DesignState } from '../types'

function Slider({
  label, unit, min, max, step, value, digits, onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  digits: number
  onChange: (v: number) => void
}) {
  return (
    <div className="ds-row">
      <div className="ds-top">
        <span>{label}</span>
        <span className="ds-val">{fmt(value, digits)} <span className="muted">{unit}</span></span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

export function DesignControls({
  design, basis, evaluating, onPatch, onReset,
}: {
  design: DesignState
  basis: Basis
  evaluating: boolean
  onPatch: (p: Partial<DesignState>) => void
  onReset: () => void
}) {
  const fl = routeFloor(design.process_route)
  const gyroid = isGyroid(design.family)
  const isStraight = design.family === 'straight_fin'
  const d = derived(design, basis)

  return (
    <div className="card">
      <h2>
        Design — live tuning
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
            value={design.process_route}
            onChange={(e) => {
              const f = routeFloor(e.target.value)
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

      {gyroid ? (
        <>
          <Slider label="Unit cell" unit="mm" min={1.0} max={4.0} step={0.1} digits={2}
            value={design.unit_cell_mm} onChange={(v) => onPatch({ unit_cell_mm: v })} />
          <Slider label="Wall thickness" unit="mm" min={fl.t} max={0.3} step={0.01} digits={2}
            value={design.wall_thickness_mm} onChange={(v) => onPatch({ wall_thickness_mm: v })} />
          <Slider label="Void fraction" unit="" min={0.3} max={0.8} step={0.01} digits={2}
            value={design.void_fraction} onChange={(v) => onPatch({ void_fraction: v })} />
          <Slider label="Surface area density" unit="m²/m³" min={3000} max={15000} step={100} digits={0}
            value={design.surface_area_density_m2_m3} onChange={(v) => onPatch({ surface_area_density_m2_m3: v })} />
          <Slider label="Hydraulic diameter" unit="mm" min={0.1} max={1.0} step={0.01} digits={2}
            value={design.hydraulic_diameter_mm} onChange={(v) => onPatch({ hydraulic_diameter_mm: v })} />
          <Slider label="Flow rate" unit="L/min" min={1.0} max={4.0} step={0.05} digits={2}
            value={design.flow_lpm} onChange={(v) => onPatch({ flow_lpm: v })} />
          <div className="ds-note muted">
            Screening: cell / wall drive the 3-D view; R_jc comes from void, SA/V &amp; D_h
            (nTop-measured + CFD placeholders until validated).
          </div>
        </>
      ) : (
        <>
          <Slider label="Fin thickness t" unit="mm" min={fl.t} max={0.3} step={0.01} digits={2}
            value={design.fin_thickness_mm} onChange={(v) => onPatch({ fin_thickness_mm: v })} />
          <Slider label="Channel gap b" unit="mm" min={fl.b} max={0.4} step={0.01} digits={2}
            value={design.channel_gap_mm} onChange={(v) => onPatch({ channel_gap_mm: v })} />
          <Slider label="Fin height H" unit="mm" min={2.0} max={6.5} step={0.05} digits={2}
            value={design.fin_height_mm} onChange={(v) => onPatch({ fin_height_mm: v })} />
          {!isStraight && (
            <>
              <Slider label="Wave amplitude A" unit="mm" min={0} max={1.0} step={0.01} digits={2}
                value={design.wave_amplitude_mm} onChange={(v) => onPatch({ wave_amplitude_mm: v })} />
              <Slider label="Wavelength λ" unit="mm" min={1.5} max={6.0} step={0.05} digits={2}
                value={design.wavelength_mm} onChange={(v) => onPatch({ wavelength_mm: v })} />
            </>
          )}
          <Slider label="Flow rate" unit="L/min" min={1.0} max={4.0} step={0.05} digits={2}
            value={design.flow_lpm} onChange={(v) => onPatch({ flow_lpm: v })} />
          <div className="ds-derived">
            <span>pitch <b>{fmt(d.pitch, 2)}</b></span>
            <span>fins <b>{d.finCount}</b></span>
            <span>open <b>{pct(d.openFrac, 0)}</b></span>
            {!isStraight && <span>χ <b>{fmt(d.chi, 2)}</b></span>}
          </div>
        </>
      )}

      <button className="ds-reset" onClick={onReset}>reset to {design.design_id}</button>
    </div>
  )
}
