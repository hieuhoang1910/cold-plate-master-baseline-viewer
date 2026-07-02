"""
07_WebApp/test_v2_tpms.py
=========================
V2.4 (S2) part 1: TPMS sheet geometry derived from the minimal-surface area
coefficients, and its use in evaluate_case for the literature TPMS types.

Contract:
  * SA/V = 2*(A0/a^2)/a exactly (that is the coefficient's definition);
  * evaluate_case derives SA/V / void / D_h for gyroid|diamond|schwarz_p from
    cell + wall (overriding hand-typed values) and stays screening on Nu;
  * non-literature TPMS shapes keep the hand-entered geometry;
  * the 5 golden fin/gyroid cases are untouched (parity stays green).

Run: python 07_WebApp/test_v2_tpms.py  (exit 0 = all pass)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402
import tpms_geometry as tg  # noqa: E402
import master_baseline_calculator as mbc  # noqa: E402

_fails = 0
_passes = 0


def check(cond, msg):
    global _fails, _passes
    if cond:
        _passes += 1; print(f"  [PASS] {msg}")
    else:
        _fails += 1; print(f"  [FAIL] {msg}")


def approx(a, b, rel=1e-6):
    return abs(a - b) <= rel * max(abs(a), abs(b), 1e-12)


# --------------------------------------------------------------------------
print("tpms_geometry — SA/V from the minimal-surface area coefficient")
g = tg.geometry("gyroid", unit_cell_mm=2.5, wall_thickness_mm=0.12)
# SA/V = 2 * 3.0915 / 0.0025
check(approx(g["surface_area_density_m2_m3"], 2 * 3.0915 / 0.0025),
      f"gyroid SA/V = 2*k/a exactly (got {g['surface_area_density_m2_m3']:.1f} m2/m3)")
check(approx(g["relative_density"], 3.0915 * (0.12 / 2.5)),
      f"gyroid rho* = k*(t/a) (got {g['relative_density']:.4f})")
check(approx(g["void_fraction"], 1 - g["relative_density"]), "void = 1 - rho*")
# diamond has the largest area coefficient -> densest surface
gd = tg.geometry("diamond", 2.5, 0.12)
gp = tg.geometry("schwarz_p", 2.5, 0.12)
check(gd["surface_area_density_m2_m3"] > g["surface_area_density_m2_m3"] > gp["surface_area_density_m2_m3"],
      "SA/V ordering diamond > gyroid > schwarz_p (area-coefficient ordering)")
# smaller cell -> higher SA/V (inverse in a)
check(tg.geometry("gyroid", 1.25, 0.12)["surface_area_density_m2_m3"]
      > g["surface_area_density_m2_m3"], "halving the cell raises SA/V")
check(tg.is_lit_type("gyroid") and not tg.is_lit_type("lidinoid"),
      "only the three literature types are handled")
thick = tg.geometry("gyroid", 2.0, 0.8)   # wall/cell = 0.4 -> warn + clamp
check(any("thin-sheet" in w or "clamped" in w for w in thick["warnings"]),
      "thick wall warns (thin-sheet approximation)")

# --------------------------------------------------------------------------
print("evaluate_case — derives geometry for literature TPMS, overriding hand values")
stack = mbc.StackBasis(**{k: server.DIE_COVERAGE_STACK[k]
                          for k in server.DIE_COVERAGE_STACK})
op = mbc.OperatingPoint()
arch = mbc.FlowArchitecture(name="center_feed_bidirectional", n_parallel_paths=2,
                            path_length_mm=14.0, header_K_total=1.5, flow_uniformity=1.0)
# deliberately WRONG hand-typed SA/V (9999) — the derived value must win
case = mbc.GeometryCase(design_id="gyr", family="gyroid_tpms", tpms_type="gyroid",
                        unit_cell_mm=2.5, wall_thickness_mm=0.12,
                        surface_area_density_m2_m3=9999.0, void_fraction=0.99,
                        hydraulic_diameter_mm=9.9)
res = mbc.evaluate_case(case, stack, op, arch)
check(approx(res.raw_SA_V_m2_m3, 2 * 3.0915 / 0.0025, rel=1e-3),
      f"derived SA/V used, not the 9999 hand value (got {res.raw_SA_V_m2_m3:.0f})")
check(any("minimal-surface area coefficient" in w for w in res.warnings),
      "result explains the geometry was derived")
check("SCREENING_ONLY" in res.kpi_status,
      "gyroid stays SCREENING_ONLY (Nu still generic; geometry only)")

# a non-literature TPMS shape keeps the hand-entered geometry
case2 = mbc.GeometryCase(design_id="lid", family="gyroid_tpms", tpms_type="lidinoid",
                         unit_cell_mm=2.5, wall_thickness_mm=0.12,
                         surface_area_density_m2_m3=9000.0, void_fraction=0.55,
                         hydraulic_diameter_mm=0.25)
res2 = mbc.evaluate_case(case2, stack, op, arch)
check(approx(res2.raw_SA_V_m2_m3, 9000.0, rel=1e-3),
      f"lidinoid keeps the hand-typed SA/V 9000 (got {res2.raw_SA_V_m2_m3:.0f})")

print("API — gyroid evaluate through the frontend payload derives geometry")
out = server.evaluate_payload({"case": {"family": "gyroid_tpms", "tpms_type": "gyroid",
                                        "unit_cell_mm": 2.5, "wall_thickness_mm": 0.12,
                                        "surface_area_density_m2_m3": 9999.0}})
check(abs(out["raw_SA_V_m2_m3"] - 2 * 3.0915 / 0.0025) / (2 * 3.0915 / 0.0025) < 1e-3,
      f"POST /api/evaluate derives gyroid SA/V (got {out['raw_SA_V_m2_m3']:.0f})")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} failed, {_passes} passed.")
sys.exit(1)
