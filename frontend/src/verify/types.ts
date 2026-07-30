// V4 Verify — shared types between the UI, the hook and the worker.
// Everything is measured in FINAL (sintered) mm unless a name says otherwise.

export type Stage = 'final' | 'green' | 'cad'

export const STAGE_META: Record<Stage, { label: string; caption: string }> = {
  final: {
    label: 'Final part',
    caption: 'design dimensions, as sintered — pick this for a plain nTop rebuild',
  },
  green: {
    label: 'Green (scaled)',
    caption: '×1.197 XY / ×1.230 Z — the part as printed, before sinter shrink',
  },
  cad: {
    label: 'CAD-for-print',
    caption: 'green + pixel snap + fin −2 px / gap +2 px overpoly compensation — the file sent to Incus',
  },
}

export type VerdictKind = 'PASS' | 'MARGINAL' | 'FAIL'

/** One judged quantity with its full explanation (spec §39-4: every number
 *  carries what it is · how measured · bound + source · what to do). */
export interface ExplainedStat {
  key: string
  label: string
  value: number | null
  unit: string
  status: VerdictKind | 'INFO'
  what: string
  how: string
  bound: string
  action: string
}

export interface FileInfo {
  name: string
  sizeBytes: number
  triangles: number
  uniqueVerts: number
  watertight: boolean
  openEdges: number
  /** raw file-frame bbox before any transform */
  bboxRaw: [number, number, number, number, number, number]
}

export interface AlignInfo {
  /** applied uniform pre-scale (user units fix, 1 = file was mm) */
  scale: number
  /** stage de-scale applied on top (green/cad → final) */
  stageScale: [number, number, number]
  /** translation applied after scaling, final mm */
  offset: [number, number, number]
  /** 90° z-rotation applied (axis swap fix) */
  rotated: boolean
  /** final-frame bbox after all transforms */
  bbox: [number, number, number, number, number, number]
  /** human hints discovered during alignment (unit / stage suggestions) */
  hints: string[]
}

export interface DeviationInfo {
  /** vertices judged (buried internal verts excluded) */
  n: number
  /** vertices > 1.25 px INSIDE the design — internal faces of overlapping-shell
   *  unions (a normal CAD practice; the app's own STL sinks fins 0.05 mm into
   *  the base). Excluded from the gates: genuine missing material at that depth
   *  is caught by the reverse pass and the layer scan instead. */
  buried: number
  p50: number
  p95: number
  max: number
  /** signed percentiles for shift detection */
  median: number
  /** fraction (0..1) of vertices with |dev| <= half printer pixel */
  insideHalfPx: number
  /** fraction with |dev| <= 1 printer pixel */
  insidePx: number
  verdict: VerdictKind
  /** histogram of signed deviation, mm */
  bins: number[]
  binMin: number
  binWidth: number
  outliersLow: number
  outliersHigh: number
  worst: { x: number; y: number; z: number; d: number }
  /** wrong-stage / uniform-shift hint, if the pattern suggests one */
  hint: string | null
}

export interface TwoSidedInfo {
  n: number
  p95: number
  max: number
  /** fraction (0..1) of design-surface samples with no mesh within 1 px */
  uncoveredFrac: number
  worst: { x: number; y: number; z: number; d: number }
  verdict: VerdictKind
}

export interface SliceMetric {
  z: number
  flowArea_mm2: number
  wettedPerim_mm: number
  dh_mm: number
  solidFrac: number
}

export interface MeasureInfo {
  volume_mm3: number | null
  /** total surface area of the mesh */
  area_mm2: number
  /** structure-only area (triangles above the base top) — compares to areas.fin_mm2 */
  structArea_mm2: number
  /** void fraction of the core band (box W×L×H) — compares to open_volume_fraction */
  voidFrac: number | null
  slices: SliceMetric[]
  dhMean_mm: number | null
  /** raster-measured min interior widths in the fin band, final mm (P5 of runs) */
  minFin_mm: number | null
  minGap_mm: number | null
  /** median widths — the "as-exported" nominal, used for re-scoring */
  medFin_mm: number | null
  medGap_mm: number | null
}

export interface LayerProfile {
  nLayers: number
  baseLayers: number
  /** mismatching pixels per layer (XOR of imported vs expected raster) */
  mismatch: Uint32Array
  /** total pixels per layer inside the grid */
  total: number
  worstLayer: number
}

export interface VerifyResult {
  file: FileInfo
  align: AlignInfo
  deviation: DeviationInfo
  twoSided: TwoSidedInfo | null
  measures: MeasureInfo
  /** deviation-coloured display geometry — always the FULL indexed mesh;
   *  the viewer decides between points (fast) and full-mesh rendering */
  view: {
    positions: Float32Array
    colors: Uint8Array
    index: Uint32Array
    /** above the comfortable-render threshold — viewer defaults to points */
    heavy: boolean
  }
}

export interface VerifyProgress {
  phase: string
  pct: number
}

// ---------------------------------------------------------------------------
// worker protocol
// ---------------------------------------------------------------------------

export interface RunMsg {
  type: 'run'
  buffer: ArrayBuffer
  name: string
  /** reference geometry in final space (already stage-adjusted for 'cad') */
  geom: import('../viewerGeom').ViewerGeom
  stage: Stage
  /** user unit fix (multiply file coords by this to get file-stage mm) */
  scale: number
  /** meshing tolerance the user entered in nTop, mm (noise floor) */
  meshTol: number
  /** the export contains only the core (fins/lattice) — compare against the
   *  reference with the base slab removed */
  noBase: boolean
  /** run the two-sided (design→mesh) pass */
  twoSided: boolean
  /** compute the per-layer XOR mismatch profile */
  layerProfile: boolean
}

export interface MaskMsg {
  type: 'mask'
  layer: number
}

/** ⌖ stack scan (2026-07-30): sweep EVERY file layer in the worker —
 *  slice + rasterize + neck-scan per layer without posting masks — and
 *  return only the worst layer. Cancelable between chunks. */
export interface ScanStackMsg {
  type: 'scanstack'
  /** channel floor in green px (disc diameter for the opening test) */
  chMinPx: number
  /** overpoly what-if: dilate each layer's solid by this many px per side
   *  before neck-scanning (0 = judge the file as drawn) */
  dilatePx: number
}
export interface ScanCancelMsg {
  type: 'scancancel'
}

export interface StackScanBest {
  fi: number       // file-layer index of the worst layer
  worstPx: number  // narrowest passage width there (green px)
  count: number    // flagged neck pixels on that layer
  idx: number      // grid index of the narrowest passage
}

export type WorkerInMsg = RunMsg | MaskMsg | ScanStackMsg | ScanCancelMsg

export type WorkerOutMsg =
  | { type: 'progress'; phase: string; pct: number }
  | { type: 'result'; result: VerifyResult }
  | { type: 'layers'; profile: { nLayers: number; baseLayers: number; mismatch: Uint32Array; total: number; worstLayer: number } }
  | { type: 'maskResult'; layer: number; imported: Uint8Array; nx: number; ny: number }
  | { type: 'scanProgress'; fi: number; total: number; best: StackScanBest | null }
  | { type: 'scanDone'; total: number; best: StackScanBest | null; cancelled: boolean }
  | { type: 'error'; message: string }

// gates (spec §40): 1 px_final = 35 µm / 1.197 ≈ 29.2 µm
export const PX_FINAL = 0.035 / 1.197
export const GATE_PASS_P95 = PX_FINAL / 2   // ≈ 14.6 µm
export const GATE_PASS_MAX = PX_FINAL       // ≈ 29.2 µm

export function deviationVerdict(p95: number, max: number): VerdictKind {
  if (p95 <= GATE_PASS_P95 && max <= GATE_PASS_MAX) return 'PASS'
  if (p95 <= GATE_PASS_MAX) return 'MARGINAL'
  return 'FAIL'
}
