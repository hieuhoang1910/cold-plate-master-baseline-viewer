import { fmt } from '../format'
import { LMM_PROC, lmmRecipe } from '../manufacturing'
import type { DesignState } from '../types'

// V3.3c — the LMM green→CAD converter (spec §35A, review §6): for every fin
// dimension, the full export chain final (sintered) → ×shrink green →
// pixel/layer-snapped → ∓2 px overpoly → CAD value. This is the nTop handoff.
export function GreenCad({ design }: { design: DesignState }) {
  const rows = lmmRecipe(design)
  return (
    <details className="gc">
      <summary>
        green → CAD converter <span className="muted">(Incus EVO35 · 35/25 µm · ×{LMM_PROC.shrinkXY}/{LMM_PROC.shrinkZ})</span>
      </summary>
      <table className="gc-tbl">
        <thead>
          <tr><th>dim</th><th className="num">final</th><th className="num">green</th><th className="num">snap</th><th className="num">px/ly</th><th className="num">CAD</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const offGrid = Math.abs(r.green - r.snapped) > 1e-6
            return (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{fmt(r.final, 3)}</td>
                <td className="num" style={offGrid ? { color: 'var(--warn, #d9a441)' } : undefined}>{fmt(r.green, 3)}</td>
                <td className="num">{fmt(r.snapped, 3)}</td>
                <td className="num">{r.units}</td>
                <td className="num"><b>{fmt(r.cad, 3)}</b></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="gc-note muted">
        mm · CAD = snapped green ∓2 px overpoly (fin −, channel +; pitch preserved).
        Draw the CAD values; the print returns the final column after sinter shrink.
      </div>
    </details>
  )
}
