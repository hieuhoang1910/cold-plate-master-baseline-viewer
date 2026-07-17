// V4 — mesh slicing + scanline rasterization onto the DLP grid (final space).
// A slice of a consistently-wound mesh is a set of ORIENTED segments, so a
// NONZERO-winding scanline fills it correctly without contour stitching — and,
// unlike even-odd, stays correct for unions of overlapping shells (the app's
// own STL export sinks fins 0.05 mm into the base on purpose).

export interface SliceIndex {
  /** layer li -> [offsets[li], offsets[li+1]) range into tris */
  offsets: Uint32Array
  tris: Uint32Array
  nLayers: number
  lyF: number
}

/** Bucket triangles by the sampling planes z = (li + 0.5) * lyF they cross. */
export function buildSliceIndex(positions: Float32Array, lyF: number, nLayers: number): SliceIndex {
  const nTris = positions.length / 9
  const lo = new Int32Array(nTris)
  const hi = new Int32Array(nTris)
  const counts = new Uint32Array(nLayers + 1)
  for (let t = 0; t < nTris; t++) {
    const p = t * 9
    const z0 = Math.min(positions[p + 2], positions[p + 5], positions[p + 8])
    const z1 = Math.max(positions[p + 2], positions[p + 5], positions[p + 8])
    // plane li crosses when z0 <= (li+0.5)*lyF <= z1
    let a = Math.ceil(z0 / lyF - 0.5)
    let b = Math.floor(z1 / lyF - 0.5)
    if (a < 0) a = 0
    if (b > nLayers - 1) b = nLayers - 1
    lo[t] = a; hi[t] = b
    for (let li = a; li <= b; li++) counts[li]++
  }
  const offsets = new Uint32Array(nLayers + 1)
  for (let li = 0; li < nLayers; li++) offsets[li + 1] = offsets[li] + counts[li]
  const tris = new Uint32Array(offsets[nLayers])
  const cursor = Uint32Array.from(offsets.subarray(0, nLayers))
  for (let t = 0; t < nTris; t++) {
    for (let li = lo[t]; li <= hi[t]; li++) tris[cursor[li]++] = t
  }
  return { offsets, tris, nLayers, lyF }
}

/** Oriented segments of the z-plane cross-section: flat [x1,y1,x2,y2, ...],
 *  directed so the solid lies consistently to one side (tangent = n × ẑ). */
export function sliceSegments(
  positions: Float32Array, idx: SliceIndex, layer: number,
): Float64Array {
  const z = (layer + 0.5) * idx.lyF
  const out: number[] = []
  const a = idx.offsets[layer], b = idx.offsets[layer + 1]
  for (let r = a; r < b; r++) {
    const p = idx.tris[r] * 9
    // gather the (up to 2) edge crossings of this triangle with plane z
    let n = 0
    let sx0 = 0, sy0 = 0, sx1 = 0, sy1 = 0
    for (let e = 0; e < 3; e++) {
      const i0 = p + e * 3
      const i1 = p + ((e + 1) % 3) * 3
      const za = positions[i0 + 2], zb = positions[i1 + 2]
      if ((za <= z) === (zb <= z)) continue
      const t = (z - za) / (zb - za)
      const x = positions[i0] + t * (positions[i1] - positions[i0])
      const y = positions[i0 + 1] + t * (positions[i1 + 1] - positions[i0 + 1])
      if (n === 0) { sx0 = x; sy0 = y } else { sx1 = x; sy1 = y }
      n++
    }
    if (n !== 2 || (sx0 === sx1 && sy0 === sy1)) continue
    // orient along n × ẑ = (ny, -nx): winding normal from the triangle itself
    const ux = positions[p + 3] - positions[p], uy = positions[p + 4] - positions[p + 1]
    const uz = positions[p + 5] - positions[p + 2]
    const vx = positions[p + 6] - positions[p], vy = positions[p + 7] - positions[p + 1]
    const vz = positions[p + 8] - positions[p + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const dot = (sx1 - sx0) * ny + (sy1 - sy0) * -nx
    if (dot < 0) out.push(sx1, sy1, sx0, sy0)
    else out.push(sx0, sy0, sx1, sy1)
  }
  return Float64Array.from(out)
}

/**
 * Nonzero-winding scanline fill of an oriented segment set onto the pixel grid
 * (pixel centres at x = -halfW + (i+0.5)·pxF, y = -halfL + (j+0.5)·pxF).
 * Writes 0/1 into `mask` (length nx*ny). Overlapping shells union cleanly.
 */
export function rasterizeSegments(
  segs: Float64Array, mask: Uint8Array,
  nx: number, ny: number, pxF: number, halfW: number, halfL: number,
): void {
  mask.fill(0)
  const nSegs = segs.length / 4
  // bucket segments by the pixel rows they span
  const rowOf = (y: number): number => (y + halfL) / pxF - 0.5
  const counts = new Uint32Array(ny + 1)
  const lo = new Int32Array(nSegs)
  const hi = new Int32Array(nSegs)
  for (let s = 0; s < nSegs; s++) {
    const y1 = segs[s * 4 + 1], y2 = segs[s * 4 + 3]
    const yLo = Math.min(y1, y2), yHi = Math.max(y1, y2)
    if (yLo === yHi) { lo[s] = 1; hi[s] = 0; continue } // horizontal: no crossings
    const a = Math.max(0, Math.ceil(rowOf(yLo)))
    const b = Math.min(ny - 1, Math.floor(rowOf(yHi)))
    lo[s] = a; hi[s] = b
    for (let j = a; j <= b; j++) counts[j]++
  }
  const offsets = new Uint32Array(ny + 1)
  for (let j = 0; j < ny; j++) offsets[j + 1] = offsets[j] + counts[j]
  const rowSegs = new Uint32Array(offsets[ny])
  const cursor = Uint32Array.from(offsets.subarray(0, ny))
  for (let s = 0; s < nSegs; s++) {
    for (let j = lo[s]; j <= hi[s]; j++) rowSegs[cursor[j]++] = s
  }

  // per-row crossings: x position + winding contribution (+1 up, -1 down)
  const xs: { x: number; w: number }[] = []
  for (let j = 0; j < ny; j++) {
    const y = -halfL + (j + 0.5) * pxF
    xs.length = 0
    for (let r = offsets[j]; r < offsets[j + 1]; r++) {
      const s = rowSegs[r] * 4
      const x1 = segs[s], y1 = segs[s + 1], x2 = segs[s + 2], y2 = segs[s + 3]
      if ((y1 <= y) === (y2 <= y)) continue // half-open rule
      xs.push({ x: x1 + ((y - y1) * (x2 - x1)) / (y2 - y1), w: y2 > y1 ? 1 : -1 })
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p.x - q.x)
    const row = j * nx
    let wind = 0
    let spanStart = 0
    for (const c of xs) {
      if (wind === 0 && wind + c.w !== 0) spanStart = c.x
      else if (wind !== 0 && wind + c.w === 0) {
        let i0 = Math.ceil((spanStart + halfW) / pxF - 0.5)
        let i1 = Math.floor((c.x + halfW) / pxF - 0.5)
        if (i0 < 0) i0 = 0
        if (i1 > nx - 1) i1 = nx - 1
        for (let i = i0; i <= i1; i++) mask[row + i] = 1
      }
      wind += c.w
    }
  }
}

/** Interior run-length distributions of a mask row-wise: solid runs (fins) and
 *  void runs (gaps), edge-touching runs excluded. Returns runs in pixels. */
export function interiorRuns(mask: Uint8Array, nx: number, ny: number): { solid: number[]; voids: number[] } {
  const solid: number[] = []
  const voids: number[] = []
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    let i = 0
    while (i < nx) {
      const v = mask[row + i]
      let e = i
      while (e < nx && mask[row + e] === v) e++
      if (i > 0 && e < nx) (v === 1 ? solid : voids).push(e - i)
      i = e
    }
  }
  return { solid, voids }
}

/** Total segment length excluding pieces lying on the outer envelope. */
export function interiorPerimeter(
  segs: Float64Array, halfW: number, halfL: number, eps: number,
): number {
  let sum = 0
  for (let s = 0; s < segs.length; s += 4) {
    const x1 = segs[s], y1 = segs[s + 1], x2 = segs[s + 2], y2 = segs[s + 3]
    const onEnvelope =
      (Math.abs(Math.abs(x1) - halfW) < eps && Math.abs(Math.abs(x2) - halfW) < eps)
      || (Math.abs(Math.abs(y1) - halfL) < eps && Math.abs(Math.abs(y2) - halfL) < eps)
    if (!onEnvelope) sum += Math.hypot(x2 - x1, y2 - y1)
  }
  return sum
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[i]
}
