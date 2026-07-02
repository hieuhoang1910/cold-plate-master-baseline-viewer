"""
07_WebApp/test_v2_sweep.py
==========================
Optimizer family-aware sweep fix: TPMS and pin designs now sweep their OWN
geometry (not fin variables), and invalid grid points don't crash the sweep.

Run: python 07_WebApp/test_v2_sweep.py  (exit 0 = all pass)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402

_fails = 0
_passes = 0


def check(cond, msg):
    global _fails, _passes
    if cond:
        _passes += 1; print(f"  [PASS] {msg}")
    else:
        _fails += 1; print(f"  [FAIL] {msg}")


def _distinct_rjc(res):
    return len({round(g["R_jc_K_W"], 6) for g in res["grid"] if g["R_jc_K_W"] is not None})


BASE_STACK = server.DIE_COVERAGE_STACK
ARCH = server.DIE_COVERAGE_ARCH

print("allowed sweep vars include TPMS + pin geometry")
allowed = server._SWEEP_VARS | server._SWEEP_OP_VARS
for v in ("unit_cell_mm", "wall_thickness_mm", "cell_grading", "pin_diameter_mm", "pin_pitch_mm", "flow_lpm"):
    check(v in allowed, f"'{v}' is sweepable")

print("gyroid — unit_cell x wall actually varies R_jc (was flat before)")
gbase = {"case": {"family": "gyroid_tpms", "tpms_type": "gyroid", "process_route": "LMM",
                  "unit_cell_mm": 2.5, "wall_thickness_mm": 0.12, "cell_grading": 0.0},
         "stack": BASE_STACK, "operating": {"flow_lpm": 2.65}, "architecture": ARCH}
rg = server.sweep_payload({"base": gbase, "x": {"var": "unit_cell_mm", "min": 1.5, "max": 3.5, "steps": 6},
                           "y": {"var": "wall_thickness_mm", "min": 0.1, "max": 0.3, "steps": 6}, "objective": "R_jc_K_W"})
check(_distinct_rjc(rg) > 10, f"gyroid unit_cell×wall gives many distinct R_jc ({_distinct_rjc(rg)})")
check(rg["optimum"] is not None, "gyroid sweep has an optimum")

print("gyroid — cell grading is a sweep axis")
rgr = server.sweep_payload({"base": gbase, "x": {"var": "cell_grading", "min": 0.0, "max": 1.0, "steps": 5},
                            "y": {"var": "flow_lpm", "min": 1.0, "max": 4.0, "steps": 5}, "objective": "R_jc_K_W"})
check(_distinct_rjc(rgr) > 5, f"grading×flow varies R_jc ({_distinct_rjc(rgr)})")

print("pin — d x pitch varies, and invalid points (d>=pitch) don't crash the sweep")
pbase = {"case": {"family": "pin_fin", "process_route": "LMM", "pin_diameter_mm": 0.8,
                  "pin_pitch_mm": 1.4, "pin_pattern": "staggered", "fin_height_mm": 5.5},
         "stack": BASE_STACK, "operating": {"flow_lpm": 2.65}, "architecture": ARCH}
rp = server.sweep_payload({"base": pbase, "x": {"var": "pin_diameter_mm", "min": 0.4, "max": 1.5, "steps": 6},
                           "y": {"var": "pin_pitch_mm", "min": 0.8, "max": 3.0, "steps": 6}, "objective": "R_jc_K_W"})
invalid = [g for g in rp["grid"] if g["kpi_status"] == "INVALID"]
check(_distinct_rjc(rp) > 10, f"pin d×pitch gives many distinct R_jc ({_distinct_rjc(rp)})")
check(len(invalid) > 0 and all(not g["feasible"] for g in invalid),
      f"invalid combos (dia>=pitch) marked INVALID + infeasible, sweep survives ({len(invalid)} pts)")
check(rp["optimum"] is not None and rp["optimum"]["feasible"], "pin optimum is a valid feasible point")

print("tier-2 — the problem (coolant + budgets) constrains the optimum")
fbase = {"case": {"family": "wavy_fin", "process_route": "LMM", "fin_thickness_mm": 0.1,
                  "channel_gap_mm": 0.15, "fin_height_mm": 5.5, "side_margin_mm": 0.9,
                  "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5},
         "stack": BASE_STACK, "operating": {"flow_lpm": 2.65}, "architecture": ARCH}
AX = {"x": {"var": "channel_gap_mm", "min": 0.1, "max": 0.4, "steps": 6},
      "y": {"var": "flow_lpm", "min": 1.0, "max": 4.0, "steps": 6}}

r_free = server.sweep_payload({"base": fbase, **AX, "objective": "R_jc_K_W"})
tight_pump = 0.5 * max(g["pump_power_W"] for g in r_free["grid"] if g["pump_power_W"])
r_tight = server.sweep_payload({
    "base": {**fbase, "targets": {"T_j_max_C": 100.0, "limit_pump_W": tight_pump}},
    **AX, "objective": "R_jc_K_W"})
og = r_tight["gates"]
check(og is not None and abs(og["limit_pump_W"] - tight_pump) < 1e-12,
      "sweep echoes the budgets it judged against (gates.limit_pump_W)")
check(og is not None and og["limit_R_jc_K_W"] is not None,
      "T_j target resolves to an R_jc gate in the echo")
ot = r_tight["optimum"]
check(ot is not None and ot["feasible"] and ot["pump_power_W"] <= tight_pump + 1e-12,
      f"optimum respects the pump budget ({ot['pump_power_W']:.3f} <= {tight_pump:.3f} W)")
of = r_free["optimum"]
check(of is not None and of["pump_power_W"] > tight_pump,
      "unconstrained optimum would have blown that budget (constraint bites)")

r_glycol = server.sweep_payload({"base": {**fbase, "coolant": "pg25"}, **AX, "objective": "R_jc_K_W"})
same_pt = lambda res: next(g for g in res["grid"] if g["R_jc_K_W"] is not None)  # noqa: E731
check(abs(same_pt(r_glycol)["R_jc_K_W"] - same_pt(r_free)["R_jc_K_W"]) > 1e-6,
      "coolant is forwarded into the sweep (pg25 shifts R_jc vs water)")

r_imposs = server.sweep_payload({
    "base": {**fbase, "targets": {"T_j_max_C": 100.0, "limit_deltaP_Pa": 1.0}},
    **AX, "objective": "R_jc_K_W"})
oi = r_imposs["optimum"]
check(oi is not None and not oi["feasible"],
      "impossible budget -> graceful fallback to best overall (flagged infeasible)")

print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed."); sys.exit(0)
print(f"FAILED: {_fails} failed, {_passes} passed."); sys.exit(1)
