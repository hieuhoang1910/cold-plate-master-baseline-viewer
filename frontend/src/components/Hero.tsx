import { milliKW } from '../format'
import type { Catalog, Project } from '../types'

// V4 — the landing hero: big type over the live implicit body, project status,
// candidate strip, and the scroll invitation. Scrolling (or "enter") dollies
// the camera from this far cinematic view into the working studio.

export function Hero({
  catalog, project, error, t, onSelect, onEnter, onStudio, onAbout,
}: {
  catalog: Catalog | null
  project: Project | null
  error: string | null
  /** scroll progress 0..1 — used to fade/translate the hero content out */
  t: number
  onSelect: (id: string) => void
  onEnter: () => void
  onStudio: () => void
  onAbout: () => void
}) {
  const fade = Math.max(0, 1 - t * 1.6)
  const rise = t * -12 // vh
  const gate = catalog?.gates.limit_R_jc_K_W

  return (
    <section className="hero">
      <div className="hero-nav">
        <span className="hero-mark">VINNOTEK<em className="hero-byline">· Hieu Hoang</em></span>
        <span className="hero-navlinks">
          <button onClick={onStudio}>design studio</button>
          <button onClick={onEnter}>viewer</button>
          <button onClick={onAbout}>about</button>
        </span>
      </div>

      <div className="hero-body" style={{ opacity: fade, transform: `translateY(${rise}vh)` }}>
        <h1 className="hero-title">COLD<br />PLATE</h1>
        <p className="hero-sub">
          implicit-body design studio — live geometry, validated physics,
          manufacturability & print verification for the {project?.name ?? 'GB202'} cold plate
        </p>

        <div className="hero-status">
          {error
            ? <span className="hs-chip bad">solver offline — start <code>python server.py</code></span>
            : catalog
              ? <>
                  <span className="hs-chip ok">● solvers live</span>
                  {gate != null && <span className="hs-chip">gate R_jc ≤ {milliKW(gate)} mK/W</span>}
                  <span className="hs-chip">{catalog.candidates.length} candidates</span>
                  {project && <span className="hs-chip">◆ {project.name}</span>}
                </>
              : <span className="hs-chip">connecting…</span>}
        </div>

        {catalog && (
          <div className="hero-cands">
            {catalog.candidates.slice(0, 8).map((c) => {
              const pass = c.R_jc_K_W <= (gate ?? Infinity)
              return (
                <button key={c.design_id} className="hero-cand"
                  onClick={() => { onSelect(c.design_id); onEnter() }}>
                  <span className="hc-name">{c.name ?? c.design_id}</span>
                  <span className="hc-meta">{c.family.replace('_', ' ')}</span>
                  <span className="hc-rjc" style={{ color: pass ? 'var(--pass)' : 'var(--fail)' }}>
                    {milliKW(c.R_jc_K_W)} <em>mK/W</em>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button className="hero-scrollhint" style={{ opacity: fade }} onClick={onEnter}>
        <span className="hsh-line" />
        scroll to enter the studio
      </button>
    </section>
  )
}
