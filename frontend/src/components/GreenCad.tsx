import { fmt } from '../format'
import { LMM_PROC, LMM_PX_RULES, lmmCompensation } from '../manufacturing'
import type { DesignState } from '../types'

// V3.3c — the LMM green→CAD converter (spec §35A, review §6): for every fin
// dimension, the full export chain final (sintered) → ×shrink green →
// pixel/layer-snapped → ∓2 px overpoly → CAD value. This is the nTop handoff.
// 2026-07-30 — px columns + guideline guardrails; the chain math lives in
// manufacturing.lmmCompensation (shared with the full ⇄ CAD tab).
export function GreenCad({ design }: { design: DesignState }) {
  const { rows, warnings, deep, chAbs, chRec } = lmmCompensation(design)
  const color = (s?: 'fail' | 'warn') =>
    s === 'fail' ? 'var(--fail)' : s === 'warn' ? 'var(--warn, #d9a441)' : undefined
  return (
    <details className="gc">
      <summary>
        green → CAD converter <span className="muted">(Incus EVO35 · 35/25 µm · ×{LMM_PROC.shrinkXY}/{LMM_PROC.shrinkZ})</span>
      </summary>
      <table className="gc-tbl">
        <thead>
          <tr><th>dim</th><th className="num">final</th><th className="num">green</th><th className="num">snap</th>
            <th className="num" title="what to model in nTop — pixels (XY) / layers (Z)">CAD draw</th>
            <th className="num" title="what the exposure delivers back: overpoly grows fins +2 px, erodes gaps −2 px — this is what Incus measures">prints</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const offGrid = Math.abs(r.green - r.snapped) > 1e-6
            const unit = r.axis === 'xy' ? 'px' : 'ly'
            return (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{fmt(r.final, 3)}</td>
                <td className="num" style={offGrid ? { color: 'var(--warn, #d9a441)' } : undefined}>{fmt(r.green, 3)}</td>
                <td className="num">{fmt(r.snapped, 3)}</td>
                <td className="num" style={{ color: color(r.status) }}>
                  <b>{fmt(r.cad, 3)}</b> <span className="muted">{r.cadPx} {unit}</span>
                </td>
                <td className="num" style={{ color: color(r.status) }}>
                  {r.name === 'fin t' || r.name === 'gap b' ? <>{r.printedPx} {unit}</> : <span className="muted">=</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {warnings.length > 0 && (
        <div className="gc-note">
          {warnings.map((w, i) => (
            <div key={i} style={{ color: w.level === 'fail' ? 'var(--fail)' : 'var(--warn, #d9a441)' }}>
              {w.level === 'fail' ? '✗' : '△'} {w.text}
            </div>
          ))}
        </div>
      )}
      <div className="gc-note muted">
        mm · CAD = snapped green ∓2 px overpoly (fin −, channel +; pitch preserved). Draw the
        CAD values in nTop; the exposure returns the <b>prints</b> px, sinter shrink returns the
        final column. Compensation preserves the nominal — it cannot upgrade a gap below the
        {' '}{chAbs} px cleaning floor. Floors (green px): fin ≥ {LMM_PX_RULES.finAbsPx}, rec {LMM_PX_RULES.finRecPx}–5 ·
        gap ≥ {chAbs}, rec {chRec}{deep ? ' (channels > 1 mm deep)' : ' (≤ 1 mm deep)'} · gap &gt; fin.
        Full-page version with the nTop handoff text: the <b>⇄ CAD</b> view up top.
      </div>
    </details>
  )
}
