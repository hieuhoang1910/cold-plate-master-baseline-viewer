import type { AppSchema, BaselineResult, Catalog, Project, ProjectSummary, SweepResult } from './types'

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// The dev server proxies /api -> the Python API (see vite.config.ts), so a
// relative base works in dev and in the eventual single-origin production build.
async function jf<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const b = await r.json()
      if (b && b.error) msg = b.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg)
  }
  return (await r.json()) as T
}

export const getCatalog = () => jf<Catalog>('/api/catalog')

// V2.1 — wizard/problem schema: coolant presets, target defaults, families, layouts.
export const getSchema = () => jf<AppSchema>('/api/schema')

// V2.2 — projects: list / load / save / delete, and the catalog rescored for one.
export const getProjects = () => jf<{ projects: ProjectSummary[] }>('/api/projects')
export const getProject = (id: string) =>
  jf<Project>(`/api/projects/${encodeURIComponent(id)}`)
export const saveProject = (project: Project) =>
  jf<{ saved: boolean; project: Project }>('/api/projects', jsonPost({ project }))
export const deleteProject = (id: string) =>
  jf<{ deleted: boolean; id: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
// The catalog (candidates + basis + gates) computed against a project.
export const projectCatalog = (project: Project | string) =>
  jf<Catalog>('/api/catalog', jsonPost({ project }))

// Master engine — arbitrary design (used from Phase 4 sliders onward).
export const evaluate = (payload: unknown) =>
  jf<BaselineResult>('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

// 2-variable grid sweep for the optimizer (Phase 5).
export const sweep = (payload: unknown) =>
  jf<SweepResult>('/api/sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
