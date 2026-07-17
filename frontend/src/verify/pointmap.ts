import type { ViewerGeom } from '../viewerGeom'
import { LMM_PROC } from '../manufacturing'
import { partField, type Field } from './field'
import {
  PX_FINAL, deviationVerdict,
  type DeviationInfo, type Stage, type VerdictKind,
} from './types'

// V4.4 — the point-map field check (spec §43): the mesh-free, implicit-grade
// verification. The app generates probe points on section planes in the
// model's frame; nTop's own kernel evaluates its implicit body at them
// (Point Map → CSV export with values); this module compares ZERO-CROSSING
// LOCATIONS along the sampling lines against the TS field. Never raw field
// values — two implicit representations of the same shape only agree on the
// zero level set (spec §38-2) — and no meshing tolerance enters the loop.

export interface PlaneMeta {
  axis: 'x' | 'y' | 'z'
  /** fixed coordinate of the plane, final mm */
  c: number
  ua: 'x' | 'y' | 'z'
  va: 'x' | 'y' | 'z'
  u0: number
  v0: number
  nu: number
  nv: number
  label: string
}

/** forward transform final → model frame (the recipe must live where the
 *  user's implicit body lives; 'cad' is modelled at green scale) */
export function forwardScale(stage: Stage): [number, number, number] {
  if (stage === 'final') return [1, 1, 1]
  return [LMM_PROC.shrinkXY, LMM_PROC.shrinkXY, LMM_PROC.shrinkZ]
}

/**
 * Three section planes: one z-plane mid fin band (the DLP view's default), one
 * y-normal plane at L/4 (clear of a centre rib), one x-normal mid plane.
 * `g` is the stage/noBase-adjusted reference geometry, final frame.
 */
export function planeMetas(g: ViewerGeom, pitch: number): PlaneMeta[] {
  const W = g.coreWidth, L = g.coreLength
  const z0 = 0, z1 = g.baseThickness + g.finHeight
  const grid = (span: number): number => Math.max(2, Math.floor(span / pitch))
  return [
    {
      axis: 'z', c: g.baseThickness + g.finHeight / 2, ua: 'x', va: 'y',
      u0: -W / 2 + pitch / 2, v0: -L / 2 + pitch / 2, nu: grid(W), nv: grid(L),
      label: 'z mid-band (the DLP view\'s default layer)',
    },
    {
      axis: 'y', c: L / 4, ua: 'x', va: 'z',
      u0: -W / 2 + pitch / 2, v0: z0 + pitch / 2, nu: grid(W), nv: grid(z1 - z0),
      label: 'y = L/4 (across the fins, clear of a centre rib)',
    },
    {
      axis: 'x', c: 0, ua: 'y', va: 'z',
      u0: -L / 2 + pitch / 2, v0: z0 + pitch / 2, nu: grid(L), nv: grid(z1 - z0),
      label: 'x = 0 (along the flow)',
    },
  ]
}

function pointOf(m: PlaneMeta, iu: number, iv: number, pitch: number): [number, number, number] {
  const u = m.u0 + iu * pitch
  const v = m.v0 + iv * pitch
  const p: Record<'x' | 'y' | 'z', number> = { x: 0, y: 0, z: 0 }
  p[m.ua] = u; p[m.va] = v; p[m.axis] = m.c
  return [p.x, p.y, p.z]
}

/** The downloadable recipe: `x,y,z` rows in the MODEL frame. */
export function buildRecipeCsv(g: ViewerGeom, stage: Stage, pitch: number): { csv: string; points: number } {
  const metas = planeMetas(g, pitch)
  const [fx, fy, fz] = forwardScale(stage)
  const chunks: string[] = ['x,y,z']
  let n = 0
  for (const m of metas) {
    for (let iv = 0; iv < m.nv; iv++) {
      for (let iu = 0; iu < m.nu; iu++) {
        const [x, y, z] = pointOf(m, iu, iv, pitch)
        chunks.push(`${(x * fx).toFixed(4)},${(y * fy).toFixed(4)},${(z * fz).toFixed(4)}`)
        n++
      }
    }
  }
  return { csv: chunks.join('\n'), points: n }
}

// ---------------------------------------------------------------------------

export interface PointMapResult {
  points: number
  assigned: number
  /** sign-convention was auto-flipped (their positive = inside) */
  flipped: boolean
  /** sign agreement over confidently-inside/outside points (|our d| > pitch) */
  signAgree: number
  crossings: number
  /** wall in OUR field with no counterpart in theirs (missing feature) */
  unmatchedOurs: number
  /** wall in THEIR field with no counterpart in ours (extra feature) */
  unmatchedTheirs: number
  dev: DeviationInfo
  verdict: VerdictKind
}

/**
 * Compare a returned point map (x,y,z,value CSV, model frame) against the
 * reference field. Points are re-binned onto the sampling grid from their
 * coordinates, so row order does not matter.
 */
export function comparePointMap(
  text: string, g: ViewerGeom, stage: Stage, pitch: number,
): PointMapResult {
  const metas = planeMetas(g, pitch)
  const [fx, fy, fz] = forwardScale(stage)

  // ---- parse: first 4 numeric columns; headers/comments skipped ----
  const theirs = metas.map((m) => {
    const a = new Float32Array(m.nu * m.nv)
    a.fill(NaN)
    return a
  })
  let points = 0
  let assigned = 0
  const tol = 0.45 * pitch
  for (const line of text.split(/\r?\n/)) {
    const t = line.split(/[,;\t ]+/).filter(Boolean)
    if (t.length < 4) continue
    const x = Number(t[0]), y = Number(t[1]), z = Number(t[2]), v = Number(t[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(v)) continue
    points++
    // model frame → final frame
    const p: Record<'x' | 'y' | 'z', number> = { x: x / fx, y: y / fy, z: z / fz }
    for (let k = 0; k < metas.length; k++) {
      const m = metas[k]
      if (Math.abs(p[m.axis] - m.c) > tol) continue
      const iu = Math.round((p[m.ua] - m.u0) / pitch)
      const iv = Math.round((p[m.va] - m.v0) / pitch)
      if (iu < 0 || iu >= m.nu || iv < 0 || iv >= m.nv) continue
      if (Math.abs(p[m.ua] - (m.u0 + iu * pitch)) > tol) continue
      if (Math.abs(p[m.va] - (m.v0 + iv * pitch)) > tol) continue
      theirs[k][iv * m.nu + iu] = v
      assigned++
      break
    }
  }
  if (points === 0) {
    throw new Error('no numeric x,y,z,value rows found — export the SAMPLED point map from nTop '
      + '(the file must carry the field value as a 4th column, not just coordinates)')
  }
  if (assigned < points * 0.5) {
    throw new Error(`only ${assigned.toLocaleString()} of ${points.toLocaleString()} points lie on this design's sampling grid — `
      + 'was the recipe generated for the SAME candidate, stage and pitch that are selected right now?')
  }

  // ---- our field at the same nodes ----
  const field: Field = partField(g)
  const ours = metas.map((m) => {
    const a = new Float32Array(m.nu * m.nv)
    for (let iv = 0; iv < m.nv; iv++) {
      for (let iu = 0; iu < m.nu; iu++) {
        const [x, y, z] = pointOf(m, iu, iv, pitch)
        a[iv * m.nu + iu] = field(x, y, z)
      }
    }
    return a
  })

  // ---- sign convention: negative-inside is standard; auto-flip if theirs
  // is inverted (judged on confidently inside/outside points only) ----
  let agree = 0, disagree = 0
  for (let k = 0; k < metas.length; k++) {
    const o = ours[k], t = theirs[k]
    for (let i = 0; i < o.length; i++) {
      if (Number.isNaN(t[i]) || Math.abs(o[i]) < pitch) continue
      if ((o[i] < 0) === (t[i] < 0)) agree++
      else disagree++
    }
  }
  const flipped = disagree > agree
  if (flipped) for (const t of theirs) for (let i = 0; i < t.length; i++) t[i] = -t[i]
  const confident = agree + disagree
  const signAgree = confident ? Math.max(agree, disagree) / confident : 1

  // ---- zero crossings along both grid directions of every plane ----
  const devs: number[] = []
  let unmatchedOurs = 0, unmatchedTheirs = 0
  let worst = { x: 0, y: 0, z: 0, d: 0 }

  const scan = (k: number, alongU: boolean) => {
    const m = metas[k], o = ours[k], t = theirs[k]
    const nOuter = alongU ? m.nv : m.nu
    const nInner = alongU ? m.nu : m.nv
    const idx = (outer: number, inner: number) =>
      alongU ? outer * m.nu + inner : inner * m.nu + outer
    for (let a = 0; a < nOuter; a++) {
      for (let b = 0; b + 1 < nInner; b++) {
        const i0 = idx(a, b), i1 = idx(a, b + 1)
        const oa = o[i0], ob = o[i1]
        const ta = t[i0], tb = t[i1]
        const oCross = (oa < 0) !== (ob < 0)
        const tCross = !Number.isNaN(ta) && !Number.isNaN(tb) && (ta < 0) !== (tb < 0)
        if (!oCross && !tCross) continue
        if (Number.isNaN(ta) || Number.isNaN(tb)) continue
        if (oCross && !tCross) { unmatchedOurs++; continue }
        if (!oCross && tCross) { unmatchedTheirs++; continue }
        // both cross: sub-pitch positions by linear interpolation of the values
        const fo = oa / (oa - ob)
        const ft = ta / (ta - tb)
        // signed toward "outside": exit crossing (in→out along +axis) keeps
        // sign; entry flips, so + always means THEIR surface sits outside ours
        const exit = oa < 0
        const d = (ft - fo) * pitch * (exit ? 1 : -1)
        devs.push(d)
        if (Math.abs(d) > Math.abs(worst.d)) {
          const inner = b + fo
          const [x, y, z] = alongU
            ? pointOf(m, inner, a, pitch)
            : pointOf(m, a, inner, pitch)
          worst = { x, y, z, d }
        }
      }
    }
  }
  for (let k = 0; k < metas.length; k++) { scan(k, true); scan(k, false) }

  // ---- stats + verdict (same gates + histogram shape as the mesh check) ----
  const absSorted = Float64Array.from(devs, Math.abs).sort()
  const signedSorted = Float64Array.from(devs).sort()
  const pick = (arr: Float64Array, p: number): number =>
    arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))] : 0
  const p50 = pick(absSorted, 0.5)
  const p95 = pick(absSorted, 0.95)
  const max = absSorted.length ? absSorted[absSorted.length - 1] : 0
  let insideHalf = 0, insideOne = 0
  for (const d of devs) {
    const ad = Math.abs(d)
    if (ad <= PX_FINAL / 2) insideHalf++
    if (ad <= PX_FINAL) insideOne++
  }
  const NB = 61
  const binMin = -1.5 * PX_FINAL
  const binWidth = (3 * PX_FINAL) / NB
  const bins = new Array<number>(NB).fill(0)
  let outLow = 0, outHigh = 0
  for (const d of devs) {
    const kk = Math.floor((d - binMin) / binWidth)
    if (kk < 0) outLow++
    else if (kk >= NB) outHigh++
    else bins[kk]++
  }
  const dev: DeviationInfo = {
    n: devs.length, buried: 0,
    p50, p95, max, median: pick(signedSorted, 0.5),
    insideHalfPx: devs.length ? insideHalf / devs.length : 0,
    insidePx: devs.length ? insideOne / devs.length : 0,
    verdict: deviationVerdict(p95, max),
    bins, binMin, binWidth,
    outliersLow: outLow, outliersHigh: outHigh,
    worst, hint: null,
  }

  // unmatched walls / sign disagreement dominate the verdict — a wall the
  // other field doesn't have at all is worse than any µm offset
  const crossings = devs.length
  const unmatchedFrac = crossings > 0
    ? (unmatchedOurs + unmatchedTheirs) / (crossings + unmatchedOurs + unmatchedTheirs) : 1
  let verdict: VerdictKind = dev.verdict
  if (unmatchedFrac > 0.005 || signAgree < 0.995) verdict = 'FAIL'
  else if ((unmatchedFrac > 0.0005 || signAgree < 0.999) && verdict === 'PASS') verdict = 'MARGINAL'

  return {
    points, assigned, flipped, signAgree,
    crossings, unmatchedOurs, unmatchedTheirs,
    dev, verdict,
  }
}
