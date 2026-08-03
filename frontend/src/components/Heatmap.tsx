import { fmt } from '../format'
import { objectiveOf, varLabel, varUnit } from '../optimizer'
import type { SweepResult } from '../types'

const MUTED = '#93a0b5'
const FAINT = '#6b7688'

function lerp(a: number[], b: number[], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t))
}
// 0 = better (green) -> 1 = worse (red)
function goodBadColor(t: number): string {
  const green = [63, 185, 80]
  const yellow = [227, 179, 65]
  const red = [248, 81, 73]
  const c = t < 0.5 ? lerp(green, yellow, t / 0.5) : lerp(yellow, red, (t - 0.5) / 0.5)
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function Heatmap({ result, onPick }: {
  result: SweepResult
  onPick?: (x: number, y: number) => void
}) {
  const ob = objectiveOf(result.objective)
  const xs = Array.from(new Set(result.grid.map((g) => g.x))).sort((a, b) => a - b)
  const ys = Array.from(new Set(result.grid.map((g) => g.y))).sort((a, b) => a - b)
  const nx = xs.length
  const ny = ys.length
  const byKey = new Map(result.grid.map((g) => [`${g.x}|${g.y}`, g]))
  const vals = result.grid.map((g) => g.objective).filter((v): v is number => v != null)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  // t: 0 = better (green). For "max" objectives, high value is better -> invert.
  const norm = (v: number) => {
    const t = hi > lo ? (v - lo) / (hi - lo) : 0
    return ob.dir === 'max' ? 1 - t : t
  }

  const W = 360, H = 300, ml = 46, mb = 34, mt = 8, mr = 10
  const pw = W - ml - mr, ph = H - mt - mb
  const cw = pw / nx, chh = ph / ny
  const xi = (i: number) => ml + i * cw
  const yj = (j: number) => mt + (ny - 1 - j) * chh

  const o = result.optimum
  const oi = o ? xs.indexOf(o.x) : -1
  const oj = o ? ys.indexOf(o.y) : -1
  // V3.3 — the gates-only ghost ☆; drawn when it differs from ★ (the gap
  // between them is the price of manufacturability).
  const u = result.optimum_unconstrained
  const ghost = u && o && (u.x !== o.x || u.y !== o.y) ? u : null
  const gi = ghost ? xs.indexOf(ghost.x) : -1
  const gj = ghost ? ys.indexOf(ghost.y) : -1

  // Two-tier feasibility dimming: gate-fail dimmest, then mfg FAIL, then MARGINAL.
  const cellOpacity = (c: { feasible: boolean; mfg?: string | null }) => {
    if (!c.feasible) return 0.22
    if (c.mfg === 'FAIL') return 0.45
    if (c.mfg === 'MARGINAL') return 0.75
    return 1
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="opt-svg">
      {xs.map((x, i) =>
        ys.map((y, j) => {
          const c = byKey.get(`${x}|${y}`)
          if (!c || c.objective == null) return null
          return (
            <rect key={`${i}-${j}`} x={xi(i)} y={yj(j)} width={cw + 0.6} height={chh + 0.6}
              fill={goodBadColor(norm(c.objective))} opacity={cellOpacity(c)}
              onClick={onPick ? () => onPick(x, y) : undefined}
              style={onPick ? { cursor: 'pointer' } : undefined}>
              <title>{`${varLabel(result.x_var)}=${fmt(x, 3)}, ${varLabel(result.y_var)}=${fmt(y, 3)}\n${ob.label}=${fmt(c.objective * ob.scale, ob.digits)} ${ob.unit}\nR_jc=${fmt((c.R_jc_K_W ?? 0) * 1000, 2)} mK/W · ΔP=${fmt((c.DeltaP_Pa ?? 0) / 1000, 2)} kPa · ${c.kpi_status}${c.mfg ? ` · mfg ${c.mfg}` : ''}${onPick ? '\nclick → load into sliders' : ''}`}</title>
            </rect>
          )
        }),
      )}

      {ghost && gi >= 0 && gj >= 0 && (
        <g opacity={0.75}>
          <circle cx={xi(gi) + cw / 2} cy={yj(gj) + chh / 2} r={6} fill="none" stroke="#fff"
            strokeWidth={1.2} strokeDasharray="2.5 2" />
          <text x={xi(gi) + cw / 2} y={yj(gj) + chh / 2 + 3.5} textAnchor="middle" fontSize="10" fill="#fff">☆</text>
          <title>gates-only optimum (ignores manufacturability)</title>
        </g>
      )}
      {o && oi >= 0 && oj >= 0 && (
        <g>
          <circle cx={xi(oi) + cw / 2} cy={yj(oj) + chh / 2} r={6} fill="none" stroke="#fff" strokeWidth={1.6} />
          <text x={xi(oi) + cw / 2} y={yj(oj) + chh / 2 + 3.5} textAnchor="middle" fontSize="10" fill="#fff">★</text>
        </g>
      )}

      <text x={ml + pw / 2} y={H - 5} textAnchor="middle" fontSize="10" fill={MUTED}>{varLabel(result.x_var)} ({varUnit(result.x_var)})</text>
      <text x={13} y={mt + ph / 2} textAnchor="middle" fontSize="10" fill={MUTED} transform={`rotate(-90 13 ${mt + ph / 2})`}>{varLabel(result.y_var)} ({varUnit(result.y_var)})</text>
      <text x={ml} y={H - mb + 13} fontSize="9" fill={FAINT}>{fmt(xs[0], 2)}</text>
      <text x={ml + pw} y={H - mb + 13} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(xs[nx - 1], 2)}</text>
      <text x={ml - 6} y={mt + ph} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(ys[0], 2)}</text>
      <text x={ml - 6} y={mt + 9} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(ys[ny - 1], 2)}</text>
    </svg>
  )
}
