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
  /** exact Euclidean clearance to the nearest solid, per pixel (px units) —
   *  2×clearance ≈ the local passage width; lets the hover explain WHY a
   *  pixel is neck-flagged even when the nominal channel width is fine */
  clearance: Float32Array
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

// Exact Euclidean distance transform (Felzenszwalb two-pass): the earlier
// 3-4 chamfer approximation underestimated DIAGONAL clearances by ~6 %, so
// borderline channels on slanted wavy sections (exactly at the floor, e.g.
// an uncompensated M4 print's 6 px gaps) were flagged wholesale even though
// a true 6 px disc fits. Exact distances flag only genuine necks.
const EDT_INF = 1e9

function edt(sites: Uint8Array, nx: number, ny: number): Float32Array {
  // pass 1 — per-column nearest site distance (in px, monotone scan both ways)
  const g = new Float32Array(nx * ny)
  for (let i = 0; i < nx; i++) {
    let d = EDT_INF
    for (let j = 0; j < ny; j++) {
      const idx = j * nx + i
      d = sites[idx] ? 0 : (d >= EDT_INF ? EDT_INF : d + 1)
      g[idx] = d
    }
    d = EDT_INF
    for (let j = ny - 1; j >= 0; j--) {
      const idx = j * nx + i
      d = sites[idx] ? 0 : (d >= EDT_INF ? EDT_INF : d + 1)
      if (d < g[idx]) g[idx] = d
    }
  }
  // pass 2 — per-row lower envelope of parabolas over g² (exact squared EDT)
  const D = new Float32Array(nx * ny)
  const v = new Int32Array(nx)
  const z = new Float32Array(nx + 1)
  const f = new Float32Array(nx)
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    for (let i = 0; i < nx; i++) {
      const gi = Math.min(g[row + i], 1e6)
      f[i] = gi * gi
    }
    let k = 0
    v[0] = 0; z[0] = -EDT_INF; z[1] = EDT_INF
    for (let q = 1; q < nx; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q; z[k] = s; z[k + 1] = EDT_INF
    }
    k = 0
    for (let q = 0; q < nx; q++) {
      while (z[k + 1] < q) k++
      const dq = q - v[k]
      D[row + q] = Math.sqrt(dq * dq + f[v[k]])
    }
  }
  return D
}

export function scanChannelNecks(mask: Uint8Array, nx: number, ny: number, minPx: number): NeckScan {
  const n = nx * ny
  const INF = 1 << 29
  let anySolid = 0
  for (let i = 0; i < n; i++) if (mask[i]) { anySolid = 1; break }
  if (!anySolid) {
    return { flags: new Uint8Array(n), count: 0, worstIdx: -1, worstPx: 0,
      clearance: new Float32Array(n) }
  }
  const r = minPx / 2
  const D = edt(mask, nx, ny)                    // exact clearance to solid, in px
  const seeds = new Uint8Array(n)                // px where a minPx disc fits
  for (let i = 0; i < n; i++) if (D[i] >= r - 1e-6) seeds[i] = 1
  const D2 = edt(seeds, nx, ny)                  // distance to nearest disc-fits px
  const flags = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (!mask[i] && D2[i] > r + 1e-6) flags[i] = 1
  // blob filter + worst passage. "Worst" = the narrowest THROAT: the minimum
  // 2×clearance over medial-ridge pixels (D a local max vs its 4 neighbours —
  // the corridor spine). The first version reported each blob's WIDEST
  // clearance, which is ≈ the throat for a small isolated neck but wildly
  // overstates a systemic flood: when the whole channel network merges into
  // one flagged region, its widest pocket sits just under the threshold
  // (M2 read "worst ≈ 5.7 px" while its real squeezes are ~2 px). The ridge
  // condition keeps corner notches out — clearance grows toward a channel's
  // centre, so non-spine pixels always have a larger neighbour.
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
    let throat = INF, tIdx = -1
    let bMax = -1, bIdx = blob[0]
    for (const p of blob) {
      const d = D[p]
      if (d > bMax) { bMax = d; bIdx = p }
      const pi = p % nx, pj = (p - pi) / nx
      const ridge =
        (pi + 1 >= nx || d >= D[p + 1] - 1e-6) &&
        (pi - 1 < 0 || d >= D[p - 1] - 1e-6) &&
        (pj + 1 >= ny || d >= D[p + nx] - 1e-6) &&
        (pj - 1 < 0 || d >= D[p - nx] - 1e-6)
      if (ridge && 2 * d < throat) { throat = 2 * d; tIdx = p }
    }
    const w = throat < INF ? throat : 2 * bMax
    const wi = tIdx >= 0 ? tIdx : bIdx
    if (w < worstW) { worstW = w; worstIdx = wi }
  }
  return { flags, count, worstIdx, worstPx: worstW === INF ? 0 : Math.round(worstW * 10) / 10,
    clearance: D }
}
