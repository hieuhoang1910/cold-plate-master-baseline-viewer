"""
07_WebApp/test_v2_pin_fin.py
============================
V2.3 acceptance tests: the S1 pin-fin solver (pin_fin.py) + its dispatch through
the (forked) master calculator.

Contract:
  * pin_fin leaves SCREENING_ONLY -> a plain PASS/FAIL status (ANALYTICAL_LIT);
  * correlations behave sanely (Nu ~ Re^0.5, dP rises with flow, guardrail
    warnings fire) and land in the right order of magnitude vs a water micro-pin
    anchor (Kosar & Peles 2006-class);
  * the 5 golden fin/gyroid cases are untouched by the fork (parity still green).

Run:
    python 07_WebApp/test_v2_pin_fin.py
Exit 0 = all pass.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  (engine/ on sys.path)
import pin_fin  # noqa: E402
import master_baseline_calculator as mbc  # noqa: E402

_fails = 0
_passes = 0


def check(cond: bool, msg: str) -> None:
    global _fails, _passes
    if cond:
        _passes += 1
        print(f"  [PASS] {msg}")
    else:
        _fails += 1
        print(f"  [FAIL] {msg}")


# common water-ish call kwargs for the bare solver
def _call(**over):
    kw = dict(
        pin_diameter_mm=0.8, pin_pitch_mm=1.4, fin_height_mm=5.5, pattern="staggered",
        core_width_mm=35.0, core_length_mm=28.0, core_volume_m3=35e-3 * 28e-3 * 5.5e-3,
        cooled_area_m2=35e-3 * 28e-3, flow_m3_s=2.65 / 60000.0, n_parallel_paths=2,
        rho=997.0, mu=0.00089, k_fluid=0.60, cp=4181.0, k_solid=340.0,
        header_K_total=1.5,
    )
    kw.update(over)
    return pin_fin.evaluate_pin_fin(**kw)


# --------------------------------------------------------------------------
print("pin_fin solver — physical sanity")
r = _call()
check(r["reynolds"] > 0 and r["Nu"] > 0 and r["UA"] > 0, "produces positive Re, Nu, UA")
check(r["pin_count"] == int(35.0 / 1.4) * int(28.0 / 1.4),
      f"pin count = cols*rows (got {r['pin_count']})")
check(0 < r["eta_f"] < 1, f"pin efficiency in (0,1) (got {r['eta_f']:.3f})")
check(0.3 < r["open_volume_fraction"] < 1.0, f"open fraction sane (got {r['open_volume_fraction']:.3f})")

# Nu ~ Re^0.5: quadruple the flow -> Nu should ~ double
r2 = _call(flow_m3_s=4 * 2.65 / 60000.0)
ratio = r2["Nu"] / r["Nu"]
check(1.8 < ratio < 2.2, f"4x flow ~doubles Nu (Re^0.5 scaling; ratio={ratio:.2f})")
check(r2["delta_p"] > r["delta_p"], "higher flow -> higher pressure drop")

print("pin_fin solver — validity guardrails")
slow = _call(flow_m3_s=0.05 / 60000.0)   # drive Re_D well below 40
check(any("Re_D" in w for w in slow["warnings"]), "low Re fires the Re_D guardrail warning")
tight = _call(pin_pitch_mm=0.9)          # S/d = 1.125 < 1.25
check(any("pitch/diameter" in w for w in tight["warnings"]), "tight pitch fires S/d warning")
check(any("ANALYTICAL_LIT" in w for w in r["warnings"]), "always carries the ANALYTICAL_LIT screening note")
try:
    _call(pin_pitch_mm=0.8)              # pitch == diameter -> no gap
    check(False, "pitch <= diameter should raise")
except ValueError:
    check(True, "pitch <= diameter raises ValueError")

print("pin_fin solver — water micro-pin order-of-magnitude anchor")
# Kosar & Peles (2006) circular micro pin-fins in water: Re_D ~ 10^2, Nu_D ~ few.
# Zukauskas single-cylinder overpredicts (no endwall), so accept within ~3x.
anchor = _call(pin_diameter_mm=0.1, pin_pitch_mm=0.15, fin_height_mm=0.243,
               core_width_mm=1.8, core_length_mm=10.0, cooled_area_m2=1.8e-3 * 10e-3,
               core_volume_m3=1.8e-3 * 10e-3 * 0.243e-3, flow_m3_s=5.0 / 60.0 / 1e6,
               n_parallel_paths=1)
check(20 < anchor["reynolds"] < 1200, f"anchor Re_D in the fitted band (got {anchor['reynolds']:.0f})")
check(1.0 < anchor["Nu"] < 30.0, f"anchor Nu_D order-of-magnitude vs literature (got {anchor['Nu']:.1f})")

# --------------------------------------------------------------------------
print("dispatch — evaluate_case routes pin_fin off SCREENING_ONLY")
stack = mbc.StackBasis(**{k: server.DIE_COVERAGE_STACK[k] for k in server.DIE_COVERAGE_STACK
                          if k in {f.name for f in __import__('dataclasses').fields(mbc.StackBasis)}})
op = mbc.OperatingPoint()
arch = mbc.FlowArchitecture(name="center_feed_bidirectional", n_parallel_paths=2,
                            path_length_mm=14.0, header_K_total=1.5, flow_uniformity=1.0)
case = mbc.GeometryCase(design_id="pin_test", family="pin_fin",
                        pin_diameter_mm=0.8, pin_pitch_mm=1.4, pin_pattern="staggered",
                        fin_height_mm=5.5)
res = mbc.evaluate_case(case, stack, op, arch)
check("SCREENING_ONLY" not in res.kpi_status,
      f"pin_fin no longer SCREENING_ONLY (status={res.kpi_status})")
check(res.R_jc_K_W > 0 and res.eta_f is not None, "pin_fin result has R_jc + pin efficiency")

print("dispatch — via the API evaluate_payload (frontend path)")
out = server.evaluate_payload({"case": {"family": "pin_fin", "pin_diameter_mm": 0.8,
                                        "pin_pitch_mm": 1.4, "pin_pattern": "staggered",
                                        "fin_height_mm": 5.5}})
check(out["R_jc_K_W"] is not None and "SCREENING_ONLY" not in out["kpi_status"],
      f"POST /api/evaluate pin_fin works (status={out['kpi_status']})")

print("schema — pin pedigree upgraded")
fam = next(f for f in server.schema_payload()["families"] if f["family"] == "pin_fin")
check(fam["status"] == "ANALYTICAL_LIT", f"schema marks pin_fin ANALYTICAL_LIT (got {fam['status']})")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} check(s) failed, {_passes} passed.")
sys.exit(1)
