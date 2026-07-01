import { useEffect, useMemo, useState } from 'react'
import { getCatalog } from './api'
import { milliKW } from './format'
import type { Catalog } from './types'
import { CandidateTable } from './components/CandidateTable'
import { KpiPanel } from './components/KpiPanel'
import { ViewerPlaceholder } from './components/ViewerPlaceholder'
import { SdfViewer } from './components/SdfViewer'
import { geomFromCase } from './viewerGeom'

const HERO_ID = 'v6_reference_wavy_fin_0p10'

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(HERO_ID)

  useEffect(() => {
    getCatalog()
      .then((c) => {
        setCatalog(c)
        // Fall back to the first candidate if the hero id is absent.
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

  const geom = useMemo(() => {
    if (!catalog) return null
    const c = catalog.cases.find((x) => x.design_id === selectedId)
    return c ? geomFromCase(c, catalog.basis) : null
  }, [catalog, selectedId])

  return (
    <div className="app">
      <header>
        <h1>Cold Plate — Master Baseline Viewer</h1>
        <span className="sub">internal engineering review · live from the validated solvers</span>
        <span className="spacer" />
        {error
          ? <span className="api-bad">API error: {error}</span>
          : catalog
            ? <span className="api-ok">● API connected · {catalog.candidates.length} candidates</span>
            : <span className="sub">connecting…</span>}
      </header>

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
            {/* LEFT: candidate selector */}
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
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Sliders to tune geometry arrive in Phase 4.
                </div>
              </div>
            </div>

            {/* CENTER: implicit-body viewer (fins) or placeholder (gyroid/pin) */}
            <div className="center col">
              {geom && selected
                ? <SdfViewer g={geom} designId={selected.design_id} family={selected.family} />
                : <ViewerPlaceholder r={selected} />}
            </div>

            {/* RIGHT: KPI panel */}
            <div className="col">
              {selected
                ? <KpiPanel r={selected} gates={catalog.gates} />
                : <div className="card muted">Select a candidate.</div>}
            </div>
          </div>

          {/* BOTTOM: comparison table */}
          <div className="bottom">
            <CandidateTable
              candidates={catalog.candidates}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </>
      )}
    </div>
  )
}
