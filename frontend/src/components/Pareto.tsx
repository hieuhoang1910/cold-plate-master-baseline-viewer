import { fmt } from '../format'
import type { BaselineResult, SweepResult } from '../types'

const MUTED = '#93a0b5'
const FAINT = '#6b7688'
const AXIS = '#2a3547'

export function Pareto({
  result, candidates, current,
}: {
  result: SweepResult
  candidates: BaselineResult[]
  current: BaselineResult | null
}) {
  const pts = result.grid.filter((g) => g.pump_power_W != null && g.R_jc_K_W != null)
  if (pts.length === 0) return null

  const pumps = [...pts.map((p) => p.pump_power_W!), ...candidates.map((c) => c.pump_power_W)]
  const rjcs = [...pts.map((p) => p.R_jc_K_W! * 1000), ...candidates.map((c) => c.R_jc_K_W * 1000)]
  if (current) { pumps.push(current.pump_power_W); rjcs.push(current.R_jc_K_W * 1000) }

  const floor = result.r_jc_floor_K_W != null ? result.r_jc_floor_K_W * 1000 : null
  const gate = result.r_jc_gate_K_W != null ? result.r_jc_gate_K_W * 1000 : null

  const xlo = 0
  const xhi = Math.max(...pumps) * 1.06 || 1
  // extend the y-range down to the floor so the "can't beat this" line shows.
  const ylo = Math.min(...rjcs, floor ?? Infinity) * 0.985
  const yhi = Math.max(...rjcs, gate ?? -Infinity) * 1.015

  const W = 360, H = 300, ml = 46, mb = 34, mt = 10, mr = 12
  const pw = W - ml - mr, ph = H - mt - mb
  const X = (v: number) => ml + ((v - xlo) / (xhi - xlo || 1)) * pw
  const Y = (v: number) => mt + (1 - (v - ylo) / (yhi - ylo || 1)) * ph

  const pareto = [...result.pareto]
    .filter((p) => p.pump_power_W != null && p.R_jc_K_W != null)
    .sort((a, b) => a.pump_power_W! - b.pump_power_W!)
  const o = result.optimum

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="opt-svg">
      <line x1={ml} y1={mt} x2={ml} y2={mt + ph} stroke={AXIS} />
      <line x1={ml} y1={mt + ph} x2={ml + pw} y2={mt + ph} stroke={AXIS} />

      {floor != null && floor >= ylo && floor <= yhi && (
        <g>
          <line x1={ml} y1={Y(floor)} x2={ml + pw} y2={Y(floor)} stroke="#3fb950" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          <text x={ml + pw} y={Y(floor) - 3} textAnchor="end" fontSize="8.5" fill="#3fb950">R_jc floor (TIM+base) {fmt(floor, 1)}</text>
        </g>
      )}
      {gate != null && gate >= ylo && gate <= yhi && (
        <g>
          <line x1={ml} y1={Y(gate)} x2={ml + pw} y2={Y(gate)} stroke="#e3b341" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          <text x={ml + pw} y={Y(gate) - 3} textAnchor="end" fontSize="8.5" fill="#e3b341">gate {fmt(gate, 1)}</text>
        </g>
      )}

      {pts.map((p, i) => (
        <circle key={i} cx={X(p.pump_power_W!)} cy={Y(p.R_jc_K_W! * 1000)} r={1.6}
          fill="#3a4759" opacity={p.feasible ? 0.7 : 0.22} />
      ))}

      <polyline points={pareto.map((p) => `${X(p.pump_power_W!)},${Y(p.R_jc_K_W! * 1000)}`).join(' ')}
        fill="none" stroke="#5b9dff" strokeWidth={1.5} opacity={0.85} />
      {pareto.map((p, i) => (
        <circle key={`p${i}`} cx={X(p.pump_power_W!)} cy={Y(p.R_jc_K_W! * 1000)} r={2.6} fill="#5b9dff" />
      ))}

      {candidates.map((c, i) => (
        <rect key={`c${i}`} x={X(c.pump_power_W) - 3.2} y={Y(c.R_jc_K_W * 1000) - 3.2} width={6.4} height={6.4}
          fill="none" stroke="#e3b341" strokeWidth={1.3} transform={`rotate(45 ${X(c.pump_power_W)} ${Y(c.R_jc_K_W * 1000)})`}>
          <title>{`${c.design_id}\nR_jc=${fmt(c.R_jc_K_W * 1000, 2)} mK/W · pump ${fmt(c.pump_power_W, 3)} W`}</title>
        </rect>
      ))}

      {current && (
        <circle cx={X(current.pump_power_W)} cy={Y(current.R_jc_K_W * 1000)} r={5} fill="none" stroke="#fff" strokeWidth={2} />
      )}

      {o && o.pump_power_W != null && o.R_jc_K_W != null && (
        <text x={X(o.pump_power_W)} y={Y(o.R_jc_K_W * 1000) + 4.5} textAnchor="middle" fontSize="13" fill="#fff">★</text>
      )}

      <text x={ml + pw / 2} y={H - 5} textAnchor="middle" fontSize="10" fill={MUTED}>pump power (W)</text>
      <text x={13} y={mt + ph / 2} textAnchor="middle" fontSize="10" fill={MUTED} transform={`rotate(-90 13 ${mt + ph / 2})`}>R_jc (mK/W)</text>
      <text x={ml} y={H - mb + 13} fontSize="9" fill={FAINT}>{fmt(xlo, 2)}</text>
      <text x={ml + pw} y={H - mb + 13} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(xhi, 2)}</text>
      <text x={ml - 6} y={mt + 9} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(yhi, 1)}</text>
      <text x={ml - 6} y={mt + ph} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(ylo, 1)}</text>
    </svg>
  )
}
