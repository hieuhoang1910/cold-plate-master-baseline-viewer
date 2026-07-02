"""
07_WebApp/test_v2_layouts.py
============================
V2.5 (S3): the layout resolver + its jet-flux coupling to the TPMS solver.

Contract:
  * layouts.resolve maps each layout to n_paths / path / header_K / uniformity /
    jet_flux_peaking; center-feed at L=28 reproduces GB202's historical knobs;
  * serpentine adds path + bend losses; u-flow drops uniformity + raises header_K;
    top-jet / distributed-jet set jet_flux_peaking = 1;
  * with a JET layout, an ungraded TPMS is penalised (centre-peaked flux over
    uniform conductance) and jet-adaptive grading RECOVERS / lowers R_conv;
  * projects resolve the architecture from the layout (GB202 unchanged);
  * parity + all prior suites stay green.

Run: python 07_WebApp/test_v2_layouts.py  (exit 0 = all pass)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402
import layouts  # noqa: E402
import tpms_correlations as tc  # noqa: E402
import projects  # noqa: E402

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


# --------------------------------------------------------------------------
print("layouts.resolve — per-layout knobs")
cf = layouts.resolve("center_feed_bidirectional", 28.0)
check(cf["n_parallel_paths"] == 2 and approx(cf["path_length_mm"], 14.0)
      and approx(cf["header_K_total"], 1.5) and cf["jet_flux_peaking"] == 0.0,
      "center-feed @ L=28 == GB202 knobs (n=2, path=14, header=1.5, jet=0)")
sp = layouts.resolve("single_pass", 28.0)
check(sp["n_parallel_paths"] == 1 and approx(sp["path_length_mm"], 28.0),
      "single_pass: n=1, path=L")
tj = layouts.resolve("top_jet_slot_centre_rib_bidirectional", 28.0)
check(tj["jet_flux_peaking"] == 1.0, "top-jet sets jet_flux_peaking=1")
ser = layouts.resolve("serpentine_n_pass", 28.0, {"n_pass": 4})
check(approx(ser["path_length_mm"], 4 * 28.0) and ser["header_K_total"] > 1.5
      and any("serpentine" in w for w in ser["warnings"]),
      "serpentine 4-pass: path=4L, +bend losses, caveat")
uf = layouts.resolve("u_flow_side_feed", 28.0)
check(uf["flow_uniformity"] < 1.0 and uf["header_K_total"] > 1.5,
      "u-flow: lower uniformity + higher header_K")
dj = layouts.resolve("distributed_jet_compartments", 28.0, {"n_jets": 3})
check(dj["n_parallel_paths"] == 6 and dj["jet_flux_peaking"] == 1.0,
      "distributed-jet 3: 2n paths + jet flux")
try:
    layouts.resolve("multi_jet_array", 28.0)
    check(False, "deferred layout should raise")
except ValueError:
    check(True, "multi_jet_array is deferred (raises)")

# --------------------------------------------------------------------------
print("jet-flux coupling — grading pays off under a jet layout")
_gk = dict(tpms_type="gyroid", unit_cell_mm=2.5, wall_thickness_mm=0.12,
           core_width_mm=35, core_length_mm=28, core_height_mm=5.5,
           core_volume_m3=35e-3 * 28e-3 * 5.5e-3, flow_m3_s=2.65 / 60000.0,
           n_parallel_paths=2, path_length_m=14e-3,
           rho=997.0, mu=0.00089, k_fluid=0.60, cp=4181.0, k_solid=340.0, header_K_total=1.5)
uni_noflux = tc.evaluate_tpms(**_gk, cell_grading=0.0, jet_flux_peaking=0.0)
uni_jet = tc.evaluate_tpms(**_gk, cell_grading=0.0, jet_flux_peaking=1.0)
grd_jet = tc.evaluate_tpms(**_gk, cell_grading=0.6, jet_flux_peaking=1.0)
check(approx(uni_noflux["R_conv"], 1.0 / uni_noflux["UA"], rel=1e-6),
      "no jet + uniform cell: R_conv = 1/UA (baseline preserved)")
check(uni_jet["R_conv"] > uni_noflux["R_conv"],
      f"jet + UNIFORM cell penalised ({uni_jet['R_conv']:.4f} > {uni_noflux['R_conv']:.4f})")
check(grd_jet["R_conv"] < uni_jet["R_conv"],
      f"jet + GRADED recovers vs jet+uniform ({grd_jet['R_conv']:.4f} < {uni_jet['R_conv']:.4f})")
check(any("jet-adaptive payoff" in w for w in grd_jet["warnings"]),
      "graded-under-jet explains the jet-adaptive payoff")

# --------------------------------------------------------------------------
print("projects — architecture resolved from the layout; GB202 unchanged")
r = projects.resolve_project(server.GB202_PROJECT)
check(r["architecture"]["n_parallel_paths"] == 2
      and approx(r["architecture"]["path_length_mm"], 14.0)
      and r["architecture"]["jet_flux_peaking"] == 0.0,
      "GB202 resolves to center-feed knobs (n=2, path=14, jet=0)")
gb_cat = server.project_catalog_payload({"project": "gb202-gpu"})
v1 = server.catalog_payload()
by_id = {c["design_id"]: c for c in v1["candidates"]}
same = all(approx(c["R_jc_K_W"], by_id[c["design_id"]]["R_jc_K_W"])
           and c["kpi_status"] == by_id[c["design_id"]]["kpi_status"]
           for c in gb_cat["candidates"])
check(same, "GB202 project still reproduces the V1 catalog candidate-for-candidate")

# a jet-layout project surfaces the jet flux
jetp = {**server.GB202_PROJECT, "id": "jt", "name": "jet",
        "architecture": {"name": "top_jet_slot_centre_rib_bidirectional"}}
rj = projects.resolve_project(jetp)
check(rj["architecture"]["jet_flux_peaking"] == 1.0,
      "top-jet project resolves jet_flux_peaking = 1")

print("schema — new layouts marked SUPPORTED")
lay = {l["layout"]: l for l in server.schema_payload()["layouts"]}
check(lay["serpentine_n_pass"]["status"] == "SUPPORTED"
      and lay["distributed_jet_compartments"]["status"] == "SUPPORTED",
      "serpentine + distributed-jet now SUPPORTED")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} failed, {_passes} passed.")
sys.exit(1)
