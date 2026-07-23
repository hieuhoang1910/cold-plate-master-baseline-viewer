// V5.2 — T0 flow-intent visualization helpers (spec §47 rev 2, §50).
// Everything drawn is a named solver output (S6 per-path speeds) or the
// layout's own routing — never a simulated field. The badge says so.

import type { BaselineResult, Basis, FlowNetworkBlock } from './types'

/** Screen slow-motion factor: dashes move at v_real / SLOWMO (§54 Q5, ~×50). */
export const SLOWMO = 50

// Shader layout codes (uFlowLayout).
export const FLOW_LAYOUTS: Record<string, number> = {
  single_pass: 0,
  u_flow_side_feed: 0, // same channel direction; header detail is schematic-only
  center_feed_bidirectional: 1,
  top_jet_slot_centre_rib_bidirectional: 1,
  serpentine_n_pass: 2,
  distributed_jet_compartments: 3,
}

export interface FlowViz {
  layout: string          // resolved architecture name
  code: number            // shader layout code
  speedMmS: number        // on-screen dash speed (mm/s, slow-motion applied)
  realV: number           // the S6/solver velocity behind it (m/s)
  nSeg: number            // serpentine passes / distributed-jet duct count
  block: FlowNetworkBlock | null
  // V5.3 — operating inputs the F1 field solver needs (SI)
  mu: number
  rho: number
  flowM3s: number
  meanRe: number
  // V5.4/V5.6 — thermal-tint + ΔP-mode anchors (all from the live solver
  // result — the tint endpoints ARE solver numbers, per the §53 acceptance)
  thermal: {
    TIn: number       // °C
    dTcal: number     // caloric rise (K)
    dTwall: number    // Q·R_conv — fin-root offset above local fluid (K)
    mH: number        // fin parameter, inverted from η_f
    heatW: number
    cp: number
    tjC: number | null
    tjMaxC: number | null
  } | null
  dp: { totalPa: number; minorFrac: number } | null
}

/** Invert η_f = tanh(x)/x (monotonic ↓) by bisection. */
export function mhFromEta(eta: number): number {
  if (!(eta > 0) || eta >= 1) return 0.5
  let lo = 1e-3, hi = 60
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2
    const v = Math.tanh(mid) / mid
    if (v > eta) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Build the viz descriptor from the live result + basis. Null = no flow layer
 *  (non-fin families — S6 doesn't model them, so nothing honest to animate). */
export function flowVizFrom(
  family: string,
  basis: Basis,
  live: BaselineResult | null,
  flowLpm?: number | null,
): FlowViz | null {
  if (!['wavy_fin', 'straight_fin'].includes(family)) return null
  const block: FlowNetworkBlock | null = live?.flow_network ?? null
  const fallbackV = live?.velocity_m_s ?? null
  const layout = String(basis.architecture?.name ?? 'center_feed_bidirectional')
  const code = FLOW_LAYOUTS[layout] ?? 1
  const paths = block?.supported ? block.per_path ?? [] : []
  const realV = paths.length
    ? paths.reduce((s, p) => s + p.velocity_m_s, 0) / paths.length
    : (fallbackV ?? 0)
  const meanRe = paths.length
    ? paths.reduce((s, p) => s + p.Re, 0) / paths.length
    : 150
  const nPaths = Number(basis.architecture?.n_parallel_paths ?? 2)
  let nSeg = 2
  if (layout === 'serpentine_n_pass') {
    const L = Number(basis.stack.core_length_mm) || 1
    nSeg = Math.max(2, Math.round(Number(basis.architecture?.path_length_mm ?? 3 * L) / L))
  } else if (layout === 'distributed_jet_compartments') {
    nSeg = Math.max(1, Math.floor(nPaths / 2))
  }
  const lpm = Number(flowLpm ?? basis.operating?.flow_lpm ?? 2.65)
  const mu = Number(live?.coolant?.mu_Pa_s ?? basis.operating?.mu_Pa_s ?? 0.00089)
  const rho = Number(live?.coolant?.rho_kg_m3 ?? basis.operating?.rho_kg_m3 ?? 997)
  const cp = Number(live?.coolant?.cp_J_kgK ?? basis.operating?.cp_J_kgK ?? 4181)
  const flowM3s = lpm / 60000

  let thermal: FlowViz['thermal'] = null
  if (live) {
    const heatW = Number(basis.operating?.heat_load_W ?? 450)
    const TIn = Number(live.coolant?.T_eval_C ?? basis.operating?.T_inlet_C ?? 25)
    const mcp = flowM3s * rho * cp
    thermal = {
      TIn,
      dTcal: mcp > 0 ? heatW / mcp : 0,
      dTwall: heatW * live.R_th_conv_K_W,
      mH: mhFromEta(live.eta_f ?? 0.5),
      heatW, cp,
      tjC: live.targets?.T_j_C ?? null,
      tjMaxC: live.targets?.T_j_max_C ?? null,
    }
  }
  const bd = block?.supported ? block.deltaP_breakdown : undefined
  const dp = live
    ? {
        totalPa: live.DeltaP_Pa,
        minorFrac: bd && (bd.friction_Pa ?? 0) + (bd.minor_Pa ?? 0) > 0
          ? (bd.minor_Pa ?? 0) / ((bd.friction_Pa ?? 0) + (bd.minor_Pa ?? 0))
          : 0.2,
      }
    : null

  return {
    layout, code,
    speedMmS: (realV * 1000) / SLOWMO,
    realV, nSeg,
    block: block?.supported ? block : null,
    mu, rho, flowM3s, meanRe,
    thermal, dp,
  }
}

/** "1 s on screen ≈ X ms real" chip text. */
export function timeScaleLabel(): string {
  return `×${SLOWMO} slow-mo · 1 s ≈ ${Math.round(1000 / SLOWMO)} ms real`
}
