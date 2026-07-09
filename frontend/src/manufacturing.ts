import type { DesignState } from './types'

// V3.3 — client-side mirror of engine/manufacturing.py (spec §35). The engine
// is authoritative (its verdict rides on every /api/evaluate result); this
// mirror exists so sliders, clamps and the green→CAD converter react
// instantly without a server round-trip. Bounds are FINAL (sintered) mm.

export type MfgVerdict = 'PASS' | 'MARGINAL' | 'FAIL' | 'INFO'
export type Enforcement = 'enforce' | 'marginal' | 'explore'

export interface RouteRule {
  key: string
  label: string
  short: string
  grade: 'supplier-verified' | 'literature'
  source: string
  wallAbs: number
  wallRec: number
  gapAbs: number
  gapRec: number
  aspectMax: number
}

export const MFG_ROUTES: RouteRule[] = [
  {
    key: 'LMM', label: 'LMM — Incus EVO35 (printed Cu)', short: 'LMM · Incus',
    grade: 'supplier-verified', source: 'Incus email 2026-07-07 (Paul Peritsch)',
    wallAbs: 0.105, wallRec: 0.14, gapAbs: 0.15, gapRec: 0.20, aspectMax: 30,
  },
  {
    key: 'SLM_IR', label: 'SLM (IR) — Nikon SLM Solutions, CuCrZr', short: 'SLM IR · Nikon',
    grade: 'literature', source: 'vendor guides + LPBF literature (2026-07-09)',
    wallAbs: 0.30, wallRec: 0.40, gapAbs: 0.40, gapRec: 0.50, aspectMax: 10,
  },
  {
    key: 'SLM_GREEN', label: 'SLM (green laser) — pure Cu fine', short: 'SLM green',
    grade: 'literature', source: 'green-laser pure-Cu studies (2026-07-09)',
    wallAbs: 0.10, wallRec: 0.18, gapAbs: 0.20, gapRec: 0.30, aspectMax: 10,
  },
]

const ALIASES: Record<string, string> = {
  lmm: 'LMM', lmm_supplier: 'LMM', standard_lpbf: 'SLM_IR', std_lpbf: 'SLM_IR',
  slm: 'SLM_IR', slm_ir: 'SLM_IR', slm_green: 'SLM_GREEN',
}

export function normalizeRoute(route?: string): string {
  if (!route) return 'LMM'
  if (MFG_ROUTES.some((r) => r.key === route)) return route
  return ALIASES[route.toLowerCase()] ?? 'LMM'
}

export function routeRule(route?: string): RouteRule {
  const key = normalizeRoute(route)
  return MFG_ROUTES.find((r) => r.key === key) ?? MFG_ROUTES[0]
}

export const ENFORCEMENT_MODES: { key: Enforcement; label: string; hint: string }[] = [
  { key: 'enforce', label: 'Design-to-manufacture', hint: 'sliders + optimizer clamped at the recommended bounds' },
  { key: 'marginal', label: 'Allow marginal', hint: 'clamped at the absolute floor; amber zone reachable, shown MARGINAL' },
  { key: 'explore', label: 'Explore / audit', hint: 'no clamps — verdicts annotate only' },
]

/** Slider/sweep floor for wall (t) and gap (b) under an enforcement mode. */
export function mfgFloor(route: string | undefined, mode: Enforcement): { t: number; b: number } {
  const r = routeRule(route)
  if (mode === 'enforce') return { t: r.wallRec, b: r.gapRec }
  if (mode === 'marginal') return { t: r.wallAbs, b: r.gapAbs }
  return { t: 0.05, b: 0.05 } // explore: physical sweep floor, no mfg clamp
}

// ---------------------------------------------------------------------------
// LMM (Incus EVO35) process chain — final → green → pixel grid → CAD
// ---------------------------------------------------------------------------
export const LMM_PROC = {
  pixelMm: 0.035, layerMm: 0.025, shrinkXY: 1.197, shrinkZ: 1.23, overpolyPx: 1,
}

export interface GreenRow {
  name: string
  final: number
  green: number
  snapped: number
  units: number      // pixels (XY) or layers (Z)
  cad: number
  axis: 'xy' | 'z'
}

export function greenChain(name: string, finalMm: number, axis: 'xy' | 'z' = 'xy', overpolyPx = 0): GreenRow {
  const shrink = axis === 'xy' ? LMM_PROC.shrinkXY : LMM_PROC.shrinkZ
  const grid = axis === 'xy' ? LMM_PROC.pixelMm : LMM_PROC.layerMm
  const green = finalMm * shrink
  const units = Math.round(green / grid)
  const snapped = units * grid
  const cad = axis === 'xy' ? snapped + overpolyPx * LMM_PROC.pixelMm : snapped
  return { name, final: finalMm, green, snapped, units, cad, axis }
}

/** The review-§6 style final→green→CAD table for the current fin design. */
export function lmmRecipe(d: DesignState): GreenRow[] {
  const rows = [
    greenChain('fin t', d.fin_thickness_mm, 'xy', -2 * LMM_PROC.overpolyPx),
    greenChain('gap b', d.channel_gap_mm, 'xy', +2 * LMM_PROC.overpolyPx),
    greenChain('pitch t+b', d.fin_thickness_mm + d.channel_gap_mm, 'xy', 0),
    greenChain('height H', d.fin_height_mm, 'z'),
  ]
  if (d.wave_amplitude_mm > 0) rows.push(greenChain('wave A', d.wave_amplitude_mm, 'xy', 0))
  if (d.wave_amplitude_mm > 0) rows.push(greenChain('wavelength λ', d.wavelength_mm, 'xy', 0))
  return rows
}

/** Snap a FINAL dim so its green lands exactly on the pixel/layer grid. */
function snapFinal(finalMm: number, axis: 'xy' | 'z'): number {
  const shrink = axis === 'xy' ? LMM_PROC.shrinkXY : LMM_PROC.shrinkZ
  const grid = axis === 'xy' ? LMM_PROC.pixelMm : LMM_PROC.layerMm
  return (Math.round((finalMm * shrink) / grid) * grid) / shrink
}

/**
 * §35F "Make manufacturable": project the design onto the nearest
 * rule-compliant point (recommended bounds), then pixel-snap for LMM.
 * Returns the patch to apply — never mutates silently.
 */
export function makeManufacturable(d: DesignState): Partial<DesignState> {
  const r = routeRule(d.process_route)
  const patch: Partial<DesignState> = {}
  const isFin = d.family === 'wavy_fin' || d.family === 'straight_fin'
  if (isFin) {
    let t = Math.max(d.fin_thickness_mm, r.wallRec)
    let b = Math.max(d.channel_gap_mm, r.gapRec)
    let H = d.fin_height_mm
    if (H / b > r.aspectMax) H = Math.round(b * r.aspectMax * 20) / 20 // trim to AR, 0.05 step
    if (normalizeRoute(d.process_route) === 'LMM') {
      t = snapFinal(t, 'xy')
      b = snapFinal(b, 'xy')
      H = snapFinal(H, 'z')
      patch.wave_amplitude_mm = d.wave_amplitude_mm > 0 ? snapFinal(d.wave_amplitude_mm, 'xy') : d.wave_amplitude_mm
      patch.wavelength_mm = d.wave_amplitude_mm > 0 ? snapFinal(d.wavelength_mm, 'xy') : d.wavelength_mm
    }
    patch.fin_thickness_mm = t
    patch.channel_gap_mm = b
    patch.fin_height_mm = H
  } else if (d.family === 'gyroid_tpms' && d.tpms_type === 'pin_fins') {
    const dia = Math.max(d.pin_diameter_mm, r.wallRec)
    patch.pin_diameter_mm = dia
    patch.pin_pitch_mm = Math.max(d.pin_pitch_mm, dia + r.gapRec)
  } else {
    patch.wall_thickness_mm = Math.max(d.wall_thickness_mm, r.wallRec)
  }
  return patch
}

/** Quick client verdict for a fin design (mirror of the engine's fin checks;
 *  used for instant slider feedback — the API's verdict wins on the KPI card). */
export function quickVerdict(d: DesignState): MfgVerdict {
  const r = routeRule(d.process_route)
  const isFin = d.family === 'wavy_fin' || d.family === 'straight_fin'
  let wall: number, gap: number | null, ar: number | null
  if (isFin) {
    wall = d.fin_thickness_mm; gap = d.channel_gap_mm; ar = d.fin_height_mm / d.channel_gap_mm
  } else if (d.family === 'gyroid_tpms' && d.tpms_type === 'pin_fins') {
    wall = d.pin_diameter_mm; gap = d.pin_pitch_mm - d.pin_diameter_mm
    ar = d.fin_height_mm / d.pin_diameter_mm
  } else {
    wall = d.wall_thickness_mm; gap = d.hydraulic_diameter_mm || null; ar = null
  }
  const grades: MfgVerdict[] = []
  const grade = (v: number, abs: number, rec: number): MfgVerdict =>
    v < abs - 1e-9 ? 'FAIL' : v < rec - 1e-9 ? 'MARGINAL' : 'PASS'
  grades.push(grade(wall, r.wallAbs, r.wallRec))
  if (gap != null) grades.push(grade(gap, r.gapAbs, r.gapRec))
  if (ar != null && ar > r.aspectMax) grades.push('MARGINAL')
  if (grades.includes('FAIL')) return 'FAIL'
  if (grades.includes('MARGINAL')) return 'MARGINAL'
  return 'PASS'
}
