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
}

export interface SweepResult {
  x_var: string
  y_var: string
  objective: string
  objective_dir: 'min' | 'max'
  grid: SweepPoint[]
  pareto: SweepPoint[]
  optimum: SweepPoint | null
  r_jc_floor_K_W: number | null
  r_jc_gate_K_W: number | null
}

// Editable live-design parameters (Phase 4 sliders; Phase 6 adds gyroid fields).
export interface DesignState {
  design_id: string        // source candidate the design was seeded from
  family: string
  process_route: string
  // fin families
  fin_thickness_mm: number
  channel_gap_mm: number
  fin_height_mm: number
  side_margin_mm: number
  wave_amplitude_mm: number
  wavelength_mm: number
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
