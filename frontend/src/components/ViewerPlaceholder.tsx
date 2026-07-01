import type { BaselineResult } from '../types'

/**
 * Center panel placeholder for the Phase 3 raymarched implicit-body viewer.
 * For now it shows which design is loaded and what geometry family will render.
 */
export function ViewerPlaceholder({ r }: { r: BaselineResult | null }) {
  return (
    <div className="viewer-ph">
      <div className="big">3D implicit-body viewer</div>
      <div>Raymarched SDF geometry lands in <b>Phase 3</b>.</div>
      {r && (
        <div className="muted" style={{ fontSize: 12 }}>
          loaded: <b>{r.design_id}</b> · family <b>{r.family}</b>
        </div>
      )}
    </div>
  )
}
