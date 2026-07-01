import type { Basis, DesignCase, DesignState } from './types'

// Process routes set the manufacturing floor on wall & gap (spec §6B).
export const ROUTES: { key: string; label: string; t: number; b: number }[] = [
  { key: 'LMM', label: 'LMM (0.10 mm floor)', t: 0.1, b: 0.1 },
  { key: 'LMM_supplier', label: 'LMM supplier-qual (0.12)', t: 0.12, b: 0.12 },
  { key: 'standard_LPBF', label: 'standard LPBF (0.20)', t: 0.2, b: 0.2 },
]

export function routeFloor(route: string) {
  return ROUTES.find((r) => r.key === route) ?? ROUTES[0]
}

export const FIN_FAMILIES = ['wavy_fin', 'straight_fin']
export function isFinFamily(f: string): boolean {
  return FIN_FAMILIES.includes(f)
}

function normalizeRoute(r?: string): string {
  return r === 'standard_LPBF' ? 'standard_LPBF' : 'LMM'
}

/** Seed an editable design from a catalog case + the shared basis. */
export function initDesign(c: DesignCase, basis: Basis): DesignState {
  return {
    design_id: c.design_id,
    family: c.family,
    process_route: normalizeRoute(c.process_route),
    fin_thickness_mm: c.fin_thickness_mm ?? 0.1,
    channel_gap_mm: c.channel_gap_mm ?? 0.1,
    fin_height_mm: c.fin_height_mm ?? basis.stack.core_height_mm,
    side_margin_mm: c.side_margin_mm ?? 0.9,
    wave_amplitude_mm: c.family === 'straight_fin' ? 0 : (c.wave_amplitude_mm ?? 0.55),
    wavelength_mm: c.wavelength_mm ?? 2.5,
    flow_lpm: Number(basis.operating.flow_lpm ?? 2.65),
  }
}

/** Build the /api/evaluate request body for a live design. */
export function evalPayload(d: DesignState, basis: Basis) {
  return {
    case: {
      design_id: 'live',
      family: d.family,
      process_route: d.process_route,
      fin_thickness_mm: d.fin_thickness_mm,
      channel_gap_mm: d.channel_gap_mm,
      fin_height_mm: d.fin_height_mm,
      side_margin_mm: d.side_margin_mm,
      wave_amplitude_mm: d.wave_amplitude_mm,
      wavelength_mm: d.wavelength_mm,
    },
    stack: basis.stack,
    operating: { ...basis.operating, flow_lpm: d.flow_lpm },
    architecture: basis.architecture,
  }
}

/** Client-side geometric derivations shown next to the sliders. */
export function derived(d: DesignState, basis: Basis) {
  const pitch = d.fin_thickness_mm + d.channel_gap_mm
  const usable = basis.stack.core_width_mm - 2 * d.side_margin_mm
  const finCount = pitch > 0 && usable > 0 ? Math.max(1, Math.floor(usable / pitch)) : 0
  const nCh = finCount + 1
  const activeW = finCount * d.fin_thickness_mm + nCh * d.channel_gap_mm
  const openFrac = activeW > 0 ? (nCh * d.channel_gap_mm) / activeW : 0
  const chi = d.wavelength_mm > 0 ? (2 * Math.PI * d.wave_amplitude_mm) / d.wavelength_mm : 0
  return { pitch, finCount, openFrac, chi }
}
