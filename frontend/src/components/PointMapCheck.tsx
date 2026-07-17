import { useMemo, useRef, useState } from 'react'
import { geomFromCase } from '../viewerGeom'
import { fmt, fmtInt } from '../format'
import { stageRefGeom } from '../verify/stages'
import { buildRecipeCsv, comparePointMap, planeMetas, type PointMapResult } from '../verify/pointmap'
import { GATE_PASS_MAX, GATE_PASS_P95, STAGE_META, type Stage } from '../verify/types'
import type { Basis, DesignState } from '../types'
import { Histogram, Info, VerdictChip } from './VerifyTab'

// V4.4 — the point-map field check (spec §43): mesh-free verification of the
// implicit MATH itself. The app writes probe points, nTop's kernel samples its
// implicit body on them, and the zero-crossing positions are compared — no
// meshing tolerance anywhere in the loop, MB-scale files instead of hundreds.

const um = (v: number | null | undefined, digits = 0): string => {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  return abs >= 1 ? `${v.toFixed(2)} mm` : (v * 1000).toFixed(digits)
}

export function PointMapCheck({
  design, basis, stage, noBase,
}: {
  design: DesignState
  basis: Basis
  stage: Stage
  noBase: boolean
}) {
  const [pitch, setPitch] = useState(0.05)
  const [busy, setBusy] = useState<'gen' | 'cmp' | null>(null)
  const [genNote, setGenNote] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; r: PointMapResult } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // stage/noBase-adjusted reference, final frame — identical to the mesh check
  const refGeom = useMemo(() => {
    const g = geomFromCase(design, basis)
    if (!g) return null
    const ref = stageRefGeom(g, stage).geom
    return noBase ? { ...ref, baseThickness: 0 } : ref
  }, [design, basis, stage, noBase])

  const planeCount = useMemo(() => {
    if (!refGeom) return null
    return planeMetas(refGeom, pitch).reduce((s, m) => s + m.nu * m.nv, 0)
  }, [refGeom, pitch])

  if (!refGeom) return null

  const generate = () => {
    setBusy('gen')
    setGenNote(null)
    setTimeout(() => {
      try {
        const { csv, points } = buildRecipeCsv(refGeom, stage, pitch)
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `pointmap_recipe_${design.design_id.replace(/[^\w.-]+/g, '_')}_${stage}_${pitch}mm.csv`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        setGenNote(`${fmtInt(points)} probe points · ${(csv.length / 1e6).toFixed(1)} MB · ${STAGE_META[stage].label.toLowerCase()} frame${noBase ? ' · no base' : ''}`)
      } catch (e) {
        setError(String((e as Error).message ?? e))
      } finally {
        setBusy(null)
      }
    }, 30)
  }

  const acceptFile = (f: File) => {
    setBusy('cmp')
    setError(null)
    setResult(null)
    void f.text().then((text) => {
      // deferred so the busy label paints before the compare blocks the thread
      setTimeout(() => {
        try {
          setResult({ name: f.name, r: comparePointMap(text, refGeom, stage, pitch) })
        } catch (e) {
          setError(String((e as Error).message ?? e))
        } finally {
          setBusy(null)
        }
      }, 30)
    })
  }

  const r = result?.r
  const sentence = r
    ? r.verdict === 'PASS'
      ? `nTop's implicit body and the app's field put every wall in the same place: ${fmtInt(r.crossings)} wall crossings compared, 95 % within ±${um(r.dev.p95, 1)} µm, sign agreement ${(r.signAgree * 100).toFixed(2)} % — the implicit MATH of the rebuild is confirmed, with no mesh in the loop.`
      : r.verdict === 'MARGINAL'
        ? `the fields mostly agree (p95 ${um(r.dev.p95, 1)} µm over ${fmtInt(r.crossings)} crossings) but not perfectly — ${fmtInt(r.unmatchedOurs + r.unmatchedTheirs)} walls matched only one side, sign agreement ${(r.signAgree * 100).toFixed(2)} %. Check the worst spot before trusting the rebuild.`
        : `the implicit bodies disagree: ${fmtInt(r.unmatchedOurs)} walls exist only in the design and ${fmtInt(r.unmatchedTheirs)} only in the nTop body; matched walls sit up to ${um(r.dev.max)} µm apart (p95 ${um(r.dev.p95, 1)} µm). A wrong parameter in the nTop rebuild (cell, wall, wave phase) looks exactly like this.`
    : null

  return (
    <details className="v-card pm" open={result != null || busy != null}>
      <summary>
        Point-map field check <span className="muted">— mesh-free, verifies the implicit math itself (V4.4)</span>
        {r && <> <VerdictChip v={r.verdict} /></>}
      </summary>
      <p className="v-plain">
        The strongest confirmation of an nTop rebuild — and the only one with <b>no meshing
        tolerance in the loop</b>. The app writes a grid of probe points on three section planes;
        nTop's own kernel evaluates its implicit body at them; the app then compares where each
        field crosses zero. Only the zero level set is compared — raw field values from two
        implicit representations are incomparable by construction.
      </p>
      <ol className="v-checks">
        <li><b>Generate</b> the recipe below and import it in nTop (Import Point Map from CSV).</li>
        <li><b>Sample</b> your implicit body at the points (Evaluate Field / Sample Field at Point Map).</li>
        <li><b>Export</b> the sampled map as CSV — it must carry the field value as a 4th column — and drop it back here.</li>
      </ol>
      <p className="v-plain muted">
        Generate and compare with the <b>same candidate, stage and settings</b> selected — the grid
        is derived from them. Current: {design.design_id} · {STAGE_META[stage].label.toLowerCase()}{noBase ? ' · no base slab' : ''}.
        Negative-inside sign convention is auto-detected, so either convention works.
      </p>

      <div className="v-knobs">
        <label>grid pitch
          <select value={pitch} onChange={(e) => { setPitch(Number(e.target.value)); setResult(null) }}>
            <option value={0.1}>0.1 mm (fast)</option>
            <option value={0.05}>0.05 mm (default)</option>
            <option value={0.025}>0.025 mm (fine)</option>
          </select>
          <Info what="Spacing of the probe grid on the three section planes."
            how="Crossing positions are interpolated from the field values, so accuracy is far better than the pitch — the pitch mainly sets how small a feature can be caught at all."
            bound={`0.05 mm resolves every DfAM-relevant feature (min fin 0.105 mm); ${planeCount != null ? `current grid = ${fmtInt(planeCount)} points` : ''}.`}
            action="Use 0.025 mm only if you are chasing a specific sub-50 µm question — files get 4× bigger." />
        </label>
        <button className="v-rescore" onClick={generate} disabled={busy != null}>
          {busy === 'gen' ? 'writing…' : '⬇ generate sampling recipe (CSV)'}
        </button>
        {genNote && <span className="muted">{genNote}</span>}
      </div>

      <div
        className={`v-drop pm-drop ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) acceptFile(f) }}
      >
        {busy === 'cmp'
          ? <span>comparing fields…</span>
          : <>
              <button className="v-small" onClick={() => fileRef.current?.click()}>choose sampled CSV…</button>
              <span className="muted"> or drop nTop's exported point map here</span>
            </>}
        <input ref={fileRef} type="file" accept=".csv,.txt" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f) }} />
      </div>

      {error && <div className="v-error"><b>Could not compare:</b> {error}</div>}

      {r && sentence && (
        <div className="v-results">
          <div className={`v-banner ${r.verdict.toLowerCase()}`}>
            <VerdictChip v={r.verdict} />
            <span>{sentence}</span>
          </div>
          <Histogram d={r.dev} meshTol={0} />
          <div className="v-gates">
            <span>
              {result!.name} · {fmtInt(r.assigned)} of {fmtInt(r.points)} points on the grid
              {r.flipped && ' · sign convention auto-flipped (their positive = inside — handled)'}
              <Info
                what="Wall-position agreement between the two implicit fields, measured at every zero crossing along the sampling lines of three section planes."
                how="Both fields' zero crossings are located by linear interpolation of the sampled values — sub-pitch accuracy with zero meshing noise. + means nTop's surface sits OUTSIDE the app's."
                bound={`Same gates as the mesh check: p95 ≤ ${um(GATE_PASS_P95)} µm and max ≤ ${um(GATE_PASS_MAX)} µm (½ / 1 printer pixel); unmatched walls or sign disagreement force MARGINAL/FAIL regardless.`}
                action="FAIL with many unmatched walls = a structural rebuild difference (cell count, wave phase, missing rib). FAIL with clean matching but a shifted histogram = a parameter offset (wall thickness, fin t/b)." />
            </span>
            <span className="mono">
              crossings {fmtInt(r.crossings)} · unmatched design-only {fmtInt(r.unmatchedOurs)} / nTop-only {fmtInt(r.unmatchedTheirs)} ·
              sign agree {(r.signAgree * 100).toFixed(2)} % ·
              p50 {um(r.dev.p50, 1)} · p95 {um(r.dev.p95, 1)} · max {um(r.dev.max)} µm
              {Math.abs(r.dev.worst.d) > 0 && ` · worst at (${fmt(r.dev.worst.x, 1)}, ${fmt(r.dev.worst.y, 1)}, ${fmt(r.dev.worst.z, 1)})`}
            </span>
          </div>
        </div>
      )}
    </details>
  )
}
