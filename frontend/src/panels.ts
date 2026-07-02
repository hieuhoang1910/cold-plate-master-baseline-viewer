import { useEffect, useState } from 'react'

/** Resizable-panel sizes (px). Left/right columns + bottom panel height. */
export interface PanelSizes { left: number; right: number; bottom: number }

export const DEFAULT_PANELS: PanelSizes = { left: 268, right: 384, bottom: 300 }

const KEY = 'cp-panel-sizes'
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const bottomMax = () => Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.75)

/** Panel sizing with drag handlers, per-dimension reset, and localStorage persistence. */
export function usePanels() {
  const [sizes, setSizes] = useState<PanelSizes>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? { ...DEFAULT_PANELS, ...JSON.parse(raw) } : DEFAULT_PANELS
    } catch { return DEFAULT_PANELS }
  })

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(sizes)) } catch { /* ignore */ }
  }, [sizes])

  return {
    sizes,
    // Left gutter: dragging right (dx>0) widens the left column.
    resizeLeft: (dx: number) => setSizes((s) => ({ ...s, left: clamp(s.left + dx, 180, 560) })),
    // Right gutter: dragging right (dx>0) shrinks the right column (grows centre).
    resizeRight: (dx: number) => setSizes((s) => ({ ...s, right: clamp(s.right - dx, 240, 680) })),
    // Bottom gutter: dragging up (dy<0) grows the bottom panel.
    resizeBottom: (dy: number) => setSizes((s) => ({ ...s, bottom: clamp(s.bottom - dy, 120, bottomMax()) })),
    resetLeft: () => setSizes((s) => ({ ...s, left: DEFAULT_PANELS.left })),
    resetRight: () => setSizes((s) => ({ ...s, right: DEFAULT_PANELS.right })),
    resetBottom: () => setSizes((s) => ({ ...s, bottom: DEFAULT_PANELS.bottom })),
  }
}
