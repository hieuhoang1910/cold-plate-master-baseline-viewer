// V4 — minimal AABB BVH over a triangle soup for closest-point queries
// (two-sided deviation: design-surface samples → nearest imported triangle).
// Hand-rolled (~150 lines) to keep the app dependency-free (spec §45-5).

export class TriBvh {
  private positions: Float32Array
  private nTris: number
  // node layout (flat arrays): bounds + either child pair or leaf tri range
  private nMin!: Float32Array
  private nMax!: Float32Array
  private nLeft!: Int32Array   // left child, or -1 for leaf
  private nRight!: Int32Array  // right child, or leaf start into order
  private nCount!: Int32Array  // 0 for inner, tri count for leaf
  private order!: Uint32Array
  private nodes = 0

  constructor(positions: Float32Array) {
    this.positions = positions
    this.nTris = positions.length / 9
    this.build()
  }

  private build(): void {
    const n = this.nTris
    const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n)
    for (let t = 0; t < n; t++) {
      const p = t * 9
      cx[t] = (this.positions[p] + this.positions[p + 3] + this.positions[p + 6]) / 3
      cy[t] = (this.positions[p + 1] + this.positions[p + 4] + this.positions[p + 7]) / 3
      cz[t] = (this.positions[p + 2] + this.positions[p + 5] + this.positions[p + 8]) / 3
    }
    this.order = new Uint32Array(n)
    for (let t = 0; t < n; t++) this.order[t] = t
    const maxNodes = Math.max(1, 2 * Math.ceil(n / 4) + 1)
    this.nMin = new Float32Array(maxNodes * 3)
    this.nMax = new Float32Array(maxNodes * 3)
    this.nLeft = new Int32Array(maxNodes)
    this.nRight = new Int32Array(maxNodes)
    this.nCount = new Int32Array(maxNodes)

    const LEAF = 8
    // iterative median-split build (explicit stack avoids recursion depth)
    const stack: [number, number, number][] = [] // node, start, end
    const rootId = this.nodes++
    stack.push([rootId, 0, n])
    const cs = [cx, cy, cz]
    while (stack.length) {
      const [node, start, end] = stack.pop()!
      // bounds over tris [start, end)
      let x0 = Infinity, y0 = Infinity, z0 = Infinity
      let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
      for (let r = start; r < end; r++) {
        const p = this.order[r] * 9
        for (let k = 0; k < 9; k += 3) {
          const x = this.positions[p + k], y = this.positions[p + k + 1], z = this.positions[p + k + 2]
          if (x < x0) x0 = x; if (x > x1) x1 = x
          if (y < y0) y0 = y; if (y > y1) y1 = y
          if (z < z0) z0 = z; if (z > z1) z1 = z
        }
      }
      this.nMin[node * 3] = x0; this.nMin[node * 3 + 1] = y0; this.nMin[node * 3 + 2] = z0
      this.nMax[node * 3] = x1; this.nMax[node * 3 + 1] = y1; this.nMax[node * 3 + 2] = z1
      if (end - start <= LEAF) {
        this.nLeft[node] = -1
        this.nRight[node] = start
        this.nCount[node] = end - start
        continue
      }
      // split on the widest centroid axis at the median
      const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
      const c = cs[axis]
      // median via sort of the subrange (n log n overall; fine at import time)
      this.order.subarray(start, end).sort((a, b) => c[a] - c[b])
      const mid = start + ((end - start) >> 1)
      const li = this.nodes++, ri = this.nodes++
      this.nLeft[node] = li
      this.nRight[node] = ri
      this.nCount[node] = 0
      stack.push([li, start, mid], [ri, mid, end])
    }
  }

  /** Squared distance from point to the closest triangle. */
  distanceSq(px: number, py: number, pz: number, maxDistSq = Infinity): number {
    let best = maxDistSq
    const stack: number[] = [0]
    while (stack.length) {
      const node = stack.pop()!
      const b3 = node * 3
      // squared distance to node AABB
      const dx = Math.max(this.nMin[b3] - px, 0, px - this.nMax[b3])
      const dy = Math.max(this.nMin[b3 + 1] - py, 0, py - this.nMax[b3 + 1])
      const dz = Math.max(this.nMin[b3 + 2] - pz, 0, pz - this.nMax[b3 + 2])
      if (dx * dx + dy * dy + dz * dz >= best) continue
      if (this.nLeft[node] < 0) {
        const start = this.nRight[node], count = this.nCount[node]
        for (let r = start; r < start + count; r++) {
          const d = triDistSq(this.positions, this.order[r] * 9, px, py, pz)
          if (d < best) best = d
        }
      } else {
        // visit nearer child first
        stack.push(this.nLeft[node], this.nRight[node])
      }
    }
    return best
  }
}

/** Squared distance point → triangle (Ericson, Real-Time Collision Detection). */
function triDistSq(pos: Float32Array, p: number, px: number, py: number, pz: number): number {
  const ax = pos[p], ay = pos[p + 1], az = pos[p + 2]
  const bx = pos[p + 3], by = pos[p + 4], bz = pos[p + 5]
  const cx = pos[p + 6], cy = pos[p + 7], cz = pos[p + 8]
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    const qx = apx - v * abx, qy = apy - v * aby, qz = apz - v * abz
    return qx * qx + qy * qy + qz * qz
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    const qx = apx - w * acx, qy = apy - w * acy, qz = apz - w * acz
    return qx * qx + qy * qy + qz * qz
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    const qx = bx + w * (cx - bx), qy = by + w * (cy - by), qz = bz + w * (cz - bz)
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom, w = vc * denom
  const qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2
}
