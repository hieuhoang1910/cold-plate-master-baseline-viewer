import { fmt, kPa, milliKW, pct } from './format'
import { LMM_PROC, normalizeRoute } from './manufacturing'
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
  L.push(`_Generated ${dateStr} · Cold Plate Master Baseline Viewer · Hieu Hoang — Vinnotek · numbers from the validated Python solvers_`)
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
    if (r.areas) L.push(`| Areas (V3) | A_fin ${fmt(r.areas.fin_mm2, 0)} mm² (×${fmt(r.areas.amplification, 0)} die) · A_eff ${fmt(r.areas.fin_eff_mm2, 0)} mm² (×${fmt(r.areas.amplification_eff, 1)}) · A_flow ${fmt(r.areas.flow_mm2, 0)} mm² · A_wet ${fmt(r.areas.wetted_mm2, 0)} mm² (model basis, incl. floor) |`)
    L.push(`| Temperature rise | ΔT@450W ${fmt(r.heat_load_deltaT_K, 2)} K · ΔT@575W ${fmt(r.margin_heat_load_deltaT_K, 2)} K${r.targets ? ` · Tⱼ ${fmt(r.targets.T_j_C, 1)} °C` : ''} |`)
    if (r.mass_g != null) L.push(`| Mass / material | ${fmt(r.mass_g, 1)} g Cu · ~$${fmt(r.material_cost_usd ?? 0, 2)} (powder only, excl. AM machine time) |`)
    L.push(`| Status | **${r.kpi_status}** |`)
    if (r.manufacturability) L.push(`| Manufacturability | **${r.manufacturability.verdict}** — ${r.manufacturability.label} (${r.manufacturability.grade}) |`)
    L.push('')
    if (r.manufacturability) {
      const bad = r.manufacturability.checks.filter((c) => c.status !== 'PASS')
      if (bad.length) {
        L.push('**Manufacturability findings** (' + r.manufacturability.source + '):')
        bad.forEach((c) => L.push(`- ${c.status}: ${c.label} — ${c.message}`))
        L.push('')
      }
    }
    if (r.warnings?.length) {
      L.push('**Warnings / caveats for this design:**')
      r.warnings.forEach((w) => L.push(`- ${w}`))
      L.push('')
    }
  } else {
    L.push('_No fin/gyroid design selected (select a viewable candidate to include its KPIs)._', '')
  }

  // 4. Candidate comparison
  // 3b. V5.6 — Flow & thermal intent: the CFD confirmation checklist (spec §52).
  // Claims are machine-checkable by id; S6/F1-backed rows are PREDICTIONS.
  const fn = r?.flow_network
  if (fn?.supported && O) {
    const rho = c?.rho_kg_m3 ?? 997
    const cp = c?.cp_J_kgK ?? 4181
    const TIn = c?.T_eval_C ?? O.T_inlet_C ?? 25
    const mcp = (O.flow_lpm / 60000) * rho * cp
    const dTcal = mcp > 0 ? O.heat_load_W / mcp : NaN
    const fr = (fn.per_path ?? []).map((p) => p.flow_fraction)
    const bd = fn.deltaP_breakdown ?? {}
    const jet = String(A?.name ?? '').includes('jet')
    const centreFeed = String(A?.name ?? '').includes('centre_rib') || String(A?.name ?? '') === 'center_feed_bidirectional'
    L.push('## 3b. Flow & thermal intent — CFD confirmation checklist')
    L.push('_The design states these checkably (spec §52). S6 = network-solved prediction; T0 = geometric intent. Ansys confirms; KPIs never read from the viz solvers._')
    L.push('')
    L.push('| id | Claim | Value (live) | Tier | CFD confirms by |', '|---|---|---|---|---|')
    if (fr.length) {
      L.push(`| FC-1 | per-path flow split | ${fn.n_paths} paths · min ${pct(Math.min(...fr), 1)} / max ${pct(Math.max(...fr), 1)} | S6 | mass flow per path/compartment |`)
    }
    L.push(`| FC-2 | flow uniformity | computed **${fmt(fn.uniformity_computed ?? 1, 3)}** vs assumed ${fmt(fn.uniformity_assumed ?? 1, 2)} | S6 | velocity histogram across channels |`)
    L.push(`| FC-3 | pressure budget | ΔP ${kPa(fn.deltaP_Pa ?? 0)} kPa = ${kPa(bd.friction_Pa ?? 0)} friction + ${kPa(bd.minor_Pa ?? 0)} minor | S6 | pressure taps (plane-averaged) |`)
    L.push(`| FC-4 | outlet temperature | ${fmt(TIn + dTcal, 2)} °C (T_in ${fmt(TIn, 1)} + ΔT_cal ${fmt(dTcal, 2)} K) | 1-D | outlet probe |`)
    L.push(`| FC-5 | low-flow zones | F1 field layer in the viewer (≈ Flow) — qualitative candidates | F1 | recirculation / stagnation check |`)
    if (jet) L.push('| FC-6 | jet aimed at the rib crown / feed slots | geometric | T0 | stagnation-line location |')
    if (centreFeed || jet) L.push('| FC-7 | wedge rib crown softens the central turn → better fin wetting (mesh-verified: 0.50 → 0.08 mm taper, ≈5° — hypothesis, no sim) | T0 | wall-shear / wetting coverage vs a sharp rib |')
    if (fn.reconciliation) {
      L.push('')
      L.push(`Reconciliation (§49): S6 network ΔP ${kPa(fn.reconciliation.network_deltaP_Pa)} kPa vs solver ${kPa(fn.reconciliation.solver_deltaP_Pa)} kPa — ratio ${fmt(fn.reconciliation.ratio, 3)} (${fn.reconciliation.within_tolerance ? 'within' : 'OUTSIDE'} ±${pct(fn.reconciliation.tolerance, 0)}).`)
    }
    L.push('')
  }

  // §4 — M1-and-forward only (user decision 2026-08-03): the default catalog
  // rows (v6 hero, straight, supplier floor, LPBF fallback, gyroid screening)
  // are physics references, not build candidates. Performance and the Incus
  // pixel checks share ONE table, each px cell as have/Paul's-reference.
  const toPx = (mm: number) => mm * LMM_PROC.shrinkXY / LMM_PROC.pixelMm
  const glyph = (s: string) => (s === 'FAIL' ? ' ✗' : s === 'MARGINAL' ? ' ⚠' : '')
  const pxCell = (k: BaselineResult, rule: string, ref: 'rec' | 'abs') => {
    if (normalizeRoute(k.process_route) !== 'LMM') return '—'
    const c = k.manufacturability?.checks.find((x) => x.rule === rule)
    if (!c || c.value == null) return '—'
    const bound = ref === 'rec' ? (c.rec ?? c.abs) : (c.abs ?? c.rec)
    return `${fmt(toPx(c.value), 1)}/${bound != null ? fmt(toPx(bound), 0) : '—'}${glyph(c.status)}`
  }
  const mRows = catalog.candidates.filter((k) => k.preset || k.saved)
  const rows = mRows.length ? mRows : catalog.candidates
  L.push('## 4. Candidate comparison — M1 and forward')
  if (mRows.length) L.push('_Default catalog reference rows (v6 hero, straight fin, supplier floor, LPBF fallback, gyroid screening) are excluded — Incus M-presets + this project\'s saved designs only._')
  L.push('_SA = fin-only structure area / effective (η_f × uniformity × access derated). Pixel cells are **have/reference** in GREEN px (35 µm px; final mm × 1.197 ÷ 0.035 — Incus guidelines 07/2026): fin t vs the 4 px recommendation, gap b vs the 8 px deep-channel recommendation (6 px floor), perpendicular passage at max wave slope vs its 6 px floor (hard rule, no rec tier — at zero slope perp = gap). ⚠ marginal · ✗ below floor._')
  L.push('| Design | Family | Route | SA fin/eff (mm²) | R_jc (mK/W) | ΔP (kPa) | pump (W) | fin t (px) | gap b (px) | perp (px) | Mfg | Status |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|')
  rows.forEach((k) => {
    const pass = k.R_jc_K_W <= g.limit_R_jc_K_W
    const sa = k.areas ? `${fmt(k.areas.fin_mm2, 0)} / ${fmt(k.areas.fin_eff_mm2, 0)}` : '—'
    L.push(`| ${k.name ?? k.design_id}${k.pinned ? ' (pinned)' : ''} | ${k.family} | ${k.process_route} | ${sa} | ${milliKW(k.R_jc_K_W)}${pass ? '' : ' ⚠'} | ${kPa(k.DeltaP_Pa)} | ${fmt(k.pump_power_W, 3)} | ${pxCell(k, 'wall_min', 'rec')} | ${pxCell(k, 'gap_min', 'rec')} | ${pxCell(k, 'gap_perp', 'abs')} | ${k.manufacturability?.verdict ?? '—'} | ${k.kpi_status} |`)
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
