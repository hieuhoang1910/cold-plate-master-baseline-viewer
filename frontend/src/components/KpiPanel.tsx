import { useState } from 'react'
import { fmt, fmtInt, isScreening, kPa, milliKW, pct } from '../format'
import type { BaselineResult, Gates, MfgInfo, TargetsInfo } from '../types'
import { LimitBar } from './LimitBar'
import { ResistanceStackup } from './ResistanceStackup'

// 2026-08-05 — click-to-explain (user request: "clean by default; when I need
// to check if the calculation is correct, I click the number"). Every metric
// can carry an `info` block; clicking the value opens ONE detail box per card
// with What / Why / How — the How line substitutes the live numbers into the
// exact formula the solver used, so the arithmetic is auditable in place.
export interface MetricInfo { what: string; why: string; how: string }

function Expl({ id, open, infos }: {
  id: string | null; open: string | null; infos: Record<string, MetricInfo>
}) {
  void id
  if (!open || !infos[open]) return null
  const i = infos[open]
  return (
    <div className="m-expl">
      <div><b>What</b> — {i.what}</div>
      <div><b>Why it matters</b> — {i.why}</div>
      <div className="m-how"><b>Calculation</b> — {i.how}</div>
    </div>
  )
}

const MFG_COLOR: Record<string, string> = {
  PASS: 'var(--accent2)', MARGINAL: 'var(--warn, #d9a441)', FAIL: 'var(--fail)', INFO: '#93a0b5',
}

// V3.3 — the manufacturability card: verdict + every non-passing rule with its
// bound and source, so no verdict is a magic judgement.
function MfgCard({ m }: { m: MfgInfo }) {
  const shown = m.checks.filter((c) => c.status !== 'PASS')
  return (
    <div className="card">
      <h2>
        Manufacturability
        <span className="mfg-chip" style={{ color: MFG_COLOR[m.verdict], borderColor: MFG_COLOR[m.verdict] }}>
          {m.verdict}
        </span>
      </h2>
      <div className="mfg-route muted">{m.label} · <em>{m.grade}</em></div>
      {shown.length === 0
        ? <div className="mfg-ok">✓ all rules met at the recommended bounds</div>
        : (
          <ul className="mfg-list">
            {shown.map((c, i) => (
              <li key={i}>
                <span className="mfg-st" style={{ color: MFG_COLOR[c.status] }}>
                  {c.status === 'FAIL' ? '✗' : c.status === 'MARGINAL' ? '△' : 'ℹ'}
                </span>
                <span><b>{c.label}</b> — {c.message}</span>
              </li>
            ))}
          </ul>
        )}
      <div className="mfg-src muted">source: {m.source}</div>
    </div>
  )
}

const SOFT_TARGET_C = 90 // design line drawn under the hard T_j ceiling (spec §25 Q1)

function Metric({ label, value, id, open, onToggle }: {
  label: string; value: string
  /** when id is set the metric is clickable and toggles the card's Expl box */
  id?: string; open?: string | null; onToggle?: (id: string | null) => void
}) {
  const clickable = !!id && !!onToggle
  return (
    <div
      className={`metric${clickable ? ' m-click' : ''}${clickable && open === id ? ' m-open' : ''}`}
      onClick={clickable ? () => onToggle!(open === id ? null : id!) : undefined}
      title={clickable ? 'click for what / why / calculation' : undefined}
    >
      <span className="m-label">{label}</span>
      <span className="m-val">{value}</span>
    </div>
  )
}

// V2.1 — exact junction temperature vs the target (ε-NTU form from the API).
function JunctionTemp({ t }: { t: TargetsInfo }) {
  const tj = t.T_j_C
  const color = tj > t.T_j_max_C ? 'var(--fail)'
    : tj > SOFT_TARGET_C ? 'var(--warn, #d9a441)' : 'var(--accent2)'
  const pctOfMax = Math.max(0, Math.min(1, tj / t.T_j_max_C))
  return (
    <div className="tj-block">
      <div className="tj-head">
        <span>Junction temperature</span>
        <span className="tj-val" style={{ color }}>{fmt(tj, 1)} °C</span>
      </div>
      <div className="tj-bar">
        <div className="tj-fill" style={{ width: `${pctOfMax * 100}%`, background: color }} />
        <div className="tj-soft" style={{ left: `${(SOFT_TARGET_C / t.T_j_max_C) * 100}%` }}
          title={`soft design target ${SOFT_TARGET_C} °C`} />
      </div>
      <div className="tj-foot muted">
        ceiling {fmt(t.T_j_max_C, 0)} °C · soft {SOFT_TARGET_C} °C · coolant out {fmt(t.coolant_out_C, 1)} °C
      </div>
    </div>
  )
}

export function KpiPanel({ r, gates }: { r: BaselineResult; gates: Gates }) {
  const screening = isScreening(r.kpi_status)
  // V2.1 — when the request carried a T_j target, the gate is the derived R_jc
  // budget (spec §19A); otherwise the catalog default gate.
  const rjcGate = r.targets?.R_jc_gate_K_W ?? gates.limit_R_jc_K_W
  const rjcPass = r.R_jc_K_W <= rjcGate
  const t = r.targets

  // one open explanation per card (clean by default)
  const [openJ, setOpenJ] = useState<string | null>(null)
  const [openH, setOpenH] = useState<string | null>(null)
  const [openS, setOpenS] = useState<string | null>(null)

  const W = r.core_width_mm, L = r.core_length_mm, Hc = r.core_height_mm
  const Vcore = W != null && L != null && Hc != null ? W * L * Hc : null
  const wetMm2 = r.wetted_area_m2 != null ? r.wetted_area_m2 * 1e6 : null
  const dieMm2 = r.coverage > 0 && W != null && L != null ? (W * L) / r.coverage : null
  const q450 = r.R_jc_K_W > 0 ? r.heat_load_deltaT_K / r.R_jc_K_W : 450
  const q575 = r.R_jc_K_W > 0 ? r.margin_heat_load_deltaT_K / r.R_jc_K_W : 575

  const J_INFO: Record<string, MetricInfo> = {
    rjc: {
      what: 'Junction-to-coolant thermal resistance — the one number the whole app minimizes. Kelvin of junction rise per watt.',
      why: 'Sets the junction temperature at any load: T_j = coolant + Q × R_jc. Everything else on this page is either a part of it or a constraint on it.',
      how: `series stack: base ${milliKW(r.R_base_K_W)} + TIM ${milliKW(r.R_TIM_K_W)} + convection ${milliKW(r.R_th_conv_K_W)} = ${milliKW(r.R_jc_K_W)} mK/W (convection = 1/UA; base & TIM from the stack dims — all design geometry, no shrink)`,
    },
    gate: {
      what: t ? 'The R_jc budget derived from the junction-temperature target (spec §19A).' : 'The project R_jc gate.',
      why: 'PASS/FAIL on the hero number. Derived gates move with coolant temperature and load — a hotter loop leaves less budget.',
      how: t
        ? `gate = (T_j ceiling − coolant-out) ÷ load = (${fmt(t.T_j_max_C, 0)} − ${fmt(t.coolant_out_C, 1)}) °C ÷ Q → ${milliKW(rjcGate)} mK/W; have ${milliKW(r.R_jc_K_W)}`
        : `project gate ${milliKW(rjcGate)} mK/W vs have ${milliKW(r.R_jc_K_W)}`,
    },
    ...(t ? {
      tj: {
        what: 'Exact junction temperature from the ε-NTU energy balance (not the linear approximation).',
        why: 'The physical pass/fail: silicon throttles on T_j, not on R_jc. The soft 90 °C line is the design target; the hard line is the ceiling.',
        how: `coolant enters, warms along the channels (ε-NTU), junction sits Q × R_jc above the local coolant → T_j ${fmt(t.T_j_C, 1)} °C vs soft ${SOFT_TARGET_C} / ceiling ${fmt(t.T_j_max_C, 0)} °C; coolant out ${fmt(t.coolant_out_C, 1)} °C`,
      },
    } : {}),
  }

  const H_INFO: Record<string, MetricInfo> = {
    dp: {
      what: 'Core pressure drop at the operating flow — friction along the wavy channels plus header/turn losses.',
      why: 'The loop grants a fixed ΔP budget; the best design SPENDS it (narrower/longer channels buy heat transfer with pressure). Over budget = the pump can\'t hold the flow.',
      how: `laminar friction fRe·2μ·v·L_arc/D_h² + headers K·½ρv² = ${kPa(r.DeltaP_Pa)} kPa vs budget ${kPa(gates.limit_deltaP_Pa)} kPa (v ${fmt(r.velocity_m_s, 3)} m/s, D_h ${fmt(r.hydraulic_diameter_mm, 3)} mm)`,
    },
    pump: {
      what: 'Hydraulic power the pump must deliver through this core.',
      why: 'The electrical/acoustic cost of the thermal result; the second hydraulic gate.',
      how: `ΔP × volumetric flow = ${kPa(r.DeltaP_Pa)} kPa × Q̇ = ${fmt(r.pump_power_W, 3)} W vs budget ${fmt(gates.limit_pump_W, 1)} W`,
    },
    vel: {
      what: 'Mean coolant velocity inside the channels.',
      why: 'Drives Re, h and erosion limits. Too low → weak convection; too high → ΔP burns the budget quadratically.',
      how: `flow ÷ flow area = v → ${fmt(r.velocity_m_s, 3)} m/s through A_flow ${r.flow_area_m2 ? fmtInt(r.flow_area_m2 * 1e6) : '—'} mm² (equiv. Q̇ ≈ ${r.flow_area_m2 ? fmt(r.velocity_m_s * r.flow_area_m2 * 60000, 2) : '—'} L/min)`,
    },
    re: {
      what: 'Channel Reynolds number.',
      why: 'Confirms the laminar regime (< ~2300) the Shah–London correlations assume. If Re leaves that range the model is out of its validity window.',
      how: `Re = ρ·v·D_h ÷ μ = ${fmt(r.Re, 0)} with v ${fmt(r.velocity_m_s, 3)} m/s, D_h ${fmt(r.hydraulic_diameter_mm, 3)} mm and the active coolant's ρ, μ`,
    },
    dh: {
      what: 'Hydraulic diameter of one rectangular channel.',
      why: 'The length scale in Re, Nu → h, and ΔP. Small D_h = strong convection AND steep friction.',
      how: `D_h = 2·b·H ÷ (b + H) for the b × H channel = ${fmt(r.hydraulic_diameter_mm, 3)} mm (design b and fin height H, exact)`,
    },
    open: {
      what: 'Open (coolant) fraction of the fin-band cross-section.',
      why: 'A depowdering/cleanability proxy and a sanity check — too low and the core is mostly metal; too high wastes fin area.',
      how: `channels ÷ pitch = n_ch·b ÷ (n_fin·t + n_ch·b) = ${pct(r.open_volume_fraction, 1)}`,
    },
  }

  const S_INFO: Record<string, MetricInfo> = {
    afin: {
      what: 'Structure-only surface area: every coolant-washed fin face (no channel floors).',
      why: 'The raw area the fins add over a bare cold plate — the amplification is the whole point of microfins.',
      how: `n_fin × 2 sides × H × wavy arc length × passes = ${r.areas ? fmtInt(r.areas.fin_mm2) : '—'} mm² = ×${r.areas ? fmt(r.areas.amplification, 0) : '—'} the die footprint${dieMm2 ? ` (${fmtInt(dieMm2)} mm²)` : ''}`,
    },
    aeff: {
      what: 'The fin area that actually works, after fin efficiency.',
      why: 'Thin tall fins are cold at the tip — raw area flatters them. This is the honest area.',
      how: `A_fin × η_f = ${r.areas ? fmtInt(r.areas.fin_mm2) : '—'} × ${r.eta_f != null ? fmt(r.eta_f, 3) : '—'} = ${r.areas ? fmtInt(r.areas.fin_eff_mm2) : '—'} mm²`,
    },
    aflow: {
      what: 'Total open cross-section the coolant flows through.',
      why: 'With the flow rate it fixes velocity — the hydraulic side of every trade.',
      how: `n_ch × b × H × parallel paths = ${r.areas ? fmtInt(r.areas.flow_mm2) : '—'} mm²`,
    },
    savr: {
      what: 'Wetted surface per unit of fin-band envelope volume — the packing density.',
      why: 'Diagnostic, not a goal: it counts area, not whether that area is hot enough to matter.',
      how: Vcore != null && wetMm2 != null && W != null && L != null && Hc != null
        ? `wetted ${fmtInt(wetMm2)} mm² ÷ V_core (${fmt(W, 1)} × ${fmt(L, 1)} × ${fmt(Hc, 1)} mm = ${fmtInt(Vcore)} mm³) = ${fmt(r.raw_SA_V_m2_m3, 0)} m²/m³ — V_core is the core envelope, base slab excluded, design dims exactly as entered`
        : `wetted area ÷ core envelope = ${fmt(r.raw_SA_V_m2_m3, 0)} m²/m³`,
    },
    save: {
      what: 'SA/V after derating by what actually transfers heat.',
      why: 'When thinner/taller fins raise raw SA/V but this stalls, you\'ve hit the fin-efficiency plateau — more packing buys ΔP, not kelvin.',
      how: `SA/V raw × η_o (× flow uniformity × access) = ${fmt(r.raw_SA_V_m2_m3, 0)} × ${r.eta_o != null ? fmt(r.eta_o, 3) : '—'} → ${fmt(r.effective_SA_V_m2_m3, 0)} m²/m³`,
    },
    etaf: {
      what: 'Single-fin efficiency — how much of each fin runs at base temperature.',
      why: 'The physics that punishes thin tall fins: conduction up the fin can\'t keep the tip hot.',
      how: `η_f = tanh(mH)/(mH), m = √(2h ÷ (k_solid·t)) → ${r.eta_f != null ? fmt(r.eta_f, 3) : '—'} (h from Nu·k_fluid/D_h on this geometry)`,
    },
    etao: {
      what: 'Overall surface efficiency — fins at η_f, channel floors at 100%.',
      why: 'The single derating between raw wetted area and the UA that fights R_jc.',
      how: `η_o = 1 − (A_fin/A_wet)·(1 − η_f) = ${r.eta_o != null ? fmt(r.eta_o, 3) : '—'}`,
    },
    ua: {
      what: 'Overall conductance of the wetted surface.',
      why: 'Convection\'s contribution to R_jc is exactly 1/UA — this is the lever the fins pull.',
      how: `UA = h × A_wet × η_o (× uniformity × access) = ${fmt(r.UA_W_K, 1)} W/K → R_conv = 1/UA = ${milliKW(r.R_th_conv_K_W)} mK/W`,
    },
    cov: {
      what: 'Cooled (finned) footprint over die footprint.',
      why: 'Below 1.0 part of the die has no fins above it and relies on lateral spreading in the base — the gate flags it (CHT check required).',
      how: W != null && L != null && dieMm2 != null
        ? `core W×L ÷ die = ${fmt(W, 1)} × ${fmt(L, 1)} (${fmtInt(W * L)} mm²) ÷ ${fmtInt(dieMm2)} mm² = ${fmt(r.coverage, 3)}`
        : `cooled area ÷ die area = ${fmt(r.coverage, 3)}`,
    },
    dt450: {
      what: 'Junction rise above coolant at the sustained load.',
      why: 'The kelvin the design costs at spec power — the number reviewers compare.',
      how: `Q × R_jc = ${fmt(q450, 0)} W × ${milliKW(r.R_jc_K_W)} mK/W = ${fmt(r.heat_load_deltaT_K, 2)} K`,
    },
    dt575: {
      what: 'Junction rise at the margin (transient/OC) load.',
      why: 'Headroom check against the ceiling when the die spikes.',
      how: `Q × R_jc = ${fmt(q575, 0)} W × ${milliKW(r.R_jc_K_W)} mK/W = ${fmt(r.margin_heat_load_deltaT_K, 2)} K`,
    },
    mass: {
      what: 'Copper mass of the printed part (fins + base + rib as modeled).',
      why: 'Cost, sinter distortion risk and the mechanical load on the board all scale with it.',
      how: `solid volume × 8.96 g/cm³ = ${r.mass_g != null ? fmt(r.mass_g, 1) : '—'} g`,
    },
    cost: {
      what: 'Raw copper material cost at the configured $/kg.',
      why: 'Order-of-magnitude sanity — print time, not feedstock, dominates the part price.',
      how: `mass × Cu price = ${r.mass_g != null ? fmt(r.mass_g, 1) : '—'} g → $${r.material_cost_usd != null ? fmt(r.material_cost_usd, 2) : '—'}`,
    },
  }

  return (
    <>
      <div className="card">
        <h2>Junction-to-coolant <span className="m-hint muted">click a value for the math</span></h2>
        <div className="kpi-hero m-click" title="click for what / why / calculation"
          onClick={() => setOpenJ(openJ === 'rjc' ? null : 'rjc')}>
          <span className="val" style={{ color: rjcPass ? 'var(--accent2)' : 'var(--fail)' }}>
            {milliKW(r.R_jc_K_W)}
          </span>
          <span className="unit">mK/W R_jc</span>
          <span style={{ marginLeft: 'auto' }}
            className={`badge ${screening ? 'screen' : rjcPass ? 'pass' : 'fail'}`}>
            {r.kpi_status}
          </span>
        </div>
        <div className="m-click" title="click for what / why / calculation"
          onClick={() => setOpenJ(openJ === 'gate' ? null : 'gate')}>
          <LimitBar label={t ? 'R_jc vs derived gate' : 'R_jc vs gate'} value={r.R_jc_K_W}
            limit={rjcGate} display={milliKW(r.R_jc_K_W)} unit="mK/W" />
        </div>
        {r.r_jc_band && (
          <div className="rjc-band muted">
            k-solid band: <b>{milliKW(r.r_jc_band.R_jc_optimistic_K_W)}–{milliKW(r.r_jc_band.R_jc_conservative_K_W)}</b> mK/W
            {' '}over k {fmt(r.r_jc_band.optimistic_k, 0)}–{fmt(r.r_jc_band.conservative_k, 0)} W/mK
            {' '}(nominal {fmt(r.r_jc_band.nominal_k, 0)})
          </div>
        )}
        {t && (
          <div className="m-click" title="click for what / why / calculation"
            onClick={() => setOpenJ(openJ === 'tj' ? null : 'tj')}>
            <JunctionTemp t={t} />
          </div>
        )}
        <Expl id={null} open={openJ} infos={J_INFO} />
        <div style={{ marginTop: 12 }}>
          <ResistanceStackup r={r} />
        </div>
      </div>

      <div className="card">
        <h2>Hydraulics</h2>
        <div className="m-click" title="click for what / why / calculation"
          onClick={() => setOpenH(openH === 'dp' ? null : 'dp')}>
          <LimitBar label="Pressure drop" value={r.DeltaP_Pa} limit={gates.limit_deltaP_Pa}
            display={kPa(r.DeltaP_Pa)} unit="kPa" />
        </div>
        <div className="m-click" title="click for what / why / calculation"
          onClick={() => setOpenH(openH === 'pump' ? null : 'pump')}>
          <LimitBar label="Pump power" value={r.pump_power_W} limit={gates.limit_pump_W}
            display={fmt(r.pump_power_W, 3)} unit="W" />
        </div>
        <div className="metrics" style={{ marginTop: 10 }}>
          <Metric label="Velocity" value={`${fmt(r.velocity_m_s, 3)} m/s`} id="vel" open={openH} onToggle={setOpenH} />
          <Metric label="Re" value={fmt(r.Re, 0)} id="re" open={openH} onToggle={setOpenH} />
          <Metric label="D_h" value={`${fmt(r.hydraulic_diameter_mm, 3)} mm`} id="dh" open={openH} onToggle={setOpenH} />
          <Metric label="Open frac" value={pct(r.open_volume_fraction, 1)} id="open" open={openH} onToggle={setOpenH} />
        </div>
        <Expl id={null} open={openH} infos={H_INFO} />
      </div>

      <div className="card">
        <h2>Surface & thermal
          <span className="muted" style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}
            title={'Every number on this card is exact geometry from the design dims as entered '
              + '(t, b, H, A, λ, core W×L×H) — SA/V = wetted area ÷ core envelope (W × L × fin H). '
              + 'NO sintering shrink is applied to any performance number; the ×1.197/×1.23 scale '
              + 'exists only in the manufacturing layer (px checks, ⇄ CAD). If you are comparing '
              + 'against a print-scaled (green) mesh in Magics/nTop, convert that file once — '
              + 'or type its dims into the sliders to score that geometry exactly.'}>
            exact from design dims · no shrink ⓘ</span>
        </h2>
        {r.areas && (
          <div className="areas-strip">
            <div className={`areas-main m-click${openS === 'afin' ? ' m-open' : ''}`}
              title="click for what / why / calculation"
              onClick={() => setOpenS(openS === 'afin' ? null : 'afin')}>
              <span className="a-label">A_fin</span>
              <b>{fmtInt(r.areas.fin_mm2)}</b> <span className="muted">mm²</span>
              <span className="a-amp">×{fmt(r.areas.amplification, 0)} die</span>
            </div>
            <div className={`areas-main m-click${openS === 'aeff' ? ' m-open' : ''}`}
              title="click for what / why / calculation"
              onClick={() => setOpenS(openS === 'aeff' ? null : 'aeff')}>
              <span className="a-label">A_eff</span>
              <b>{fmtInt(r.areas.fin_eff_mm2)}</b> <span className="muted">mm²</span>
              <span className="a-amp eff">×{fmt(r.areas.amplification_eff, 1)} die</span>
            </div>
            <div className={`areas-main m-click${openS === 'aflow' ? ' m-open' : ''}`}
              title="click for what / why / calculation"
              onClick={() => setOpenS(openS === 'aflow' ? null : 'aflow')}>
              <span className="a-label">A_flow</span>
              <b>{fmtInt(r.areas.flow_mm2)}</b> <span className="muted">mm²</span>
            </div>
          </div>
        )}
        <div className="metrics">
          <Metric label="SA/V raw" value={`${fmt(r.raw_SA_V_m2_m3, 0)}`} id="savr" open={openS} onToggle={setOpenS} />
          <Metric label="SA/V eff" value={`${fmt(r.effective_SA_V_m2_m3, 0)}`} id="save" open={openS} onToggle={setOpenS} />
          <Metric label="η_f" value={r.eta_f == null ? '—' : fmt(r.eta_f, 3)} id="etaf" open={openS} onToggle={setOpenS} />
          <Metric label="η_o" value={r.eta_o == null ? '—' : fmt(r.eta_o, 3)} id="etao" open={openS} onToggle={setOpenS} />
          <Metric label="UA" value={`${fmt(r.UA_W_K, 1)} W/K`} id="ua" open={openS} onToggle={setOpenS} />
          <Metric label="Coverage" value={fmt(r.coverage, 3)} id="cov" open={openS} onToggle={setOpenS} />
          <Metric label="ΔT @450W" value={`${fmt(r.heat_load_deltaT_K, 2)} K`} id="dt450" open={openS} onToggle={setOpenS} />
          <Metric label="ΔT @575W" value={`${fmt(r.margin_heat_load_deltaT_K, 2)} K`} id="dt575" open={openS} onToggle={setOpenS} />
          {r.mass_g != null && <Metric label="Cu mass" value={`${fmt(r.mass_g, 1)} g`} id="mass" open={openS} onToggle={setOpenS} />}
          {r.material_cost_usd != null && <Metric label="Material $" value={`$${fmt(r.material_cost_usd, 2)}`} id="cost" open={openS} onToggle={setOpenS} />}
        </div>
        <Expl id={null} open={openS} infos={S_INFO} />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge stage">{r.validation_stage}</span>
          <span className="badge stage">{r.process_route}</span>
        </div>
      </div>

      {r.manufacturability && <MfgCard m={r.manufacturability} />}

      {r.warnings.length > 0 && (
        <div className="warn-box">
          <b>⚠ {r.warnings.length} warning(s)</b>
          <ul>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </>
  )
}
