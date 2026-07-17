import type { ViewerGeom } from './viewerGeom'

// STL export of the current viewer model.
//
// The viewer raymarches an implicit SDF (SdfViewer.tsx), so there is no mesh
// to grab from the scene. Instead this module rebuilds the same geometry as
// triangles, in millimetres, in the viewer's object space (x = fin/width axis,
// y = flow, z = height):
//
//   - base slab, straight/wavy fins, center rib, pin fins -> exact analytic
//     prisms/cylinders (tiny files, exact dimensions);
//   - TPMS lattices -> surface nets over the same field the shader marches
//     (thin-sheet lattices are inherently triangle-dense; see voxelFor).
//
// Every primitive is emitted as its own closed, consistently-oriented shell.
// Shells overlap slightly where parts join (EMBED) so slicers/CAD union them
// cleanly instead of seeing coincident faces.

export type StlQuality = 'draft' | 'standard' | 'fine'

export interface StlResult {
  buffer: ArrayBuffer
  triangles: number
}

// Fins/pins/lattice sink this far into the base slab so shells overlap.
const EMBED = 0.05
const TAU = Math.PI * 2

// ---------------------------------------------------------------------------
// Triangle sink + binary STL writer
// ---------------------------------------------------------------------------

class TriSink {
  private data = new Float32Array(9 * 4096)
  private used = 0 // floats

  get triangles(): number {
    return this.used / 9
  }

  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ): void {
    if (this.used + 9 > this.data.length) {
      const next = new Float32Array(Math.ceil(this.data.length * 1.8 / 9) * 9)
      next.set(this.data)
      this.data = next
    }
    const d = this.data
    let u = this.used
    d[u++] = ax; d[u++] = ay; d[u++] = az
    d[u++] = bx; d[u++] = by; d[u++] = bz
    d[u++] = cx; d[u++] = cy; d[u++] = cz
    this.used = u
  }

  /** Quad a-b-c-d (CCW from outside) as two triangles. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
  ): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz)
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz)
  }

  /**
   * Serialize as binary STL (normals recomputed from winding).
   * Zero-area triangles with two coincident vertices (surface nets emits a few
   * where neighbouring cells collapse to the same point) are dropped — their
   * two real directed edges cancel each other, so watertightness is preserved.
   */
  toBinaryStl(): ArrayBuffer {
    const total = this.triangles
    const d = this.data
    const degenerate = (p: number): boolean => {
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3
        if (d[p + 3 * a] === d[p + 3 * b] && d[p + 3 * a + 1] === d[p + 3 * b + 1]
          && d[p + 3 * a + 2] === d[p + 3 * b + 2]) return true
      }
      return false
    }
    let n = 0
    for (let t = 0; t < total; t++) if (!degenerate(t * 9)) n++
    const buf = new ArrayBuffer(84 + 50 * n)
    const view = new DataView(buf)
    const header = 'Cold Plate Master Baseline Viewer - units: mm'
    for (let i = 0; i < Math.min(80, header.length); i++) view.setUint8(i, header.charCodeAt(i))
    view.setUint32(80, n, true)
    let off = 84
    for (let t = 0; t < total; t++) {
      const p = t * 9
      if (degenerate(p)) continue
      const ux = d[p + 3] - d[p], uy = d[p + 4] - d[p + 1], uz = d[p + 5] - d[p + 2]
      const vx = d[p + 6] - d[p], vy = d[p + 7] - d[p + 1], vz = d[p + 8] - d[p + 2]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len
      view.setFloat32(off, nx, true)
      view.setFloat32(off + 4, ny, true)
      view.setFloat32(off + 8, nz, true)
      for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + 4 * k, d[p + k], true)
      view.setUint16(off + 48, 0, true)
      off += 50
    }
    return buf
  }
}

// ---------------------------------------------------------------------------
// Exact primitives
// ---------------------------------------------------------------------------

function meshBox(
  s: TriSink,
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): void {
  s.quad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0) // -z
  s.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1) // +z
  s.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1) // -y
  s.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0) // +y
  s.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0) // -x
  s.quad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1) // +x
}

function meshCylinder(
  s: TriSink,
  cx: number, cy: number, z0: number, z1: number, r: number, segments: number,
): void {
  const px: number[] = []
  const py: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (TAU * i) / segments
    px.push(cx + r * Math.cos(a))
    py.push(cy + r * Math.sin(a))
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    s.quad(px[i], py[i], z0, px[j], py[j], z0, px[j], py[j], z1, px[i], py[i], z1)
    s.tri(cx, cy, z1, px[i], py[i], z1, px[j], py[j], z1) // top fan (+z)
    s.tri(cx, cy, z0, px[j], py[j], z0, px[i], py[i], z0) // bottom fan (-z)
  }
}

/**
 * One fin: a prism swept along y with the shader's wave offset
 * x(y) = center + A*sin(2*pi*y/lambda), clipped to |x| <= fieldHalf.
 * Returns false (nothing emitted) if the fin is clipped away anywhere —
 * partially-present edge fins would need split topology; skipping keeps
 * every emitted shell watertight and matches the render to within one fin.
 */
function meshWavyFin(
  s: TriSink,
  center: number, t: number, amp: number, lambda: number,
  fieldHalf: number, length: number, z0: number, z1: number, segments: number,
): boolean {
  const n = Math.max(1, segments)
  const xa = new Float64Array(n + 1)
  const xb = new Float64Array(n + 1)
  const ys = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const y = -length / 2 + (length * i) / n
    const dx = amp > 0 ? amp * Math.sin((TAU * y) / lambda) : 0
    const lo = Math.max(center + dx - t / 2, -fieldHalf)
    const hi = Math.min(center + dx + t / 2, fieldHalf)
    if (hi - lo < 1e-4) return false
    ys[i] = y; xa[i] = lo; xb[i] = hi
  }
  for (let i = 0; i < n; i++) {
    const yA = ys[i], yB = ys[i + 1]
    // -x wall
    s.quad(xa[i], yA, z0, xa[i], yA, z1, xa[i + 1], yB, z1, xa[i + 1], yB, z0)
    // +x wall
    s.quad(xb[i], yA, z0, xb[i + 1], yB, z0, xb[i + 1], yB, z1, xb[i], yA, z1)
    // top (+z)
    s.quad(xa[i], yA, z1, xb[i], yA, z1, xb[i + 1], yB, z1, xa[i + 1], yB, z1)
    // bottom (-z)
    s.quad(xa[i], yA, z0, xa[i + 1], yB, z0, xb[i + 1], yB, z0, xb[i], yA, z0)
  }
  // end caps
  s.quad(xa[0], ys[0], z0, xb[0], ys[0], z0, xb[0], ys[0], z1, xa[0], ys[0], z1)       // -y
  s.quad(xa[n], ys[n], z0, xa[n], ys[n], z1, xb[n], ys[n], z1, xb[n], ys[n], z0)       // +y
  return true
}

// ---------------------------------------------------------------------------
// TPMS field (port of the GLSL in SdfViewer.tsx — keep the two in sync)
// ---------------------------------------------------------------------------

export const TPMS_IDX: Record<string, number> = {
  gyroid: 0, diamond: 1, schwarz_p: 2, lidinoid: 3,
  split_p: 4, iwp: 5, neovius: 6, fischer_koch: 7,
}

export function tpmsField(px: number, py: number, pz: number, k: number, ty: number): number {
  const x = k * px, y = k * py, z = k * pz
  const c2x = Math.cos(2 * x), c2y = Math.cos(2 * y), c2z = Math.cos(2 * z)
  const sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z)
  const cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z)
  switch (ty) {
    case 0: return cx * sy + cy * sz + cz * sx                                        // gyroid
    case 1: return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz          // Schwarz diamond
    case 2: return cx + cy + cz                                                       // Schwarz P
    case 3: return Math.sin(2 * x) * cy * sz + Math.sin(2 * y) * cz * sx              // lidinoid
      + Math.sin(2 * z) * cx * sy - c2x * c2y - c2y * c2z - c2z * c2x + 0.3
    case 4: return 1.1 * (Math.sin(2 * x) * sz * cy + Math.sin(2 * y) * sx * cz       // split-P
      + Math.sin(2 * z) * sy * cx) - 0.2 * (c2x * c2y + c2y * c2z + c2z * c2x)
      - 0.4 * (c2x + c2y + c2z)
    case 5: return 2 * (cx * cy + cy * cz + cz * cx) - (c2x + c2y + c2z)              // Schoen I-WP
    case 6: return 3 * (cx + cy + cz) + 4 * cx * cy * cz                              // Neovius
    default: return c2x * sy * cz + c2y * sz * cx + c2z * sx * cy                     // Fischer-Koch S
  }
}

/** Signed distance of the TPMS core (mirrors mapScene's TPMS branch, base excluded). */
function makeTpmsSdf(g: ViewerGeom, zLo: number, zHi: number): (x: number, y: number, z: number) => number {
  const W = g.coreWidth, L = g.coreLength
  const R = 0.5 * Math.min(W, L)
  const zc = (zLo + zHi) / 2
  const hz = (zHi - zLo) / 2
  const cylinder = g.layout === 'cylinder'
  const ty = TPMS_IDX[g.tpmsType] ?? 0
  const grade = g.grading
  const wall = g.wallThickness
  const solid = g.solid

  return (x, y, z) => {
    // clip volume (box or vertical cylinder)
    let clip: number
    const dzAbs = Math.abs(z - zc) - hz
    if (cylinder) {
      const dr = Math.hypot(x, y) - R
      clip = Math.min(Math.max(dr, dzAbs), 0) + Math.hypot(Math.max(dr, 0), Math.max(dzAbs, 0))
    } else {
      const qx = Math.abs(x) - W / 2
      const qy = Math.abs(y) - L / 2
      const m = Math.max(qx, qy, dzAbs)
      clip = Math.min(m, 0)
        + Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(dzAbs, 0))
    }
    const rr = Math.hypot(x, y)
    // jet-adaptive grading: finer than nominal at the centre, coarser at the edges
    const cLocal = g.unitCell * (1 + grade * (Math.min(Math.max(rr / Math.max(R, 1e-3), 0), 1.5) - 0.5))
    const c = Math.max(cLocal, 0.3)
    const k = TAU / c
    const f = tpmsField(x, y, z, k, ty)
    const iso = Math.min(Math.max((wall * Math.PI) / c, 0.06), 1.2)
    const scale = (c / TAU) * 0.5
    const d = (solid ? f - iso : Math.abs(f) - iso) * scale
    return Math.max(d, clip)
  }
}

// ---------------------------------------------------------------------------
// Manifold surface nets: watertight mesh of an SDF's zero level set.
// Streams two z-slabs at a time so memory stays flat regardless of grid size.
// The caller must size the grid so all boundary samples are outside (> 0).
//
// Unlike plain surface nets (one vertex per mixed cell), each cell gets one
// vertex PER CONNECTED COMPONENT of its inside corners. A thin TPMS sheet
// passing twice through one cell previously collapsed both sides onto a single
// shared vertex — a pinch that slicers report as thousands of non-manifold
// edges. With per-component vertices the two sheet sides stay separate, at any
// voxel resolution.
// ---------------------------------------------------------------------------

function surfaceNets(
  s: TriSink,
  f: (x: number, y: number, z: number) => number,
  x0: number, y0: number, z0: number,
  nx: number, ny: number, nz: number, h: number,
): void {
  const sx = nx + 1, sy = ny + 1
  const sliceLen = sx * sy
  let sliceA = new Float32Array(sliceLen) // samples at level k
  let sliceB = new Float32Array(sliceLen) // samples at level k+1
  // per cell: first vertex id (-1 = none) + packed 4-bit map corner -> local
  // component (15 = outside corner). Component c's vertex id = base + c.
  let baseP = new Int32Array(nx * ny).fill(-1)
  let baseQ = new Int32Array(nx * ny).fill(-1)
  let compP = new Uint32Array(nx * ny)
  let compQ = new Uint32Array(nx * ny)
  const verts: number[] = [] // xyz triples, indexed by cell-vertex id

  const fillSlice = (dst: Float32Array, k: number) => {
    const z = z0 + k * h
    let p = 0
    for (let j = 0; j < sy; j++) {
      const y = y0 + j * h
      for (let i = 0; i < sx; i++) {
        const v = f(x0 + i * h, y, z)
        // nudge exact zeros off the surface: crossings that land precisely on
        // shared grid corners collapse neighbouring cell vertices into
        // degenerate triangles otherwise (guard again after Float32 rounding)
        dst[p] = v === 0 ? 1e-6 : v
        if (dst[p] === 0) dst[p] = 1e-6
        p++
      }
    }
  }

  /** Vertex id for `corner` (bit order x|y<<1|z<<2) of cell `ci`, or -1. */
  const vertOf = (bases: Int32Array, comps: Uint32Array, ci: number, corner: number): number => {
    const b = bases[ci]
    if (b < 0) return -1
    const c = (comps[ci] >>> (corner * 4)) & 15
    return c === 15 ? -1 : b + c
  }

  // Triangles are buffered as vertex ids so disconnected micro-fragments
  // (under-resolved sheet dust — unprintable, and flagged by mesh checkers)
  // can be dropped before anything reaches the sink.
  let triBuf = new Int32Array(3 * 4096)
  let triUsed = 0
  const pushTri = (a: number, b: number, c: number) => {
    if (triUsed + 3 > triBuf.length) {
      const next = new Int32Array(Math.ceil(triBuf.length * 1.8 / 3) * 3)
      next.set(triBuf)
      triBuf = next
    }
    triBuf[triUsed++] = a; triBuf[triUsed++] = b; triBuf[triUsed++] = c
  }

  const quadFromVerts = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) { pushTri(d, c, b); pushTri(d, b, a) }
    else { pushTri(a, b, c); pushTri(a, c, d) }
  }

  // scratch buffers reused per cell
  const v = new Float64Array(8)
  const root = new Int32Array(8)
  const compOf = new Int32Array(8)
  const px = new Float64Array(8), py = new Float64Array(8)
  const pz = new Float64Array(8), cnt = new Int32Array(8)
  const qx = new Float64Array(8), qy = new Float64Array(8)
  const qz = new Float64Array(8), qn = new Int32Array(8)

  fillSlice(sliceA, 0)
  for (let k = 0; k < nz; k++) {
    fillSlice(sliceB, k + 1)
    baseQ.fill(-1)
    const zA = z0 + k * h

    // 1. vertices: one per connected inside-corner component of each mixed cell
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const i00 = j * sx + i
        v[0] = sliceA[i00]; v[1] = sliceA[i00 + 1]
        v[2] = sliceA[i00 + sx]; v[3] = sliceA[i00 + sx + 1]
        v[4] = sliceB[i00]; v[5] = sliceB[i00 + 1]
        v[6] = sliceB[i00 + sx]; v[7] = sliceB[i00 + sx + 1]
        let inside = 0
        for (let m = 0; m < 8; m++) if (v[m] < 0) inside++
        if (inside === 0 || inside === 8) continue

        // union inside corners along cube edges (corner bits: x|y<<1|z<<2)
        for (let m = 0; m < 8; m++) root[m] = m
        const find = (m: number): number => {
          while (root[m] !== m) { root[m] = root[root[m]]; m = root[m] }
          return m
        }
        for (let e = 0; e < 24; e += 2) {
          const a = SN_EDGES[e], b = SN_EDGES[e + 1]
          if (v[a] < 0 && v[b] < 0) root[find(a)] = find(b)
        }
        // assign component ids in first-seen order
        let nComp = 0
        for (let m = 0; m < 8; m++) compOf[m] = -1
        for (let m = 0; m < 8; m++) {
          if (v[m] >= 0) continue
          const r = find(m)
          if (compOf[r] < 0) compOf[r] = nComp++
          compOf[m] = compOf[r]
        }

        // average the crossing edges into their inside-corner's component
        px.fill(0); py.fill(0); pz.fill(0); cnt.fill(0)
        qx.fill(0); qy.fill(0); qz.fill(0); qn.fill(0)
        for (let e = 0; e < 24; e += 2) {
          const a = SN_EDGES[e], b = SN_EDGES[e + 1]
          const va = v[a], vb = v[b]
          if ((va < 0) === (vb < 0)) continue
          const t = va / (va - vb)
          const c = compOf[va < 0 ? a : b]
          px[c] += (a & 1) + t * ((b & 1) - (a & 1))
          py[c] += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1))
          pz[c] += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1))
          cnt[c]++
        }
        // inside-corner centroid per component (for the two-sheet bias below)
        for (let m = 0; m < 8; m++) {
          if (v[m] >= 0) continue
          const c = compOf[m]
          qx[c] += m & 1; qy[c] += (m >> 1) & 1; qz[c] += (m >> 2) & 1
          qn[c]++
        }
        const ci = j * nx + i
        baseQ[ci] = verts.length / 3
        for (let c = 0; c < nComp; c++) {
          // every maximal inside component in a mixed cell has >= 1 crossing
          const n = cnt[c] || 1
          let vx = px[c] / n, vy = py[c] / n, vz = pz[c] / n
          if (nComp > 1) {
            // two sheet sides in one cell: pull each vertex slightly toward its
            // own inside corners so the sides can't land on coincident points
            // (position-welded coincident vertices read as non-manifold)
            const m = qn[c] || 1
            vx = 0.85 * vx + 0.15 * (qx[c] / m)
            vy = 0.85 * vy + 0.15 * (qy[c] / m)
            vz = 0.85 * vz + 0.15 * (qz[c] / m)
          }
          verts.push(x0 + (i + vx) * h, y0 + (j + vy) * h, zA + (vz) * h)
        }
        let packed = 0
        for (let m = 0; m < 8; m++) packed |= (v[m] < 0 ? compOf[m] : 15) << (m * 4)
        compQ[ci] = packed >>> 0
      }
    }

    // 2. z-edges of level k..k+1: 4 surrounding cells all live in slab k.
    // Each cell's vertex is the one owning the edge's INSIDE corner, so the
    // two sides of a thin sheet stitch to their own vertices.
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const a = sliceA[j * sx + i], b = sliceB[j * sx + i]
        if ((a < 0) === (b < 0)) continue
        const zin = a < 0 ? 0 : 4 // z-bit of the inside sample
        quadFromVerts(
          vertOf(baseQ, compQ, (j - 1) * nx + (i - 1), 3 + zin), // local x=1 y=1
          vertOf(baseQ, compQ, (j - 1) * nx + i, 2 + zin),       // local x=0 y=1
          vertOf(baseQ, compQ, j * nx + i, 0 + zin),             // local x=0 y=0
          vertOf(baseQ, compQ, j * nx + (i - 1), 1 + zin),       // local x=1 y=0
          b < 0, // inside above -> normal points -z -> flip
        )
      }
    }

    // 3. x- and y-edges at sample level k: cells from slabs k-1 (P, z-bit 1)
    // and k (Q, z-bit 0)
    if (k > 0) {
      // cell order below gives an outward normal when the +side sample is
      // inside, so these two flip on a<0 (unlike the z-edges above)
      for (let j = 1; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = sliceA[j * sx + i], b = sliceA[j * sx + i + 1]
          if ((a < 0) === (b < 0)) continue
          const xin = a < 0 ? 0 : 1 // x-bit of the inside sample
          quadFromVerts(
            vertOf(baseP, compP, (j - 1) * nx + i, xin + 2 + 4), // y=1 z=1
            vertOf(baseQ, compQ, (j - 1) * nx + i, xin + 2),     // y=1 z=0
            vertOf(baseQ, compQ, j * nx + i, xin),               // y=0 z=0
            vertOf(baseP, compP, j * nx + i, xin + 4),           // y=0 z=1
            a < 0,
          )
        }
      }
      for (let j = 0; j < ny; j++) {
        for (let i = 1; i < nx; i++) {
          const a = sliceA[j * sx + i], b = sliceA[(j + 1) * sx + i]
          if ((a < 0) === (b < 0)) continue
          const yin = a < 0 ? 0 : 2 // y-bit of the inside sample
          quadFromVerts(
            vertOf(baseP, compP, j * nx + (i - 1), 1 + yin + 4), // x=1 z=1
            vertOf(baseP, compP, j * nx + i, yin + 4),           // x=0 z=1
            vertOf(baseQ, compQ, j * nx + i, yin),               // x=0 z=0
            vertOf(baseQ, compQ, j * nx + (i - 1), 1 + yin),     // x=1 z=0
            a < 0,
          )
        }
      }
    }

    // rotate the window
    const tmpS = sliceA; sliceA = sliceB; sliceB = tmpS
    const tmpB = baseP; baseP = baseQ; baseQ = tmpB
    const tmpM = compP; compP = compQ; compQ = tmpM
  }

  // Drop disconnected micro-shells (< MIN_SHELL_TRIS triangles): sub-voxel
  // sheet dust from under-resolution — unprintable, and each fragment shows up
  // in mesh checkers. Union-find over shared vertex ids, then emit the rest.
  const MIN_SHELL_TRIS = 32
  const nV = verts.length / 3
  const parent = new Int32Array(nV)
  for (let i = 0; i < nV; i++) parent[i] = i
  const findV = (m: number): number => {
    while (parent[m] !== m) { parent[m] = parent[parent[m]]; m = parent[m] }
    return m
  }
  for (let t = 0; t < triUsed; t += 3) {
    const ra = findV(triBuf[t])
    parent[findV(triBuf[t + 1])] = ra
    parent[findV(triBuf[t + 2])] = ra
  }
  const shellTris = new Map<number, number>()
  for (let t = 0; t < triUsed; t += 3) {
    const r = findV(triBuf[t])
    shellTris.set(r, (shellTris.get(r) ?? 0) + 1)
  }
  for (let t = 0; t < triUsed; t += 3) {
    if ((shellTris.get(findV(triBuf[t])) ?? 0) < MIN_SHELL_TRIS) continue
    const A = triBuf[t] * 3, B = triBuf[t + 1] * 3, C = triBuf[t + 2] * 3
    s.tri(verts[A], verts[A + 1], verts[A + 2],
      verts[B], verts[B + 1], verts[B + 2],
      verts[C], verts[C + 1], verts[C + 2])
  }
}

// The 12 cube edges as corner-index pairs (corner bits: x | y<<1 | z<<2).
const SN_EDGES = new Int8Array([
  0, 1, 2, 3, 4, 5, 6, 7, // x-edges
  0, 2, 1, 3, 4, 6, 5, 7, // y-edges
  0, 4, 1, 5, 2, 6, 3, 7, // z-edges
])

// ---------------------------------------------------------------------------
// Per-family builders
// ---------------------------------------------------------------------------

function buildFins(s: TriSink, g: ViewerGeom): void {
  const fieldHalf = g.coreWidth / 2 - g.sideMargin
  const pitch = g.finThickness + g.gap
  const zTop = g.baseThickness + g.finHeight
  const zBot = g.baseThickness - EMBED
  const lambda = Math.max(g.waveLen, 0.5)
  // enough segments that the sine's chord error stays well under 0.02 mm
  const segs = g.waveAmp > 0
    ? Math.min(600, Math.max(8, Math.ceil((g.coreLength / lambda) * 12)))
    : 1
  if (pitch > 1e-4 && fieldHalf > 0) {
    const nMax = Math.floor((fieldHalf + g.finThickness / 2 + g.waveAmp) / pitch)
    for (let n = -nMax; n <= nMax; n++) {
      meshWavyFin(s, n * pitch, g.finThickness, g.waveAmp, lambda,
        fieldHalf, g.coreLength, zBot, zTop, segs)
    }
  }
  if (g.ribWidth > 0) {
    meshBox(s, -g.coreWidth / 2, g.coreWidth / 2,
      -g.ribWidth / 2, g.ribWidth / 2, zBot, zTop)
  }
}

function buildPins(s: TriSink, g: ViewerGeom): void {
  const pp = Math.max(g.pinPitch, 0.1)
  const r = g.pinDiameter / 2
  const zTop = g.baseThickness + g.finHeight
  const zBot = g.baseThickness - EMBED
  const W = g.coreWidth, L = g.coreLength
  const R = 0.5 * Math.min(W, L)
  const cylinder = g.layout === 'cylinder'
  // pins fully inside the clip region only — edge-clipped partial pins would
  // not be watertight shells, and slivers are unprintable anyway
  const mMax = Math.floor(L / 2 / pp) + 1
  const nMax = Math.floor((W / 2 + pp) / pp) + 1
  for (let m = -mMax; m <= mMax; m++) {
    const cy = m * pp
    const xoff = g.pinStagger && ((m % 2) + 2) % 2 === 1 ? 0.5 * pp : 0
    for (let n = -nMax; n <= nMax; n++) {
      const cx = n * pp - xoff
      const insideClip = cylinder
        ? Math.hypot(cx, cy) <= R - r
        : Math.abs(cx) <= W / 2 - r && Math.abs(cy) <= L / 2 - r
      if (insideClip) meshCylinder(s, cx, cy, zBot, zTop, r, 24)
    }
  }
}

/** Voxel size for the TPMS grid — sheet walls must stay resolved or they vanish. */
function voxelFor(g: ViewerGeom, quality: StlQuality): number {
  const scale = quality === 'draft' ? 1.5 : quality === 'fine' ? 0.65 : 1.0
  if (g.solid) return Math.min(Math.max((g.unitCell / 10) * scale, 0.04), 0.5)
  const v = Math.min(g.unitCell / 8, 0.75 * g.wallThickness) * scale
  return Math.min(Math.max(v, 0.03), 0.8 * g.wallThickness)
}

function buildTpms(s: TriSink, g: ViewerGeom, quality: StlQuality): void {
  const zLo = g.baseThickness - EMBED
  const zHi = g.baseThickness + g.finHeight
  const sdf = makeTpmsSdf(g, zLo, zHi)
  const h = voxelFor(g, quality)
  const pad = 2 * h
  const x0 = -g.coreWidth / 2 - pad
  const y0 = -g.coreLength / 2 - pad
  const zg = zLo - pad
  const nx = Math.ceil((g.coreWidth + 2 * pad) / h)
  const ny = Math.ceil((g.coreLength + 2 * pad) / h)
  const nz = Math.ceil((zHi - zLo + 2 * pad) / h)
  surfaceNets(s, sdf, x0, y0, zg, nx, ny, nz, h)
}

/** Build a binary STL of the full current model (base + core), in mm. */
export function buildStl(g: ViewerGeom, quality: StlQuality = 'standard'): StlResult {
  const s = new TriSink()
  meshBox(s, -g.coreWidth / 2, g.coreWidth / 2,
    -g.coreLength / 2, g.coreLength / 2, 0, g.baseThickness)
  if (g.family === 'gyroid_tpms') {
    if (g.isPin) buildPins(s, g)
    else buildTpms(s, g, quality)
  } else {
    buildFins(s, g)
  }
  const buffer = s.toBinaryStl()
  return { buffer, triangles: (buffer.byteLength - 84) / 50 }
}
