import { fmt, fmtInt, kPa, milliKW } from '../format'
import type { BaselineResult } from '../types'

const MFG_COLOR: Record<string, string> = {
  PASS: 'var(--accent2)', MARGINAL: 'var(--warn, #d9a441)', FAIL: 'var(--fail)',
}

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
          <th className="num" title="structure-only surface area (no channel floor), mm²">A_fin</th>
          <th className="num" title="effective amplification: working area ÷ die area">eff ×</th>
          <th className="num" title="open flow cross-section, mm²">A_flow</th>
          <th className="num">cover</th>
          <th title="manufacturability verdict from the route's DfAM rulebook">mfg</th>
          <th>status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={c.design_id}
            className={c.design_id === selectedId ? 'sel' : ''}
            onClick={() => onSelect(c.design_id)}>
            <td>{c.name ?? c.design_id}</td>
            <td>{c.family}</td>
            <td className="num">{milliKW(c.R_jc_K_W)}</td>
            <td className="num">{milliKW(c.R_th_conv_K_W)}</td>
            <td className="num">{kPa(c.DeltaP_Pa)}</td>
            <td className="num">{fmt(c.pump_power_W, 3)}</td>
            <td className="num">{c.areas ? fmtInt(c.areas.fin_mm2) : '—'}</td>
            <td className="num">{c.areas?.amplification_eff != null ? `×${fmt(c.areas.amplification_eff, 1)}` : '—'}</td>
            <td className="num">{c.areas ? fmtInt(c.areas.flow_mm2) : '—'}</td>
            <td className="num">{fmt(c.coverage, 2)}</td>
            <td>
              {c.manufacturability
                ? <b style={{ color: MFG_COLOR[c.manufacturability.verdict] }}
                    title={`${c.manufacturability.label} — ${c.manufacturability.checks.filter((k) => k.status === 'FAIL' || k.status === 'MARGINAL').map((k) => k.label).join(', ') || 'all rules met'}`}>
                    {c.manufacturability.verdict === 'PASS' ? '✓' : c.manufacturability.verdict === 'MARGINAL' ? '△' : '✗'}
                  </b>
                : '—'}
            </td>
            <td>{c.kpi_status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
