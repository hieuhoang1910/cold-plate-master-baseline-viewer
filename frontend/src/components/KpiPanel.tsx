import { fmt, isScreening, kPa, milliKW, pct } from '../format'
import type { BaselineResult, Gates } from '../types'
import { LimitBar } from './LimitBar'
import { ResistanceStackup } from './ResistanceStackup'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="m-label">{label}</span>
      <span className="m-val">{value}</span>
    </div>
  )
}

export function KpiPanel({ r, gates }: { r: BaselineResult; gates: Gates }) {
  const screening = isScreening(r.kpi_status)
  const rjcPass = r.R_jc_K_W <= gates.limit_R_jc_K_W

  return (
    <>
      <div className="card">
        <h2>Junction-to-coolant</h2>
        <div className="kpi-hero">
          <span className="val" style={{ color: rjcPass ? 'var(--accent2)' : 'var(--fail)' }}>
            {milliKW(r.R_jc_K_W)}
          </span>
          <span className="unit">mK/W R_jc</span>
          <span style={{ marginLeft: 'auto' }}
            className={`badge ${screening ? 'screen' : rjcPass ? 'pass' : 'fail'}`}>
            {r.kpi_status}
          </span>
        </div>
        <LimitBar label="R_jc vs gate" value={r.R_jc_K_W} limit={gates.limit_R_jc_K_W}
          display={milliKW(r.R_jc_K_W)} unit="mK/W" />
        <div style={{ marginTop: 12 }}>
          <ResistanceStackup r={r} />
        </div>
      </div>

      <div className="card">
        <h2>Hydraulics</h2>
        <LimitBar label="Pressure drop" value={r.DeltaP_Pa} limit={gates.limit_deltaP_Pa}
          display={kPa(r.DeltaP_Pa)} unit="kPa" />
        <LimitBar label="Pump power" value={r.pump_power_W} limit={gates.limit_pump_W}
          display={fmt(r.pump_power_W, 3)} unit="W" />
        <div className="metrics" style={{ marginTop: 10 }}>
          <Metric label="Velocity" value={`${fmt(r.velocity_m_s, 3)} m/s`} />
          <Metric label="Re" value={fmt(r.Re, 0)} />
          <Metric label="D_h" value={`${fmt(r.hydraulic_diameter_mm, 3)} mm`} />
          <Metric label="Open frac" value={pct(r.open_volume_fraction, 1)} />
        </div>
      </div>

      <div className="card">
        <h2>Surface & thermal</h2>
        <div className="metrics">
          <Metric label="SA/V raw" value={`${fmt(r.raw_SA_V_m2_m3, 0)}`} />
          <Metric label="SA/V eff" value={`${fmt(r.effective_SA_V_m2_m3, 0)}`} />
          <Metric label="η_f" value={r.eta_f == null ? '—' : fmt(r.eta_f, 3)} />
          <Metric label="η_o" value={r.eta_o == null ? '—' : fmt(r.eta_o, 3)} />
          <Metric label="UA" value={`${fmt(r.UA_W_K, 1)} W/K`} />
          <Metric label="Coverage" value={fmt(r.coverage, 3)} />
          <Metric label="ΔT @450W" value={`${fmt(r.heat_load_deltaT_K, 2)} K`} />
          <Metric label="ΔT @575W" value={`${fmt(r.margin_heat_load_deltaT_K, 2)} K`} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge stage">{r.validation_stage}</span>
          <span className="badge stage">{r.process_route}</span>
        </div>
      </div>

      {r.warnings.length > 0 && (
        <div className="warn-box">
          <b>⚠ {r.warnings.length} warning(s)</b>
          <ul>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </>
  )
}
