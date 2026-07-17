// V4 — mesh bookkeeping on the imported triangle soup: vertex dedup (hash on
// exact float bits — STL shares vertices bit-exactly), watertightness via
// directed-edge pairing, signed volume, areas, bbox.

export interface IndexedMesh {
  /** deduped vertices, xyz triples */
  verts: Float32Array
  /** vertex count */
  nVerts: number
  /** triangle indices into verts */
  index: Uint32Array
  triangles: number
}

export function bbox(positions: Float32Array): [number, number, number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
    if (z < z0) z0 = z; if (z > z1) z1 = z
  }
  return [x0, y0, z0, x1, y1, z1]
}

/** In-place affine transform: p' = scale⊙p + offset (per-axis scale). */
export function transformPositions(
  positions: Float32Array,
  sx: number, sy: number, sz: number,
  ox: number, oy: number, oz: number,
  rotate90: boolean,
): void {
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i] * sx
    let y = positions[i + 1] * sy
    const z = positions[i + 2] * sz
    if (rotate90) { const t = x; x = y; y = -t } // +90° about z
    positions[i] = x + ox
    positions[i + 1] = y + oy
    positions[i + 2] = z + oz
  }
}

/**
 * Dedup vertices by exact float bit pattern (open-addressing hash table).
 * STL repeats each shared vertex verbatim, so bit-exact matching is the
 * correct equivalence — no quantization welding that could fuse thin walls.
 */
export function indexMesh(positions: Float32Array, onProgress?: (pct: number) => void): IndexedMesh {
  const nTris = positions.length / 9
  const nCorners = nTris * 3
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length)

  // hash table sized to the corner count (load factor <= 0.5)
  let cap = 1
  while (cap < nCorners * 2) cap <<= 1
  const mask = cap - 1
  const table = new Int32Array(cap).fill(-1) // -> vertex id
  const verts = new Float32Array(nCorners * 3) // worst case: no sharing
  const vbits = new Uint32Array(verts.buffer)
  const index = new Uint32Array(nCorners)
  let nVerts = 0

  for (let c = 0; c < nCorners; c++) {
    const p = c * 3
    const ax = bits[p], ay = bits[p + 1], az = bits[p + 2]
    // FNV-ish mix of the three bit patterns
    let h = 2166136261 >>> 0
    h = Math.imul(h ^ ax, 16777619) >>> 0
    h = Math.imul(h ^ ay, 16777619) >>> 0
    h = Math.imul(h ^ az, 16777619) >>> 0
    let slot = h & mask
    for (;;) {
      const vid = table[slot]
      if (vid < 0) {
        table[slot] = nVerts
        const v = nVerts * 3
        vbits[v] = ax; vbits[v + 1] = ay; vbits[v + 2] = az
        index[c] = nVerts
        nVerts++
        break
      }
      const v = vid * 3
      if (vbits[v] === ax && vbits[v + 1] === ay && vbits[v + 2] === az) {
        index[c] = vid
        break
      }
      slot = (slot + 1) & mask
    }
    if (onProgress && (c & 0xfffff) === 0) onProgress(c / nCorners)
  }

  return { verts: verts.subarray(0, nVerts * 3), nVerts, index, triangles: nTris }
}

/**
 * Watertightness: every directed edge must be matched by its reverse exactly
 * once. Returns the count of unmatched (open / over-shared) edges.
 */
export function openEdgeCount(mesh: IndexedMesh): number {
  const { index, triangles } = mesh
  // map key: lo * 2^32 + hi encoded as two 32-bit ints in a Map<number, number>
  // → count balance: +1 for (a<b) direction, -1 for (b<a)
  const balance = new Map<number, number>()
  const keyOf = (a: number, b: number): number =>
    a < b ? a * 4294967296 + b : b * 4294967296 + a
  for (let t = 0; t < triangles; t++) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2]
    if (i0 === i1 || i1 === i2 || i2 === i0) continue // degenerate
    const edges: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]]
    for (const [a, b] of edges) {
      const k = keyOf(a, b)
      balance.set(k, (balance.get(k) ?? 0) + (a < b ? 1 : -1))
    }
  }
  let open = 0
  for (const v of balance.values()) if (v !== 0) open += Math.abs(v)
  return open
}

/** Signed volume via divergence theorem (valid when watertight + consistently
 *  wound; caller flips sign if negative and flags approximate otherwise). */
export function signedVolume(positions: Float32Array): number {
  let vol = 0
  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t], ay = positions[t + 1], az = positions[t + 2]
    const bx = positions[t + 3], by = positions[t + 4], bz = positions[t + 5]
    const cx = positions[t + 6], cy = positions[t + 7], cz = positions[t + 8]
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return vol / 6
}

/** Total area + structure-only area (triangle centroid above `zBase`). */
export function surfaceAreas(positions: Float32Array, zBase: number): { total: number; struct: number } {
  let total = 0, struct = 0
  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t], ay = positions[t + 1], az = positions[t + 2]
    const ux = positions[t + 3] - ax, uy = positions[t + 4] - ay, uz = positions[t + 5] - az
    const vx = positions[t + 6] - ax, vy = positions[t + 7] - ay, vz = positions[t + 8] - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const a = Math.hypot(nx, ny, nz) / 2
    total += a
    const cz = (az + positions[t + 5] + positions[t + 8]) / 3
    if (cz > zBase + 1e-4) struct += a
  }
  return { total, struct }
}
