import type { ViewerGeom } from '../viewerGeom'
import { TPMS_IDX, tpmsField } from '../stl'

// V4 — TS mirror of the raymarch shader's mapScene (SdfViewer.tsx): the whole
// part (base slab + core structure) as one implicit field, in final mm.
// Keep the three implementations in sync: GLSL shader / stl.ts TPMS SDF / here.
//
// The raw field is only distance-LIKE away from the surface (the fin branch
// carries a 0.6 Lipschitz guard, TPMS is sin/cos algebra), so deviation
// measurements use signedDistance(), which normalizes by the local gradient —
// first-order exact near the zero level set, which is the only place we
// measure.

const TAU = Math.PI * 2

export type Field = (x: number, y: number, z: number) => number

function sdBox(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
  const qx = Math.abs(px) - bx
  const qy = Math.abs(py) - by
  const qz = Math.abs(pz) - bz
  const m = Math.max(qx, qy, qz)
  return Math.min(m, 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
}

/** The full part field (base ∪ core), mirroring mapScene. */
export function partField(g: ViewerGeom): Field {
  const W = g.coreWidth, L = g.coreLength, H = g.finHeight, base = g.baseThickness
  const zc = base + H / 2

  if (g.family !== 'gyroid_tpms') {
    // --- fin field (straight / wavy, optional centre rib) ---
    const pitch = g.finThickness + g.gap
    const fieldHalf = W / 2 - g.sideMargin
    const halfT = g.finThickness / 2
    const amp = g.waveAmp, lambda = Math.max(g.waveLen, 1e-6)
    const rib = g.ribWidth
    return (x, y, z) => {
      const bs = sdBox(x, y, z - base / 2, W / 2, L / 2, base / 2)
      const dx = amp > 0 ? amp * Math.sin((TAU * y) / lambda) : 0
      const xw = x - dx
      // GLSL mod(xw + p/2, p) - p/2 — the +p/2 must be INSIDE the mod, or the
      // fin lattice lands half a pitch off (V3.3d PixelPreview shipped that bug)
      const m = ((((xw + pitch / 2) % pitch) + pitch) % pitch) - pitch / 2
      const dWall = Math.abs(m) - halfT
      const dbox = sdBox(x, y, z - zc, fieldHalf, L / 2, H / 2)
      let core = Math.max(dWall * 0.6, dbox)
      if (rib > 0) {
        const rb = sdBox(x, y, z - zc, W / 2, rib / 2, H / 2)
        core = Math.min(core, rb)
      }
      return Math.min(bs, core)
    }
  }

  const R = 0.5 * Math.min(W, L)
  const cylinder = g.layout === 'cylinder'

  if (g.isPin) {
    // --- pin-fin array ---
    const pp = Math.max(g.pinPitch, 0.1)
    const r = g.pinDiameter / 2
    const stagger = g.pinStagger
    return (x, y, z) => {
      const bs = sdBox(x, y, z - base / 2, W / 2, L / 2, base / 2)
      const dzAbs = Math.abs(z - zc) - H / 2
      let clip: number
      if (cylinder) {
        const dr = Math.hypot(x, y) - R
        clip = Math.min(Math.max(dr, dzAbs), 0) + Math.hypot(Math.max(dr, 0), Math.max(dzAbs, 0))
      } else {
        clip = sdBox(x, y, z - zc, W / 2, L / 2, H / 2)
      }
      const rowY = Math.floor(y / pp + 0.5)
      const xoff = stagger ? (((rowY % 2) + 2) % 2) * 0.5 * pp : 0
      const qx = ((((x + xoff + pp / 2) % pp) + pp) % pp) - pp / 2
      const qy = ((((y + pp / 2) % pp) + pp) % pp) - pp / 2
      const dRad = Math.hypot(qx, qy) - r
      const core = Math.max(Math.max(dRad, dzAbs), clip)
      return Math.min(bs, core)
    }
  }

  // --- TPMS sheet / solid with jet-adaptive radial grading ---
  const ty = TPMS_IDX[g.tpmsType] ?? 0
  const grade = g.grading, wall = g.wallThickness, solid = g.solid
  const cell = g.unitCell
  return (x, y, z) => {
    const bs = sdBox(x, y, z - base / 2, W / 2, L / 2, base / 2)
    const dzAbs = Math.abs(z - zc) - H / 2
    let clip: number
    if (cylinder) {
      const dr = Math.hypot(x, y) - R
      clip = Math.min(Math.max(dr, dzAbs), 0) + Math.hypot(Math.max(dr, 0), Math.max(dzAbs, 0))
    } else {
      clip = sdBox(x, y, z - zc, W / 2, L / 2, H / 2)
    }
    const rr = Math.hypot(x, y)
    const cLocal = Math.max(cell * (1 + grade * (Math.min(Math.max(rr / Math.max(R, 1e-3), 0), 1.5) - 0.5)), 0.3)
    const k = TAU / cLocal
    const f = tpmsField(x, y, z, k, ty)
    const iso = Math.min(Math.max((wall * Math.PI) / cLocal, 0.06), 1.2)
    const scale = (cLocal / TAU) * 0.5
    const d = (solid ? f - iso : Math.abs(f) - iso) * scale
    return Math.min(bs, Math.max(d, clip))
  }
}

const GRAD_H = 0.004 // central-difference step, mm (≈ 1/7 printer pixel)

/** Gradient-normalized signed distance: f / |∇f| — first-order exact near the
 *  zero set, which is where deviation is measured. |∇f| is clamped to ≥ 0.5:
 *  at field ridges (gap centrelines, max() creases) the central differences
 *  cancel to ~0 and an unclamped quotient explodes to metres; every branch of
 *  the part field has true slope ≥ 0.6, so 0.5 keeps the estimate conservative
 *  without the blow-up (a real file showed "worst 423 mm" before this). */
export function signedDistance(f: Field, x: number, y: number, z: number): number {
  const v = f(x, y, z)
  const gx = f(x + GRAD_H, y, z) - f(x - GRAD_H, y, z)
  const gy = f(x, y + GRAD_H, z) - f(x, y - GRAD_H, z)
  const gz = f(x, y, z + GRAD_H) - f(x, y, z - GRAD_H)
  const mag = Math.hypot(gx, gy, gz) / (2 * GRAD_H)
  return v / Math.max(mag, 0.5)
}

/**
 * Sample points ON the reference implicit surface (mesh-free, so no meshing
 * tolerance enters the two-sided check): stratified grid seeds near the zero
 * set, Newton-projected onto it.
 */
export function sampleSurface(
  f: Field, g: ViewerGeom, spacing: number, maxPoints: number,
): Float32Array {
  const zTop = g.baseThickness + g.finHeight
  const x0 = -g.coreWidth / 2, x1 = g.coreWidth / 2
  const y0 = -g.coreLength / 2, y1 = g.coreLength / 2
  const pts: number[] = []
  const near = spacing * 0.9
  for (let z = spacing / 2; z < zTop && pts.length / 3 < maxPoints; z += spacing) {
    for (let y = y0 + spacing / 2; y < y1 && pts.length / 3 < maxPoints; y += spacing) {
      for (let x = x0 + spacing / 2; x < x1; x += spacing) {
        let v = f(x, y, z)
        if (Math.abs(v) > near) continue
        // Newton projection: p -= f * ∇f / |∇f|²  (3 iterations)
        let px = x, py = y, pz = z
        let ok = false
        for (let it = 0; it < 3; it++) {
          const gx = (f(px + GRAD_H, py, pz) - f(px - GRAD_H, py, pz)) / (2 * GRAD_H)
          const gy = (f(px, py + GRAD_H, pz) - f(px, py - GRAD_H, pz)) / (2 * GRAD_H)
          const gz = (f(px, py, pz + GRAD_H) - f(px, py, pz - GRAD_H)) / (2 * GRAD_H)
          const m2 = gx * gx + gy * gy + gz * gz
          if (m2 < 1e-12) break
          px -= (v * gx) / m2
          py -= (v * gy) / m2
          pz -= (v * gz) / m2
          v = f(px, py, pz)
          if (Math.abs(v) < 1e-4) { ok = true; break }
        }
        if (!ok) continue
        // keep the projected point inside the sampled domain
        if (px < x0 - 0.05 || px > x1 + 0.05 || py < y0 - 0.05 || py > y1 + 0.05
          || pz < -0.05 || pz > zTop + 0.05) continue
        pts.push(px, py, pz)
        if (pts.length / 3 >= maxPoints) break
      }
    }
  }
  return new Float32Array(pts)
}
