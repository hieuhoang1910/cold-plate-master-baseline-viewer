// V2.1: fluid-property block attached to a result when a coolant was requested.
export interface CoolantInfo {
  coolant: string
  label: string
  rho_kg_m3: number
  mu_Pa_s: number
  k_fluid_W_mK: number
  cp_J_kgK: number
  T_eval_C: number
  extrapolated: boolean
  warnings: string[]
}

// V2.1: targets block attached to a result when a T_j target was requested.
export interface TargetsInfo {
  R_jc_gate_K_W: number
  caloric_dT_K: number
  mean_coolant_C: number
  mdot_cp_W_K: number
  T_j_max_C: number
  derivation: string
  T_j_C: number
  NTU: number
  effectiveness: number
  coolant_out_C: number
  wall_to_inlet_K: number
  conduction_rise_K: number
  T_j_pass: boolean | null
  warnings: string[]
}

// V3.2 — absolute area readouts (fin/structure-only; no channel-floor base).
// All areas in mm² (user request 2026-07-09).
export interface AreasInfo {
  die_mm2: number
  cooled_mm2: number
  fin_mm2: number
  fin_eff_mm2: number
  flow_mm2: number
  wetted_mm2: number
  amplification: number | null
  amplification_eff: number | null
}

// V3.3 — manufacturability verdict from the per-route DfAM rulebook.
export interface MfgCheck {
  rule: string
  label: string
  value: number | null
  abs: number | null
  rec: number | null
  status: 'PASS' | 'MARGINAL' | 'FAIL' | 'INFO'
  message: string
}
export interface MfgInfo {
  route: string
  label: string
  grade: string
  source: string
  verdict: 'PASS' | 'MARGINAL' | 'FAIL'
  checks: MfgCheck[]
}

// V5.1 — S6 flow-network block (fin families only; additive, spec §47).
export interface FlowPathInfo {
  label: string
  flow_fraction: number
  velocity_m_s: number
  Re: number
}
export interface FlowNetworkBlock {
  supported: boolean
  model: string
  layout: string
  n_paths?: number
  deltaP_Pa?: number
  deltaP_breakdown?: { friction_Pa?: number; minor_Pa?: number }
  per_path?: FlowPathInfo[]
  uniformity_computed?: number
  uniformity_assumed?: number
  assumptions?: string[]
  warnings?: string[]
  applied_to_kpis?: boolean
  reconciliation?: {
    solver_deltaP_Pa: number
    network_deltaP_Pa: number
    ratio: number
    within_tolerance: boolean
    tolerance: number
  }
  note?: string
  error?: string
}

// Mirrors the master engine BaselineResult (asdict) returned by the API.
export interface BaselineResult {
  design_id: string
  family: string
  process_route: string
  validation_stage: string
  coverage: number
  R_th_conv_K_W: number
  R_base_K_W: number
  R_TIM_K_W: number
  R_jc_K_W: number
  conv_fraction: number
  DeltaP_Pa: number
  pump_power_W: number
  velocity_m_s: number
  Re: number
  hydraulic_diameter_mm: number
  open_volume_fraction: number
  raw_SA_V_m2_m3: number
  effective_SA_V_m2_m3: number
  wetted_area_m2: number
  flow_area_m2: number
  fin_area_m2?: number | null
  // 2026-08-05 — SA/V denominator factors echoed by the engine (the stack
  // actually used — a pinned row's own core, not the project's)
  core_width_mm?: number | null
  core_length_mm?: number | null
  core_height_mm?: number | null
  UA_W_K: number
  eta_f: number | null
  eta_o: number | null
  heat_load_deltaT_K: number
  margin_heat_load_deltaT_K: number
  kpi_status: string
  warnings: string[]
  // V2.1 — present only when the request included coolant / targets.
  coolant?: CoolantInfo
  targets?: TargetsInfo
  // V2.2 — set on saved user designs surfaced as candidates.
  saved?: boolean
  name?: string
  // V2.6 — mass/material (always) + k-solid R_jc uncertainty band (on request).
  mass_g?: number
  material_cost_usd?: number
  r_jc_band?: {
    conservative_k: number
    R_jc_conservative_K_W: number
    optimistic_k: number
    R_jc_optimistic_K_W: number
    nominal_k: number
    R_jc_nominal_K_W: number
  }
  // V3 — always attached by the API (areas + manufacturability verdict).
  areas?: AreasInfo
  manufacturability?: MfgInfo
  // V3.3 — set on the built-in Incus M-presets.
  preset?: boolean
  // 2026-07-31 — set on fixed references scored on their own as-sent envelope
  // (Prototype 1): project settings never rescale a part that exists.
  pinned?: boolean
  // V5.1 — S6 flow-network block (fin families; spec §47).
  flow_network?: FlowNetworkBlock
}

// V2.1 — /api/schema (wizard metadata). Only the parts the viewer uses today.
export interface CoolantPreset {
  name: string
  label: string
  note: string
  preview_25C: { rho_kg_m3: number; mu_Pa_s: number; k_fluid_W_mK: number; cp_J_kgK: number }
  T_range_C: [number, number]
}
export interface TargetField {
  default: number
  min: number
  max: number
  soft_target?: number
  help?: string
}
export interface AppSchema {
  coolants: CoolantPreset[]
  targets: Record<string, TargetField>
  families: { family: string; label: string; model: string; status: string; viewable: boolean }[]
  layouts: { layout: string; label: string; status: string; resolves: string }[]
  // V3.3 — DfAM rulebooks + LMM process constants + enforcement modes.
  manufacturing?: {
    routes: Record<string, unknown>[]
    lmm_process: Record<string, number>
    enforcement_modes: { key: string; label: string; hint: string }[]
  }
}

export interface Gates {
  limit_R_jc_K_W: number
  limit_deltaP_Pa: number
  limit_pump_W: number
}

// Input geometry for one design (from baseline_cases.json).
export interface DesignCase {
  design_id: string
  family: string
  process_route?: string
  validation_stage?: string
  /** fixed reference (e.g. Prototype 1): its own as-sent envelope — scoring
   *  and the viewer use these stack overrides instead of the project basis */
  pinned_stack?: Record<string, number>
  fin_thickness_mm?: number
  channel_gap_mm?: number
  fin_height_mm?: number
  side_margin_mm?: number
  wave_amplitude_mm?: number
  wavelength_mm?: number
  void_fraction?: number
  surface_area_density_m2_m3?: number
  hydraulic_diameter_mm?: number
  unit_cell_mm?: number
  wall_thickness_mm?: number
  tpms_type?: string
  tpms_layout?: string
  cell_grading?: number
  tpms_solid?: boolean
  pin_diameter_mm?: number
  pin_pitch_mm?: number
  pin_pattern?: string
  notes?: string
}

export interface StackBasis {
  die_width_mm: number
  die_length_mm: number
  core_width_mm: number
  core_length_mm: number
  core_height_mm: number
  base_thickness_mm: number
  k_solid_W_mK?: number
  tim_areal_Kcm2_W?: number
}

export interface Basis {
  stack: StackBasis
  operating: Record<string, number | string>
  architecture: Record<string, number | string>
}

export interface Catalog {
  design_parameters: unknown
  candidates: BaselineResult[]
  cases: DesignCase[]
  basis: Basis
  gates: Gates
  // V2.2 — present when the catalog was computed for a project (POST /api/catalog)
  project?: { id: string; name: string; builtin: boolean; families?: string[] }
  coolant?: CoolantInfo
  targets?: TargetsInfo
}

// V2.2 — a Project scopes the whole app to a user-defined problem (spec §19).
export interface Project {
  id?: string
  name: string
  schema_version?: number
  builtin?: boolean
  description?: string
  problem: {
    die_width_mm: number
    die_length_mm: number
    core_width_mm: number
    core_length_mm: number
    core_height_mm: number
    base_thickness_mm: number
    k_solid_W_mK: number
    tim_areal_Kcm2_W: number
    coolant: string
  }
  operating: {
    heat_load_W: number
    margin_heat_load_W?: number
    flow_lpm: number
    T_inlet_C: number
  }
  targets: {
    T_j_max_C?: number
    R_jc_gate_override?: number | null
    limit_deltaP_Pa?: number
    limit_pump_W?: number
  }
  architecture: {
    name?: string
    n_parallel_paths?: number
    path_length_mm?: number
    header_K_total?: number
    flow_uniformity?: number
  }
  families?: string[]
  designs?: SavedDesign[]
  physical_footprint?: { width_mm: number; length_mm: number }
  // V3.3 §35F — how hard the manufacturing rulebook binds this project.
  manufacturing?: { enforcement?: 'enforce' | 'marginal' | 'explore' }
  created?: string | null
  modified?: string | null
}

// V2.2 — a design saved onto a project; surfaces as a named candidate.
export interface SavedDesign {
  name: string
  design: DesignState
}

export interface ProjectSummary {
  id: string
  name: string
  builtin: boolean
  created: string | null
  modified: string | null
}

// Optimizer sweep (Phase 5).
export interface SweepPoint {
  x: number
  y: number
  objective: number | null
  R_jc_K_W: number | null
  R_th_conv_K_W: number | null
  DeltaP_Pa: number | null
  pump_power_W: number | null
  mass_g: number | null
  cop: number | null
  kpi_status: string
  feasible: boolean
  // V3.3 — per-point manufacturability verdict (PASS/MARGINAL/FAIL, null = invalid)
  mfg?: 'PASS' | 'MARGINAL' | 'FAIL' | null
}

export interface SweepResult {
  x_var: string
  y_var: string
  objective: string
  objective_dir: 'min' | 'max'
  grid: SweepPoint[]
  pareto: SweepPoint[]
  optimum: SweepPoint | null
  // V3.3 — gates-only best point (the ghost ☆); the gap to `optimum` is the
  // price of manufacturability. Equal to `optimum` when no enforcement sent.
  optimum_unconstrained?: SweepPoint | null
  mfg_enforce?: string | null
  r_jc_floor_K_W: number | null
  r_jc_gate_K_W: number | null
  // V2 tier-2 — the budgets every grid point was judged against (from the
  // active project's targets; engine defaults when none were sent).
  gates?: {
    limit_R_jc_K_W: number | null
    limit_deltaP_Pa: number | null
    limit_pump_W: number | null
  } | null
}

// Editable live-design parameters (Phase 4 sliders; Phase 6 adds gyroid fields).
export interface DesignState {
  design_id: string        // source candidate the design was seeded from
  family: string
  process_route: string
  /** carried from a pinned reference case — live evaluate + viewer stay on
   *  the as-sent envelope, not the project's */
  pinned_stack?: Record<string, number>
  // fin families
  fin_thickness_mm: number
  channel_gap_mm: number
  fin_height_mm: number
  side_margin_mm: number
  wave_amplitude_mm: number
  wavelength_mm: number
  /** how the wavy fin field is built — 'shear' (default, what this app's
   *  rasterizer and the Proto 2 nTop model do) or 'offset' (constant-thickness
   *  band swept along the curve, as Prototype 1). Manufacturability only. */
  wave_construction?: 'shear' | 'offset'
  // gyroid / TPMS
  unit_cell_mm: number
  wall_thickness_mm: number
  void_fraction: number
  surface_area_density_m2_m3: number
  hydraulic_diameter_mm: number
  heat_transfer_multiplier: number
  pressure_loss_multiplier: number
  // TPMS / lattice geometry-screening variants (viewer-only; no analytical model yet)
  tpms_type: string        // gyroid|diamond|schwarz_p|lidinoid|split_p|iwp|neovius|fischer_koch|pin_fins
  tpms_layout: string      // rectangular | cylinder
  cell_grading: number     // 0 = uniform, >0 = radially graded (jet-adaptive)
  tpms_solid: boolean      // false = shelled sheet, true = solid/network fill
  pin_diameter_mm: number  // pin-fin structure only
  pin_pitch_mm: number
  pin_pattern: string      // inline | staggered
  // operating
  flow_lpm: number
}
