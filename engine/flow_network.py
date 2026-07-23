"""
07_WebApp/engine/flow_network.py  (webapp-native)
=================================================
S6 — flow-network solver (V5.1, spec §47). The manifold → slots → compartments
→ channels system as a hydraulic network, built from the active layout +
geometry and solved Kirchhoff-style:

  * channel bundles use the SAME laminar Shah–London fRe model (and roughness
    factor) as `master_baseline_calculator._evaluate_fin_family` — no second
    physics model, only a finer topology;
  * minor losses (turns, slot entries, headers) are K·½ρv² edges → mildly
    nonlinear → fixed-point iteration (converges in a few passes at Re≈100–200);
  * the linear system is solved with hand-rolled Gaussian elimination with
    partial pivoting (pure stdlib — same dependency discipline as the V4 BVH).

Outputs per evaluate: per-path flow fractions, COMPUTED uniformity (the
flow-weighted statistic the assumed `flow_uniformity` scalar approximates),
ΔP decomposition (friction vs minor), per-path velocity/Re, assumptions and
warnings. Fin families only in V5.1 (straight_fin / wavy_fin); other families
are reported unsupported rather than modelled loosely.

Distributed-jet geometry defaults are MESH-MEASURED from Hieu's current
`ICE rev 3 scaled - Remeshed.stl` (sliced 2026-07-23, final-part mm):
10 transverse feed ducts (≈1.17 × 1.48 mm) with top windows at 2.79 mm pitch,
interdigitated return gaps (≈1.15 × 1.9 mm) venting at both part sides,
fin-field compartment walls at 1.40 mm pitch. Which system is feed vs return
is symmetric for this network (spec §54 Q1: only the viz arrows need Hieu's
answer). Minor-loss K values are engineering estimates pending CFD (TD-10/11).

Uniformity metric: U = (Σq)² / (N·Σq²) over the N parallel path flows — the
standard flow-maldistribution factor (1.0 = perfectly even).
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional

import master_baseline_calculator as mbc

MODEL = "S6 flow-network v1 (V5.1)"

# Minor-loss coefficients (engineering estimates; pending CFD TD-10/11).
K_PORT = 0.5            # plenum/port entry or exit
K_BEND_180 = 2.2        # serpentine 180-degree bend (matches layouts.py)
K_SLOT_TURN = 1.0       # 90-degree slot turn (down into / up out of the fins)
K_GAP_EXIT = 1.0        # return-gap exit into the housing plenum

# ICE rev 3 mesh-measured geometry (final-part mm, sliced 2026-07-23).
ICE_DUCT_W_MM = 1.17
ICE_DUCT_H_MM = 1.48
ICE_GAP_W_MM = 1.15
ICE_GAP_H_MM = 1.90

_U_FLOW_HEADER_W_MM = 2.0   # assumed feed/return header width (u_flow only)
_U_FLOW_GROUPS = 10         # channel groups along the header ladder


# ---------------------------------------------------------------------------
# Linear algebra (pure stdlib)
# ---------------------------------------------------------------------------

def _solve_linear(A: List[List[float]], b: List[float]) -> List[float]:
    """Gaussian elimination with partial pivoting. Small dense systems only."""
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-300:
            raise ValueError("singular network matrix")
        M[col], M[piv] = M[piv], M[col]
        inv = 1.0 / M[col][col]
        for r in range(col + 1, n):
            f = M[r][col] * inv
            if f != 0.0:
                for c in range(col, n + 1):
                    M[r][c] -= f * M[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n] - sum(M[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / M[r][r]
    return x


# ---------------------------------------------------------------------------
# Edge resistance components — ΔP(q) models
# ---------------------------------------------------------------------------

class _Edge:
    """Directed i→j edge whose resistance R(q) = ΔP/q may depend on |q|."""

    def __init__(self, i: int, j: int, label: str,
                 components: List[Dict[str, Any]]):
        self.i = i
        self.j = j
        self.label = label
        self.components = components   # each: {"kind", "R": callable(q)->R}
        self.q = 0.0

    def resistance(self, q: float) -> float:
        return sum(c["R"](abs(q)) for c in self.components)

    def split_deltaP(self) -> Dict[str, float]:
        """Per-kind ΔP at the converged flow (for the friction/minor split)."""
        out: Dict[str, float] = {}
        for c in self.components:
            out[c["kind"]] = out.get(c["kind"], 0.0) + c["R"](abs(self.q)) * abs(self.q)
        return out


def _lam_channel(n_ch: int, b_m: float, H_m: float, L_m: float,
                 rho: float, mu: float, rr: float) -> Dict[str, Any]:
    """Laminar fin-channel bundle — same fRe math as _evaluate_fin_family."""
    A = n_ch * b_m * H_m
    Dh = 2.0 * b_m * H_m / (b_m + H_m)
    alpha = min(b_m, H_m) / max(b_m, H_m)
    fre0 = mbc._shah_london_fre(alpha)

    def R(q: float) -> float:
        if A <= 0 or Dh <= 0:
            return float("inf")
        v = q / A
        Re = rho * v * Dh / mu if mu > 0 else 0.0
        fre = fre0 * mbc._roughness_factor(rr, Re)
        return fre * 2.0 * mu * L_m / (Dh * Dh * A)

    return {"kind": "friction", "R": R, "A": A, "Dh": Dh}


def _rect_duct(w_m: float, h_m: float, L_m: float,
               rho: float, mu: float) -> Dict[str, Any]:
    """Laminar rectangular duct (headers, feed ducts, return gaps)."""
    return _lam_channel(1, w_m, h_m, L_m, rho, mu, 0.0)


def _minor(K: float, A_m2: float, rho: float) -> Dict[str, Any]:
    def R(q: float) -> float:
        if A_m2 <= 0:
            return float("inf")
        return K * rho * q / (2.0 * A_m2 * A_m2)

    return {"kind": "minor", "R": R, "A": A_m2}


# ---------------------------------------------------------------------------
# Network solve (nodal analysis + fixed point on the quadratic edges)
# ---------------------------------------------------------------------------

def _solve_network(n_nodes: int, edges: List[_Edge], inlet: int, outlet: int,
                   Q_total: float, iters: int = 60, tol: float = 1e-12) -> float:
    """Solve node pressures for a fixed total flow; edge.q filled in.

    Returns the inlet pressure (= total ΔP, outlet is the 0-reference).
    """
    # Seed: equal split across edges leaving the inlet, else tiny flow.
    seed = Q_total / max(1, sum(1 for e in edges if e.i == inlet or e.j == inlet))
    for e in edges:
        e.q = seed
    unknowns = [n for n in range(n_nodes) if n != outlet]
    index = {n: k for k, n in enumerate(unknowns)}
    p_in_prev = None
    for _ in range(iters):
        G = [[0.0] * len(unknowns) for _ in unknowns]
        rhs = [0.0] * len(unknowns)
        for e in edges:
            g = 1.0 / max(e.resistance(e.q), 1e-300)
            for a, bnode in ((e.i, e.j), (e.j, e.i)):
                if a == outlet:
                    continue
                ia = index[a]
                G[ia][ia] += g
                if bnode != outlet:
                    G[ia][index[bnode]] -= g
        rhs[index[inlet]] += Q_total
        p = _solve_linear(G, rhs)
        pressures = [0.0] * n_nodes
        for n, k in index.items():
            pressures[n] = p[k]
        for e in edges:
            g = 1.0 / max(e.resistance(e.q), 1e-300)
            e.q = g * (pressures[e.i] - pressures[e.j])
        p_in = pressures[inlet]
        if p_in_prev is not None and abs(p_in - p_in_prev) <= tol * max(abs(p_in), 1e-30):
            break
        p_in_prev = p_in
    return pressures[inlet]


def _uniformity(flows: List[float]) -> float:
    n = len(flows)
    if n == 0:
        return 1.0
    s1 = sum(abs(q) for q in flows)
    s2 = sum(q * q for q in flows)
    if s2 <= 0:
        return 1.0
    return (s1 * s1) / (n * s2)


# ---------------------------------------------------------------------------
# Per-layout graph builders
# ---------------------------------------------------------------------------

def _fin_geometry(case, stack, op):
    t = float(case.fin_thickness_mm) * 1e-3
    b = float(case.channel_gap_mm) * 1e-3
    H_mm = case.fin_height_mm if case.fin_height_mm is not None else stack.core_height_mm
    H = float(H_mm) * 1e-3
    n_fin = mbc._computed_fin_count(stack, case)
    n_channel = case.channel_count if case.channel_count else n_fin + 1
    arc = 1.0
    if case.family.lower().strip() == "wavy_fin":
        arc = mbc._arc_factor(case.wave_amplitude_mm * 1e-3, case.wavelength_mm * 1e-3)
    return t, b, H, n_channel, arc


def compute(case, stack, op, arch, relative_roughness: float = 0.03,
            params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Build + solve the layout's hydraulic network for a fin-family case.

    Returns the additive `flow_network` block (spec §47). Raises nothing in
    normal use — unsupported families return {"supported": False, ...}.
    """
    p = params or {}
    family = case.family.lower().strip()
    if family not in {"straight_fin", "wavy_fin"}:
        return {
            "supported": False, "model": MODEL, "layout": arch.name,
            "note": "S6 v1 models fin families only; TPMS/pin networks are a "
                    "V5.x extension (their ΔP models are not channel-resolved).",
        }
    if case.fin_thickness_mm is None or case.channel_gap_mm is None:
        return {"supported": False, "model": MODEL, "layout": arch.name,
                "note": "fin geometry incomplete (t/b missing)"}

    rho, mu = op.rho_kg_m3, op.mu_Pa_s
    rr = relative_roughness
    Q = op.flow_m3_s
    t, b, H, n_channel, arc = _fin_geometry(case, stack, op)
    L_core = stack.core_length_mm * 1e-3
    layout = (arch.name or "center_feed_bidirectional").strip()

    edges: List[_Edge] = []
    assumptions: List[str] = []
    warnings: List[str] = []
    path_labels: List[str] = []
    path_edges: List[_Edge] = []          # one representative edge per parallel path

    if layout in {"single_pass", "u_flow_side_feed_lumped"} or (
            layout not in {"center_feed_bidirectional",
                           "top_jet_slot_centre_rib_bidirectional",
                           "serpentine_n_pass", "u_flow_side_feed",
                           "distributed_jet_compartments"}):
        # Single composite branch — identical math to the solver's lumped model.
        if layout != "single_pass":
            warnings.append(f"layout {layout!r} has no dedicated S6 graph; "
                            "using the lumped single-branch model.")
        L_path = arch.resolved_path_length_m(stack) * arc
        ch = _lam_channel(n_channel, b, H, L_path, rho, mu, rr)
        e = _Edge(0, 1, "core", [ch, _minor(arch.header_K_total, ch["A"], rho)])
        edges = [e]
        path_edges = [e]
        path_labels = ["core"]
        n_nodes, inlet, outlet = 2, 0, 1

    elif layout in {"center_feed_bidirectional", "top_jet_slot_centre_rib_bidirectional"}:
        # inlet plenum (0) -> two half-paths in parallel -> outlet (1).
        # Each half-path sees the full channel bundle at half flow, path L/2·arc,
        # with the lumped header K on its own velocity — the solver's exact model,
        # now expressed as a real 2-branch network (splits are solved, not assumed).
        L_path = arch.resolved_path_length_m(stack) * arc
        for k, lab in enumerate(("half_path_A", "half_path_B")):
            ch = _lam_channel(n_channel, b, H, L_path, rho, mu, rr)
            e = _Edge(0, 1, lab, [ch, _minor(arch.header_K_total, ch["A"], rho)])
            edges.append(e)
            path_edges.append(e)
            path_labels.append(lab)
        n_nodes, inlet, outlet = 2, 0, 1
        if layout.startswith("top_jet"):
            assumptions.append("jet slot entry loss is inside header_K_total "
                               "(v6 convention); slot detail pending CFD (TD-11). "
                               "The rib crown is impingement-shaped to soften the "
                               "central turn (design hypothesis, FC-7 — uncredited "
                               "until CFD).")

    elif layout == "serpentine_n_pass":
        # Series chain: each pass uses 1/n of the transverse width (velocity ×n).
        n_pass = int(p.get("n_pass", 0)) or max(2, round((arch.path_length_mm or 0)
                                                          / max(stack.core_length_mm, 1e-9))) or 3
        n_pass = max(2, min(6, n_pass))
        n_ch_pass = max(1, n_channel // n_pass)
        node = 0
        for k in range(n_pass):
            ch = _lam_channel(n_ch_pass, b, H, L_core * arc, rho, mu, rr)
            comps = [ch]
            if k == 0:
                comps.append(_minor(K_PORT, ch["A"], rho))
            if k == n_pass - 1:
                comps.append(_minor(K_PORT, ch["A"], rho))
            if k > 0:
                comps.append(_minor(K_BEND_180, ch["A"], rho))
            e = _Edge(node, node + 1, f"pass_{k + 1}", comps)
            edges.append(e)
            node += 1
        path_edges = [edges[0]]
        path_labels = ["serpentine"]
        n_nodes, inlet, outlet = node + 1, 0, node
        warnings.append(
            f"S6 serpentine resolves per-pass width (n_ch/{n_pass} -> velocity "
            "x n); the screening solver keeps full-width velocity, so the two "
            "ΔP values legitimately differ — S6 is the finer model here.")

    elif layout == "u_flow_side_feed":
        # Ladder: feed header along one side taps G channel groups to a return
        # header on the other side. U-type (ports at the same end) by default.
        G = int(p.get("n_groups", _U_FLOW_GROUPS))
        header_w = float(p.get("header_width_mm", _U_FLOW_HEADER_W_MM)) * 1e-3
        port = str(p.get("port_config", "u")).lower()
        n_ch_g = max(1, n_channel // G)
        seg_L = (stack.core_width_mm * 1e-3) / G
        # nodes: 0 = inlet plenum, feed f_1..f_G = 1..G, return r_1..r_G = G+1..2G,
        # outlet = 2G+1.
        f0, r0, outlet = 1, 1 + G, 2 * G + 1
        A_hdr = header_w * H
        edges.append(_Edge(0, f0, "port_in",
                           [_minor(K_PORT, A_hdr, rho), _rect_duct(header_w, H, seg_L / 2, rho, mu)]))
        for g in range(G - 1):
            edges.append(_Edge(f0 + g, f0 + g + 1, f"feed_seg_{g + 1}",
                               [_rect_duct(header_w, H, seg_L, rho, mu)]))
            edges.append(_Edge(r0 + g, r0 + g + 1, f"return_seg_{g + 1}",
                               [_rect_duct(header_w, H, seg_L, rho, mu)]))
        for g in range(G):
            ch = _lam_channel(n_ch_g, b, H, L_core * arc, rho, mu, rr)
            e = _Edge(f0 + g, r0 + g, f"group_{g + 1}",
                      [ch, _minor(max(arch.header_K_total - 2 * K_PORT, 0.5), ch["A"], rho)])
            edges.append(e)
            path_edges.append(e)
            path_labels.append(f"group_{g + 1}")
        exit_node = r0 if port == "u" else r0 + G - 1
        edges.append(_Edge(exit_node, outlet, "port_out",
                           [_minor(K_PORT, A_hdr, rho), _rect_duct(header_w, H, seg_L / 2, rho, mu)]))
        n_nodes, inlet = 2 * G + 2, 0
        assumptions.append(
            f"feed/return header width assumed {header_w * 1e3:.1f} mm x fin height "
            f"(no measured header geometry); {G} channel groups; "
            f"{'U' if port == 'u' else 'Z'}-type ports. Refine when the housing is drawn.")

    elif layout == "distributed_jet_compartments":
        # ICE rev 3 (mesh-verified 2026-07-23): n ducted slots feed alternating
        # compartments; interdigitated return gaps collect along the transverse
        # axis and vent at BOTH part sides into the housing plenum.
        n_jets = int(p.get("n_jets", 0)) or max(1, arch.n_parallel_paths // 2)
        pitch = float(p.get("compartment_pitch_mm", 0.0)) * 1e-3 or L_core / (2.0 * n_jets)
        span = (stack.core_width_mm - 2.0 * case.side_margin_mm) * 1e-3
        duct_w = float(p.get("duct_width_mm", ICE_DUCT_W_MM)) * 1e-3
        duct_h = float(p.get("duct_height_mm", ICE_DUCT_H_MM)) * 1e-3
        gap_w = float(p.get("gap_width_mm", ICE_GAP_W_MM)) * 1e-3
        gap_h = float(p.get("gap_height_mm", ICE_GAP_H_MM)) * 1e-3
        # nodes: 0 inlet plenum; ducts d_i = 1..n; gaps g_j = n+1..n+n+1 (n+1 of
        # them, interdigitated with end gaps); outlet = n + n + 2.
        d0, g0 = 1, 1 + n_jets
        outlet = g0 + n_jets + 1
        n_ch_comp = max(1, int(span / (t + b)))
        A_win = duct_w * min(span, 26.0e-3)
        for i in range(n_jets):
            d = d0 + i
            edges.append(_Edge(0, d, f"window_{i + 1}",
                               [_minor(K_PORT, A_win, rho),
                                _rect_duct(duct_w, duct_h, span / 4.0, rho, mu),
                                _minor(K_SLOT_TURN, duct_w * span, rho)]))
            for side, j in (("L", i), ("R", i + 1)):
                ch = _lam_channel(n_ch_comp, b, H, (pitch / 2.0) * arc, rho, mu, rr)
                e = _Edge(d, g0 + j, f"cross_{i + 1}{side}",
                          [ch, _minor(K_SLOT_TURN, ch["A"], rho)])
                edges.append(e)
                path_edges.append(e)
                path_labels.append(f"cross_{i + 1}{side}")
        A_gap = gap_w * gap_h
        for j in range(n_jets + 1):
            edges.append(_Edge(g0 + j, outlet, f"gap_out_{j + 1}",
                               [_rect_duct(gap_w, gap_h, span / 4.0, rho, mu),
                                _minor(K_GAP_EXIT, 2.0 * A_gap, rho)]))
        n_nodes, inlet = outlet + 1, 0
        assumptions.append(
            f"ICE rev 3 mesh-measured geometry (final mm): {n_jets} feed ducts "
            f"{duct_w * 1e3:.2f}x{duct_h * 1e3:.2f} at {2 * pitch * 1e3:.2f} pitch, return gaps "
            f"{gap_w * 1e3:.2f}x{gap_h * 1e3:.2f} venting both sides; compartment pitch "
            f"{pitch * 1e3:.2f}. Duct distribution along its span treated as lumped "
            "(L/4 effective); slot/turn K values are estimates pending CFD (TD-10/11).")
        assumptions.append(
            "ducts are the FEED side — the pump inlet enters via the top "
            "windows; the interdigitated gaps return to the side exits "
            "(user 2026-07-23, spec §54 Q1 resolved). The network is "
            "symmetric under feed/return swap, so this sets the arrow "
            "directions, not the numbers.")

    else:  # pragma: no cover — guarded above
        return {"supported": False, "model": MODEL, "layout": layout}

    dP = _solve_network(n_nodes, edges, inlet, outlet, Q)

    # Per-kind ΔP split via dissipation / Q_total (exact for series-parallel).
    diss: Dict[str, float] = {}
    for e in edges:
        for kind, dpe in e.split_deltaP().items():
            diss[kind] = diss.get(kind, 0.0) + dpe * abs(e.q)
    breakdown = {f"{k}_Pa": v / Q if Q > 0 else 0.0 for k, v in diss.items()}

    flows = [abs(e.q) for e in path_edges]
    total = sum(flows) or 1.0
    per_path = []
    for lab, e in zip(path_labels, path_edges):
        comp = e.components[0]
        A = comp.get("A", 0.0)
        v = abs(e.q) / A if A > 0 else 0.0
        Dh = comp.get("Dh", 0.0)
        per_path.append({
            "label": lab,
            "flow_fraction": abs(e.q) / total,
            "velocity_m_s": v,
            "Re": rho * v * Dh / mu if mu > 0 else 0.0,
        })
    U = _uniformity(flows)

    return {
        "supported": True,
        "model": MODEL,
        "layout": layout,
        "n_paths": len(path_edges),
        "deltaP_Pa": dP,
        "deltaP_breakdown": breakdown,
        "per_path": per_path,
        "uniformity_computed": U,
        "uniformity_assumed": arch.flow_uniformity,
        "assumptions": assumptions,
        "warnings": warnings,
    }


def reconcile(block: Dict[str, Any], solver_deltaP_Pa: float,
              tolerance: float = 0.15) -> Dict[str, Any]:
    """Attach the §49 reconciliation row: S6 total ΔP vs the KPI solver's."""
    if not block.get("supported"):
        return block
    net = block.get("deltaP_Pa", 0.0)
    ratio = net / solver_deltaP_Pa if solver_deltaP_Pa > 0 else float("inf")
    block["reconciliation"] = {
        "solver_deltaP_Pa": solver_deltaP_Pa,
        "network_deltaP_Pa": net,
        "ratio": ratio,
        "within_tolerance": abs(ratio - 1.0) <= tolerance,
        "tolerance": tolerance,
    }
    if not block["reconciliation"]["within_tolerance"]:
        block.setdefault("warnings", []).append(
            f"network ΔP differs from the solver's by {abs(ratio - 1) * 100:.0f}% "
            "(> tolerance) — the finer topology resolves losses the lumped model "
            "cannot; KPI numbers remain the solver's (spec §49).")
    return block
