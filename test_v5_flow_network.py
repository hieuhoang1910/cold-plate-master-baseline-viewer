"""
07_WebApp/test_v5_flow_network.py
=================================
V5.1 (S6): the flow-network solver + its additive API block (spec §47).

Contract:
  * single-pass and center-feed networks REPRODUCE the lumped solver dP
    exactly (same fRe + K math, finer topology) — reconciliation ratio 1;
  * center-feed splits exactly 50/50 by solved symmetry (not by assumption);
  * serpentine dP equals the closed-form per-pass path sum (width/n per pass),
    with the divergence-from-screening-solver warning;
  * u-flow ladder computes real maldistribution: uniformity < 1, improving
    with a wider header; U-type vs Z-type differ;
  * distributed-jet (ICE rev 3 mesh geometry) solves 2n crossings with mirror
    symmetry and an exact friction+minor dP decomposition;
  * use_computed_uniformity is opt-in: default results byte-identical (parity
    suite guards goldens); flag on -> uniformity replaced + warning;
  * non-fin families carry no flow_network block (additive discipline).

Run: python 07_WebApp/test_v5_flow_network.py  (exit 0 = all pass)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  (puts engine/ on sys.path)
import flow_network as fnet  # noqa: E402
import master_baseline_calculator as mbc  # noqa: E402

_fails = 0
_passes = 0


def check(cond, msg):
    global _fails, _passes
    if cond:
        _passes += 1; print(f"  [PASS] {msg}")
    else:
        _fails += 1; print(f"  [FAIL] {msg}")


def approx(a, b, rel=1e-9):
    return abs(a - b) <= rel * max(abs(a), abs(b), 1e-12)


M1_CASE = {"family": "wavy_fin", "fin_thickness_mm": 0.12, "channel_gap_mm": 0.15,
           "fin_height_mm": 5.5, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5}

# --------------------------------------------------------------------------
print("single-pass — S6 reproduces the lumped solver exactly")
out = server.evaluate_payload({
    "case": dict(M1_CASE),
    "architecture": {"name": "single_pass", "n_parallel_paths": 1,
                     "header_K_total": 0.5},
})
fb = out.get("flow_network") or {}
check(fb.get("supported") is True, "fin family carries a flow_network block")
rec = fb.get("reconciliation") or {}
check(approx(rec.get("network_deltaP_Pa", 0), out["DeltaP_Pa"]),
      f"network dP == solver dP ({rec.get('network_deltaP_Pa', 0):.1f} Pa)")
check(approx(rec.get("ratio", 0), 1.0), "reconciliation ratio == 1 (exact)")
bd = fb["deltaP_breakdown"]
check(approx(bd.get("friction_Pa", 0) + bd.get("minor_Pa", 0), fb["deltaP_Pa"], rel=1e-6),
      "dP decomposition sums to the total")

# --------------------------------------------------------------------------
print("center-feed — solved 50/50 split, exact reconciliation")
out = server.evaluate_payload({"case": dict(M1_CASE)})   # default arch = center-feed
fb = out.get("flow_network") or {}
fr = [p["flow_fraction"] for p in fb.get("per_path", [])]
check(len(fr) == 2 and approx(fr[0], 0.5) and approx(fr[1], 0.5),
      f"two half-paths split exactly 50/50 (got {fr})")
check(approx(fb.get("uniformity_computed", 0), 1.0, rel=1e-9),
      "computed uniformity == 1.0 for the symmetric split")
check(approx((fb.get("reconciliation") or {}).get("ratio", 0), 1.0),
      "center-feed reconciliation ratio == 1 (exact)")

# --------------------------------------------------------------------------
print("serpentine — closed-form per-pass path sum")
case = mbc.GeometryCase(design_id="s", **M1_CASE)
stack = mbc.StackBasis()
op = mbc.OperatingPoint()
arch = mbc.FlowArchitecture(name="serpentine_n_pass", n_parallel_paths=1,
                            path_length_mm=3 * stack.core_length_mm,
                            header_K_total=0.5 + 2.2 * 2)
blk = fnet.compute(case, stack, op, arch, relative_roughness=0.03,
                   params={"n_pass": 3})
# independent hand sum (same correlations, explicit formula)
t, b, H = 0.12e-3, 0.15e-3, 5.5e-3
n_fin = mbc._computed_fin_count(stack, case)
n_ch = (n_fin + 1) // 3
arc = mbc._arc_factor(0.55e-3, 2.5e-3)
A = n_ch * b * H
Dh = 2 * b * H / (b + H)
v = op.flow_m3_s / A
Re = op.rho_kg_m3 * v * Dh / op.mu_Pa_s
fre = mbc._shah_london_fre(min(b, H) / max(b, H)) * mbc._roughness_factor(0.03, Re)
L = stack.core_length_mm * 1e-3 * arc
dp_hand = 3 * (fre * 2 * op.mu_Pa_s * v * L / (Dh * Dh)) \
    + (2 * fnet.K_PORT + 2 * fnet.K_BEND_180) * 0.5 * op.rho_kg_m3 * v * v
check(approx(blk["deltaP_Pa"], dp_hand, rel=1e-9),
      f"3-pass serpentine dP == hand path sum ({dp_hand:.0f} Pa)")
check(any("per-pass width" in w for w in blk["warnings"]),
      "serpentine flags its divergence from the screening solver")

# --------------------------------------------------------------------------
print("u-flow — real maldistribution from the header ladder")
arch_u = mbc.FlowArchitecture(name="u_flow_side_feed", n_parallel_paths=1,
                              header_K_total=2.5, flow_uniformity=0.90)
u_narrow = fnet.compute(case, stack, op, arch_u, params={"header_width_mm": 1.0})
u_wide = fnet.compute(case, stack, op, arch_u, params={"header_width_mm": 6.0})
u_z = fnet.compute(case, stack, op, arch_u,
                   params={"header_width_mm": 1.0, "port_config": "z"})
check(u_narrow["uniformity_computed"] < 1.0,
      f"narrow header -> computed uniformity < 1 ({u_narrow['uniformity_computed']:.4f})")
check(u_wide["uniformity_computed"] > u_narrow["uniformity_computed"],
      f"wider header improves uniformity ({u_wide['uniformity_computed']:.4f} > "
      f"{u_narrow['uniformity_computed']:.4f})")
check(approx(sum(p["flow_fraction"] for p in u_narrow["per_path"]), 1.0, rel=1e-9),
      "group fractions sum to 1")
pat_u = [p["flow_fraction"] for p in u_narrow["per_path"]]
pat_z = [p["flow_fraction"] for p in u_z["per_path"]]
check(any(abs(a - c) > 1e-6 for a, c in zip(pat_u, pat_z)),
      "U-type and Z-type ports give different distributions")
check(any("header width assumed" in a for a in u_narrow["assumptions"]),
      "u-flow states its header-geometry assumption")

# --------------------------------------------------------------------------
print("distributed-jet — ICE rev 3 network (mesh-measured geometry)")
stack_ice = mbc.StackBasis(core_width_mm=28.0, core_length_mm=28.0)
arch_dj = mbc.FlowArchitecture(name="distributed_jet_compartments",
                               n_parallel_paths=20, header_K_total=1.5)
dj = fnet.compute(case, stack_ice, op, arch_dj)
check(dj["supported"] and dj["n_paths"] == 20,
      f"10 ducts -> 20 crossing paths (got {dj['n_paths']})")
frs = {p["label"]: p["flow_fraction"] for p in dj["per_path"]}
check(approx(sum(frs.values()), 1.0, rel=1e-9), "crossing fractions sum to 1")
check(approx(frs["cross_1L"], frs["cross_10R"], rel=1e-6)
      and approx(frs["cross_3L"], frs["cross_8R"], rel=1e-6),
      "mirror symmetry: cross_1L == cross_10R, cross_3L == cross_8R")
check(0.5 < dj["uniformity_computed"] <= 1.0 + 1e-12,
      f"uniformity in (0.5, 1] ({dj['uniformity_computed']:.4f})")
bd = dj["deltaP_breakdown"]
check(approx(bd.get("friction_Pa", 0) + bd.get("minor_Pa", 0), dj["deltaP_Pa"], rel=1e-6),
      "distributed-jet dP decomposition sums to the total")
check(any("ICE rev 3 mesh-measured" in a for a in dj["assumptions"])
      and any("§54 Q1" in a or "feed-vs-return" in a for a in dj["assumptions"]),
      "assumptions carry mesh provenance + the open feed/return note")

# --------------------------------------------------------------------------
print("KPI coupling — use_computed_uniformity is opt-in")
pay_u = {"case": dict(M1_CASE),
         "architecture": {"name": "u_flow_side_feed", "n_parallel_paths": 1,
                          "header_K_total": 2.5, "flow_uniformity": 0.90}}
base = server.evaluate_payload(pay_u)
coupled = server.evaluate_payload({**pay_u, "use_computed_uniformity": True,
                                   "flow_network_params": {"header_width_mm": 1.0}})
check("applied_to_kpis" not in (base.get("flow_network") or {}),
      "flag off: computed uniformity NOT applied")
check((coupled.get("flow_network") or {}).get("applied_to_kpis") is True,
      "flag on: block records applied_to_kpis")
check(not approx(coupled["R_jc_K_W"], base["R_jc_K_W"], rel=1e-12),
      f"flag on changes R_jc ({base['R_jc_K_W']:.6f} -> {coupled['R_jc_K_W']:.6f})")
check(any("use_computed_uniformity" in w for w in coupled.get("warnings", [])),
      "coupled result carries the opt-in warning")

# --------------------------------------------------------------------------
print("additive discipline — non-fin families carry no block")
gy = server.evaluate_payload({
    "case": {"family": "gyroid_tpms", "tpms_type": "gyroid",
             "unit_cell_mm": 2.5, "wall_thickness_mm": 0.12},
})
check("flow_network" not in gy, "gyroid result has no flow_network key")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} failed, {_passes} passed.")
sys.exit(1)
