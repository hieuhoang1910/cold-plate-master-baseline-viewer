// V5.2 — 2-D layout schematic (spec §47-3): how the active layout routes the
// water, annotated with the S6 network-COMPUTED flow fractions (not assumed).
// Collapsible card, mounted under the layout selector (V5-D7 / §54 Q5).

import { useMemo } from 'react'
import { fmt } from '../format'
import type { FlowNetworkBlock } from '../types'

const SW = 232 // svg width (px)

function DashLine({ x1, y1, x2, y2, feed = false, w = 2 }: {
  x1: number; y1: number; x2: number; y2: number; feed?: boolean; w?: number
}) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} className={`fs-dash ${feed ? 'feed' : 'ret'}`}
      strokeWidth={w} markerEnd="url(#fs-arr)" />
  )
}

export function FlowSchematic({
  layout, coreWidth, coreLength, nSeg, block, defaultOpen = false,
}: {
  layout: string
  coreWidth: number
  coreLength: number
  nSeg: number
  block: FlowNetworkBlock | null
  defaultOpen?: boolean
}) {
  const H = Math.max(120, Math.min(240, Math.round((SW - 32) * (coreLength / Math.max(coreWidth, 1)))))
  const px = 16, py = 14
  const iw = SW - 2 * px, ih = H - 2 * py
  const X = (fx: number) => px + fx * iw          // fx ∈ [0,1] across width
  const Y = (fy: number) => py + (1 - fy) * ih    // fy ∈ [0,1] along flow (0 = -y edge)

  // Aggregate per-duct fractions for the distributed layout (cross_iL + cross_iR).
  const ductFractions = useMemo(() => {
    if (!block?.per_path) return null
    const by: Record<string, number> = {}
    for (const p of block.per_path) {
      const m = /^cross_(\d+)/.exec(p.label)
      if (!m) return null
      by[m[1]] = (by[m[1]] ?? 0) + p.flow_fraction
    }
    const out = Object.entries(by).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v)
    return out.length ? out : null
  }, [block])

  const body = (() => {
    if (layout === 'serpentine_n_pass') {
      const pts: string[] = []
      for (let k = 0; k < nSeg; k++) {
        const x = X((k + 0.5) / nSeg)
        const up = k % 2 === 0
        pts.push(`${x},${Y(up ? 0 : 1)}`, `${x},${Y(up ? 1 : 0)}`)
      }
      return (
        <>
          <polyline points={pts.join(' ')} className="fs-dash feed" strokeWidth={3} fill="none" />
          <text x={X(0.5 / nSeg)} y={H - 2} className="fs-lbl">in</text>
          <text x={X((nSeg - 0.5) / nSeg)} y={nSeg % 2 ? 12 : H - 2} className="fs-lbl">out</text>
        </>
      )
    }
    if (layout === 'distributed_jet_compartments') {
      const rows: JSX.Element[] = []
      for (let k = 0; k < nSeg; k++) {
        const fy = (2 * k + 1) / (2 * nSeg)
        const y = Y(fy)
        rows.push(
          <g key={`f${k}`}>
            <line x1={X(0.06)} y1={y} x2={X(0.94)} y2={y} className="fs-feedline" strokeWidth={3} />
            <circle cx={X(0.5)} cy={y} r={3.4} className="fs-window" />
            {ductFractions && ductFractions[k] != null && (
              <text x={SW - 2} y={y + 3} className="fs-frac" textAnchor="end">
                {fmt(ductFractions[k] * 100, 1)}%
              </text>
            )}
          </g>,
        )
      }
      for (let k = 0; k <= nSeg; k++) {
        const y = Y(k / nSeg)
        rows.push(
          <g key={`r${k}`}>
            <DashLine x1={X(0.5)} y1={y} x2={X(0.03)} y2={y} w={1.6} />
            <DashLine x1={X(0.5)} y1={y} x2={X(0.97)} y2={y} w={1.6} />
          </g>,
        )
      }
      return (
        <>
          {rows}
          <text x={X(0.5)} y={11} className="fs-lbl" textAnchor="middle">⊙ feed windows (pump in, from top)</text>
          <text x={4} y={H - 2} className="fs-lbl">returns vent both sides</text>
        </>
      )
    }
    if (layout === 'center_feed_bidirectional' || layout === 'top_jet_slot_centre_rib_bidirectional') {
      const yMid = Y(0.5)
      return (
        <>
          <line x1={X(0.04)} y1={yMid} x2={X(0.96)} y2={yMid} className="fs-feedline" strokeWidth={3.4} />
          <circle cx={X(0.5)} cy={yMid} r={3.6} className="fs-window" />
          {[0.2, 0.4, 0.6, 0.8].map((fx) => (
            <g key={fx}>
              <DashLine x1={X(fx)} y1={yMid - 5} x2={X(fx)} y2={Y(0.97)} feed w={1.8} />
              <DashLine x1={X(fx)} y1={yMid + 5} x2={X(fx)} y2={Y(0.03)} feed w={1.8} />
            </g>
          ))}
          <text x={X(0.5)} y={yMid - 6} className="fs-lbl" textAnchor="middle">jet slot → wedge rib crown</text>
        </>
      )
    }
    // single_pass / u_flow_side_feed
    const uflow = layout === 'u_flow_side_feed'
    return (
      <>
        {[0.15, 0.32, 0.5, 0.68, 0.85].map((fx) => (
          <DashLine key={fx} x1={X(fx)} y1={Y(0.03)} x2={X(fx)} y2={Y(0.97)} feed w={1.8} />
        ))}
        {uflow && (
          <>
            <line x1={X(0.02)} y1={Y(0.03)} x2={X(0.98)} y2={Y(0.03)} className="fs-feedline" strokeWidth={3} />
            <line x1={X(0.02)} y1={Y(0.97)} x2={X(0.98)} y2={Y(0.97)} className="fs-retline" strokeWidth={3} />
            <text x={4} y={H - 2} className="fs-lbl">feed header</text>
            <text x={4} y={11} className="fs-lbl">return header</text>
          </>
        )}
        {!uflow && <text x={X(0.5)} y={H - 2} className="fs-lbl" textAnchor="middle">in → straight through → out</text>}
      </>
    )
  })()

  const rec = block?.reconciliation
  const bd = block?.deltaP_breakdown

  return (
    <details className="card fs-card" open={defaultOpen}>
      <summary>
        Flow route <em className="fs-tag">design intent · S6-solved</em>
      </summary>
      <svg width={SW} height={H} viewBox={`0 0 ${SW} ${H}`}>
        <defs>
          <marker id="fs-arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
          </marker>
        </defs>
        <rect x={px - 6} y={py - 6} width={iw + 12} height={ih + 12} className="fs-plate" rx={4} />
        {body}
      </svg>
      <div className="fs-stats">
        {block?.uniformity_computed != null && (
          <span title="S6 network-computed uniformity vs the layout's assumed scalar">
            U <b>{fmt(block.uniformity_computed, 3)}</b>
            <em> (assumed {fmt(block.uniformity_assumed ?? 1, 2)})</em>
          </span>
        )}
        {bd && (
          <span title="Where the pressure budget is spent (S6 decomposition)">
            ΔP <b>{fmt((block?.deltaP_Pa ?? 0) / 1000, 1)} kPa</b>
            <em> = {fmt((bd.friction_Pa ?? 0) / 1000, 1)} friction + {fmt((bd.minor_Pa ?? 0) / 1000, 1)} minor</em>
          </span>
        )}
        {rec && (
          <span className={rec.within_tolerance ? 'fs-ok' : 'fs-warn'}
            title="S6 network ΔP vs the validated solver's — the anchor check (spec §49). KPIs are always the solver's.">
            {rec.within_tolerance ? '✓ reconciled with solver' : `⚠ ΔP ratio ${fmt(rec.ratio, 2)} vs solver`}
          </span>
        )}
        {!block && <span className="muted">S6 network runs for fin families — evaluate to populate.</span>}
      </div>
    </details>
  )
}
