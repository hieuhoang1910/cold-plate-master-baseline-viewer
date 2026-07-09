import { evalPayload, isGyroid, isPinStructure, routeFloor, type ProblemOpts } from './design'
import type { Enforcement } from './manufacturing'
import type { Basis, DesignState } from './types'

export interface SweepVar { key: string; label: string }

// The full set (used for label lookup); sweepVarsFor() picks the family subset.
export const SWEEP_VARS: SweepVar[] = [
  { key: 'fin_thickness_mm', label: 'fin thickness t' },
  { key: 'channel_gap_mm', label: 'channel gap b' },
  { key: 'fin_height_mm', label: 'fin height H' },
  { key: 'wave_amplitude_mm', label: 'wave amplitude A' },
  { key: 'wavelength_mm', label: 'wavelength λ' },
  { key: 'unit_cell_mm', label: 'unit cell c' },
  { key: 'wall_thickness_mm', label: 'wall thickness w' },
  { key: 'cell_grading', label: 'cell grading' },
  { key: 'pin_diameter_mm', label: 'pin diameter d' },
  { key: 'pin_pitch_mm', label: 'pin pitch S' },
  { key: 'flow_lpm', label: 'flow rate V̇' },
]

const FIN_KEYS = ['fin_thickness_mm', 'channel_gap_mm', 'fin_height_mm', 'wave_amplitude_mm', 'wavelength_mm', 'flow_lpm']
const TPMS_KEYS = ['unit_cell_mm', 'wall_thickness_mm', 'cell_grading', 'flow_lpm']
const PIN_KEYS = ['pin_diameter_mm', 'pin_pitch_mm', 'flow_lpm']

/** Sweep variables valid for a design's family (fin vs TPMS sheet vs pin). */
export function sweepVarsFor(d: DesignState | null): SweepVar[] {
  const keys = !d ? FIN_KEYS
    : (isGyroid(d.family) && isPinStructure(d.tpms_type)) ? PIN_KEYS
      : isGyroid(d.family) ? TPMS_KEYS : FIN_KEYS
  return SWEEP_VARS.filter((v) => keys.includes(v.key))
}

// What to minimise across the grid, always subject to the problem's budgets
// (T_j gate + ΔP + pump): the optimum is the best FEASIBLE point. Mass and COP
// were dropped as objectives on review — with Q fixed, COP is just inverted
// pump power, and minimising mass drives to the flimsiest geometry; both stay
// as reported per-point metrics.
export interface Objective { key: string; label: string; short: string; unit: string; dir: 'min' | 'max'; scale: number; digits: number }
export const OBJECTIVES: Objective[] = [
  { key: 'R_jc_K_W', label: 'R_jc (thermal margin)', short: 'rjc', unit: 'mK/W', dir: 'min', scale: 1000, digits: 2 },
  { key: 'pump_power_W', label: 'pump power', short: 'pump', unit: 'W', dir: 'min', scale: 1, digits: 3 },
  { key: 'DeltaP_Pa', label: 'pressure drop', short: 'dp', unit: 'kPa', dir: 'min', scale: 1e-3, digits: 2 },
]
export function objectiveOf(key: string): Objective {
  return OBJECTIVES.find((o) => o.key === key) ?? OBJECTIVES[0]
}

export function varLabel(key: string): string {
  return SWEEP_VARS.find((v) => v.key === key)?.label ?? key
}
export function varUnit(key: string): string {
  if (key === 'flow_lpm') return 'L/min'
  if (key === 'cell_grading') return ''
  return 'mm'
}

/** Sweep range for a variable — mirrors the slider bounds; t/b/wall clamp to
 *  the route floor under the active enforcement mode (§35F). */
export function varRange(key: string, design: DesignState, mode: Enforcement = 'marginal'): { min: number; max: number } {
  const fl = routeFloor(design.process_route, mode)
  switch (key) {
    case 'fin_thickness_mm': return { min: fl.t, max: 0.3 }
    case 'channel_gap_mm': return { min: fl.b, max: 0.4 }
    case 'fin_height_mm': return { min: 2.0, max: 6.5 }
    case 'wave_amplitude_mm': return { min: 0.0, max: 1.0 }
    case 'wavelength_mm': return { min: 1.5, max: 6.0 }
    case 'unit_cell_mm': return { min: 1.0, max: 4.0 }
    case 'wall_thickness_mm': return { min: fl.t, max: 0.3 }
    case 'cell_grading': return { min: 0.0, max: 1.0 }
    case 'pin_diameter_mm': return { min: 0.2, max: 2.0 }
    case 'pin_pitch_mm': return { min: 0.5, max: 4.0 }
    case 'flow_lpm': return { min: 1.0, max: 4.0 }
    default: return { min: 0, max: 1 }
  }
}

export function buildSweepRequest(
  design: DesignState, basis: Basis, xVar: string, yVar: string,
  objective = 'R_jc_K_W', opts: ProblemOpts = {}, steps = 24,
  mode: Enforcement = 'marginal',
) {
  // Sweep the FULL physical range so the ghost ☆ (gates-only optimum) and the
  // infeasible shading stay visible; the server picks ★ from the compliant
  // pool per the enforcement mode (§35F).
  const rx = varRange(xVar, design, 'explore')
  const ry = varRange(yVar, design, 'explore')
  return {
    // Same family-aware case + coolant + targets as the live KPI evaluate, so
    // "feasible" in the sweep means "fits the active project's problem".
    base: evalPayload(design, basis, opts),
    x: { var: xVar, min: rx.min, max: rx.max, steps },
    y: { var: yVar, min: ry.min, max: ry.max, steps },
    objective,
    manufacturability: mode === 'explore' ? undefined : { enforce: mode },
  }
}
