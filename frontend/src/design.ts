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
export const VIEWABLE_FAMILIES = ['wavy_fin', 'straight_fin', 'gyroid_tpms']
export function isFinFamily(f: string): boolean { return FIN_FAMILIES.includes(f) }
export function isGyroid(f: string): boolean { return f === 'gyroid_tpms' }
export function isViewable(f: string): boolean { return VIEWABLE_FAMILIES.includes(f) }

function normalizeRoute(r?: string): string {
  return r === 'standard_LPBF' ? 'standard_LPBF' : 'LMM'
}

/** Seed an editable design from a catalog case + basis. All fields are always
 *  populated (fin + gyroid defaults) so switching family never leaves gaps. */
export function initDesign(c: DesignCase, basis: Basis): DesignState {
  return {
    design_id: c.design_id,
    family: c.family,
    process_route: normalizeRoute(c.process_route),
    // fin defaults (overridden by the case where present)
    fin_thickness_mm: c.fin_thickness_mm ?? 0.1,
    channel_gap_mm: c.channel_gap_mm ?? 0.1,
    fin_height_mm: c.fin_height_mm ?? basis.stack.core_height_mm,
    side_margin_mm: c.side_margin_mm ?? 0.9,
    wave_amplitude_mm: c.family === 'straight_fin' ? 0 : (c.wave_amplitude_mm ?? 0.55),
    wavelength_mm: c.wavelength_mm ?? 2.5,
    // gyroid defaults (cell/wall are viewer-only; void/SAD/Dh drive screening physics)
    unit_cell_mm: c.unit_cell_mm ?? 2.5,
    wall_thickness_mm: c.wall_thickness_mm ?? 0.12,
    void_fraction: c.void_fraction ?? 0.55,
    surface_area_density_m2_m3: c.surface_area_density_m2_m3 ?? 9000,
    hydraulic_diameter_mm: c.hydraulic_diameter_mm ?? 0.25,
    heat_transfer_multiplier: 0.85,
    pressure_loss_multiplier: 2.0,
    tpms_type: c.tpms_type ?? 'gyroid',
    tpms_layout: c.tpms_layout ?? 'rectangular',
    cell_grading: c.cell_grading ?? 0,
    tpms_solid: c.tpms_solid ?? false,
    pin_diameter_mm: c.pin_diameter_mm ?? 0.8,
    pin_pitch_mm: c.pin_pitch_mm ?? 1.4,
    pin_pattern: c.pin_pattern ?? 'staggered',
    flow_lpm: Number(basis.operating.flow_lpm ?? 2.65),
  }
}

export const TPMS_TYPES = [
  { key: 'gyroid', label: 'Gyroid' },
  { key: 'diamond', label: 'Diamond (Schwarz D)' },
  { key: 'schwarz_p', label: 'Schwarz P' },
  { key: 'lidinoid', label: 'Lidinoid' },
  { key: 'split_p', label: 'Split-P' },
  { key: 'iwp', label: 'Schoen I-WP' },
  { key: 'neovius', label: 'Neovius' },
  { key: 'fischer_koch', label: 'Fischer-Koch S' },
  { key: 'pin_fins', label: 'Pin fins' },
]
export const TPMS_LAYOUTS = [
  { key: 'rectangular', label: 'Rectangular' },
  { key: 'cylinder', label: 'Circular (cylinder)' },
]
export const PIN_PATTERNS = [
  { key: 'inline', label: 'Inline' },
  { key: 'staggered', label: 'Staggered' },
]
export function isPinStructure(tpmsType: string): boolean { return tpmsType === 'pin_fins' }

/** Patch applied when the family dropdown changes (keeps other fields intact). */
export function familyPatch(newFamily: string, design: DesignState): Partial<DesignState> {
  if (newFamily === 'straight_fin') return { family: newFamily, wave_amplitude_mm: 0 }
  if (newFamily === 'wavy_fin') {
    return { family: newFamily, wave_amplitude_mm: design.wave_amplitude_mm > 0 ? design.wave_amplitude_mm : 0.55 }
  }
  return { family: newFamily } // gyroid — fields already populated
}

// V2.1 — the problem knobs the user sets outside the geometry (coolant + target
// junction temperature). Optional so V1 call sites keep working unchanged.
export interface ProblemOpts {
  coolant?: string
  tjMaxC?: number
}

/** Build the /api/evaluate request body — family-aware so fin params don't leak
 *  into the gyroid generic-surface model (and vice-versa). `opts` adds the V2.1
 *  coolant + target blocks (omitted when not provided, so behaviour is V1). */
export function evalPayload(d: DesignState, basis: Basis, opts: ProblemOpts = {}) {
  const caseObj = isGyroid(d.family)
    ? {
        design_id: 'live', family: d.family, process_route: d.process_route,
        void_fraction: d.void_fraction,
        surface_area_density_m2_m3: d.surface_area_density_m2_m3,
        hydraulic_diameter_mm: d.hydraulic_diameter_mm,
        heat_transfer_multiplier: d.heat_transfer_multiplier,
        pressure_loss_multiplier: d.pressure_loss_multiplier,
      }
    : {
        design_id: 'live', family: d.family, process_route: d.process_route,
        fin_thickness_mm: d.fin_thickness_mm, channel_gap_mm: d.channel_gap_mm,
        fin_height_mm: d.fin_height_mm, side_margin_mm: d.side_margin_mm,
        wave_amplitude_mm: d.wave_amplitude_mm, wavelength_mm: d.wavelength_mm,
      }
  const payload: Record<string, unknown> = {
    case: caseObj,
    stack: basis.stack,
    operating: { ...basis.operating, flow_lpm: d.flow_lpm },
    architecture: basis.architecture,
  }
  if (opts.coolant) payload.coolant = opts.coolant
  if (opts.tjMaxC != null) payload.targets = { T_j_max_C: opts.tjMaxC }
  return payload
}

/** Client-side geometric derivations shown next to the fin sliders. */
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
