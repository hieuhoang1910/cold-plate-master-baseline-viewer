import { useEffect, useMemo, useState } from 'react'
import { evaluate, getProject, getProjects, getSchema, projectCatalog, saveProject, deleteProject } from './api'
import { milliKW } from './format'
import { evalPayload, initDesign, isViewable, type ProblemOpts } from './design'
import type { AppSchema, BaselineResult, Catalog, DesignState, Project, ProjectSummary, SavedDesign } from './types'
import { CandidateTable } from './components/CandidateTable'
import { KpiPanel } from './components/KpiPanel'
import { ViewerPlaceholder } from './components/ViewerPlaceholder'
import { SdfViewer } from './components/SdfViewer'
import { DesignControls } from './components/DesignControls'
import { ProblemControls } from './components/ProblemControls'
import { DesignStudio } from './components/DesignStudio'
import { OptimizerPanel } from './components/OptimizerPanel'
import { About } from './components/About'
import { Report } from './components/Report'
import { geomFromCase } from './viewerGeom'

const HERO_ID = 'v6_reference_wavy_fin_0p10'
const DEFAULT_PROJECT_ID = 'gb202-gpu'

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [schema, setSchema] = useState<AppSchema | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(HERO_ID)

  // V2.2 — the active project scopes the whole app (basis, gates, coolant).
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [dirty, setDirty] = useState(false)
  const [showStudio, setShowStudio] = useState(false)

  // Live editable design (fin/gyroid families) + its recomputed result.
  const [design, setDesign] = useState<DesignState | null>(null)
  const [live, setLive] = useState<BaselineResult | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [bottomTab, setBottomTab] = useState<'compare' | 'optimize'>('compare')
  const [showAbout, setShowAbout] = useState(false)
  const [showReport, setShowReport] = useState(false)

  // Boot: schema + project list + the default project.
  useEffect(() => {
    getSchema().then(setSchema).catch(() => { /* optional */ })
    getProjects().then((r) => setProjects(r.projects)).catch(() => { /* optional */ })
    getProject(DEFAULT_PROJECT_ID)
      .then((p) => { setActiveProject(p); setDirty(false) })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  // Whenever the active project changes, re-resolve the catalog (candidates
  // rescored against its coolant + gate). Debounced so live knob-twiddling in
  // ProblemControls doesn't spam the API.
  useEffect(() => {
    if (!activeProject) return
    const h = setTimeout(() => {
      projectCatalog(activeProject)
        .then((cat) => {
          setCatalog(cat)
          setSelectedId((prev) =>
            cat.candidates.some((c) => c.design_id === prev)
              ? prev
              : (cat.candidates.find((c) => c.design_id === HERO_ID)?.design_id
                 ?? cat.candidates[0]?.design_id ?? ''))
        })
        .catch((e) => setError(String(e.message ?? e)))
    }, 150)
    return () => clearTimeout(h)
  }, [activeProject])

  const selected = useMemo(
    () => catalog?.candidates.find((c) => c.design_id === selectedId) ?? null,
    [catalog, selectedId],
  )

  // Seed the editable design when the selected candidate changes.
  useEffect(() => {
    if (!catalog) return
    const c = catalog.cases.find((x) => x.design_id === selectedId)
    setDesign(c && isViewable(c.family) ? initDesign(c, catalog.basis) : null)
    setLive(null)
  }, [catalog, selectedId])

  // The problem knobs the live design inherits from the active project.
  const liveOpts = useMemo((): ProblemOpts => {
    const p = activeProject
    if (!p) return {}
    const t = p.targets ?? {}
    const opts: ProblemOpts = {
      coolant: p.problem?.coolant,
      limitDeltaPPa: t.limit_deltaP_Pa,
      limitPumpW: t.limit_pump_W,
    }
    if (t.R_jc_gate_override != null) opts.rjcGateOverride = t.R_jc_gate_override
    else if (t.T_j_max_C != null) opts.tjMaxC = t.T_j_max_C
    return opts
  }, [activeProject])

  // Debounced live recompute as the design / project change.
  useEffect(() => {
    if (!design || !catalog) return
    const h = setTimeout(() => {
      setEvaluating(true)
      evaluate({ ...evalPayload(design, catalog.basis, liveOpts), uncertainty: true })
        .then(setLive)
        .catch(() => {})
        .finally(() => setEvaluating(false))
    }, 150)
    return () => clearTimeout(h)
  }, [design, catalog, liveOpts])

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

  // --- Project actions -----------------------------------------------------
  const patchProject = (upd: (p: Project) => Project) =>
    setActiveProject((p) => (p ? upd(p) : p))
  const setCoolant = (c: string) => { patchProject((p) => ({ ...p, problem: { ...p.problem, coolant: c } })); setDirty(true) }
  // Editing the target activates gate derivation (drops any pinned override).
  const setTjMax = (v: number) => { patchProject((p) => ({ ...p, targets: { ...p.targets, T_j_max_C: v, R_jc_gate_override: null } })); setDirty(true) }

  const loadProject = (id: string) => {
    getProject(id).then((p) => { setActiveProject(p); setDirty(false); setShowStudio(false) })
      .catch((e) => setError(String(e.message ?? e)))
  }
  const applyProjectDraft = (p: Project) => { setActiveProject(p); setDirty(true); setShowStudio(false) }
  const saveProjectDraft = async (p: Project) => {
    const { project: stored } = await saveProject(p)
    const r = await getProjects(); setProjects(r.projects)
    setActiveProject(stored); setDirty(false); setShowStudio(false)
  }
  const removeProject = (id: string) => {
    deleteProject(id).then(async () => {
      const r = await getProjects(); setProjects(r.projects)
      loadProject(DEFAULT_PROJECT_ID)
    }).catch((e) => setError(String(e.message ?? e)))
  }

  // --- Designs as candidates (V2.2) ---------------------------------------
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design'

  // Persist the current live design as a named candidate on the active project.
  // Built-in projects can't be written, so the first save forks a "(custom)" copy.
  const saveAsCandidate = async () => {
    if (!design || !activeProject) return
    const name = window.prompt('Name this design (it becomes a candidate):', design.design_id)?.trim()
    if (!name) return
    let proj = activeProject
    if (proj.builtin) proj = { ...proj, id: undefined, name: `${proj.name} (custom)`, builtin: false }
    const designs = [...(proj.designs ?? []).filter((d) => d.name !== name), { name, design }]
    try {
      await saveProjectDraft({ ...proj, designs })
      setSelectedId('saved_' + slug(name))
    } catch (e) { setError(String((e as Error).message ?? e)) }
  }

  const removeSavedDesign = async (name: string) => {
    if (!activeProject) return
    const designs = (activeProject.designs ?? []).filter((d) => d.name !== name)
    try { await saveProjectDraft({ ...activeProject, designs }) }
    catch (e) { setError(String((e as Error).message ?? e)) }
  }

  // Add a batch of designs (e.g. the optimizer's top-N sweep points) as named
  // candidates on the active project; re-adding replaces same-named entries.
  const addCandidates = async (entries: SavedDesign[]) => {
    if (!activeProject || entries.length === 0) return
    let proj = activeProject
    if (proj.builtin) proj = { ...proj, id: undefined, name: `${proj.name} (custom)`, builtin: false }
    const incoming = new Set(entries.map((e) => e.name))
    const designs = [...(proj.designs ?? []).filter((d) => !incoming.has(d.name)), ...entries]
    try {
      await saveProjectDraft({ ...proj, designs })
      setSelectedId('saved_' + slug(entries[0].name))
    } catch (e) { setError(String((e as Error).message ?? e)) }
  }

  const coolant = activeProject?.problem?.coolant ?? 'water'
  const tjMaxC = activeProject?.targets?.T_j_max_C ?? 100

  // KPI panel + viewer follow the live design when editing.
  const kpiResult = design ? (live ?? selected) : selected

  return (
    <div className="app">
      <header>
        <h1>Cold Plate — Master Baseline Viewer</h1>
        <span className="sub">internal engineering review · live from the validated solvers</span>
        <span className="spacer" />
        {activeProject && (
          <button className="proj-chip" onClick={() => setShowStudio(true)}
            title="Open the Design Studio to edit or switch the problem">
            ◆ {activeProject.name}{activeProject.builtin ? '' : ''}{dirty ? ' *' : ''}
          </button>
        )}
        {error
          ? <span className="api-bad">API error: {error}</span>
          : catalog
            ? <span className="api-ok">● {catalog.candidates.length} candidates</span>
            : <span className="sub">connecting…</span>}
        {catalog && <button className="about-btn" onClick={() => setShowReport(true)}>Report</button>}
        <button className="about-btn" onClick={() => setShowAbout(true)}>About</button>
      </header>

      {showAbout && <About onClose={() => setShowAbout(false)} />}
      {showReport && catalog && (
        <Report project={activeProject} catalog={catalog} live={design ? live : selected}
          design={design} onClose={() => setShowReport(false)} />
      )}
      {showStudio && schema && activeProject && (
        <DesignStudio schema={schema} current={activeProject} projects={projects}
          onApply={applyProjectDraft} onSave={saveProjectDraft}
          onLoad={loadProject} onDelete={removeProject} onClose={() => setShowStudio(false)} />
      )}

      {!catalog && !error && <div className="center-msg">Loading…</div>}

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
            {/* LEFT: candidate selector + problem knobs + live design sliders */}
            <div className="col">
              <div className="card">
                <h2>Candidates</h2>
                {catalog.candidates.map((c) => {
                  const pass = c.R_jc_K_W <= catalog.gates.limit_R_jc_K_W
                  return (
                    <div key={c.design_id}
                      className={`cand-item ${c.design_id === selectedId ? 'sel' : ''}`}
                      onClick={() => setSelectedId(c.design_id)}>
                      <div className="name">
                        {c.name ?? c.design_id}
                        {c.saved && (
                          <button className="cand-del" title="delete saved design"
                            onClick={(e) => { e.stopPropagation(); removeSavedDesign(c.name!) }}>×</button>
                        )}
                      </div>
                      <div className="meta">
                        {c.saved && <span className="cand-saved">saved</span>}
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

              {schema && (
                <ProblemControls schema={schema} coolant={coolant} tjMaxC={tjMaxC}
                  live={design ? live : null} onCoolant={setCoolant} onTjMax={setTjMax} />
              )}

              {design
                ? <DesignControls design={design} basis={catalog.basis} evaluating={evaluating}
                    onPatch={patchDesign} onReset={resetDesign} />
                : <div className="card muted" style={{ fontSize: 12 }}>
                    Live tuning covers wavy / straight fin and gyroid designs.
                  </div>}

              {design && (
                <button className="save-cand" onClick={saveAsCandidate}
                  title="Save the current tuned design as a named candidate (optimize first in the Optimizer tab, then load into the sliders)">
                  + Save current design as candidate
                </button>
              )}
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
                  current={kpiResult} onLoadOptimum={patchDesign} onAddCandidates={addCandidates} />}
          </div>
        </>
      )}
    </div>
  )
}
