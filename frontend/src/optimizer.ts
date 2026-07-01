import { routeFloor } from './design'
import type { Basis, DesignState } from './types'

export interface SweepVar { key: string; label: string }

export const SWEEP_VARS: SweepVar[] = [
  { key: 'fin_thickness_mm', label: 'fin thickness t' },
  { key: 'channel_gap_mm', label: 'channel gap b' },
  { key: 'fin_height_mm', label: 'fin height H' },
  { key: 'wave_amplitude_mm', label: 'wave amplitude A' },
  { key: 'wavelength_mm', label: 'wavelength λ' },
]

export function varLabel(key: string): string {
  return SWEEP_VARS.find((v) => v.key === key)?.label ?? key
}

/** Sweep range for a variable — mirrors the slider bounds; t/b clamp to the route floor. */
export function varRange(key: string, design: DesignState): { min: number; max: number } {
  const fl = routeFloor(design.process_route)
  switch (key) {
    case 'fin_thickness_mm': return { min: fl.t, max: 0.3 }
    case 'channel_gap_mm': return { min: fl.b, max: 0.4 }
    case 'fin_height_mm': return { min: 2.0, max: 6.5 }
    case 'wave_amplitude_mm': return { min: 0.0, max: 1.0 }
    case 'wavelength_mm': return { min: 1.5, max: 6.0 }
    default: return { min: 0, max: 1 }
  }
}

export function buildSweepRequest(
  design: DesignState, basis: Basis, xVar: string, yVar: string, steps = 24,
) {
  const rx = varRange(xVar, design)
  const ry = varRange(yVar, design)
  return {
    base: {
      case: {
        family: design.family,
        process_route: design.process_route,
        fin_thickness_mm: design.fin_thickness_mm,
        channel_gap_mm: design.channel_gap_mm,
        fin_height_mm: design.fin_height_mm,
        side_margin_mm: design.side_margin_mm,
        wave_amplitude_mm: design.wave_amplitude_mm,
        wavelength_mm: design.wavelength_mm,
      },
      stack: basis.stack,
      operating: { ...basis.operating, flow_lpm: design.flow_lpm },
      architecture: basis.architecture,
    },
    x: { var: xVar, min: rx.min, max: rx.max, steps },
    y: { var: yVar, min: ry.min, max: ry.max, steps },
    objective: 'R_jc_K_W',
  }
}
