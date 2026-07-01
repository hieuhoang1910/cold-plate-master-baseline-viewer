import type { BaselineResult, Catalog } from './types'

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

// Master engine — arbitrary design (used from Phase 4 sliders onward).
export const evaluate = (payload: unknown) =>
  jf<BaselineResult>('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
