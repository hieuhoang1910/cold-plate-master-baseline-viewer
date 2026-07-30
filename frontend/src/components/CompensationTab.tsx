import { useState } from 'react'
import { fmt } from '../format'
import { LMM_PROC, LMM_PX_RULES, lmmCompensation } from '../manufacturing'
import type { DesignState } from '../types'

// 2026-07-30 — the ⇄ CAD view: the full 3-D design → print compensation
// story for the selected candidate / live slider design, as a first-class
// tab next to ▦ Pixel and ✓ Verify. Every number the nTop model needs:
//
//   final (sintered)  →  ×1.197/×1.23 green  →  snapped to the 35/25 µm grid
//   →  CAD draw (∓2 px overpoly pre-compensation)  →  printed-back px
//
// plus the guideline verdicts (Incus_Design_Guidelines.pdf July 2026 + the
// 2026-07-29 px review) and a copy-to-clipboard nTop handoff block.
// Chain math lives in manufacturing.lmmCompensation (shared with GreenCad).

export function CompensationTab({ design, sourceLabel }: {
  design: DesignState
  sourceLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const isFin = design.family === 'wavy_fin' || design.family === 'straight_fin'
  if (!isFin) {
    return (
      <div className="card" style={{ margin: 14, padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>⇄ CAD compensation</h3>
        <p className="muted">
          The compensation chain is defined for the fin families (wavy / straight) — TPMS and
          pin exports go through the STL / point-map path in ✓ Verify instead. Select a fin
          candidate or switch the family to use this view.
        </p>
      </div>
    )
  }

  const { rows, warnings, deep, chAbs, chRec } = lmmCompensation(design)
  const color = (s?: 'fail' | 'warn') =>
    s === 'fail' ? 'var(--fail)' : s === 'warn' ? 'var(--warn, #d9a441)' : undefined
  const ok = warnings.length === 0

  const handoff = [
    `Cold Plate — nTop CAD values (green state, overpoly pre-compensated)`,
    `design: ${sourceLabel}`,
    `scale vs final: x${LMM_PROC.shrinkXY} XY / x${LMM_PROC.shrinkZ} Z — already applied below, model these directly`,
    ...rows.map((r) => {
      const unit = r.axis === 'xy' ? 'px' : 'layers'
      return `${r.name}: ${r.cad.toFixed(3)} mm (${r.cadPx} ${unit})`
    }),
    `grid: ${LMM_PROC.pixelMm * 1000} um XY pixel / ${LMM_PROC.layerMm * 1000} um Z layer`,
    `overpoly: ~1 px per side — fins drawn -2 px, channels +2 px (pitch preserved)`,
  ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handoff)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard unavailable (http) — the text block below stays selectable */ }
  }

  return (
    <div className="card" style={{ margin: 14, padding: 18, overflowY: 'auto', maxHeight: '100%' }}>
      <h3 style={{ marginTop: 0 }}>
        ⇄ CAD compensation <span className="muted">— {sourceLabel}</span>
      </h3>
      <p className="muted" style={{ maxWidth: 720 }}>
        What to model in nTop so the <b>sintered part</b> lands on this design's dimensions.
        Chain per dimension: final → ×{LMM_PROC.shrinkXY} XY / ×{LMM_PROC.shrinkZ} Z green →
        snapped to the {LMM_PROC.pixelMm * 1000}/{LMM_PROC.layerMm * 1000} µm grid → <b>CAD
        draw</b> (overpoly pre-compensation: fin −2 px, channel +2 px) → the exposure grows
        it back to the <b>prints</b> column. Compensation preserves the nominal — it cannot
        upgrade a gap below the {chAbs} px cleaning floor; only the design values can.
      </p>

      <table className="gc-tbl" style={{ fontSize: '1.05em' }}>
        <thead>
          <tr>
            <th>dimension</th>
            <th className="num">final (sintered)</th>
            <th className="num">green ×shrink</th>
            <th className="num">snapped</th>
            <th className="num">CAD draw — model this</th>
            <th className="num">prints back as</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const offGrid = Math.abs(r.green - r.snapped) > 1e-6
            const unit = r.axis === 'xy' ? 'px' : 'ly'
            const judged = r.name === 'fin t' || r.name === 'gap b'
            return (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{fmt(r.final, 3)} mm</td>
                <td className="num" style={offGrid ? { color: 'var(--warn, #d9a441)' } : undefined}>
                  {fmt(r.green, 4)}{offGrid ? ' (off-grid)' : ''}
                </td>
                <td className="num">{fmt(r.snapped, 3)} · {r.units} {unit}</td>
                <td className="num" style={{ color: color(r.status) }}>
                  <b>{fmt(r.cad, 3)} mm</b> ({r.cadPx} {unit})
                </td>
                <td className="num" style={{ color: color(r.status) }}>
                  {judged ? <b>{r.printedPx} {unit}</b> : <span className="muted">unchanged</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ margin: '12px 0' }}>
        {ok
          ? <div style={{ color: 'var(--pass)' }}>✓ chain is clean — CAD is drawable and the printed part meets the
              guideline floors (fin ≥ {LMM_PX_RULES.finAbsPx} px, gap ≥ {chAbs} px{deep ? ' deep-channel' : ''}, rec {chRec} px, gap &gt; fin)</div>
          : warnings.map((w, i) => (
            <div key={i} style={{ color: w.level === 'fail' ? 'var(--fail)' : 'var(--warn, #d9a441)' }}>
              {w.level === 'fail' ? '✗' : '△'} {w.text}
            </div>
          ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <button className="about-btn" onClick={copy}>{copied ? '✓ copied' : '⧉ copy for nTop'}</button>
        <span className="muted">plain-text handoff block (also selectable below)</span>
      </div>
      <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em', userSelect: 'text',
        background: 'rgba(128,128,128,0.08)', padding: 10, borderRadius: 6 }}>{handoff}</pre>

      <p className="muted" style={{ maxWidth: 720 }}>
        Source: Incus_Design_Guidelines.pdf (July 2026, green px basis) + Peritsch email
        2026-07-29. In nTop, the per-feature ∓2 px edit is equivalent to a single 1 px
        ({LMM_PROC.pixelMm * 1000} µm) inward surface offset on the scaled green body. After
        export, self-review with ✓ Verify (stage "CAD-for-print") and the ▦ Pixel imported-STL
        view — nominal compensation does not catch local thin spots on wavy crests or the rib
        wedge.
      </p>
    </div>
  )
}
