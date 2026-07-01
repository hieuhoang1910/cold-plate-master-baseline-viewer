import { useEffect, useMemo, useState } from 'react'
import { evaluate, getCatalog } from './api'
import { milliKW } from './format'
import { evalPayload, initDesign, isViewable } from './design'
import type { BaselineResult, Catalog, DesignState } from './types'
import { CandidateTable } from './components/CandidateTable'
import { KpiPanel } from './components/KpiPanel'
import { ViewerPlaceholder } from './components/ViewerPlaceholder'
import { SdfViewer } from './components/SdfViewer'
import { DesignControls } from './components/DesignControls'
import { OptimizerPanel } from './components/OptimizerPanel'
import { About } from './components/About'
import { geomFromCase } from './viewerGeom'

const HERO_ID = 'v6_reference_wavy_fin_0p10'

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(HERO_ID)

  // Live editable design (fin families only) + its recomputed result.
  const [design, setDesign] = useState<DesignState | null>(null)
  const [live, setLive] = useState<BaselineResult | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [bottomTab, setBottomTab] = useState<'compare' | 'optimize'>('compare')
  const [showAbout, setShowAbout] = useState(false)

  useEffect(() => {
    getCatalog()
      .then((c) => {
        setCatalog(c)
        if (!c.candidates.some((x) => x.design_id === HERO_ID)) {
          setSelectedId(c.candidates[0]?.design_id ?? '')
        }
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const selected = useMemo(
    () => catalog?.candidates.find((c) => c.design_id === selectedId) ?? null,
    [catalog, selectedId],
  )

  // Seed the editable design when the selected candidate changes (fin families).
  useEffect(() => {
    if (!catalog) return
    const c = catalog.cases.find((x) => x.design_id === selectedId)
    if (c && isViewable(c.family)) {
      setDesign(initDesign(c, catalog.basis))
    } else {
      setDesign(null)
    }
    setLive(null)
  }, [catalog, selectedId])

  // Debounced live recompute as the design changes.
  useEffect(() => {
    if (!design || !catalog) return
    const h = setTimeout(() => {
      setEvaluating(true)
      evaluate(evalPayload(design, catalog.basis))
        .then(setLive)
        .catch(() => {})
        .finally(() => setEvaluating(false))
    }, 150)
    return () => clearTimeout(h)
  }, [design, catalog])

  const geom = useMemo(
    () => (design && catalog ? geomFromCase(design, catalog.basis) : null),
    [design, catalog],
  )

  const patchDesign = (p: Partial<DesignState>) =>
    setDesign((d) => (d ? { ...d, ...p } : d))
  const resetDesign = () => {
    if (!catalog) return
    const c = catalog.cases.find((x) => x.design_id === selectedId)
    if (c && isViewable(c.family)) setDesign(initDesign(c, catalog.basis))
  }

  // KPI panel + viewer follow the live design when editing a fin family.
  const kpiResult = design ? (live ?? selected) : selected

  return (
    <div className="app">
      <header>
        <h1>Cold Plate — Master Baseline Viewer</h1>
        <span className="sub">internal engineering review · live from the validated solvers</span>
        <span className="spacer" />
        {error
          ? <span className="api-bad">API error: {error}</span>
          : catalog
            ? <span className="api-ok">● Solver connected · {catalog.candidates.length} candidates</span>
            : <span className="sub">connecting…</span>}
        <button className="about-btn" onClick={() => setShowAbout(true)}>About</button>
      </header>

      {showAbout && <About onClose={() => setShowAbout(false)} />}

      {!catalog && !error && <div className="center-msg">Loading catalog…</div>}

      {error && (
        <div className="center-msg">
          <div>
            <p className="error">Could not reach the API: {error}</p>
            <p className="muted">Start it with <code>python server.py</code> (it listens on :8000; Vite proxies /api).</p>
          </div>
        </div>
      )}

      {catalog && (
        <>
          <div className="main">
            {/* LEFT: candidate selector + live design sliders */}
            <div className="col">
              <div className="card">
                <h2>Candidates</h2>
                {catalog.candidates.map((c) => {
                  const pass = c.R_jc_K_W <= catalog.gates.limit_R_jc_K_W
                  return (
                    <div key={c.design_id}
                      className={`cand-item ${c.design_id === selectedId ? 'sel' : ''}`}
                      onClick={() => setSelectedId(c.design_id)}>
                      <div className="name">{c.design_id}</div>
                      <div className="meta">
                        <span>{c.family}</span><span>·</span><span>{c.process_route}</span>
                      </div>
                      <div className="rjc">
                        R_jc <b style={{ color: pass ? 'var(--accent2)' : 'var(--fail)' }}>{milliKW(c.R_jc_K_W)}</b>
                        <span className="muted"> mK/W</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {design
                ? <DesignControls design={design} basis={catalog.basis} evaluating={evaluating}
                    onPatch={patchDesign} onReset={resetDesign} />
                : <div className="card muted" style={{ fontSize: 12 }}>
                    Live tuning covers wavy / straight fin and gyroid designs.
                  </div>}
            </div>

            {/* CENTER: implicit-body viewer (fins) or placeholder (gyroid/pin) */}
            <div className="center col">
              {geom && design
                ? <SdfViewer g={geom} designId={design.design_id} family={design.family} />
                : <ViewerPlaceholder r={selected} />}
            </div>

            {/* RIGHT: KPI panel (follows the live design when tuning) */}
            <div className="col">
              {kpiResult
                ? <KpiPanel r={kpiResult} gates={catalog.gates} />
                : <div className="card muted">Select a candidate.</div>}
            </div>
          </div>

          {/* BOTTOM: comparison table / optimizer */}
          <div className="bottom">
            <div className="tabs">
              <button className={bottomTab === 'compare' ? 'sel' : ''} onClick={() => setBottomTab('compare')}>Comparison</button>
              <button className={bottomTab === 'optimize' ? 'sel' : ''} onClick={() => setBottomTab('optimize')}>Optimizer</button>
            </div>
            {bottomTab === 'compare'
              ? <CandidateTable candidates={catalog.candidates} selectedId={selectedId} onSelect={setSelectedId} />
              : <OptimizerPanel design={design} basis={catalog.basis} candidates={catalog.candidates}
                  current={kpiResult} onLoadOptimum={patchDesign} />}
          </div>
        </>
      )}
    </div>
  )
}
