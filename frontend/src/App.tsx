import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { evaluate, getProject, getProjects, getSchema, projectCatalog, saveProject, deleteProject } from './api'
import { evalPayload, initDesign, isViewable, type ProblemOpts } from './design'
import type { AppSchema, BaselineResult, Catalog, DesignState, Project, ProjectSummary, SavedDesign } from './types'
import { CandidateTable } from './components/CandidateTable'
import { KpiPanel } from './components/KpiPanel'
import { ViewerPlaceholder } from './components/ViewerPlaceholder'
import { SdfViewer } from './components/SdfViewer'
import { PixelPreview } from './components/PixelPreview'
import { DesignControls } from './components/DesignControls'
import { ProblemControls } from './components/ProblemControls'
import { DesignStudio } from './components/DesignStudio'
import { OptimizerPanel } from './components/OptimizerPanel'
import { About } from './components/About'
import { Report } from './components/Report'
import { Hero } from './components/Hero'
import { Cursor } from './components/Cursor'
import { VerifyTab } from './components/VerifyTab'
import { useVerify } from './verify/useVerify'
import { geomFromCase } from './viewerGeom'
import { flowVizFrom } from './flowviz'
import { FlowSchematic } from './components/FlowSchematic'
import { milliKW } from './format'
import { normalizeRoute, type Enforcement } from './manufacturing'

// V3.3: M1 is the primary manufacturing target (team decision 2026-07-09);
// the 0.10 hero stays in the list as a reference row.
const DEFAULT_ID = 'v6_lmm_M1_primary'
const HERO_ID = 'v6_reference_wavy_fin_0p10'
const DEFAULT_PROJECT_ID = 'gb202-gpu'

// V4 shell — one long page: hero (100vh) → scroll runway → pinned studio.
// The implicit-body viewer is a fixed full-bleed stage behind everything;
// scrolling dollies its camera from the far cinematic pose into the workspace.
const RUNWAY_VH = 2.2 // scroll distance (in viewport heights) of the intro

type ViewMode = '3d' | 'pixel' | 'verify'

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [schema, setSchema] = useState<AppSchema | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_ID)
  const [viewMode, setViewMode] = useState<ViewMode>('3d')
  const [pixelJump, setPixelJump] = useState<number | null>(null)

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

  // V4 — drawers (glass overlays over the stage) + scroll intro + verify
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(false)
  const verifyApi = useVerify()
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [introT, setIntroT] = useState(reduced ? 1 : 0)
  const introRef = useRef(introT)
  introRef.current = introT

  const runwayPx = useCallback(() => window.innerHeight * RUNWAY_VH, [])

  useEffect(() => {
    if (reduced) { setIntroT(1); return }
    let raf = 0
    const read = () => {
      const t = Math.min(1, Math.max(0, window.scrollY / runwayPx()))
      if (Math.abs(t - introRef.current) > 0.001 || (t === 1) !== (introRef.current === 1)) setIntroT(t)
      raf = 0
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    read()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [reduced, runwayPx])

  const enterStudio = useCallback(() => {
    window.scrollTo({ top: runwayPx() + 2, behavior: reduced ? 'auto' : 'smooth' })
  }, [reduced, runwayPx])
  const backToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }, [reduced])

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
              : (cat.candidates.find((c) => c.design_id === DEFAULT_ID)?.design_id
                 ?? cat.candidates.find((c) => c.design_id === HERO_ID)?.design_id
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

  // V5.2 — flow-intent layer: layout routing at the S6 network-solved speed.
  const flowViz = useMemo(
    () => (design && catalog
      ? flowVizFrom(design.family, catalog.basis, live, design.flow_lpm)
      : null),
    [design, catalog, live],
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
  // V3.3 §35F — enforcement mode lives on the project; default = allow-marginal
  // (M1 sits on the Incus floor while the cleanability coupon is pending).
  const mfgMode: Enforcement = activeProject?.manufacturing?.enforcement ?? 'marginal'

  // KPI panel + viewer follow the live design when editing.
  const kpiResult = design ? (live ?? selected) : selected

  const isLmm = design ? normalizeRoute(design.process_route) === 'LMM' : false
  const entered = introT >= 1

  // Verify tab's "open this layer in the pixel view" jump.
  const openPixelAt = (layer: number) => {
    setPixelJump(layer)
    setViewMode('pixel')
  }

  const setMode = (m: ViewMode) => {
    if (m !== 'pixel') setPixelJump(null)
    setViewMode(m)
  }

  return (
    <div className="shell">
      <Cursor />

      {/* fixed full-bleed stage behind everything; dimmed + HUD-less while a
          pane (pixel/verify) covers it, and its HUD/gizmo inset past the open
          drawers so nothing is trapped underneath the glass */}
      {/* class is "viewer-stage", NOT "stage" — the V2 KPI badges already use
          `badge stage`, and a bare .stage selector inflated them into giant
          accent discs (found live 2026-07-17) */}
      <div className={`viewer-stage ${entered && viewMode === '3d' ? 'live' : ''} ${entered && viewMode !== '3d' ? 'dim' : ''} ${leftOpen ? 'pad-l' : ''} ${rightOpen ? 'pad-r' : ''}`}
        data-cursor="drag">
        {geom && design
          ? <SdfViewer g={geom} designId={design.design_id} family={design.family} introT={introT}
              hud={viewMode === '3d'} gizmoMargin={[rightOpen ? 476 : 110, 116]} flow={flowViz} />
          : <div className="stage-empty">{catalog && <ViewerPlaceholder r={selected} />}</div>}
      </div>

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

      <div className="scroller">
        <Hero catalog={catalog} project={activeProject} error={error} t={introT}
          onSelect={setSelectedId} onEnter={enterStudio}
          onStudio={() => setShowStudio(true)} onAbout={() => setShowAbout(true)} />

        <div className="runway" style={{ height: `${(RUNWAY_VH - 1) * 100}vh` }} />

        {/* ------------------------- the studio ------------------------- */}
        <section className="workspace" style={{ opacity: Math.max(0, (introT - 0.55) / 0.45) }}>
          <div className="ws-top">
            <button className="ws-mark" onClick={backToTop} title="back to the landing view">COLD PLATE</button>
            {activeProject && (
              <button className="proj-chip" onClick={() => setShowStudio(true)}
                title="Open the Design Studio to edit or switch the problem">
                ◆ {activeProject.name}{dirty ? ' *' : ''}
              </button>
            )}
            <div className="ws-views">
              <button className={viewMode === '3d' ? 'sel' : ''} onClick={() => setMode('3d')}>3-D</button>
              <button className={viewMode === 'pixel' ? 'sel' : ''} onClick={() => setMode('pixel')}
                disabled={!isLmm}
                title={isLmm ? 'DLP layer preview — the design rasterized on the EVO35 pixel grid'
                  : 'pixel preview applies to the LMM (DLP) route only'}>
                ▦ Pixel
              </button>
              <button className={viewMode === 'verify' ? 'sel' : ''} onClick={() => setMode('verify')}
                disabled={!design}
                title="import an nTop STL and verify it against this design">
                ✓ Verify
                {verifyApi.session.status === 'done' && verifyApi.session.result && (
                  <span className={`ws-vdot ${verifyApi.session.result.deviation.verdict.toLowerCase()}`} />
                )}
              </button>
            </div>
            <span className="ws-spacer" />
            {error
              ? <span className="api-bad">API error: {error}</span>
              : catalog
                ? <span className="api-ok" title="candidates rescored live against the active project">
                    ● {catalog.candidates.length} candidates
                    {kpiResult && ` · R_jc ${milliKW(kpiResult.R_jc_K_W)} mK/W`}
                  </span>
                : <span className="muted">connecting…</span>}
            {catalog && <button className="about-btn" onClick={() => setShowReport(true)}>Report</button>}
            <button className="about-btn" onClick={() => setShowAbout(true)}>About</button>
          </div>

          {!catalog && !error && <div className="ws-center-msg">Loading…</div>}
          {error && !catalog && (
            <div className="ws-center-msg">
              <div>
                <p className="error">Could not reach the API: {error}</p>
                <p className="muted">Start it with <code>python server.py</code> (it listens on :8000; Vite proxies /api).</p>
              </div>
            </div>
          )}

          {catalog && (
            <>
              {/* LEFT drawer: candidates + problem + live design sliders */}
              <button className={`ws-tab ws-tab-left ${leftOpen ? 'open' : ''}`}
                onClick={() => setLeftOpen(!leftOpen)} title={leftOpen ? 'hide the design panel' : 'candidates + design sliders'}>
                {leftOpen ? '◂' : '▸ design'}
              </button>
              {leftOpen && (
                <div className="ws-left">
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
                        mode={mfgMode} mfg={live?.manufacturability ?? null}
                        onPatch={patchDesign} onReset={resetDesign} />
                    : <div className="card muted" style={{ fontSize: 14 }}>
                        Live tuning covers wavy / straight fin and gyroid designs.
                      </div>}

                  {flowViz && (
                    <FlowSchematic layout={flowViz.layout} nSeg={flowViz.nSeg}
                      coreWidth={catalog.basis.stack.core_width_mm}
                      coreLength={catalog.basis.stack.core_length_mm}
                      block={live?.flow_network ?? null} />
                  )}

                  {design && (
                    <button className="save-cand" onClick={saveAsCandidate}
                      title="Save the current tuned design as a named candidate (optimize first in the Optimizer tab, then load into the sliders)">
                      + Save current design as candidate
                    </button>
                  )}
                </div>
              )}

              {/* CENTER pane for pixel / verify (the 3-D lives on the stage) */}
              {viewMode !== '3d' && design && (
                <div className={`ws-pane ${leftOpen ? '' : 'wide-l'} ${rightOpen ? '' : 'wide-r'}`}>
                  {viewMode === 'pixel' && isLmm && (
                    <PixelPreview design={design} basis={catalog.basis}
                      verify={verifyApi} initialLayer={pixelJump} />
                  )}
                  {viewMode === 'verify' && (
                    <VerifyTab verify={verifyApi} design={design} basis={catalog.basis}
                      live={design ? live : selected} opts={liveOpts} onOpenPixel={openPixelAt} />
                  )}
                </div>
              )}

              {/* RIGHT drawer: KPI panel */}
              <button className={`ws-tab ws-tab-right ${rightOpen ? 'open' : ''}`}
                onClick={() => setRightOpen(!rightOpen)} title={rightOpen ? 'hide the KPI panel' : 'KPIs'}>
                {rightOpen ? '▸' : '◂ KPIs'}
              </button>
              {rightOpen && (
                <div className="ws-right">
                  {kpiResult
                    ? <KpiPanel r={kpiResult} gates={catalog.gates} />
                    : <div className="card muted">Select a candidate.</div>}
                </div>
              )}

              {/* BOTTOM drawer: comparison / optimizer */}
              <div className={`ws-bottom ${bottomOpen ? 'open' : ''}`}>
                <div className="ws-bottom-bar">
                  <button className={bottomOpen && bottomTab === 'compare' ? 'sel' : ''}
                    onClick={() => { setBottomTab('compare'); setBottomOpen(bottomTab !== 'compare' ? true : !bottomOpen) }}>
                    Comparison
                  </button>
                  <button className={bottomOpen && bottomTab === 'optimize' ? 'sel' : ''}
                    onClick={() => { setBottomTab('optimize'); setBottomOpen(bottomTab !== 'optimize' ? true : !bottomOpen) }}>
                    Optimizer
                  </button>
                  <span className="ws-spacer" />
                  <button className="ws-bottom-toggle" onClick={() => setBottomOpen(!bottomOpen)}>
                    {bottomOpen ? '▾ collapse' : '▴ expand'}
                  </button>
                </div>
                {bottomOpen && (
                  <div className="ws-bottom-body">
                    {bottomTab === 'compare'
                      ? <CandidateTable candidates={catalog.candidates} selectedId={selectedId} onSelect={setSelectedId} />
                      : <OptimizerPanel design={design} basis={catalog.basis} opts={liveOpts} mode={mfgMode}
                          candidates={catalog.candidates}
                          current={kpiResult} onLoadOptimum={patchDesign} onAddCandidates={addCandidates} />}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
