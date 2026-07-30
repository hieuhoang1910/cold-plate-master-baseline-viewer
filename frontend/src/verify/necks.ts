// ⌖ neck scan (2026-07-30): Incus reviews the slicer BITMAP, not nominal
// widths — their "cross section only 2 px" findings are local passages where
// off-grid rounding + stair-step phasing neck the drawn channel down. The
// scan runs a morphological opening on the void (3-4 chamfer distance
// transform ≈ Euclidean): any channel pixel a minPx-diameter disc cannot
// reach is a neck that will not be cleaned. Stair-corner clips (< 3 px
// blobs) are dropped. Shared by PixelPreview (per-layer, main thread) and
// the verify worker (whole-stack sweep — keeping the sweep in the worker is
// what makes "scan all layers" fast: no per-layer mask copies or renders).

export interface NeckScan {
  flags: Uint8Array
  count: number
  worstIdx: number
  worstPx: number
}

/** Overpoly what-if on a rasterized mask: grow every solid feature by ~1 px
 *  per side (8-neighbour dilation) — what an UNcompensated print delivers.
 *  Returns a new array; the input is untouched. */
export function dilate1px(mask: Uint8Array, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(mask)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
      if (mask[idx]) continue
      let s = 0
      for (let dj = -1; dj <= 1 && !s; dj++) {
        const jj = j + dj
        if (jj < 0 || jj >= ny) continue
        for (let di = -1; di <= 1; di++) {
          const ii = i + di
          if (ii < 0 || ii >= nx) continue
          if (mask[jj * nx + ii]) { s = 1; break }
        }
      }
      if (s) out[idx] = 1
    }
  }
  return out
}

export function scanChannelNecks(mask: Uint8Array, nx: number, ny: number, minPx: number): NeckScan {
  const n = nx * ny
  const INF = 1 << 29
  const pass = (dist: Int32Array, fwd: boolean) => {
    const j0 = fwd ? 0 : ny - 1, j1 = fwd ? ny : -1, dj = fwd ? 1 : -1
    for (let j = j0; j !== j1; j += dj) {
      const i0 = fwd ? 0 : nx - 1, i1 = fwd ? nx : -1, di = fwd ? 1 : -1
      for (let i = i0; i !== i1; i += di) {
        const idx = j * nx + i
        let d = dist[idx]
        const ip = i - di, jp = j - dj
        if (ip >= 0 && ip < nx) d = Math.min(d, dist[j * nx + ip] + 3)
        if (jp >= 0 && jp < ny) {
          d = Math.min(d, dist[jp * nx + i] + 3)
          if (ip >= 0 && ip < nx) d = Math.min(d, dist[jp * nx + ip] + 4)
          const iq = i + di
          if (iq >= 0 && iq < nx) d = Math.min(d, dist[jp * nx + iq] + 4)
        }
        dist[idx] = d
      }
    }
  }
  const D = new Int32Array(n)                    // chamfer distance to solid, ×3
  for (let i = 0; i < n; i++) D[i] = mask[i] ? 0 : INF
  pass(D, true); pass(D, false)
  const r3 = Math.round((minPx / 2) * 3)
  const D2 = new Int32Array(n)                   // distance to "disc fits here" seeds
  for (let i = 0; i < n; i++) D2[i] = D[i] >= r3 && D[i] < INF ? 0 : INF
  pass(D2, true); pass(D2, false)
  const flags = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (!mask[i] && D[i] < INF && D2[i] > r3) flags[i] = 1
  // blob filter + worst passage (narrowest neck = blob with the smallest max clearance)
  const seen = new Uint8Array(n)
  const stack: number[] = []
  let count = 0, worstIdx = -1, worstW = INF
  for (let s = 0; s < n; s++) {
    if (!flags[s] || seen[s]) continue
    stack.length = 0; stack.push(s); seen[s] = 1
    const blob: number[] = []
    while (stack.length) {
      const p = stack.pop() as number
      blob.push(p)
      const pi = p % nx, pj = (p - pi) / nx
      if (pi + 1 < nx && flags[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1) }
      if (pi - 1 >= 0 && flags[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1) }
      if (pj + 1 < ny && flags[p + nx] && !seen[p + nx]) { seen[p + nx] = 1; stack.push(p + nx) }
      if (pj - 1 >= 0 && flags[p - nx] && !seen[p - nx]) { seen[p - nx] = 1; stack.push(p - nx) }
    }
    if (blob.length < 3) { for (const p of blob) flags[p] = 0; continue }
    count += blob.length
    let bMax = -1, bIdx = blob[0]
    for (const p of blob) if (D[p] > bMax) { bMax = D[p]; bIdx = p }
    const w = (2 * bMax) / 3
    if (w < worstW) { worstW = w; worstIdx = bIdx }
  }
  return { flags, count, worstIdx, worstPx: worstW === INF ? 0 : Math.round(worstW * 10) / 10 }
}
