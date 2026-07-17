import { useCallback, useMemo, useRef, useState } from 'react'
import { evaluate } from '../api'
import { evalPayload, type ProblemOpts } from '../design'
import { routeRule } from '../manufacturing'
import { fmt, fmtInt, milliKW } from '../format'
import { gridDims } from '../verify/raster'
import { geomFromCase } from '../viewerGeom'
import type { Basis, BaselineResult, DesignState } from '../types'
import type { VerifyApi } from '../verify/useVerify'
import { GATE_PASS_MAX, GATE_PASS_P95, PX_FINAL, STAGE_META, type Stage, type VerdictKind } from '../verify/types'
import { DeviationViewer } from './DeviationViewer'
import { PointMapCheck } from './PointMapCheck'

// V4 Verify tab (spec §38–45). Explanation-first by contract (§39): every
// number ships with what it is · how it was measured · the bound + source ·
// what to do about it. A screen of bare µm statistics is a spec violation.

// µm for surface-scale numbers, switching to mm past 1 mm (a gross mismatch
// reported as "4583.8 µm" reads like line noise; "4.58 mm" reads like what it
// is — the wrong part)
const um = (v: number | null | undefined, digits = 0): string => {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  return abs >= 1 ? `${v.toFixed(2)} mm` : (v * 1000).toFixed(digits)
}

export function Info({ what, how, bound, action }: { what: string; how: string; bound: string; action: string }) {
  return (
    <span className="vinfo" tabIndex={0}>
      ⓘ
      <span className="vinfo-pop">
        <b>What it is.</b> {what}<br />
        <b>How it's measured.</b> {how}<br />
        <b>Judged against.</b> {bound}<br />
        <b>If it fails.</b> {action}
      </span>
    </span>
  )
}

export function VerdictChip({ v }: { v: VerdictKind | 'INFO' }) {
  const cls = v === 'PASS' ? 'pass' : v === 'MARGINAL' ? 'marg' : v === 'FAIL' ? 'fail' : 'info'
  return <span className={`vchip ${cls}`}>{v}</span>
}

// ---------------------------------------------------------------------------

export function VerifyTab({
  verify, design, basis, live, opts, onOpenPixel,
}: {
  verify: VerifyApi
  design: DesignState
  basis: Basis
  live: BaselineResult | null
  opts: ProblemOpts
  onOpenPixel: (layer: number) => void
}) {
  const { session } = verify
  const geom = useMemo(() => geomFromCase(design, basis), [design, basis])
  const [file, setFile] = useState<{ name: string; buffer: ArrayBuffer } | null>(null)
  const [stage, setStage] = useState<Stage>('final')
  const [scale, setScale] = useState(1)
  const [meshTol, setMeshTol] = useState(0.01)
  const [noBase, setNoBase] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [rescore, setRescore] = useState<{ busy: boolean; result: BaselineResult | null; error: string | null }>({ busy: false, result: null, error: null })
  const fileRef = useRef<HTMLInputElement>(null)

  const runWith = useCallback((f: { name: string; buffer: ArrayBuffer }, st: Stage, sc: number, tol: number, nb: boolean) => {
    if (!geom) return
    setRescore({ busy: false, result: null, error: null })
    verify.run(f, geom, st, sc, tol, nb)
  }, [geom, verify])

  const acceptFile = useCallback(async (f: File) => {
    const buffer = await f.arrayBuffer()
    const entry = { name: f.name, buffer }
    setFile(entry)
    runWith(entry, stage, scale, meshTol, noBase)
  }, [runWith, stage, scale, meshTol, noBase])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void acceptFile(f)
  }

  const reRun = (patch: { stage?: Stage; scale?: number; meshTol?: number; noBase?: boolean }) => {
    const st = patch.stage ?? stage
    const sc = patch.scale ?? scale
    const tol = patch.meshTol ?? meshTol
    const nb = patch.noBase ?? noBase
    if (patch.stage !== undefined) setStage(patch.stage)
    if (patch.scale !== undefined) setScale(patch.scale)
    if (patch.meshTol !== undefined) setMeshTol(patch.meshTol)
    if (patch.noBase !== undefined) setNoBase(patch.noBase)
    if (file) runWith(file, st, sc, tol, nb)
  }

  if (!geom) {
    return <div className="verify-pane"><div className="v-empty muted">
      Verification needs a viewable design (fin / TPMS / pin families) as the reference. Select one first.
    </div></div>
  }

  const r = session.result

  return (
    <div className="verify-pane">
      {/* ---------- step 1: what this is + the file ---------- */}
      {!file && (
        <div
          className={`v-drop ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="v-drop-title">Verify an nTop export against this design</div>
          <p className="v-plain">
            Drop the <b>binary STL</b> Hieu exported from nTop (or any STL of this part) and the app
            checks it three ways — all against the same implicit geometry the solvers scored:
          </p>
          <ol className="v-checks">
            <li><b>Shape</b> — every vertex is measured against the design surface. Verdict gate:
              95 % of the surface within ±{um(GATE_PASS_P95)} µm (half a printer pixel) and nothing
              beyond ±{um(GATE_PASS_MAX)} µm. Below the printer's own pixel, a deviation cannot change
              a single exposed voxel — that is what “identical” means here.</li>
            <li><b>Solver inputs</b> — fin area, flow area, hydraulic diameter, porosity and minimum
              fin/gap are measured on the actual mesh and compared with what the KPIs assumed. If these
              drift, the quoted R_jc is quietly wrong — this is the honesty check.</li>
            <li><b>Printer pixels</b> — every 25 µm layer is rasterized on the EVO35 grid and
              XOR-diffed against the expected exposure. Catches missing features, wrong shrink and
              overpoly sign errors that µm-level checks can't see.</li>
          </ol>
          <p className="v-plain muted">
            Export contract: millimetres, frame per <code>NTOP_REPLICATION.md §0</code> (x = fins,
            y = flow, z = height from the bottom face). Wrong units, a 90° rotation or a green-stage
            export are detected and explained — nothing is silently “fixed”.
          </p>
          <button className="v-browse" onClick={() => fileRef.current?.click()}>choose STL…</button>
          <span className="muted"> or drag it anywhere in this box</span>
          <input ref={fileRef} type="file" accept=".stl" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void acceptFile(f) }} />
        </div>
      )}

      {/* ---------- step 2: what the file is ---------- */}
      {file && (
        <div className="v-settings">
          <div className="v-file-row">
            <b>{file.name}</b>
            <span className="muted">{(file.buffer.byteLength / 1e6).toFixed(1)} MB</span>
            <button className="v-small" onClick={() => { setFile(null); verify.reset() }}>✕ different file</button>
          </div>
          <div className="v-stage-cards">
            {(Object.keys(STAGE_META) as Stage[]).map((s) => (
              <button key={s} className={`v-stage ${stage === s ? 'sel' : ''}`} onClick={() => reRun({ stage: s })}>
                <span className="v-stage-name">{STAGE_META[s].label}</span>
                <span className="v-stage-cap">{STAGE_META[s].caption}</span>
              </button>
            ))}
          </div>
          <div className="v-knobs">
            <label>unit scale ×
              <input type="number" step="any" value={scale}
                onChange={(e) => setScale(Number(e.target.value) || 1)}
                onBlur={() => reRun({ scale })} />
              <Info what="Multiplier applied to the file's coordinates before anything else. STL carries no units — 1 means the file is already in millimetres."
                how="Applied on import; the bounding box below shows the result."
                bound="The design envelope is W×L×H mm — a mismatch of ×1000 or ×25.4 triggers a worded suggestion."
                action="Use the suggested factor, or re-export from nTop in mm." />
            </label>
            <label>nTop meshing tolerance
              <input type="number" step="0.001" min="0" value={meshTol}
                onChange={(e) => setMeshTol(Number(e.target.value) || 0)}
                onBlur={() => reRun({ meshTol })} /> mm
              <Info what="The chordal tolerance used in nTop's mesh-from-implicit block. It is this check's noise floor — meshing chatter below it is not a rebuild error."
                how="You enter it; it is drawn as the grey band on the histogram."
                bound={`Recommend ≤ 0.010 mm (≈ ⅓ printer pixel) — coarser tolerances eat the ±${um(GATE_PASS_P95)} µm PASS band with meshing error alone.`}
                action="Re-export with a tighter meshing tolerance if the histogram is wider than this band for no design reason." />
            </label>
            <label>
              <input type="checkbox" checked={noBase} onChange={(e) => reRun({ noBase: e.target.checked })} />
              file has no base slab (core / fins only)
              <Info what="Compare against the design WITHOUT its base slab — for exports that contain only the fin/lattice core, which land at z = 0 where the design expects the base."
                how="The reference loses its base; fins start at z = 0 exactly like the floored file. The audit's solver-assumed values still describe the full design."
                bound="Use when the file's height matches the fin height alone (the hint above detects this)."
                action="For the definitive pre-print check, export WITH the base — the base's pixel raster and the fin-root junction are verified only then." />
            </label>
          </div>
          <div className="v-plain muted v-stagewhy">
            Why the stage matters: the CAD-for-print file deliberately carries thinner fins
            (−2 px) and wider gaps (+2 px) than the design, and the green file is ~19.7 % oversize —
            compared against the wrong stage, that intent reads as a huge uniform “error”.
            The comparison is always made in the final frame against the matching reference.
          </div>
        </div>
      )}

      {/* ---------- progress / error ---------- */}
      {session.status === 'running' && session.progress && (
        <div className="v-progress">
          <div className="v-prog-bar"><div style={{ width: `${Math.round(session.progress.pct * 100)}%` }} /></div>
          <span>{session.progress.phase}…</span>
        </div>
      )}
      {session.status === 'error' && (
        <div className="v-error">
          <b>Could not verify:</b> {session.error}
        </div>
      )}

      {/* ---------- results ---------- */}
      {r && (
        <VerifyResults
          r={r} layers={session.layers} stage={stage} meshTol={meshTol}
          design={design} basis={basis} live={live} opts={opts}
          rescore={rescore} setRescore={setRescore}
          onStage={(s) => reRun({ stage: s })}
          onScale={(v) => reRun({ scale: v })}
          onOpenPixel={(l) =>
            // fins-only run: worker layers start at the base top — map back to
            // design layers for the pixel view
            onOpenPixel(l + (noBase && geom ? gridDims(geom).baseLayers : 0))}
        />
      )}

      {/* V4.4 — the mesh-free field check, independent of the STL import */}
      <PointMapCheck design={design} basis={basis} stage={stage} noBase={noBase} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function VerifyResults({
  r, layers, stage, meshTol, design, basis, live, opts, rescore, setRescore,
  onStage, onScale, onOpenPixel,
}: {
  r: NonNullable<VerifyApi['session']['result']>
  layers: VerifyApi['session']['layers']
  stage: Stage
  meshTol: number
  design: DesignState
  basis: Basis
  live: BaselineResult | null
  opts: ProblemOpts
  rescore: { busy: boolean; result: BaselineResult | null; error: string | null }
  setRescore: (v: { busy: boolean; result: BaselineResult | null; error: string | null }) => void
  onStage: (s: Stage) => void
  onScale: (v: number) => void
  onOpenPixel: (layer: number) => void
}) {
  const d = r.deviation
  const geom = useMemo(() => geomFromCase(design, basis), [design, basis])
  const rule = routeRule(design.process_route)
  const isFin = design.family !== 'gyroid_tpms'
  const isPin = design.family === 'gyroid_tpms' && design.tpms_type === 'pin_fins'

  // ---- verdict sentence (numbers second — §39-3) ----
  const overall: VerdictKind =
    d.verdict === 'FAIL' || r.twoSided?.verdict === 'FAIL' ? 'FAIL'
      : d.verdict === 'MARGINAL' || r.twoSided?.verdict === 'MARGINAL' ? 'MARGINAL' : 'PASS'
  const sentence = overall === 'PASS'
    ? `${(d.insideHalfPx * 100).toFixed(1)} % of the imported surface lies within ±${um(GATE_PASS_P95)} µm — half a printer pixel — of the design; the worst spot is ${um(d.max)} µm off, at (${fmt(d.worst.x, 1)}, ${fmt(d.worst.y, 1)}, ${fmt(d.worst.z, 1)}) mm. As far as the EVO35 can see, this file IS the design.`
    : overall === 'MARGINAL'
      ? `most of the surface matches (95th percentile ${um(d.p95, 1)} µm), but parts sit up to ${um(d.max)} µm off — under a printer pixel of doubt remains. Check the histogram and worst spot before sending this file out.`
      : `this file does not match the design: 95 % of the surface must stay within ±${um(GATE_PASS_MAX)} µm, but the measured p95 is ${um(d.p95, 1)} µm (worst ${um(d.max)} µm at (${fmt(d.worst.x, 1)}, ${fmt(d.worst.y, 1)}, ${fmt(d.worst.z, 1)}) mm). Read the hints below — a wrong stage or unit is the most common cause.`

  // ---- audit rows ----
  interface Row {
    label: string
    nominal: number | null
    measured: number | null
    unit: string
    digits: number
    note: string
    info: { what: string; how: string; bound: string; action: string }
  }
  const areas = live?.areas
  const coreVol = geom ? geom.coreWidth * geom.coreLength * geom.finHeight : null
  const mFlow = r.measures.slices.length
    ? r.measures.slices.reduce((s, m) => s + m.flowArea_mm2, 0) / r.measures.slices.length : null
  const rows: Row[] = [
    {
      label: 'fin / structure area', unit: 'mm²', digits: 0,
      nominal: areas?.fin_mm2 ?? null, measured: r.measures.structArea_mm2,
      note: 'measured value includes fin tops and tips (a few % high by construction)',
      info: {
        what: 'Total heat-exchange surface of the core structure — the area the convection model multiplies by h.',
        how: 'Sum of mesh triangle areas above the base top, in the final frame.',
        bound: 'The solver\'s areas.fin_mm2 for the current design; agreement within a few % keeps the KPIs valid.',
        action: 'A big deficit usually means missing features — check the two-sided pass and the layer scan.',
      },
    },
    {
      label: 'flow area A_flow', unit: 'mm²', digits: 1,
      nominal: live ? live.flow_area_m2 * 1e6 : null, measured: mFlow,
      note: 'mean of 5 cross-sections through the fin band',
      info: {
        what: 'Open cross-section the coolant flows through — sets velocity, hence Re, h and ΔP.',
        how: 'Void pixels of 5 mesh slices rasterized at the 29 µm final grid, × pixel area.',
        bound: 'The solver\'s flow_area_m2. Drift here shifts ΔP quadratically.',
        action: 'If low: channels are undersized (overpoly sign? wrong stage?). Re-score below to see the KPI impact.',
      },
    },
    {
      label: 'hydraulic diameter D_h', unit: 'mm', digits: 3,
      nominal: live?.hydraulic_diameter_mm ?? null, measured: r.measures.dhMean_mm,
      note: '4·A_flow / wetted perimeter, envelope walls excluded',
      info: {
        what: 'The length scale the Nu and f correlations run on.',
        how: '4×(slice flow area)/(interior contour length), averaged over 5 slices.',
        bound: 'The solver\'s hydraulic_diameter_mm.',
        action: 'A few % drift is normal (raster + meshing). >10 % means the geometry the correlations assumed is not what is in the file.',
      },
    },
    {
      label: 'void fraction (core band)', unit: '', digits: 3,
      nominal: live?.open_volume_fraction ?? null, measured: r.measures.voidFrac,
      note: 'volume-open fraction of the W×L×H band',
      info: {
        what: 'Open volume fraction of the core — porosity for TPMS, channel fraction for fins.',
        how: 'Mean void share of the 5 rasterized slices.',
        bound: 'The solver\'s open_volume_fraction.',
        action: 'For TPMS this is the ρ* check of NTOP_REPLICATION §3.6 — a mismatch means wall thickness or cell size was rebuilt wrong.',
      },
    },
    {
      label: 'surface area / volume', unit: 'm²/m³', digits: 0,
      nominal: live ? live.raw_SA_V_m2_m3 : null,
      measured: coreVol && coreVol > 0 ? (r.measures.structArea_mm2 / coreVol) * 1000 : null,
      note: 'structure area over core-band volume',
      info: {
        what: 'Compactness of the heat exchanger (SA/V).',
        how: 'Measured structure area ÷ core band volume (×1000 for m²/m³).',
        bound: 'The solver\'s raw_SA_V_m2_m3.',
        action: 'Tracks the fin-area row; if only this row drifts, check the core height alignment.',
      },
    },
  ]

  const worstDelta = rows.reduce((w, row) => {
    if (row.nominal == null || row.measured == null || row.nominal === 0) return w
    return Math.max(w, Math.abs(row.measured / row.nominal - 1))
  }, 0)

  // file-level DfAM verdict on measured minimums
  const mfGap = r.measures.minGap_mm
  const mfFin = r.measures.minFin_mm
  const gradeOf = (v: number | null, abs: number, rec: number): VerdictKind | 'INFO' =>
    v == null ? 'INFO' : v < abs - 1e-9 ? 'FAIL' : v < rec - 1e-9 ? 'MARGINAL' : 'PASS'
  const gapVerdict = gradeOf(mfGap, rule.gapAbs, rule.gapRec)
  const finVerdict = gradeOf(mfFin, rule.wallAbs, rule.wallRec)
  const fileVerdict: VerdictKind = gapVerdict === 'FAIL' || finVerdict === 'FAIL' ? 'FAIL'
    : gapVerdict === 'MARGINAL' || finVerdict === 'MARGINAL' ? 'MARGINAL' : 'PASS'

  // ---- re-score with measured geometry ----
  const canRescore = (isFin && r.measures.medFin_mm != null && r.measures.medGap_mm != null)
    || (!isFin && !isPin && r.measures.voidFrac != null && r.measures.dhMean_mm != null)
  const doRescore = async () => {
    setRescore({ busy: true, result: null, error: null })
    try {
      const patched: DesignState = isFin
        ? { ...design, fin_thickness_mm: r.measures.medFin_mm!, channel_gap_mm: r.measures.medGap_mm! }
        : {
          ...design,
          void_fraction: r.measures.voidFrac!,
          hydraulic_diameter_mm: r.measures.dhMean_mm!,
          surface_area_density_m2_m3: coreVol && coreVol > 0 ? (r.measures.structArea_mm2 / coreVol) * 1000 : design.surface_area_density_m2_m3,
        }
      const res = await evaluate(evalPayload(patched, basis, opts))
      setRescore({ busy: false, result: res, error: null })
    } catch (e) {
      setRescore({ busy: false, result: null, error: String((e as Error).message ?? e) })
    }
  }

  const bb = r.align.bbox
  const worstLayerPct = layers && layers.total > 0
    ? (layers.mismatch[layers.worstLayer] / layers.total) * 100 : null

  return (
    <div className="v-results">
      {/* verdict-first banner */}
      <div className={`v-banner ${overall.toLowerCase()}`}>
        <VerdictChip v={overall} />
        <span>{sentence}</span>
      </div>

      {(r.align.hints.length > 0 || d.hint) && (
        <div className="v-hints">
          {r.align.hints.map((h, i) => <div key={i} className="v-hint">💡 {h}</div>)}
          {d.hint && (
            <div className="v-hint">
              💡 {d.hint}
              <span className="v-hint-actions">
                {(['final', 'green', 'cad'] as Stage[]).filter((s) => s !== stage).map((s) => (
                  <button key={s} className="v-small" onClick={() => onStage(s)}>re-run as {STAGE_META[s].label.toLowerCase()}</button>
                ))}
                <button className="v-small" onClick={() => onScale(1000)}>×1000 (metres→mm)</button>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="v-grid">
        {/* -------- left: 3-D deviation + histogram -------- */}
        <div className="v-col">
          {geom && <DeviationViewer view={r.view} geom={geom} />}
          <Histogram d={d} meshTol={meshTol} />
          <div className="v-gates">
            <span>verdict <VerdictChip v={d.verdict} /> — the PASS gate is: p95 ≤ {um(GATE_PASS_P95)} µm and max ≤ {um(GATE_PASS_MAX)} µm
              <Info
                what="The acceptance gate for shape conformance, tied to the printer's quantization — not an arbitrary tolerance."
                how="p95/max of |signed distance| from every imported vertex to the design surface (gradient-normalized field evaluation, no CAD kernel)."
                bound={`½ / 1 EVO35 pixel mapped to final scale (35 µm ÷ 1.197 = ${um(PX_FINAL, 1)} µm). Below ½ px the raster cannot change; spec §40.`}
                action="MARGINAL/FAIL: check stage + units first (hints above), then the red/blue regions in the 3-D view." />
            </span>
            <span className="mono">p50 {um(d.p50, 1)} · p95 {um(d.p95, 1)} · max {um(d.max)} µm · {fmtInt(d.n)} vertices</span>
            {d.buried > 0 && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {fmtInt(d.buried)} vertices sit deeper than 1.25 px INSIDE the design and were
                classified as internal faces of overlapping-shell unions (a normal CAD/export
                practice — the app's own STL sinks fins 0.05 mm into the base on purpose). They are
                excluded from the gates; genuinely missing material at that depth is caught by the
                reverse check and the layer scan below.
              </span>
            )}
          </div>
          {r.twoSided && (
            <div className="v-gates">
              <span>reverse check (design → file) <VerdictChip v={r.twoSided.verdict} />
                <Info
                  what="The mirror direction: points ON the design surface measured against the imported mesh. Vertex sampling alone cannot see MISSING geometry — a deleted fin has no vertices to flag. This pass does."
                  how={`${fmtInt(r.twoSided.n)} points sampled directly on the implicit surface (mesh-free), nearest-distance to the file via a triangle BVH.`}
                  bound="Same ½ px / 1 px gates; “uncovered” counts design points with no file surface within 1 px."
                  action="Uncovered > 0 with a healthy forward check = something is missing from the file. The layer scan shows where." />
              </span>
              <span className="mono">
                p95 {um(r.twoSided.p95, 1)} µm · max {um(r.twoSided.max)} µm ·
                uncovered {(r.twoSided.uncoveredFrac * 100).toFixed(2)} %
                {r.twoSided.uncoveredFrac > 0 && ` · worst at (${fmt(r.twoSided.worst.x, 1)}, ${fmt(r.twoSided.worst.y, 1)}, ${fmt(r.twoSided.worst.z, 1)})`}
              </span>
            </div>
          )}
          {layers && (
            <div className="v-layers">
              <LayerStrip layers={layers} onOpenPixel={onOpenPixel} />
              <div className="v-layers-cap">
                pixel conformance: every 25 µm layer rasterized on the EVO35 grid, XOR-diffed
                against the expected exposure.
                {worstLayerPct != null && (
                  <> worst layer <b>{layers.worstLayer + 1}</b> differs in <b>{fmt(worstLayerPct, 2)} %</b> of pixels
                    — <button className="v-link" onClick={() => onOpenPixel(layers.worstLayer)}>open it in the pixel view</button>.</>
                )}
                <Info
                  what="What the printer would actually expose, layer by layer — the check that catches missing features, un-applied shrink and overpoly sign errors that µm statistics hide."
                  how="The mesh is sliced at each 25 µm green layer and scanline-rasterized on the same 35 µm grid as the DLP preview; mismatching pixels are counted per layer."
                  bound="0 mismatching feature pixels expected for a faithful export; single-pixel edge flicker on slanted walls is normal quantization."
                  action="Jump to the worst layer in the pixel view — the mismatch overlay paints exactly which pixels differ." />
              </div>
            </div>
          )}
        </div>

        {/* -------- right: file card + audit + DfAM + re-score -------- */}
        <div className="v-col">
          <div className="v-card">
            <h3>File</h3>
            <div className="v-kv"><span>triangles</span><b>{fmtInt(r.file.triangles)}</b></div>
            <div className="v-kv"><span>unique vertices</span><b>{fmtInt(r.file.uniqueVerts)}</b></div>
            <div className="v-kv"><span>watertight</span>
              <b>{r.file.watertight ? 'yes' : `no — ${fmtInt(r.file.openEdges)} open edges`}</b>
              <Info what="A closed (watertight) mesh separates inside from outside everywhere. Volume and porosity need it; the deviation check does not."
                how="Every directed triangle edge must be matched by its reverse exactly once."
                bound="0 open edges. (The app's own TPMS exports keep ~0.05 % saddle contacts — slicers auto-repair those.)"
                action="If open: volume/porosity rows are disabled; run the file through netfabb/Meshmixer repair before printing." />
            </div>
            <div className="v-kv"><span>aligned bbox (final)</span>
              <b className="mono">{fmt(bb[3] - bb[0], 2)} × {fmt(bb[4] - bb[1], 2)} × {fmt(bb[5] - bb[2], 2)} mm</b>
            </div>
            <div className="v-kv"><span>alignment applied</span>
              <b className="mono">
                {r.align.rotated ? 'rot 90° · ' : ''}
                Δ({fmt(r.align.offset[0], 2)}, {fmt(r.align.offset[1], 2)}, {fmt(r.align.offset[2], 2)}) mm
              </b>
              <Info what="The transform applied to land the file in the contract frame (centre in x/y, bottom face at z = 0). Reported, never silent."
                how="Bounding-box registration; a 90° rotation is applied only when the footprint clearly matches the design rotated."
                bound="Small offsets are normal (nTop origins differ); the rotation flag should match your export intent."
                action="If the rotation looks wrong, re-export in the NTOP_REPLICATION §0 frame instead." />
            </div>
          </div>

          <div className="v-card">
            <h3>Solver-input audit
              <span className={`v-trust ${worstDelta <= 0.02 ? 'ok' : worstDelta <= 0.1 ? 'warn' : 'bad'}`}>
                {worstDelta <= 0.02
                  ? `geometry matches solver inputs within ${Math.max(1, Math.ceil(worstDelta * 100))} % — KPIs valid for this file`
                  : worstDelta <= 0.1
                    ? `inputs drift up to ${(worstDelta * 100).toFixed(0)} % — KPIs are approximate for this file, re-score below`
                    : `inputs drift up to ${(worstDelta * 100).toFixed(0)} % — the quoted KPIs do NOT describe this file`}
              </span>
            </h3>
            <table className="v-tbl">
              <thead><tr><th>quantity</th><th className="num">solver assumed</th><th className="num">measured in file</th><th className="num">Δ</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const delta = row.nominal != null && row.measured != null && row.nominal !== 0
                    ? (row.measured / row.nominal - 1) * 100 : null
                  return (
                    <tr key={row.label}>
                      <td>{row.label} <Info {...row.info} /><div className="v-rownote muted">{row.note}</div></td>
                      <td className="num">{row.nominal != null ? fmt(row.nominal, row.digits) : '—'}{row.unit && ` ${row.unit}`}</td>
                      <td className="num">{row.measured != null ? fmt(row.measured, row.digits) : '—'}{row.unit && ` ${row.unit}`}</td>
                      <td className="num" style={{ color: delta == null ? undefined : Math.abs(delta) <= 2 ? 'var(--pass)' : Math.abs(delta) <= 10 ? 'var(--warn)' : 'var(--fail)' }}>
                        {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %`}
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td>solid volume <Info
                    what="Material volume of the part — a coarse global check that nothing big is missing or doubled."
                    how="Signed tetrahedron sum over the (watertight, consistently wound) mesh."
                    bound="Informational — no gate; needs a watertight mesh."
                    action="Grossly low volume with a passing deviation check = missing feature; see the reverse check." /></td>
                  <td className="num">—</td>
                  <td className="num">{r.measures.volume_mm3 != null ? `${fmtInt(r.measures.volume_mm3)} mm³` : 'needs watertight mesh'}</td>
                  <td className="num">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="v-card">
            <h3>Manufacturability of THIS file <VerdictChip v={fileVerdict} /></h3>
            <p className="v-plain muted">
              The DfAM rulebook run on the file as exported (not the nominal sliders) —
              rule set: {rule.short}, {rule.grade}, {rule.source}.
            </p>
            <div className="v-kv"><span>min gap in file</span>
              <b>{mfGap != null ? `${fmt(mfGap, 3)} mm` : '—'}</b> <VerdictChip v={gapVerdict} />
              <Info what="Narrowest interior channel found in the file — the cleanability-critical number."
                how="5th percentile of void run-lengths across 5 rasterized fin-band slices (P5, not absolute min, so single-pixel chords on slanted walls don't false-alarm)."
                bound={`≥ ${rule.gapAbs} mm printable / ≥ ${rule.gapRec} mm recommended (${rule.source}).`}
                action="Below the floor the part can print but cannot be cleaned — fix the design or the export, don't ship it." />
            </div>
            <div className="v-kv"><span>min fin in file</span>
              <b>{mfFin != null ? `${fmt(mfFin, 3)} mm` : '—'}</b> <VerdictChip v={finVerdict} />
              <Info what="Thinnest structure found in the file."
                how="5th percentile of solid run-lengths across the same slices."
                bound={`≥ ${rule.wallAbs} mm printable / ≥ ${rule.wallRec} mm recommended.`}
                action="A CAD-for-print export is EXPECTED to sit ~2 px under nominal (overpoly compensation) — judge that stage against the green rules, or verify the final-stage file instead." />
            </div>
          </div>

          <div className="v-card">
            <h3>Re-score with measured geometry</h3>
            <p className="v-plain muted">
              Runs the validated solver (server-side, same <code>/api/evaluate</code>) with the file's
              measured {isFin ? 'fin/gap widths' : 'porosity, D_h and SA/V'} instead of the nominal
              sliders — the browser never invents physics. The delta is what shipping this exact file
              would do to the KPIs.
            </p>
            {isPin
              ? <div className="muted">Not available for pin arrays yet — raster runs don't map cleanly onto Ø/pitch.</div>
              : (
                <>
                  <button className="v-rescore" disabled={!canRescore || rescore.busy || !live} onClick={() => void doRescore()}>
                    {rescore.busy ? 'scoring…' : '⟳ re-score this file'}
                  </button>
                  {rescore.error && <div className="v-error">{rescore.error}</div>}
                  {rescore.result && live && (
                    <table className="v-tbl">
                      <thead><tr><th>KPI</th><th className="num">nominal design</th><th className="num">this file</th></tr></thead>
                      <tbody>
                        <tr><td>R_jc</td>
                          <td className="num">{milliKW(live.R_jc_K_W)} mK/W</td>
                          <td className="num">{milliKW(rescore.result.R_jc_K_W)} mK/W</td></tr>
                        <tr><td>ΔP</td>
                          <td className="num">{fmt(live.DeltaP_Pa / 1000, 2)} kPa</td>
                          <td className="num">{fmt(rescore.result.DeltaP_Pa / 1000, 2)} kPa</td></tr>
                        <tr><td>pump power</td>
                          <td className="num">{fmt(live.pump_power_W, 3)} W</td>
                          <td className="num">{fmt(rescore.result.pump_power_W, 3)} W</td></tr>
                        {live.targets && rescore.result.targets && (
                          <tr><td>T_j</td>
                            <td className="num">{fmt(live.targets.T_j_C, 1)} °C</td>
                            <td className="num">{fmt(rescore.result.targets.T_j_C, 1)} °C</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function Histogram({ d, meshTol }: { d: NonNullable<VerifyApi['session']['result']>['deviation']; meshTol: number }) {
  const W = 560, H = 120, PAD = 6
  const maxBin = Math.max(1, ...d.bins)
  const x = (mm: number): number => PAD + ((mm - d.binMin) / (d.binWidth * d.bins.length)) * (W - 2 * PAD)
  const barW = (W - 2 * PAD) / d.bins.length
  return (
    <div className="v-hist">
      <svg viewBox={`0 0 ${W} ${H + 26}`} className="v-hist-svg">
        {/* meshing-tolerance noise band */}
        <rect x={x(-meshTol)} y={0} width={Math.max(1, x(meshTol) - x(-meshTol))} height={H}
          fill="rgba(255,255,255,0.06)" />
        {d.bins.map((b, i) => {
          const mm = d.binMin + (i + 0.5) * d.binWidth
          const bad = Math.abs(mm) > GATE_PASS_MAX
          const marg = !bad && Math.abs(mm) > GATE_PASS_P95
          return (
            <rect key={i}
              x={PAD + i * barW + 0.5} width={Math.max(0.5, barW - 1)}
              y={H - (b / maxBin) * (H - 8)} height={(b / maxBin) * (H - 8)}
              fill={bad ? 'var(--fail)' : marg ? 'var(--warn)' : 'var(--accent)'} opacity={0.85} />
          )
        })}
        {[-GATE_PASS_MAX, -GATE_PASS_P95, GATE_PASS_P95, GATE_PASS_MAX].map((g, i) => (
          <line key={i} x1={x(g)} x2={x(g)} y1={0} y2={H} stroke="rgba(255,255,255,0.45)" strokeDasharray="3 3" />
        ))}
        <line x1={x(0)} x2={x(0)} y1={0} y2={H} stroke="rgba(255,255,255,0.7)" />
        <text x={x(0)} y={H + 12} className="v-hist-t" textAnchor="middle">0</text>
        <text x={x(-GATE_PASS_P95)} y={H + 12} className="v-hist-t" textAnchor="middle">−½px</text>
        <text x={x(GATE_PASS_P95)} y={H + 12} className="v-hist-t" textAnchor="middle">+½px</text>
        <text x={x(-GATE_PASS_MAX)} y={H + 12} className="v-hist-t" textAnchor="middle">−1px</text>
        <text x={x(GATE_PASS_MAX)} y={H + 12} className="v-hist-t" textAnchor="middle">+1px</text>
        <text x={PAD} y={H + 24} className="v-hist-t">← inside the design (undersize) · {fmtInt(d.outliersLow)} beyond</text>
        <text x={W - PAD} y={H + 24} className="v-hist-t" textAnchor="end">outside (oversize) → · {fmtInt(d.outliersHigh)} beyond</text>
      </svg>
      <div className="v-hist-cap muted">
        signed deviation of every vertex; grey band = your nTop meshing tolerance (noise floor —
        width inside it is meshing chatter, not rebuild error)
      </div>
    </div>
  )
}

function LayerStrip({ layers, onOpenPixel }: {
  layers: NonNullable<VerifyApi['session']['layers']>
  onOpenPixel: (layer: number) => void
}) {
  const W = 560, H = 42
  const n = layers.nLayers
  const maxM = Math.max(1, ...Array.from(layers.mismatch))
  const bw = W / n
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="v-strip" onClick={(e) => {
      const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect()
      const li = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n)))
      onOpenPixel(li)
    }}>
      <rect x={0} y={0} width={(layers.baseLayers / n) * W} height={H} fill="rgba(255,255,255,0.05)" />
      {Array.from(layers.mismatch).map((m, i) => (
        m > 0
          ? <rect key={i} x={i * bw} width={Math.max(0.6, bw)} y={H - (m / maxM) * (H - 4)}
              height={(m / maxM) * (H - 4)} fill={m / layers.total > 0.001 ? 'var(--fail)' : 'var(--warn)'} />
          : null
      ))}
      <rect x={(layers.worstLayer / n) * W - 1} y={0} width={2} height={H} fill="var(--fail)" opacity={0.8} />
    </svg>
  )
}
