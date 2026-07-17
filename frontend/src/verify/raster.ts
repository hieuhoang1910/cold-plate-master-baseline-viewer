import { LMM_PROC } from '../manufacturing'
import type { ViewerGeom } from '../viewerGeom'

// V4 — the DLP expected-layer raster, shared by PixelPreview (display) and the
// verify worker (XOR conformance). This is the exact solidAt() logic that
// shipped in PixelPreview V3.3d, extracted so both consumers rasterize the
// SAME expected geometry — a diff against two different rasters would be
// meaningless.

/** final-space sample pitch: one green pixel / layer through the shrink */
export const PXF = LMM_PROC.pixelMm / LMM_PROC.shrinkXY   // ≈ 0.02924 mm
export const LYF = LMM_PROC.layerMm / LMM_PROC.shrinkZ    // ≈ 0.02033 mm

export interface GridDims { nx: number; ny: number; nLayers: number; baseLayers: number }

export function gridDims(g: ViewerGeom): GridDims {
  const nx = Math.round(g.coreWidth / PXF)
  const ny = Math.round(g.coreLength / PXF)
  const nLayers = Math.max(1, Math.round((g.baseThickness + g.finHeight) / LYF))
  const baseLayers = Math.round(g.baseThickness / LYF)
  return { nx, ny, nLayers, baseLayers }
}

/**
 * Point-in-solid test for layer height zF (final mm), with optional overpoly
 * widening `comp` (mm added to each solid feature width).
 * True inside the base slab, and z-independent within the fin band for
 * fin / pin families (only TPMS layers vary with z).
 */
export function makeSolidAt(g: ViewerGeom, zF: number, comp = 0): (x: number, y: number) => boolean {
  const inBase = zF < g.baseThickness
  const halfW = g.coreWidth / 2
  const fieldHalf = halfW - g.sideMargin
  const pitch = g.finThickness + g.gap
  const tEff = g.finThickness + comp
  const wallEff = g.wallThickness + comp
  const pinREff = g.pinDiameter / 2 + comp / 2
  const TWO_PI = Math.PI * 2

  if (inBase) return () => true

  if (g.family !== 'gyroid_tpms') {
    return (x, y) => {
      if (g.ribWidth > 0 && Math.abs(y) <= g.ribWidth / 2) return true
      if (Math.abs(x) > fieldHalf) return false
      const xw = x - g.waveAmp * Math.sin((TWO_PI * y) / g.waveLen)
      // GLSL mod(xw + p/2, p) - p/2 — the +p/2 must sit INSIDE the mod. The
      // V3.3d PixelPreview formula had it outside, which drew every fin half a
      // pitch off its true position (aggregate widths/solidity were unaffected,
      // so it went unnoticed until V4 cross-checked absolute positions).
      const m = ((((xw + pitch / 2) % pitch) + pitch) % pitch) - pitch / 2
      return Math.abs(m) <= tEff / 2
    }
  }
  if (g.isPin) {
    const pp = Math.max(g.pinPitch, 0.1)
    return (x, y) => {
      const rowY = Math.floor(y / pp + 0.5)
      const xoff = g.pinStagger ? (((rowY % 2) + 2) % 2) * 0.5 * pp : 0
      const qx = ((((x + xoff + pp / 2) % pp) + pp) % pp) - pp / 2
      const qy = ((((y + pp / 2) % pp) + pp) % pp) - pp / 2
      return Math.hypot(qx, qy) <= pinREff
    }
  }
  // TPMS sheet/solid with jet-adaptive radial grading (matches the shader law)
  const R = 0.5 * Math.min(g.coreWidth, g.coreLength)
  return (x, y) => {
    const rr = Math.hypot(x, y)
    const cLocal = Math.max(g.unitCell * (1 + g.grading * (Math.min(Math.max(rr / Math.max(R, 1e-3), 0), 1.5) - 0.5)), 0.3)
    const k = TWO_PI / cLocal
    const xk = k * x, yk = k * y, zk = k * zF
    let F: number
    switch (g.tpmsType) {
      case 'diamond':
        F = Math.sin(xk) * Math.sin(yk) * Math.sin(zk) + Math.sin(xk) * Math.cos(yk) * Math.cos(zk)
          + Math.cos(xk) * Math.sin(yk) * Math.cos(zk) + Math.cos(xk) * Math.cos(yk) * Math.sin(zk)
        break
      case 'schwarz_p':
        F = Math.cos(xk) + Math.cos(yk) + Math.cos(zk)
        break
      default: // gyroid (exotic types preview as gyroid, like TPMS_IDX fallback)
        F = Math.cos(xk) * Math.sin(yk) + Math.cos(yk) * Math.sin(zk) + Math.cos(zk) * Math.sin(xk)
    }
    const iso = Math.min(Math.max((wallEff * Math.PI) / cLocal, 0.06), 1.2)
    return g.solid ? F <= iso : Math.abs(F) <= iso
  }
}

/** Rasterize the expected mask for one layer into `mask` (0/1, nx*ny). */
export function expectedMask(
  g: ViewerGeom, zF: number, mask: Uint8Array, nx: number, ny: number, comp = 0,
): void {
  const solidAt = makeSolidAt(g, zF, comp)
  const halfW = g.coreWidth / 2
  const halfL = g.coreLength / 2
  let p = 0
  for (let j = 0; j < ny; j++) {
    const y = -halfL + (j + 0.5) * PXF
    for (let i = 0; i < nx; i++) {
      mask[p++] = solidAt(-halfW + (i + 0.5) * PXF, y) ? 1 : 0
    }
  }
}
