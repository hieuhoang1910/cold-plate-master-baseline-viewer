/// <reference lib="webworker" />
// V4 — the verify worker: parses the imported STL, aligns it to the contract
// frame, measures deviation against the reference implicit field, audits
// solver inputs, runs the two-sided pass and the per-layer XOR profile.
// Everything heavy lives here; the main thread only renders results.

import type { ViewerGeom } from '../viewerGeom'
import { looksAscii, parseBinaryStl } from './stlParse'
import { bbox, indexMesh, openEdgeCount, signedVolume, surfaceAreas, transformPositions } from './geometry'
import { partField, sampleSurface, signedDistance } from './field'
import { buildSliceIndex, interiorPerimeter, interiorRuns, percentile, rasterizeSegments, sliceSegments } from './slice'
import { stageRefGeom, stageScale, detectHints } from './stages'
import { TriBvh } from './bvh'
import { PXF, LYF, gridDims, expectedMask } from './raster'
import { scanChannelNecks } from './necks'
import {
  PX_FINAL, deviationVerdict,
  type DeviationInfo, type MeasureInfo, type RunMsg, type SliceMetric,
  type TwoSidedInfo, type VerifyResult, type WorkerInMsg, type WorkerOutMsg,
} from './types'

const post = (msg: WorkerOutMsg, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? [])

const progress = (phase: string, pct: number) => post({ type: 'progress', phase, pct })

// retained between messages for on-demand layer masks (PixelPreview compare)
let state: {
  positions: Float32Array
  sliceIdx: ReturnType<typeof buildSliceIndex>
  geom: ViewerGeom
  nx: number
  ny: number
} | null = null

self.onmessage = (e: MessageEvent<WorkerInMsg>) => {
  try {
    if (e.data.type === 'run') run(e.data)
    else if (e.data.type === 'mask') maskFor(e.data.layer)
    else if (e.data.type === 'scanstack') void scanStack(e.data.chMinPx)
    else if (e.data.type === 'scancancel') scanCancelled = true
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

const MAX_MESH_TRIS = 2_000_000

function run(msg: RunMsg): void {
  // ---- 1. parse --------------------------------------------------------
  progress('parsing STL', 0)
  if (looksAscii(msg.buffer)) {
    throw new Error(
      'this looks like an ASCII STL — export a BINARY STL from nTop '
      + '(File → Export → STL → binary). ASCII files are 5–10× larger and slower to check.')
  }
  const { positions, triangles } = parseBinaryStl(msg.buffer)
  progress('parsing STL', 1)

  // ---- 2. align to the contract frame ----------------------------------
  const bboxRaw = bbox(positions)
  let refGeom = stageRefGeom(msg.geom, msg.stage).geom
  // core-only export: the reference loses its base slab, so fins sit at z = 0
  // exactly like the floored file
  if (msg.noBase) refGeom = { ...refGeom, baseThickness: 0 }
  const hintInfo = detectHints(bboxRaw, msg.geom, msg.stage, msg.scale)
  const [ssx, ssy, ssz] = stageScale(msg.stage)
  const sx = msg.scale * ssx, sy = msg.scale * ssy, sz = msg.scale * ssz
  // scale + optional 90° rotation first, then translate: centre x/y, floor z→0
  transformPositions(positions, sx, sy, sz, 0, 0, 0, hintInfo.rotate90)
  const bb1 = bbox(positions)
  const ox = -(bb1[0] + bb1[3]) / 2
  const oy = -(bb1[1] + bb1[4]) / 2
  const oz = -bb1[2]
  transformPositions(positions, 1, 1, 1, ox, oy, oz, false)
  const bboxFinal = bbox(positions)

  // ---- 3. index + watertightness ---------------------------------------
  progress('indexing vertices', 0)
  const mesh = indexMesh(positions, (p) => progress('indexing vertices', p))
  progress('checking watertightness', 0.5)
  const openEdges = openEdgeCount(mesh)
  const watertight = openEdges === 0

  // ---- 4. deviation vs the reference field ------------------------------
  // Vertices deeper than BURIED_MM inside the design are internal faces of
  // overlapping-shell unions (the app's own export sinks fins 0.05 mm into the
  // base; nTop booleans can leave the same). They are surface-of-a-shell, not
  // surface-of-the-part, so they are excluded from the gates and counted —
  // genuinely missing material at that depth is caught by the two-sided pass
  // and the layer XOR instead.
  const BURIED_MM = 1.25 * PX_FINAL
  const field = partField(refGeom)
  const nAll = mesh.nVerts
  const devAll = new Float32Array(nAll)   // per-vertex, for colouring
  const judgedBuf = new Float32Array(nAll) // compacted, for the gates
  let n = 0
  let buried = 0
  let devMax = 0
  let worst = { x: 0, y: 0, z: 0, d: 0 }
  for (let i = 0; i < nAll; i++) {
    const x = mesh.verts[i * 3], y = mesh.verts[i * 3 + 1], z = mesh.verts[i * 3 + 2]
    const d = signedDistance(field, x, y, z)
    devAll[i] = d
    if (d < -BURIED_MM) { buried++; continue }
    judgedBuf[n++] = d
    const ad = Math.abs(d)
    if (ad > devMax) { devMax = ad; worst = { x, y, z, d } }
    if ((i & 0x3ffff) === 0) progress('measuring deviation', i / nAll)
  }
  progress('measuring deviation', 1)
  const judged = judgedBuf.subarray(0, n)

  // percentiles on |dev| (typed sort), signed median for shift detection
  const absSorted = Float32Array.from(judged, Math.abs).sort()
  const signedSorted = Float32Array.from(judged).sort()
  const pick = (arr: Float32Array, p: number): number =>
    arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))] : 0
  const p50 = pick(absSorted, 0.5)
  const p95 = pick(absSorted, 0.95)
  const median = pick(signedSorted, 0.5)
  let insideHalf = 0, insideOne = 0
  for (let i = 0; i < n; i++) {
    const ad = Math.abs(judged[i])
    if (ad <= PX_FINAL / 2) insideHalf++
    if (ad <= PX_FINAL) insideOne++
  }

  // histogram: 61 bins over ±1.5 px
  const NB = 61
  const binMin = -1.5 * PX_FINAL
  const binWidth = (3 * PX_FINAL) / NB
  const bins = new Array<number>(NB).fill(0)
  let outLow = 0, outHigh = 0
  for (let i = 0; i < n; i++) {
    const k = Math.floor((judged[i] - binMin) / binWidth)
    if (k < 0) outLow++
    else if (k >= NB) outHigh++
    else bins[k]++
  }

  // uniform-shift hint: tight distribution sitting off-centre → wrong stage /
  // compensation baked in
  let hint: string | null = null
  const spread = p95 - Math.abs(median)
  if (Math.abs(median) > 0.35 * PX_FINAL && spread < 0.35 * PX_FINAL) {
    hint = `the whole surface sits a uniform ${(median * 1000).toFixed(0)} µm `
      + `${median > 0 ? 'outside' : 'inside'} the reference — that pattern is a stage/compensation `
      + `mismatch (shrink or overpoly), not a shape error. Try the other stage options.`
  }

  const deviation: DeviationInfo = {
    n,
    buried,
    p50, p95, max: devMax, median,
    insideHalfPx: n ? insideHalf / n : 0,
    insidePx: n ? insideOne / n : 0,
    verdict: deviationVerdict(p95, devMax),
    bins, binMin, binWidth,
    outliersLow: outLow, outliersHigh: outHigh,
    worst,
    hint,
  }

  // ---- 5. display geometry (deviation-coloured) -------------------------
  progress('building display mesh', 0)
  const colors = new Uint8Array(nAll * 3)
  for (let i = 0; i < nAll; i++) {
    if (devAll[i] < -BURIED_MM) {
      // buried/internal faces: neutral dark — visibly "not judged"
      colors[i * 3] = 84; colors[i * 3 + 1] = 90; colors[i * 3 + 2] = 104
    } else {
      colorFor(devAll[i], colors, i * 3)
    }
  }
  // always ship the FULL indexed mesh — the viewer chooses points vs mesh
  // rendering (heavy files default to points with a "render full mesh" opt-in)
  const view: VerifyResult['view'] = {
    positions: mesh.verts.slice(),
    colors,
    index: mesh.index,
    heavy: triangles > MAX_MESH_TRIS,
  }

  // ---- 6. solver-input audit --------------------------------------------
  progress('auditing solver inputs', 0)
  const dims = gridDims(refGeom)
  const sliceIdx = buildSliceIndex(positions, LYF, dims.nLayers)
  state = { positions, sliceIdx, geom: refGeom, nx: dims.nx, ny: dims.ny }

  const areas = surfaceAreas(positions, refGeom.baseThickness)
  let volume: number | null = Math.abs(signedVolume(positions))
  if (!watertight) volume = null

  // per-slice metrics at 12 heights in the fin band (12, not 5: TPMS slice
  // solidity varies strongly with z-phase — fewer samples alias the void
  // fraction by several percent)
  const N_SLICES = 12
  const halfW = refGeom.coreWidth / 2, halfL = refGeom.coreLength / 2
  const mask = new Uint8Array(dims.nx * dims.ny)
  const slices: SliceMetric[] = []
  const runsSolid: number[] = [], runsVoid: number[] = []
  const bandLayers = dims.nLayers - dims.baseLayers
  for (let k = 0; k < N_SLICES; k++) {
    const li = dims.baseLayers + Math.max(0, Math.min(bandLayers - 1,
      Math.floor(((k + 0.5) / N_SLICES) * bandLayers)))
    const segs = sliceSegments(positions, sliceIdx, li)
    rasterizeSegments(segs, mask, dims.nx, dims.ny, PXF, halfW, halfL)
    let solid = 0
    for (let i = 0; i < mask.length; i++) solid += mask[i]
    const flowArea = (mask.length - solid) * PXF * PXF
    const perim = interiorPerimeter(segs, halfW, halfL, 0.05)
    slices.push({
      z: (li + 0.5) * LYF,
      flowArea_mm2: flowArea,
      wettedPerim_mm: perim,
      dh_mm: perim > 1e-6 ? (4 * flowArea) / perim : 0,
      solidFrac: solid / mask.length,
    })
    const rr = interiorRuns(mask, dims.nx, dims.ny)
    for (const r of rr.solid) runsSolid.push(r)
    for (const r of rr.voids) runsVoid.push(r)
    progress('auditing solver inputs', (k + 1) / (N_SLICES + 1))
  }
  runsSolid.sort((a, b) => a - b)
  runsVoid.sort((a, b) => a - b)
  const minFinPx = percentile(runsSolid, 0.05)
  const minGapPx = percentile(runsVoid, 0.05)
  const medFinPx = percentile(runsSolid, 0.5)
  const medGapPx = percentile(runsVoid, 0.5)
  const voidFrac = slices.length
    ? 1 - slices.reduce((s, m) => s + m.solidFrac, 0) / slices.length
    : null
  const dhMean = slices.length
    ? slices.reduce((s, m) => s + m.dh_mm, 0) / slices.length
    : null

  const measures: MeasureInfo = {
    volume_mm3: volume,
    area_mm2: areas.total,
    structArea_mm2: areas.struct,
    voidFrac,
    slices,
    dhMean_mm: dhMean,
    minFin_mm: minFinPx != null ? minFinPx * PXF : null,
    minGap_mm: minGapPx != null ? minGapPx * PXF : null,
    medFin_mm: medFinPx != null ? medFinPx * PXF : null,
    medGap_mm: medGapPx != null ? medGapPx * PXF : null,
  }

  // ---- 7. two-sided pass (design → mesh; catches MISSING geometry) ------
  let twoSided: TwoSidedInfo | null = null
  if (msg.twoSided) {
    progress('two-sided check', 0)
    const spacing = Math.min(1.0, Math.max(0.08, Math.sqrt(Math.max(areas.total, 1) / 40_000)))
    const samples = sampleSurface(field, refGeom, spacing, 80_000)
    progress('two-sided check', 0.3)
    const bvh = new TriBvh(positions)
    progress('two-sided check', 0.5)
    const ns = samples.length / 3
    const dists = new Float32Array(ns)
    let tMax = 0
    let tWorst = { x: 0, y: 0, z: 0, d: 0 }
    let uncovered = 0
    for (let i = 0; i < ns; i++) {
      const x = samples[i * 3], y = samples[i * 3 + 1], z = samples[i * 3 + 2]
      const d = Math.sqrt(bvh.distanceSq(x, y, z))
      dists[i] = d
      if (d > tMax) { tMax = d; tWorst = { x, y, z, d } }
      if (d > PX_FINAL) uncovered++
      if ((i & 0xfff) === 0) progress('two-sided check', 0.5 + 0.5 * (i / ns))
    }
    dists.sort()
    const tp95 = ns ? dists[Math.min(ns - 1, Math.floor(0.95 * (ns - 1)))] : 0
    twoSided = {
      n: ns,
      p95: tp95,
      max: tMax,
      uncoveredFrac: ns ? uncovered / ns : 0,
      worst: tWorst,
      verdict: deviationVerdict(tp95, tMax),
    }
  }

  // ---- ship the result ---------------------------------------------------
  const result: VerifyResult = {
    file: {
      name: msg.name,
      sizeBytes: msg.buffer.byteLength,
      triangles,
      uniqueVerts: mesh.nVerts,
      watertight,
      openEdges,
      bboxRaw,
    },
    align: {
      scale: msg.scale,
      stageScale: [ssx, ssy, ssz],
      offset: [ox, oy, oz],
      rotated: hintInfo.rotate90,
      bbox: bboxFinal,
      hints: hintInfo.hints,
    },
    deviation,
    twoSided,
    measures,
    view,
  }
  const transfer: Transferable[] = [view.positions.buffer, view.colors.buffer, view.index.buffer]
  post({ type: 'result', result }, transfer)

  // ---- 8. per-layer XOR profile (after the main result, so UI is live) ---
  if (msg.layerProfile) layerProfile(refGeom, dims)
}

/** diverging colormap: −1 px = blue (inside/undersize) · 0 = light · +1 px = red */
function colorFor(d: number, out: Uint8Array, o: number): void {
  const t = Math.max(-1, Math.min(1, d / PX_FINAL))
  let r: number, g: number, b: number
  if (t < 0) {
    const u = -t
    r = 232 + (91 - 232) * u; g = 234 + (157 - 234) * u; b = 238 + (255 - 238) * u
  } else {
    r = 232 + (248 - 232) * t; g = 234 + (81 - 234) * t; b = 238 + (73 - 238) * t
  }
  out[o] = r; out[o + 1] = g; out[o + 2] = b
}

function layerProfile(geom: ViewerGeom, dims: ReturnType<typeof gridDims>): void {
  if (!state) return
  const { positions, sliceIdx, nx, ny } = state
  const halfW = geom.coreWidth / 2, halfL = geom.coreLength / 2
  const nPx = nx * ny
  const mismatch = new Uint32Array(dims.nLayers)
  const impMask = new Uint8Array(nPx)
  const expMask = new Uint8Array(nPx)
  const isTpms = geom.family === 'gyroid_tpms' && !geom.isPin

  // fin/pin families: the expected mask is z-independent within the band —
  // compute base + band masks once. TPMS varies with z: per layer.
  let expBand: Uint8Array | null = null
  if (!isTpms) {
    expBand = new Uint8Array(nPx)
    expectedMask(geom, geom.baseThickness + geom.finHeight / 2, expBand, nx, ny)
  }

  let worstLayer = 0
  let worstCount = -1
  for (let li = 0; li < dims.nLayers; li++) {
    const zF = (li + 0.5) * LYF
    const segs = sliceSegments(positions, sliceIdx, li)
    rasterizeSegments(segs, impMask, nx, ny, PXF, halfW, halfL)
    let exp: Uint8Array
    if (li < dims.baseLayers) {
      expMask.fill(1) // base slab: fully exposed
      exp = expMask
    } else if (expBand) {
      exp = expBand
    } else {
      expectedMask(geom, zF, expMask, nx, ny)
      exp = expMask
    }
    let m = 0
    for (let i = 0; i < nPx; i++) if (impMask[i] !== exp[i]) m++
    mismatch[li] = m
    if (m > worstCount) { worstCount = m; worstLayer = li }
    if ((li & 7) === 0) progress('scanning layers', li / dims.nLayers)
  }
  progress('scanning layers', 1)
  post({
    type: 'layers',
    profile: { nLayers: dims.nLayers, baseLayers: dims.baseLayers, mismatch, total: nPx, worstLayer },
  }, [mismatch.buffer])
}

/** On-demand imported mask for one layer (PixelPreview compare overlay). */
function maskFor(layer: number): void {
  if (!state) return
  const { positions, sliceIdx, geom, nx, ny } = state
  const mask = new Uint8Array(nx * ny)
  const li = Math.max(0, Math.min(sliceIdx.nLayers - 1, layer))
  const segs = sliceSegments(positions, sliceIdx, li)
  rasterizeSegments(segs, mask, nx, ny, PXF, geom.coreWidth / 2, geom.coreLength / 2)
  post({ type: 'maskResult', layer: li, imported: mask, nx, ny }, [mask.buffer])
}

// ---------------------------------------------------------------------------
// ⌖ stack scan (2026-07-30): the whole-stack worst-neck sweep, entirely
// in-worker. The first version orchestrated this from the main thread — one
// maskResult round trip per layer (~1 MB copy + two React renders + a
// main-thread neck scan, fully serialized) which made a 271-layer sweep take
// minutes. Here each layer is slice → rasterize → neck-scan in place; only
// tiny progress numbers cross the thread boundary, and the winner is
// reported once at the end. Chunked with a macrotask yield so a
// 'scancancel' message can interrupt between chunks.
// ---------------------------------------------------------------------------
let scanCancelled = false

async function scanStack(chMinPx: number): Promise<void> {
  if (!state) return
  scanCancelled = false
  const { positions, sliceIdx, geom, nx, ny } = state
  const total = sliceIdx.nLayers
  const mask = new Uint8Array(nx * ny)
  let best: { fi: number; worstPx: number; count: number; idx: number } | null = null
  for (let fi = 0; fi < total; fi++) {
    if (scanCancelled) {
      post({ type: 'scanDone', total, best, cancelled: true })
      return
    }
    mask.fill(0)
    const segs = sliceSegments(positions, sliceIdx, fi)
    rasterizeSegments(segs, mask, nx, ny, PXF, geom.coreWidth / 2, geom.coreLength / 2)
    const neck = scanChannelNecks(mask, nx, ny, chMinPx)
    if (neck.count > 0 && (best == null || neck.worstPx < best.worstPx
        || (neck.worstPx === best.worstPx && neck.count > best.count))) {
      best = { fi, worstPx: neck.worstPx, count: neck.count, idx: neck.worstIdx }
    }
    if (fi % 8 === 7) {
      post({ type: 'scanProgress', fi, total, best })
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  post({ type: 'scanDone', total, best, cancelled: false })
}
