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

export interface Catalog {
  design_parameters: unknown
  candidates: BaselineResult[]
  gates: Gates
}
