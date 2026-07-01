import { fmt, kPa, milliKW } from '../format'
import type { BaselineResult } from '../types'

/** Bottom comparison table across all candidates. Click a row to select it. */
export function CandidateTable({
  candidates, selectedId, onSelect,
}: {
  candidates: BaselineResult[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const sorted = [...candidates].sort((a, b) => a.R_jc_K_W - b.R_jc_K_W)
  return (
    <table>
      <thead>
        <tr>
          <th>design</th>
          <th>family</th>
          <th className="num">R_jc</th>
          <th className="num">R_conv</th>
          <th className="num">ΔP</th>
          <th className="num">pump</th>
          <th className="num">SA/V eff</th>
          <th className="num">cover</th>
          <th>status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={c.design_id}
            className={c.design_id === selectedId ? 'sel' : ''}
            onClick={() => onSelect(c.design_id)}>
            <td>{c.design_id}</td>
            <td>{c.family}</td>
            <td className="num">{milliKW(c.R_jc_K_W)}</td>
            <td className="num">{milliKW(c.R_th_conv_K_W)}</td>
            <td className="num">{kPa(c.DeltaP_Pa)}</td>
            <td className="num">{fmt(c.pump_power_W, 3)}</td>
            <td className="num">{fmt(c.effective_SA_V_m2_m3, 0)}</td>
            <td className="num">{fmt(c.coverage, 2)}</td>
            <td>{c.kpi_status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
