import type { Basis, DesignCase } from './types'

// Everything the raymarch shader needs, in millimetres (object space).
export interface ViewerGeom {
  coreWidth: number      // x span — fins are spaced across this (pitch = t+gap)
  coreLength: number     // y span — flow path; the wave runs along here
  finHeight: number      // z span of the fin band
  baseThickness: number  // solid base slab under the fins
  finThickness: number   // t
  gap: number            // b
  sideMargin: number     // lateral margin each side of the fin field
  waveAmp: number        // A (0 for straight fins)
  waveLen: number        // lambda
  ribWidth: number       // center rib width (0 = none)
  finCount: number       // derived, for display
}

export const FIN_FAMILIES = ['wavy_fin', 'straight_fin']

/** True when we can raymarch this family today (Phase 3 = fins only). */
export function isViewable(family: string): boolean {
  return FIN_FAMILIES.includes(family)
}

/** Build viewer geometry from a design case + the shared stack/arch basis. */
export function geomFromCase(c: DesignCase, basis: Basis): ViewerGeom | null {
  if (!isViewable(c.family)) return null
  const s = basis.stack
  const t = c.fin_thickness_mm ?? 0.1
  const b = c.channel_gap_mm ?? 0.1
  const margin = c.side_margin_mm ?? 0.9
  const pitch = t + b
  const usable = s.core_width_mm - 2 * margin
  const finCount = pitch > 0 && usable > 0 ? Math.max(1, Math.floor(usable / pitch)) : 0
  const nPaths = Number(basis.architecture?.n_parallel_paths ?? 1)

  return {
    coreWidth: s.core_width_mm,
    coreLength: s.core_length_mm,
    finHeight: c.fin_height_mm ?? s.core_height_mm,
    baseThickness: s.base_thickness_mm,
    finThickness: t,
    gap: b,
    sideMargin: margin,
    waveAmp: c.family === 'straight_fin' ? 0 : (c.wave_amplitude_mm ?? 0),
    waveLen: c.wavelength_mm ?? 2.5,
    ribWidth: nPaths >= 2 ? 1.0 : 0.0,
    finCount,
  }
}
