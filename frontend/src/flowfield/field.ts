// V5.3 — F1 depth-integrated field solver (spec §48).
// Anisotropic Darcy / Hele-Shaw on the core planform: fin channels give an
// along-flow conductance from the SAME Shah–London fRe slot model the KPI
// solver uses (K_y = b·H·Dh² / (fRe·rough·2μ·arc·pitch) per unit width);
// fins block the transverse direction (K_x = 0) except in header / turn
// zones. Solved with column line-relaxation (Thomas) — exact per channel
// column, so it converges in a handful of sweeps.
//
// F1 resolves FRICTION only — minor losses (slots, turns, ports) are lumped
// K's outside the sheet, so the §49 reconciliation anchor is S6's friction
// component, never the total. KPIs never read from this module.
// Pure TypeScript: no DOM, no three.js — node-testable like verify/*.

export interface FieldInput {
  // geometry (mm)
  coreWidth: number
  coreLength: number
  finHeight: number
  finThickness: number
  gap: number
  sideMargin: number
  waveAmp: number
  waveLen: number
  // layout
  layout: string          // architecture name
  nSeg: number            // serpentine passes / distributed-jet duct count
  // operating (SI)
  mu: number              // Pa·s
  rho: number             // kg/m³
  flowM3s: number         // total volumetric flow
  meanRe: number          // for the (constant) roughness factor
  relRoughness: number    // solver default 0.03
  // u-flow extras
  headerWidthMm?: number
  portConfig?: 'u' | 'z'
}

export interface FieldResult {
  nx: number
  ny: number
  dx: number              // mm
  dy: number              // mm
  deltaP: number          // Pa (source flux-weighted mean pressure)
  massErr: number         // |in − out| / in
  iters: number
  // per-column y-flux at mid-plane (m³/s) — the maldistribution profile
  columnFlux: Float64Array
  uniformity: number      // (Σq)²/(N·Σq²) over column fluxes
  // streamlines packed as [x0,y0,t0, x1,y1,t1, ...] (mm, seconds real);
  // lineOffsets[i]..lineOffsets[i+1] delimit line i (index into triplets)
  linePoints: Float32Array
  lineOffsets: Int32Array
}

const shahLondonFre = (alpha: number) => {
  const a = Math.min(Math.max(alpha, 1e-6), 1)
  return 24 * (1 - 1.3553 * a + 1.9467 * a ** 2 - 1.7012 * a ** 3 + 0.9564 * a ** 4 - 0.2537 * a ** 5)
}
const roughFactor = (rr: number, Re: number) =>
  rr <= 0 ? 1 : 1 + 12 * Math.min(rr, 0.05) * Math.tanh(Re / 50)
const arcFactor = (ampMm: number, lamMm: number) => {
  if (ampMm <= 0 || lamMm <= 0) return 1
  const chi = (2 * Math.PI * ampMm) / lamMm
  return Math.sqrt(1 + 0.5 * chi * chi)
}

/** Depth-integrated fin-field conductance per unit width (m² / (Pa·s)):
 *  q [m²/s] = K · dp/dy. Same correlation chain as the solvers. */
export function finConductance(inp: FieldInput): number {
  const b = inp.gap * 1e-3, H = inp.finHeight * 1e-3, t = inp.finThickness * 1e-3
  const Dh = (2 * b * H) / (b + H)
  const alpha = Math.min(b, H) / Math.max(b, H)
  const fre = shahLondonFre(alpha) * roughFactor(inp.relRoughness, inp.meanRe)
  const arc = arcFactor(inp.waveAmp, inp.waveLen)
  return (b * H * Dh * Dh) / (fre * 2 * inp.mu * arc * (t + b))
}

interface Problem {
  nx: number; ny: number; dx: number; dy: number
  gN: Float64Array        // face conductance to the +y neighbour (m³/s per Pa)
  gE: Float64Array        // face conductance to the +x neighbour
  src: Float64Array       // injected flow per cell (m³/s)
  dirichlet: Uint8Array   // 1 = pinned to p = 0 (sink)
}

const idx = (i: number, j: number, nx: number) => j * nx + i

export function buildProblem(inp: FieldInput): Problem {
  const Wf = inp.coreWidth - 2 * inp.sideMargin      // fin band (mm)
  const L = inp.coreLength
  // grid: fine enough for the finest layout period (distributed-jet pitch/2)
  let ny = Math.round(Math.min(220, Math.max(96, L / 0.3)))
  if (inp.layout === 'distributed_jet_compartments') {
    ny = Math.min(256, Math.max(ny, inp.nSeg * 16))
  }
  const nx = Math.round(Math.min(160, Math.max(48, Wf / 0.35)))
  const dx = Wf / nx, dy = L / ny
  const K = finConductance(inp)                       // per unit width
  const gYfin = (K * (dx * 1e-3)) / (dy * 1e-3)       // face conductance, m³/(s·Pa)

  const n = nx * ny
  const gN = new Float64Array(n)                      // default 0
  const gE = new Float64Array(n)                      // fins block x: 0 in the field
  const src = new Float64Array(n)
  const dirichlet = new Uint8Array(n)

  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) gN[idx(i, j, nx)] = gYfin

  const openGx = gYfin * 40                           // "open zone" transverse conductance

  if (inp.layout === 'serpentine_n_pass') {
    // band walls: cut gN? no — walls are ALONG y; cut x between bands instead
    // (fins already block x). Turn strips at alternating ends open x locally.
    const nSeg = Math.max(2, inp.nSeg)
    const turnRows = Math.max(2, Math.round(ny * 0.05))
    for (let s = 0; s < nSeg - 1; s++) {
      // the turn plenum spans BOTH bands' width (also anchors every column of
      // the bands to an x-coupled row — pure-Neumann columns would be singular)
      const lo = Math.round((s * nx) / nSeg)
      const hi = Math.round(((s + 2) * nx) / nSeg) - 1
      const topTurn = s % 2 === 0                      // pass 0 flows +y, turns at top
      for (let r = 0; r < turnRows; r++) {
        const j = topTurn ? ny - 1 - r : r
        for (let i = lo; i < hi; i++) gE[idx(i, j, nx)] = openGx
      }
    }
    // walls between bands elsewhere: gE stays 0 (already).
    // inlet: band 0 bottom row; outlet: last band's final row (top if nSeg odd)
    const band0 = { lo: 0, hi: Math.round(nx / nSeg) - 1 }
    const lastLo = Math.round(((nSeg - 1) * nx) / nSeg)
    const per = inp.flowM3s / (band0.hi - band0.lo + 1)
    for (let i = band0.lo; i <= band0.hi; i++) src[idx(i, 0, nx)] = per
    const jOut = nSeg % 2 === 1 ? ny - 1 : 0
    for (let i = lastLo; i < nx; i++) dirichlet[idx(i, jOut, nx)] = 1
  } else if (inp.layout === 'u_flow_side_feed') {
    // feed header = bottom row (open along x), return header = top row;
    // ports at the SAME x end (U) or opposite (Z).
    const hw = (inp.headerWidthMm ?? 2) * 1e-3
    const H = inp.finHeight * 1e-3
    const Dhh = (2 * hw * H) / (hw + H)
    const freH = shahLondonFre(Math.min(hw, H) / Math.max(hw, H))
    const gXheader = (hw * H * Dhh * Dhh) / (freH * 2 * inp.mu * (dx * 1e-3))
    for (const j of [0, ny - 1]) for (let i = 0; i < nx - 1; i++) gE[idx(i, j, nx)] = gXheader
    src[idx(0, 0, nx)] = inp.flowM3s
    dirichlet[idx(inp.portConfig === 'z' ? nx - 1 : 0, ny - 1, nx)] = 1
  } else if (inp.layout === 'distributed_jet_compartments') {
    // feed rows at the duct lines (period 2·pitch), sink rows at the returns.
    const nJ = Math.max(1, inp.nSeg)
    const pc = L / (2 * nJ)
    const per = inp.flowM3s / (nJ * nx)
    for (let k = 0; k < nJ; k++) {
      const jF = Math.min(ny - 1, Math.round(((2 * k + 1) * pc) / L * ny))
      for (let i = 0; i < nx; i++) src[idx(i, jF, nx)] += per
    }
    for (let k = 0; k <= nJ; k++) {
      const jR = Math.min(ny - 1, Math.round((2 * k * pc) / L * ny))
      for (let i = 0; i < nx; i++) dirichlet[idx(i, jR, nx)] = 1
    }
  } else if (inp.layout === 'center_feed_bidirectional'
      || inp.layout === 'top_jet_slot_centre_rib_bidirectional') {
    // source at the rib line, sinks at both y ends
    const jMid = Math.round(ny / 2)
    const per = inp.flowM3s / nx
    for (let i = 0; i < nx; i++) src[idx(i, jMid, nx)] = per
    for (let i = 0; i < nx; i++) { dirichlet[idx(i, 0, nx)] = 1; dirichlet[idx(i, ny - 1, nx)] = 1 }
  } else {
    // single_pass: in at j=0, out at j=ny−1
    const per = inp.flowM3s / nx
    for (let i = 0; i < nx; i++) src[idx(i, 0, nx)] = per
    for (let i = 0; i < nx; i++) dirichlet[idx(i, ny - 1, nx)] = 1
  }

  return { nx, ny, dx, dy, gN, gE, src, dirichlet }
}

/** Column line-relaxation (Thomas per x-column). With gE = 0 over the fin
 *  field, columns decouple except through header/turn rows → fast, robust. */
export function solvePressure(pb: Problem): { p: Float64Array; iters: number } {
  const { nx, ny, gN, gE, src, dirichlet } = pb
  const p = new Float64Array(nx * ny)
  const m = Math.max(nx, ny)
  const a = new Float64Array(m), b = new Float64Array(m)
  const c = new Float64Array(m), d = new Float64Array(m)
  // rows that carry x-conductance (headers / turn plena) — they get their own
  // row line-solve each sweep (ADI), or the stiff x-chains converge slowly
  const xRows: number[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) if (gE[idx(i, j, nx)] > 0) { xRows.push(j); break }
  }
  // level anchoring: total injection, sink-adjacent conductance, and a helper
  // for the flux actually reaching the sinks — the slow "constant" mode is
  // corrected directly each sweep instead of diffusing through the grid
  let qIn = 0
  for (let k = 0; k < nx * ny; k++) qIn += src[k]
  let gSink = 0
  const sinkFaces: Array<[number, number]> = []      // [neighbour id, conductance]
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = idx(i, j, nx)
    if (!dirichlet[id]) continue
    if (j > 0 && !dirichlet[idx(i, j - 1, nx)]) { sinkFaces.push([idx(i, j - 1, nx), gN[idx(i, j - 1, nx)]]); gSink += gN[idx(i, j - 1, nx)] }
    if (j < ny - 1 && !dirichlet[idx(i, j + 1, nx)]) { sinkFaces.push([idx(i, j + 1, nx), gN[id]]); gSink += gN[id] }
    if (i > 0 && !dirichlet[idx(i - 1, j, nx)]) { sinkFaces.push([idx(i - 1, j, nx), gE[idx(i - 1, j, nx)]]); gSink += gE[idx(i - 1, j, nx)] }
    if (i < nx - 1 && !dirichlet[idx(i + 1, j, nx)]) { sinkFaces.push([idx(i + 1, j, nx), gE[id]]); gSink += gE[id] }
  }
  const outflow = () => {
    let o = 0
    for (const [nb, g] of sinkFaces) o += g * p[nb]
    return o
  }
  let iters = 0
  for (let sweep = 0; sweep < 1500; sweep++) {
    let maxD = 0
    // ---- row pass over the x-coupled rows -------------------------------
    for (const j of xRows) {
      for (let i = 0; i < nx; i++) {
        const id = idx(i, j, nx)
        if (dirichlet[id]) { a[i] = 0; b[i] = 1; c[i] = 0; d[i] = 0; continue }
        const gW = i > 0 ? gE[idx(i - 1, j, nx)] : 0
        const gEe = i < nx - 1 ? gE[id] : 0
        const gS = j > 0 ? gN[idx(i, j - 1, nx)] : 0
        const gNn = j < ny - 1 ? gN[id] : 0
        let diag = gS + gNn + gW + gEe
        let rhs = src[id]
        if (j > 0) rhs += gS * p[idx(i, j - 1, nx)]
        if (j < ny - 1) rhs += gNn * p[idx(i, j + 1, nx)]
        if (diag <= 0) { diag = 1; rhs = p[id] }
        a[i] = -gW; b[i] = diag; c[i] = -gEe; d[i] = rhs
      }
      for (let i = 1; i < nx; i++) {
        const f = a[i] / b[i - 1]
        b[i] -= f * c[i - 1]
        d[i] -= f * d[i - 1]
      }
      let prev = d[nx - 1] / b[nx - 1]
      maxD = Math.max(maxD, Math.abs(prev - p[idx(nx - 1, j, nx)]))
      p[idx(nx - 1, j, nx)] = prev
      for (let i = nx - 2; i >= 0; i--) {
        const v = (d[i] - c[i] * prev) / b[i]
        maxD = Math.max(maxD, Math.abs(v - p[idx(i, j, nx)]))
        p[idx(i, j, nx)] = v
        prev = v
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const i0 = pass === 0 ? 0 : nx - 1
      const di = pass === 0 ? 1 : -1
      for (let k = 0; k < nx; k++) {
        const i = i0 + di * k
        // assemble tridiagonal for column i
        for (let j = 0; j < ny; j++) {
          const id = idx(i, j, nx)
          if (dirichlet[id]) { a[j] = 0; b[j] = 1; c[j] = 0; d[j] = 0; continue }
          const gS = j > 0 ? gN[idx(i, j - 1, nx)] : 0
          const gNn = j < ny - 1 ? gN[id] : 0
          const gW = i > 0 ? gE[idx(i - 1, j, nx)] : 0
          const gEe = i < nx - 1 ? gE[id] : 0
          let diag = gS + gNn + gW + gEe
          let rhs = src[id]
          if (i > 0) rhs += gW * p[idx(i - 1, j, nx)]
          if (i < nx - 1) rhs += gEe * p[idx(i + 1, j, nx)]
          if (diag <= 0) { diag = 1; rhs = p[id] }   // isolated cell: hold value
          a[j] = -gS; b[j] = diag; c[j] = -gNn; d[j] = rhs
        }
        // Thomas
        for (let j = 1; j < ny; j++) {
          const m = a[j] / b[j - 1]
          b[j] -= m * c[j - 1]
          d[j] -= m * d[j - 1]
        }
        let prev = d[ny - 1] / b[ny - 1]
        let ch = Math.abs(prev - p[idx(i, ny - 1, nx)])
        p[idx(i, ny - 1, nx)] = prev
        for (let j = ny - 2; j >= 0; j--) {
          const v = (d[j] - c[j] * prev) / b[j]
          ch = Math.max(ch, Math.abs(v - p[idx(i, j, nx)]))
          p[idx(i, j, nx)] = v
          prev = v
        }
        maxD = Math.max(maxD, ch)
      }
    }
    // global level correction: lift all free cells so the sink outflow
    // matches the injection (kills the slow constant mode in one step).
    // Convergence is judged on the PRE-shift imbalance — post-shift it is
    // zero by construction.
    let balanced = 0
    if (gSink > 0 && qIn > 0) {
      const o = outflow()
      balanced = Math.abs(o - qIn) / qIn
      const shift = (qIn - o) / gSink
      if (shift !== 0) {
        for (let k = 0; k < nx * ny; k++) if (!dirichlet[k]) p[k] += shift
      }
    }
    iters = sweep + 1
    if (balanced < 1e-9 && maxD < 1e-7 * Math.max(1, maxAbs(p))) break
  }
  return { p, iters }
}

const maxAbs = (arr: Float64Array) => {
  let m = 0
  for (let k = 0; k < arr.length; k++) { const v = Math.abs(arr[k]); if (v > m) m = v }
  return m
}

export function solveField(inp: FieldInput, streamlineCount = 48): FieldResult {
  const pb = buildProblem(inp)
  const { nx, ny, dx, dy } = pb
  const { p, iters } = solvePressure(pb)

  // ΔP = flux-weighted mean source pressure (sinks are the 0 reference)
  let num = 0, den = 0
  for (let k = 0; k < nx * ny; k++) if (pb.src[k] > 0) { num += p[k] * pb.src[k]; den += pb.src[k] }
  const deltaP = den > 0 ? num / den : 0

  // mass check: net flux into dirichlet cells vs injected
  let out = 0
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = idx(i, j, nx)
    if (!pb.dirichlet[id]) continue
    if (j > 0 && !pb.dirichlet[idx(i, j - 1, nx)]) out += pb.gN[idx(i, j - 1, nx)] * (p[idx(i, j - 1, nx)] - p[id])
    if (j < ny - 1 && !pb.dirichlet[idx(i, j + 1, nx)]) out += pb.gN[id] * (p[idx(i, j + 1, nx)] - p[id])
    if (i > 0 && !pb.dirichlet[idx(i - 1, j, nx)]) out += pb.gE[idx(i - 1, j, nx)] * (p[idx(i - 1, j, nx)] - p[id])
    if (i < nx - 1 && !pb.dirichlet[idx(i + 1, j, nx)]) out += pb.gE[id] * (p[idx(i + 1, j, nx)] - p[id])
  }
  const massErr = den > 0 ? Math.abs(out - den) / den : 1

  // column |flux| profile at the row of maximum total |flux| (mid for most
  // layouts; for distributed-jet it lands inside a crossing) → uniformity
  const columnFlux = new Float64Array(nx)
  let bestRow = 0, bestSum = -1
  for (let j = 0; j < ny - 1; j++) {
    let s = 0
    for (let i = 0; i < nx; i++) s += Math.abs(pb.gN[idx(i, j, nx)] * (p[idx(i, j, nx)] - p[idx(i, j + 1, nx)]))
    if (s > bestSum) { bestSum = s; bestRow = j }
  }
  for (let i = 0; i < nx; i++) {
    columnFlux[i] = Math.abs(pb.gN[idx(i, bestRow, nx)] * (p[idx(i, bestRow, nx)] - p[idx(i, bestRow + 1, nx)]))
  }
  let s1 = 0, s2 = 0
  for (let i = 0; i < nx; i++) { s1 += columnFlux[i]; s2 += columnFlux[i] * columnFlux[i] }
  const uniformity = s2 > 0 ? (s1 * s1) / (nx * s2) : 1

  // ---- streamlines with time-of-flight ----------------------------------
  const open = inp.gap / (inp.gap + inp.finThickness)  // open fraction
  const Hm = inp.finHeight * 1e-3
  const vAt = (xm: number, ym: number): [number, number] => {
    // cell-centred velocity (m/s) from face fluxes; x,y in mm grid coords
    const i = Math.min(nx - 1, Math.max(0, Math.floor(xm / dx)))
    const j = Math.min(ny - 1, Math.max(0, Math.floor(ym / dy)))
    const id = idx(i, j, nx)
    const qN = j < ny - 1 ? pb.gN[id] * (p[id] - p[idx(i, j + 1, nx)]) : 0
    const qS = j > 0 ? pb.gN[idx(i, j - 1, nx)] * (p[idx(i, j - 1, nx)] - p[id]) : 0
    const qE = i < nx - 1 ? pb.gE[id] * (p[id] - p[idx(i + 1, j, nx)]) : 0
    const qW = i > 0 ? pb.gE[idx(i - 1, j, nx)] * (p[idx(i - 1, j, nx)] - p[id]) : 0
    const A = open * Hm * dx * 1e-3                    // open cross-section per cell face
    const Ax = open * Hm * dy * 1e-3
    return [((qE + qW) / 2) / Ax, ((qN + qS) / 2) / A]
  }

  const pts: number[] = []
  const offs: number[] = [0]
  // seeds: spread across the source cells
  const seeds: [number, number][] = []
  const srcCells: number[] = []
  for (let k = 0; k < nx * ny; k++) if (pb.src[k] > 0) srcCells.push(k)
  const step = Math.max(1, Math.floor((2 * srcCells.length) / streamlineCount))
  for (let s = 0; s < srcCells.length; s += step) {
    const k = srcCells[s]
    const cx = ((k % nx) + 0.5) * dx
    const cy = (Math.floor(k / nx) + 0.5) * dy
    // nudge off the source line both ways — the cell-centred velocity is ~0
    // exactly on a symmetric feed row (center-feed rib, distributed ducts)
    seeds.push([cx, cy - 0.6 * dy], [cx, cy + 0.6 * dy])
  }
  const maxSteps = 4 * (nx + ny)
  for (const [sx, sy] of seeds) {
    let x = sx, y = sy, t = 0
    pts.push(x, y, 0)
    let count = 1
    for (let s = 0; s < maxSteps; s++) {
      const [vx, vy] = vAt(x, y)
      const sp = Math.hypot(vx, vy)
      if (sp < 1e-6) break
      const dsMm = Math.min(dx, dy) * 0.9              // step in mm
      const mx = x + (vx / sp) * dsMm * 0.5, my = y + (vy / sp) * dsMm * 0.5
      const [vx2, vy2] = vAt(mx, my)
      const sp2 = Math.hypot(vx2, vy2)
      if (sp2 < 1e-6) break
      x += (vx2 / sp2) * dsMm
      y += (vy2 / sp2) * dsMm
      t += (dsMm * 1e-3) / sp2                          // real seconds
      if (x < 0 || x > nx * dx || y < 0 || y > ny * dy) break
      pts.push(x, y, t)
      count++
      const jj = Math.min(ny - 1, Math.max(0, Math.floor(y / dy)))
      const ii = Math.min(nx - 1, Math.max(0, Math.floor(x / dx)))
      if (pb.dirichlet[idx(ii, jj, nx)]) break
    }
    if (count < 3) { pts.length = offs[offs.length - 1] * 3 } // drop stub
    else offs.push(offs[offs.length - 1] + count)
  }

  return {
    nx, ny, dx, dy, deltaP, massErr, iters,
    columnFlux, uniformity,
    linePoints: new Float32Array(pts),
    lineOffsets: new Int32Array(offs),
  }
}
