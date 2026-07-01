import { fmt } from '../format'
import { varLabel } from '../optimizer'
import type { SweepResult } from '../types'

const MUTED = '#93a0b5'
const FAINT = '#6b7688'

function lerp(a: number[], b: number[], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t))
}
// 0 = low R_jc (good, green) -> 1 = high R_jc (bad, red)
function rjcColor(t: number): string {
  const green = [63, 185, 80]
  const yellow = [227, 179, 65]
  const red = [248, 81, 73]
  const c = t < 0.5 ? lerp(green, yellow, t / 0.5) : lerp(yellow, red, (t - 0.5) / 0.5)
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function Heatmap({ result }: { result: SweepResult }) {
  const xs = Array.from(new Set(result.grid.map((g) => g.x))).sort((a, b) => a - b)
  const ys = Array.from(new Set(result.grid.map((g) => g.y))).sort((a, b) => a - b)
  const nx = xs.length
  const ny = ys.length
  const byKey = new Map(result.grid.map((g) => [`${g.x}|${g.y}`, g]))
  const vals = result.grid.map((g) => g.R_jc_K_W).filter((v): v is number => v != null)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0)

  const W = 360, H = 300, ml = 46, mb = 34, mt = 8, mr = 10
  const pw = W - ml - mr, ph = H - mt - mb
  const cw = pw / nx, chh = ph / ny
  const xi = (i: number) => ml + i * cw
  const yj = (j: number) => mt + (ny - 1 - j) * chh

  const o = result.optimum
  const oi = o ? xs.indexOf(o.x) : -1
  const oj = o ? ys.indexOf(o.y) : -1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="opt-svg">
      {xs.map((x, i) =>
        ys.map((y, j) => {
          const c = byKey.get(`${x}|${y}`)
          if (!c || c.R_jc_K_W == null) return null
          return (
            <rect key={`${i}-${j}`} x={xi(i)} y={yj(j)} width={cw + 0.6} height={chh + 0.6}
              fill={rjcColor(norm(c.R_jc_K_W))} opacity={c.feasible ? 1 : 0.28}>
              <title>{`${varLabel(result.x_var)}=${fmt(x, 3)}, ${varLabel(result.y_var)}=${fmt(y, 3)}\nR_jc=${fmt(c.R_jc_K_W * 1000, 2)} mK/W\nΔP=${fmt((c.DeltaP_Pa ?? 0) / 1000, 2)} kPa · ${c.kpi_status}`}</title>
            </rect>
          )
        }),
      )}

      {o && oi >= 0 && oj >= 0 && (
        <g>
          <circle cx={xi(oi) + cw / 2} cy={yj(oj) + chh / 2} r={6} fill="none" stroke="#fff" strokeWidth={1.6} />
          <text x={xi(oi) + cw / 2} y={yj(oj) + chh / 2 + 3.5} textAnchor="middle" fontSize="10" fill="#fff">★</text>
        </g>
      )}

      <text x={ml + pw / 2} y={H - 5} textAnchor="middle" fontSize="10" fill={MUTED}>{varLabel(result.x_var)} (mm)</text>
      <text x={13} y={mt + ph / 2} textAnchor="middle" fontSize="10" fill={MUTED} transform={`rotate(-90 13 ${mt + ph / 2})`}>{varLabel(result.y_var)} (mm)</text>
      <text x={ml} y={H - mb + 13} fontSize="9" fill={FAINT}>{fmt(xs[0], 2)}</text>
      <text x={ml + pw} y={H - mb + 13} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(xs[nx - 1], 2)}</text>
      <text x={ml - 6} y={mt + ph} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(ys[0], 2)}</text>
      <text x={ml - 6} y={mt + 9} textAnchor="end" fontSize="9" fill={FAINT}>{fmt(ys[ny - 1], 2)}</text>
    </svg>
  )
}
