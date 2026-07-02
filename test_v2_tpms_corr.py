"""
07_WebApp/test_v2_tpms_corr.py
==============================
V2.4 (S2) part 2: the TPMS Nu/f correlation solver (Renon & Jeanningros 2025)
for Gyroid & Diamond, and its dispatch through the (forked) master calculator.

Contract:
  * Nu = 0.2644*Re^0.69*Pr^(1/3); Fanning f = 1.850*Re^-0.17 (gyroid ~15% higher);
  * at the cold-plate operating point the correlation is EXTRAPOLATED (Re<2961)
    and every result says so, but the predicted Nu is order-of-magnitude
    consistent with independent in-regime data (Re 50-300: Nu ~ 19-30);
  * gyroid & diamond leave SCREENING_ONLY (-> ANALYTICAL_LIT); Schwarz-P stays
    SCREENING_ONLY (no in-regime coefficients were sourced — not fabricated);
  * the 5 golden cases are untouched (parity green).

Run: python 07_WebApp/test_v2_tpms_corr.py  (exit 0 = all pass)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402
import tpms_correlations as tc  # noqa: E402
import master_baseline_calculator as mbc  # noqa: E402

_fails = 0
_passes = 0


def check(cond, msg):
    global _fails, _passes
    if cond:
        _passes += 1; print(f"  [PASS] {msg}")
    else:
        _fails += 1; print(f"  [FAIL] {msg}")


def approx(a, b, rel=1e-4):
    return abs(a - b) <= rel * max(abs(a), abs(b), 1e-12)


# --------------------------------------------------------------------------
print("tpms_correlations — Renon & Jeanningros coefficients")
check(approx(tc.nusselt(5000, 4.0), 0.2644 * 5000 ** 0.69 * 4.0 ** (1 / 3)),
      "Nu = 0.2644*Re^0.69*Pr^(1/3)")
check(tc.fanning_friction(5000, "gyroid") > tc.fanning_friction(5000, "diamond"),
      "gyroid friction > diamond at matched Re")
check(approx(tc.fanning_friction(5000, "diamond"), 1.850 * 5000 ** -0.17),
      "diamond Fanning f = 1.850*Re^-0.17")
check("gyroid" in tc.CORR_TYPES and "diamond" in tc.CORR_TYPES and "schwarz_p" not in tc.CORR_TYPES,
      "correlation covers gyroid+diamond only (not Schwarz-P)")

print("evaluate_tpms — cold-plate point is flagged extrapolated but sane")
r = tc.evaluate_tpms(tpms_type="gyroid", unit_cell_mm=2.5, wall_thickness_mm=0.12,
                     core_width_mm=35, core_length_mm=28, core_height_mm=5.5,
                     core_volume_m3=35e-3 * 28e-3 * 5.5e-3, flow_m3_s=2.65 / 60000.0,
                     n_parallel_paths=2, path_length_m=14e-3,
                     rho=997.0, mu=0.00089, k_fluid=0.60, cp=4181.0, k_solid=340.0,
                     header_K_total=1.5)
check(r["reynolds"] < 2961 and any("EXTRAPOLATED" in w for w in r["warnings"]),
      f"Re_Dh={r['reynolds']:.0f} < fit floor -> extrapolation warning fires")
check(any("ANALYTICAL_LIT" in w and "Renon" in w for w in r["warnings"]),
      "carries the Renon & Jeanningros ANALYTICAL_LIT provenance note")
check(3.0 < r["Nu"] < 60.0,
      f"Nu={r['Nu']:.1f} is order-of-magnitude consistent with in-regime data (~19-30)")
check(r["R_conv"] > 0 and r["UA"] > 0 and r["delta_p"] > 0, "produces positive R_conv, UA, dP")

# --------------------------------------------------------------------------
print("radial cell grading (jet-adaptive) — option 2 zone integration")
_gk = dict(tpms_type="gyroid", unit_cell_mm=2.5, wall_thickness_mm=0.12,
           core_width_mm=35, core_length_mm=28, core_height_mm=5.5,
           core_volume_m3=35e-3 * 28e-3 * 5.5e-3, flow_m3_s=2.65 / 60000.0,
           n_parallel_paths=2, path_length_m=14e-3,
           rho=997.0, mu=0.00089, k_fluid=0.60, cp=4181.0, k_solid=340.0, header_K_total=1.5)
uni = tc.evaluate_tpms(**_gk, cell_grading=0.0)
uni2 = tc.evaluate_tpms(**_gk)                         # default grading = 0
check(approx(uni["R_conv"], uni2["R_conv"]) and approx(uni["Nu"], uni2["Nu"]),
      "grade=0 default == explicit 0 (single-zone)")
graded = tc.evaluate_tpms(**_gk, cell_grading=0.6)
check(not approx(graded["R_conv"], uni["R_conv"], rel=1e-3),
      "grading changes R_conv (no longer viewer-only)")
# This grading law coarsens the outer (larger-area) zones, so under the model's
# uniform-base-flux assumption it nets LESS surface area -> higher R_conv. The
# jet-adaptive BENEFIT needs a centre-peaked impingement flux (V2.5 layout).
check(graded["R_conv"] > uni["R_conv"],
      f"grading raises R_conv under uniform flux (net-area; jet benefit is V2.5) "
      f"({graded['R_conv']:.4f} > {uni['R_conv']:.4f})")
check(graded["raw_SA_V_m2_m3"] < uni["raw_SA_V_m2_m3"],
      "grading nets less surface area (coarse outer zones dominate the footprint)")
check(any("radial cell grading" in w and "zones" in w for w in graded["warnings"]),
      "graded result explains the zone integration")
# through evaluate_case, grading flows end-to-end and moves R_jc
gc = mbc.GeometryCase(design_id="g", family="gyroid_tpms", tpms_type="gyroid",
                      unit_cell_mm=2.5, wall_thickness_mm=0.12, cell_grading=0.6)
gc0 = mbc.GeometryCase(design_id="g0", family="gyroid_tpms", tpms_type="gyroid",
                       unit_cell_mm=2.5, wall_thickness_mm=0.12, cell_grading=0.0)
stack0 = mbc.StackBasis(**{k: server.DIE_COVERAGE_STACK[k] for k in server.DIE_COVERAGE_STACK})
op0 = mbc.OperatingPoint()
arch0 = mbc.FlowArchitecture(name="center_feed_bidirectional", n_parallel_paths=2,
                             path_length_mm=14.0, header_K_total=1.5, flow_uniformity=1.0)
check(not approx(mbc.evaluate_case(gc, stack0, op0, arch0).R_jc_K_W,
                 mbc.evaluate_case(gc0, stack0, op0, arch0).R_jc_K_W, rel=1e-4),
      "evaluate_case: grading moves R_jc end-to-end (no longer viewer-only)")

print("dispatch — gyroid/diamond leave SCREENING_ONLY; Schwarz-P stays")
stack = mbc.StackBasis(**{k: server.DIE_COVERAGE_STACK[k] for k in server.DIE_COVERAGE_STACK})
op = mbc.OperatingPoint()
arch = mbc.FlowArchitecture(name="center_feed_bidirectional", n_parallel_paths=2,
                            path_length_mm=14.0, header_K_total=1.5, flow_uniformity=1.0)


def _eval(tpms_type):
    case = mbc.GeometryCase(design_id=tpms_type, family="gyroid_tpms", tpms_type=tpms_type,
                            unit_cell_mm=2.5, wall_thickness_mm=0.12)
    return mbc.evaluate_case(case, stack, op, arch)


gy = _eval("gyroid")
di = _eval("diamond")
sp = _eval("schwarz_p")
check("SCREENING_ONLY" not in gy.kpi_status, f"gyroid -> ANALYTICAL_LIT (status {gy.kpi_status})")
check("SCREENING_ONLY" not in di.kpi_status, f"diamond -> ANALYTICAL_LIT (status {di.kpi_status})")
check("SCREENING_ONLY" in sp.kpi_status, f"schwarz_p stays SCREENING_ONLY (status {sp.kpi_status})")
check(gy.R_jc_K_W > 0 and di.R_jc_K_W > 0, "gyroid & diamond produce finite R_jc")
# diamond has denser surface (higher area coeff) -> generally lower R_conv than gyroid
check(gy.R_th_conv_K_W != di.R_th_conv_K_W, "gyroid and diamond differ (distinct geometry)")

print("API + schema")
out = server.evaluate_payload({"case": {"family": "gyroid_tpms", "tpms_type": "gyroid",
                                        "unit_cell_mm": 2.5, "wall_thickness_mm": 0.12}})
check("SCREENING_ONLY" not in out["kpi_status"], f"POST /api/evaluate gyroid -> {out['kpi_status']}")
fam = next(f for f in server.schema_payload()["families"] if f["family"] == "gyroid_tpms")
check(fam["status"] == "ANALYTICAL_LIT", "schema marks TPMS family ANALYTICAL_LIT")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} failed, {_passes} passed.")
sys.exit(1)
