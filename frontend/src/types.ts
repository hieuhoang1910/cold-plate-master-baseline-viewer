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
  kpi_status: string
  feasible: boolean
}

export interface SweepResult {
  x_var: string
  y_var: string
  objective: string
  grid: SweepPoint[]
  pareto: SweepPoint[]
  optimum: SweepPoint | null
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
  // operating
  flow_lpm: number
}
