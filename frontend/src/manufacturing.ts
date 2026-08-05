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

// Incus_Design_Guidelines.pdf (July 2026): all guideline dims are GREEN px
// (1 px = 35 µm) — converted to FINAL mm via ÷1.197. Deep channels (> 1 mm)
// need 6–8 px; fins 3 px abs / 4–5 px rec; gaps must be wider than fins
// (Peritsch email 2026-07-29).
export const LMM_PX_RULES = {
  finAbsPx: 3, finRecPx: 4, chAbsPxDeep: 6, chRecPxDeep: 8,
  chAbsPxShallow: 5, chRecPxShallow: 6, deepChannelMmGreen: 1.0,
}
// unrounded so a px-exact design (4 px fin = 0.116959… mm) sits ON its bound
const pxFinal = (px: number) => px * 0.035 / 1.197

export const MFG_ROUTES: RouteRule[] = [
  {
    key: 'LMM', label: 'LMM — Incus EVO35 (printed Cu)', short: 'LMM · Incus',
    grade: 'supplier-verified',
    source: 'Incus_Design_Guidelines.pdf (Jul 2026) + Peritsch emails 2026-07-07/-29',
    wallAbs: pxFinal(LMM_PX_RULES.finAbsPx),      // 3 px green = 0.0877 final
    wallRec: pxFinal(LMM_PX_RULES.finRecPx),      // 4 px green = 0.1170 final
    gapAbs: pxFinal(LMM_PX_RULES.chAbsPxDeep),    // 6 px green = 0.1754 final (deep channels)
    gapRec: pxFinal(LMM_PX_RULES.chRecPxDeep),    // 8 px green = 0.2339 final
    aspectMax: 30,
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

// 2026-08-05 — read out of Incus's own Chitubox configs (Peritsch, archived in
// 01_Inputs_and_References). pixelMm is DERIVED from platform/resolution so it
// can never drift from the supplier file: Evo35 56.0/1600 = 35 µm exactly.
export const LMM_MACHINES = {
  EVO35: {
    label: 'Incus Hammer Evo35', resolutionPx: [1600, 2560] as [number, number],
    platformMm: [56.0, 89.6, 150.02] as [number, number, number],
    pixelMm: 56.0 / 1600, layerMm: 0.025, preferred: true,
  },
  PRO25: {
    label: 'Incus Hammer Pro25', resolutionPx: [8000, 8128] as [number, number],
    platformMm: [200.0, 203.2, 140.0] as [number, number, number],
    pixelMm: 200.0 / 8000, layerMm: 0.025, preferred: false,
  },
}
/** The machine every LMM bound in this file is expressed in (Peritsch
 *  2026-08-05: "for these parts please always use the HammerEvo35"). */
export const LMM_MACHINE: keyof typeof LMM_MACHINES = 'EVO35'
/** Incus's own Chitubox shrink-compensation profile — anisotropic in XY, and
 *  1–2 % off the 1.197/1.23 basis this app uses. Open question for Paul. */
export const LMM_SC_PROFILE = { x: 1.21, y: 1.22, z: 1.25, name: 'SCx121y122z125' }

/** FINAL mm → green px (35 µm) — the unit Incus counts on the slice raster. */
export const greenPx = (finalMm: number) => (finalMm * LMM_PROC.shrinkXY) / LMM_PROC.pixelMm

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

// ---------------------------------------------------------------------------
// 2026-07-30 — the full compensation story for a design (shared by the
// green→CAD fold-out and the ⇄ CAD tab): per dimension, the chain
// final → green → snapped → CAD draw (∓2 px overpoly) → printed-back px,
// with guideline verdicts. Compensation PRESERVES the nominal — the printed
// px equal the snapped green px; only the design values move them.
// ---------------------------------------------------------------------------
export interface CompRow extends GreenRow {
  cadPx: number       // what you DRAW, in px (XY) or layers (Z)
  printedPx: number   // what the exposure delivers back (= snapped green px)
  status?: 'fail' | 'warn'
}
export interface CompWarning { level: 'fail' | 'warn'; text: string }

export function lmmCompensation(d: DesignState): {
  rows: CompRow[]; warnings: CompWarning[]; deep: boolean; chAbs: number; chRec: number
} {
  const deep = d.fin_height_mm * LMM_PROC.shrinkZ > LMM_PX_RULES.deepChannelMmGreen
  const chAbs = deep ? LMM_PX_RULES.chAbsPxDeep : LMM_PX_RULES.chAbsPxShallow
  const chRec = deep ? LMM_PX_RULES.chRecPxDeep : LMM_PX_RULES.chRecPxShallow
  const warnings: CompWarning[] = []
  const rows: CompRow[] = lmmRecipe(d).map((r) => {
    const grid = r.axis === 'xy' ? LMM_PROC.pixelMm : LMM_PROC.layerMm
    const cadPx = Math.round(r.cad / grid)
    const printedPx = r.units
    let status: CompRow['status']
    if (r.name === 'fin t') {
      if (cadPx <= 1) {
        status = 'fail'
        warnings.push({ level: 'fail', text: `CAD fin ${cadPx} px (${r.cad.toFixed(3)} mm) will not slice — a ≤ 1 px ribbon drops out of the raster; thicken the fin` })
      } else if (cadPx === 2) {
        status = 'warn'
        warnings.push({ level: 'warn', text: 'CAD fin 2 px (0.070 mm) is at the slicing edge — expect irregular exposure on slanted wavy sections' })
      }
      if (printedPx < LMM_PX_RULES.finAbsPx) {
        status = 'fail'
        warnings.push({ level: 'fail', text: `printed fin ${printedPx} px < ${LMM_PX_RULES.finAbsPx} px minimum` })
      } else if (printedPx < LMM_PX_RULES.finRecPx && !status) status = 'warn'
    }
    if (r.name === 'gap b') {
      if (printedPx < chAbs) {
        status = 'fail'
        warnings.push({ level: 'fail', text: `printed gap ${printedPx} px < ${chAbs} px ${deep ? 'deep-channel' : 'shallow'} floor — Incus: will not be cleaned` })
      } else if (printedPx < chRec) {
        status = 'warn'
        warnings.push({ level: 'warn', text: `printed gap ${printedPx} px is inside the band but under the ${chRec} px recommendation` })
      }
    }
    return { ...r, cadPx, printedPx, status }
  })
  const fin = rows.find((r) => r.name === 'fin t')
  const gap = rows.find((r) => r.name === 'gap b')
  if (fin && gap && gap.printedPx <= fin.printedPx) {
    warnings.push({ level: 'fail', text: `printed gap ${gap.printedPx} px ≤ fin ${fin.printedPx} px — Incus (2026-07-29): gaps must be wider than fins` })
  }
  return { rows, warnings, deep, chAbs, chRec }
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
    if (normalizeRoute(d.process_route) === 'LMM') b = Math.max(b, t) // gaps wider than fins (Incus 2026-07-29)
    let H = d.fin_height_mm
    if (H / b > r.aspectMax) H = Math.round(b * r.aspectMax * 20) / 20 // trim to AR, 0.05 step
    if (normalizeRoute(d.process_route) === 'LMM') {
      t = snapFinal(t, 'xy')
      b = snapFinal(b, 'xy')
      H = snapFinal(H, 'z')
      let A = d.wave_amplitude_mm
      if (d.family === 'wavy_fin' && A > 0 && d.wavelength_mm > 0) {
        // tame the wave to the slope budget: perp passage b·cosθ ≥ abs floor,
        // AND the fin t·cosθ ≥ its own floor (2026-08-05 shear correction).
        // Snap A DOWN to the grid so the snapped value never re-breaks it.
        const cNeed = Math.min(1, Math.max(r.gapAbs / b, r.wallAbs / t))
        const aMax = d.wavelength_mm * Math.tan(Math.acos(cNeed)) / (2 * Math.PI)
        A = Math.min(A, aMax)
        A = Math.floor((A * LMM_PROC.shrinkXY) / LMM_PROC.pixelMm) * LMM_PROC.pixelMm / LMM_PROC.shrinkXY
      }
      patch.wave_amplitude_mm = A > 0 ? A : d.wave_amplitude_mm
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
  // Incus 2026-07-29: gaps should be wider than fins (LMM fin families)
  if (isFin && normalizeRoute(d.process_route) === 'LMM' && gap != null && gap < wall - 1e-9)
    grades.push('MARGINAL')
  // 2026-07-31 wave-slope pinch, CORRECTED 2026-08-05: the fin field is a
  // SHEAR of a straight array, so gap_perp = b·cosθ and fin_perp = t·cosθ at
  // tanθ = 2πA/λ (not (t+b)·cosθ − t, which is an offset sweep). Measured on
  // the mesh sent to Incus: 8.11 px actual vs 8.14 px predicted.
  if (d.family === 'wavy_fin' && normalizeRoute(d.process_route) === 'LMM'
      && gap != null && d.wave_amplitude_mm > 0 && d.wavelength_mm > 0) {
    const c = Math.cos(Math.atan(2 * Math.PI * d.wave_amplitude_mm / d.wavelength_mm))
    if (gap * c < r.gapAbs - 1e-9) grades.push('FAIL')
    if (wall * c < r.wallAbs - 1e-9) grades.push('FAIL')
    else if (wall * c < r.wallRec - 1e-9) grades.push('MARGINAL')
  }
  if (grades.includes('FAIL')) return 'FAIL'
  if (grades.includes('MARGINAL')) return 'MARGINAL'
  return 'PASS'
}
