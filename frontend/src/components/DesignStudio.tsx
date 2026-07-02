import { useMemo, useState } from 'react'
import { fmt, milliKW } from '../format'
import type { AppSchema, Project, ProjectSummary } from '../types'

// A blank problem template for "New project".
const BLANK: Project = {
  name: 'New project',
  problem: {
    die_width_mm: 24, die_length_mm: 31,
    core_width_mm: 35, core_length_mm: 28, core_height_mm: 5.5,
    base_thickness_mm: 0.7, k_solid_W_mK: 340, tim_areal_Kcm2_W: 0.05,
    coolant: 'water',
  },
  operating: { heat_load_W: 450, margin_heat_load_W: 575, flow_lpm: 2.65, T_inlet_C: 25 },
  targets: { T_j_max_C: 100, R_jc_gate_override: null, limit_deltaP_Pa: 50000, limit_pump_W: 5 },
  architecture: { name: 'center_feed_bidirectional', n_parallel_paths: 2, path_length_mm: 14, header_K_total: 1.5, flow_uniformity: 1 },
  families: ['wavy_fin', 'straight_fin', 'gyroid_tpms', 'pin_fin'],
}

function Num({ label, value, onChange, step = 1, unit }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string
}) {
  return (
    <label className="ds2-num">
      <span>{label}</span>
      <input type="number" value={value} step={step}
        onChange={(e) => onChange(Number(e.target.value))} />
      {unit && <em>{unit}</em>}
    </label>
  )
}

export function DesignStudio({
  schema, current, projects, onApply, onSave, onLoad, onDelete, onClose,
}: {
  schema: AppSchema
  current: Project
  projects: ProjectSummary[]
  onApply: (p: Project) => void
  onSave: (p: Project) => Promise<void>
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Project>(() => structuredClone(current))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const P = draft.problem, O = draft.operating, T = draft.targets, A = draft.architecture
  const patchP = (p: Partial<Project['problem']>) => setDraft((d) => ({ ...d, problem: { ...d.problem, ...p } }))
  const patchO = (p: Partial<Project['operating']>) => setDraft((d) => ({ ...d, operating: { ...d.operating, ...p } }))
  const patchT = (p: Partial<Project['targets']>) => setDraft((d) => ({ ...d, targets: { ...d.targets, ...p } }))
  const patchA = (p: Partial<Project['architecture']>) => setDraft((d) => ({ ...d, architecture: { ...d.architecture, ...p } }))

  // Live (approximate) preview of the derived gate + coverage — the server
  // recomputes the exact value on Apply/Save (fluid props at the true inlet T).
  const preview = useMemo(() => {
    const cool = schema.coolants.find((c) => c.name === P.coolant) ?? schema.coolants[0]
    const rho = cool?.preview_25C.rho_kg_m3 ?? 997
    const cp = cool?.preview_25C.cp_J_kgK ?? 4181
    const mcp = (O.flow_lpm / 60000) * rho * cp
    const caloric = mcp > 0 ? O.heat_load_W / mcp : Infinity
    const override = T.R_jc_gate_override
    const gate = override != null && override > 0
      ? override
      : ((T.T_j_max_C ?? 100) - O.T_inlet_C - caloric / 2) / O.heat_load_W
    const coverage = (P.die_width_mm * P.die_length_mm) > 0
      ? (P.core_width_mm * P.core_length_mm) / (P.die_width_mm * P.die_length_mm) : 0
    return { gate, caloric, coverage, override: override != null && override > 0 }
  }, [schema, P, O, T])

  const toggleFamily = (fam: string) => setDraft((d) => {
    const set = new Set(d.families ?? [])
    set.has(fam) ? set.delete(fam) : set.add(fam)
    return { ...d, families: [...set] }
  })

  const doSave = async () => {
    setSaving(true); setErr(null)
    try { await onSave(draft) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const coverageBad = preview.coverage < 1

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card ds2" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <h2>Design Studio — define your problem</h2>
          <button className="about-close" onClick={onClose}>✕</button>
        </div>

        <div className="ds2-body">
          {/* Project picker */}
          <div className="ds2-picker">
            <label className="ds2-num" style={{ flex: 1 }}>
              <span>Load project</span>
              <select value={current.id ?? ''} onChange={(e) => e.target.value && onLoad(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.builtin ? ' (built-in)' : ''}</option>
                ))}
              </select>
            </label>
            <button className="vo-reset" onClick={() => setDraft(structuredClone({ ...BLANK }))}>+ New</button>
            {current.id && !current.builtin && (
              <button className="vo-reset" onClick={() => onDelete(current.id!)}>Delete</button>
            )}
          </div>

          <label className="ds2-name">
            <span>Project name</span>
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>

          <div className="ds2-cols">
            {/* Step 1 — Targets */}
            <section>
              <h3>1 · Targets</h3>
              <Num label="Max junction Tj" value={T.T_j_max_C ?? 100} step={1} unit="°C"
                onChange={(v) => patchT({ T_j_max_C: v })} />
              <Num label="Heat load (nominal)" value={O.heat_load_W} step={5} unit="W"
                onChange={(v) => patchO({ heat_load_W: v })} />
              <Num label="Heat load (margin)" value={O.margin_heat_load_W ?? 575} step={5} unit="W"
                onChange={(v) => patchO({ margin_heat_load_W: v })} />
              <Num label="Inlet temp" value={O.T_inlet_C} step={1} unit="°C"
                onChange={(v) => patchO({ T_inlet_C: v })} />
              <Num label="Flow rate" value={O.flow_lpm} step={0.05} unit="L/min"
                onChange={(v) => patchO({ flow_lpm: v })} />
              <Num label="Max ΔP" value={T.limit_deltaP_Pa ?? 50000} step={1000} unit="Pa"
                onChange={(v) => patchT({ limit_deltaP_Pa: v })} />
              <Num label="Max pump" value={T.limit_pump_W ?? 5} step={0.5} unit="W"
                onChange={(v) => patchT({ limit_pump_W: v })} />
            </section>

            {/* Step 2 — Problem definition */}
            <section>
              <h3>2 · Problem</h3>
              <label className="ds2-num">
                <span>Coolant</span>
                <select value={P.coolant} onChange={(e) => patchP({ coolant: e.target.value })}>
                  {schema.coolants.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </label>
              <Num label="Die width" value={P.die_width_mm} step={0.5} unit="mm"
                onChange={(v) => patchP({ die_width_mm: v })} />
              <Num label="Die length" value={P.die_length_mm} step={0.5} unit="mm"
                onChange={(v) => patchP({ die_length_mm: v })} />
              <Num label="Core width" value={P.core_width_mm} step={0.5} unit="mm"
                onChange={(v) => patchP({ core_width_mm: v })} />
              <Num label="Core length" value={P.core_length_mm} step={0.5} unit="mm"
                onChange={(v) => patchP({ core_length_mm: v })} />
              <Num label="Core height" value={P.core_height_mm} step={0.1} unit="mm"
                onChange={(v) => patchP({ core_height_mm: v })} />
              <Num label="Base thickness" value={P.base_thickness_mm} step={0.05} unit="mm"
                onChange={(v) => patchP({ base_thickness_mm: v })} />
              <Num label="Solid k" value={P.k_solid_W_mK} step={10} unit="W/mK"
                onChange={(v) => patchP({ k_solid_W_mK: v })} />
              <Num label="TIM areal R" value={P.tim_areal_Kcm2_W} step={0.01} unit="K·cm²/W"
                onChange={(v) => patchP({ tim_areal_Kcm2_W: v })} />
            </section>

            {/* Step 3 — Families + Step 4 — Layout */}
            <section>
              <h3>3 · Families</h3>
              <div className="ds2-fams">
                {schema.families.map((f) => (
                  <label key={f.family} className="ds2-check" title={`${f.model} · ${f.status}`}>
                    <input type="checkbox" checked={(draft.families ?? []).includes(f.family)}
                      onChange={() => toggleFamily(f.family)} />
                    <span>{f.label}</span>
                    {f.status !== 'ANALYTICAL' && <em className="ds2-tag">{f.status.replace('_', ' ').toLowerCase()}</em>}
                  </label>
                ))}
              </div>

              <h3 style={{ marginTop: 14 }}>4 · Layout</h3>
              <label className="ds2-num">
                <span>Architecture</span>
                <select value={A.name ?? ''} onChange={(e) => patchA({ name: e.target.value })}>
                  {schema.layouts.map((l) => (
                    <option key={l.layout} value={l.layout}
                      disabled={l.status !== 'SUPPORTED'}>
                      {l.label}{l.status !== 'SUPPORTED' ? ` (${l.status.replace(/_/g, ' ').toLowerCase()})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <Num label="Parallel paths" value={A.n_parallel_paths ?? 2} step={1}
                onChange={(v) => patchA({ n_parallel_paths: v })} />
              <Num label="Path length" value={A.path_length_mm ?? 14} step={0.5} unit="mm"
                onChange={(v) => patchA({ path_length_mm: v })} />
              <Num label="Header K" value={A.header_K_total ?? 1.5} step={0.1}
                onChange={(v) => patchA({ header_K_total: v })} />
            </section>
          </div>

          {/* Live preview */}
          <div className="ds2-preview">
            <div>
              <span className="muted">Derived R_jc gate {preview.override ? '(override)' : ''}</span>
              <b>{Number.isFinite(preview.gate) ? `${milliKW(preview.gate)} mK/W` : '—'}</b>
            </div>
            <div>
              <span className="muted">Coolant rise (½ caloric)</span>
              <b>{Number.isFinite(preview.caloric) ? `${fmt(preview.caloric / 2, 2)} K` : '—'}</b>
            </div>
            <div>
              <span className="muted">Coverage</span>
              <b style={{ color: coverageBad ? 'var(--fail)' : 'var(--accent2)' }}>{fmt(preview.coverage, 2)}</b>
            </div>
          </div>
          {coverageBad && <div className="pc-warn">⚠ Cooled core is smaller than the die (coverage &lt; 1) — the 1-D model turns optimistic.</div>}
          <p className="ds2-hint muted">
            Preview uses coolant properties at 25 °C; the server recomputes the exact gate on Apply/Save.
            The <b>override</b> gate (audit mode) is off unless you set it in the saved JSON.
          </p>

          {err && <div className="pc-warn">⚠ {err}</div>}
        </div>

        <div className="ds2-actions">
          <button className="vo-reset" onClick={() => onApply(draft)}>Apply (don't save)</button>
          <button className="ds2-save" onClick={doSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save project'}
          </button>
        </div>
      </div>
    </div>
  )
}
