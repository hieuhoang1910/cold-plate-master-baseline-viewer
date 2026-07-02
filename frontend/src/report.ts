import { fmt, kPa, milliKW, pct } from './format'
import type { BaselineResult, Catalog, DesignState, Project } from './types'

// V2.6 — assemble a print-ready Markdown design-review from the current state
// (project + selected design + KPIs + candidate table + provenance). Pure.

function geomSummary(d: DesignState | null): string {
  if (!d) return '—'
  if (d.family === 'gyroid_tpms') {
    const pin = d.tpms_type === 'pin_fins'
    return pin
      ? `pin fins · Ø${fmt(d.pin_diameter_mm, 2)} mm · pitch ${fmt(d.pin_pitch_mm, 2)} mm · ${d.pin_pattern}`
      : `${d.tpms_type} · cell ${fmt(d.unit_cell_mm, 2)} mm · wall ${fmt(d.wall_thickness_mm, 2)} mm`
        + (d.cell_grading > 0 ? ` · grading ${fmt(d.cell_grading, 2)}` : '')
  }
  return `t ${fmt(d.fin_thickness_mm, 2)} · b ${fmt(d.channel_gap_mm, 2)} · H ${fmt(d.fin_height_mm, 2)} mm`
    + (d.family === 'straight_fin' ? '' : ` · A ${fmt(d.wave_amplitude_mm, 2)} · λ ${fmt(d.wavelength_mm, 2)} mm`)
}

export function generateReport(
  project: Project | null, catalog: Catalog, live: BaselineResult | null,
  design: DesignState | null, dateStr: string,
): string {
  const P = project?.problem
  const O = project?.operating
  const A = catalog.basis.architecture as Record<string, number | string>
  const c = catalog.coolant
  const g = catalog.gates
  const r = live
  const L: string[] = []

  L.push(`# Cold Plate Design Review — ${project?.name ?? 'design'}`)
  L.push(`_Generated ${dateStr} · Cold Plate Master Baseline Viewer · numbers from the validated Python solvers_`)
  L.push('')

  // 1. Problem
  L.push('## 1. Problem')
  L.push('| Field | Value |', '|---|---|')
  if (P) {
    L.push(`| Die footprint | ${fmt(P.die_width_mm, 0)} × ${fmt(P.die_length_mm, 0)} mm |`)
    L.push(`| Cooled core | ${fmt(P.core_width_mm, 0)} × ${fmt(P.core_length_mm, 0)} × ${fmt(P.core_height_mm, 1)} mm · base ${fmt(P.base_thickness_mm, 2)} mm |`)
    L.push(`| Material | k_solid ${fmt(P.k_solid_W_mK, 0)} W/mK (Cu-AM) · TIM ${fmt(P.tim_areal_Kcm2_W, 3)} K·cm²/W |`)
  }
  if (c) L.push(`| Coolant | ${c.label} @ ${fmt(c.T_eval_C, 0)} °C · ρ ${fmt(c.rho_kg_m3, 0)} · µ ${fmt(c.mu_Pa_s * 1e3, 3)} mPa·s · k ${fmt(c.k_fluid_W_mK, 3)} |`)
  if (O) L.push(`| Heat load | ${fmt(O.heat_load_W, 0)} W nominal / ${fmt(O.margin_heat_load_W ?? 575, 0)} W margin · flow ${fmt(O.flow_lpm, 2)} L/min |`)
  L.push(`| Layout | ${A?.name ?? '—'} · n_paths ${A?.n_parallel_paths ?? '—'} · path ${fmt(Number(A?.path_length_mm ?? 0), 1)} mm · header_K ${fmt(Number(A?.header_K_total ?? 0), 1)}${Number(A?.jet_flux_peaking) > 0 ? ' · central jet' : ''} |`)
  L.push('')

  // 2. Targets & gates
  L.push('## 2. Targets & gates')
  const t = catalog.targets
  if (t?.T_j_max_C != null) L.push(`- Max junction Tⱼ **${fmt(t.T_j_max_C, 0)} °C** → derived R_jc gate **${milliKW(g.limit_R_jc_K_W)} mK/W** (${t.derivation})`)
  L.push(`- Gates: R_jc ≤ **${milliKW(g.limit_R_jc_K_W)}** mK/W · ΔP ≤ **${kPa(g.limit_deltaP_Pa)}** kPa · pump ≤ **${fmt(g.limit_pump_W, 1)}** W`)
  L.push('')

  // 3. Selected design
  L.push(`## 3. Selected design — ${r?.name ?? r?.design_id ?? '(none)'}`)
  if (r) {
    L.push(`**${r.family}** · ${geomSummary(design)} · route ${r.process_route} · stage ${r.validation_stage}`)
    L.push('')
    L.push('| KPI | Value |', '|---|---|')
    const band = r.r_jc_band
      ? ` (k-band ${milliKW(r.r_jc_band.R_jc_optimistic_K_W)}–${milliKW(r.r_jc_band.R_jc_conservative_K_W)} over k ${fmt(r.r_jc_band.optimistic_k, 0)}–${fmt(r.r_jc_band.conservative_k, 0)})`
      : ''
    L.push(`| **R_jc** | **${milliKW(r.R_jc_K_W)} mK/W**${band} |`)
    L.push(`| R stack (base / TIM / conv) | ${milliKW(r.R_base_K_W)} / ${milliKW(r.R_TIM_K_W)} / ${milliKW(r.R_th_conv_K_W)} mK/W (conv ${pct(r.conv_fraction, 0)}) |`)
    L.push(`| Hydraulics | ΔP ${kPa(r.DeltaP_Pa)} kPa · pump ${fmt(r.pump_power_W, 3)} W · v ${fmt(r.velocity_m_s, 3)} m/s · Re ${fmt(r.Re, 0)} · D_h ${fmt(r.hydraulic_diameter_mm, 3)} mm |`)
    L.push(`| Surface | SA/V ${fmt(r.raw_SA_V_m2_m3, 0)} raw / ${fmt(r.effective_SA_V_m2_m3, 0)} eff · η_f ${r.eta_f == null ? '—' : fmt(r.eta_f, 3)} · η_o ${r.eta_o == null ? '—' : fmt(r.eta_o, 3)} · UA ${fmt(r.UA_W_K, 1)} W/K · coverage ${fmt(r.coverage, 2)} |`)
    L.push(`| Temperature rise | ΔT@450W ${fmt(r.heat_load_deltaT_K, 2)} K · ΔT@575W ${fmt(r.margin_heat_load_deltaT_K, 2)} K${r.targets ? ` · Tⱼ ${fmt(r.targets.T_j_C, 1)} °C` : ''} |`)
    if (r.mass_g != null) L.push(`| Mass / material | ${fmt(r.mass_g, 1)} g Cu · ~$${fmt(r.material_cost_usd ?? 0, 2)} (powder only, excl. AM machine time) |`)
    L.push(`| Status | **${r.kpi_status}** |`)
    L.push('')
    if (r.warnings?.length) {
      L.push('**Warnings / caveats for this design:**')
      r.warnings.forEach((w) => L.push(`- ${w}`))
      L.push('')
    }
  } else {
    L.push('_No fin/gyroid design selected (select a viewable candidate to include its KPIs)._', '')
  }

  // 4. Candidate comparison
  L.push('## 4. Candidate comparison')
  L.push('| Design | Family | Route | R_jc (mK/W) | ΔP (kPa) | pump (W) | Status |', '|---|---|---|---|---|---|---|')
  catalog.candidates.forEach((k) => {
    const pass = k.R_jc_K_W <= g.limit_R_jc_K_W
    L.push(`| ${k.name ?? k.design_id} | ${k.family} | ${k.process_route} | ${milliKW(k.R_jc_K_W)}${pass ? '' : ' ⚠'} | ${kPa(k.DeltaP_Pa)} | ${fmt(k.pump_power_W, 3)} | ${k.kpi_status} |`)
  })
  L.push('')

  // 5. Provenance
  L.push('## 5. Provenance & caveats')
  L.push('- Every number comes from the project\'s validated Python solvers (no second physics model in the browser).')
  L.push('- **Fin (wavy/straight):** Shah–London H1 laminar Nu + fRe, wavy multiplier — validated hero.')
  L.push('- **Pin fin (S1):** Zukauskas single-cylinder Nu + Gaddis–Gnielinski laminar ΔP — ANALYTICAL_LIT screening (overpredicts short pins).')
  L.push('- **Gyroid/Diamond (S2):** Renon & Jeanningros (2025) Nu/f + minimal-surface geometry — ANALYTICAL_LIT, *extrapolated* below the fitted Re range; Schwarz-P & others are SCREENING_ONLY.')
  L.push('- R_jc uncertainty band spans the Cu-AM conductivity range (k = 250/340/400 W/mK). Mass/cost is a screening proxy from the solid fraction.')
  L.push('- Screening-grade unless marked validated; confirm with CFD/CHT + supplier coupon before external claims.')
  L.push('')
  return L.join('\n')
}
