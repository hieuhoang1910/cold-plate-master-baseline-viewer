"""
07_WebApp/test_v2_report.py
===========================
V2.6: mass/material estimate + k-solid R_jc uncertainty band on /api/evaluate.

Contract:
  * mass_g + material_cost_usd are attached to every result (additive);
  * "uncertainty": true adds r_jc_band with conservative (k=250) > nominal >
    optimistic (k=400) — lower conductivity => higher R_jc;
  * absent by default -> golden parity untouched (guarded by test_api_parity).

Run: python 07_WebApp/test_v2_report.py  (exit 0 = all pass)
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


CASE = {"family": "wavy_fin", "fin_thickness_mm": 0.1, "channel_gap_mm": 0.1,
        "fin_height_mm": 5.5, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5}

print("mass / material — attached to every result")
r = server.evaluate_payload({"case": CASE, "stack": server.DIE_COVERAGE_STACK})
check(r.get("mass_g") and r["mass_g"] > 0, f"mass_g present + positive ({r.get('mass_g'):.1f} g)")
check(abs(r["material_cost_usd"] - r["mass_g"] / 1000.0 * server._CU_POWDER_USD_PER_KG) < 1e-9,
      "material_cost = mass * $/kg")
check("r_jc_band" not in r, "no r_jc_band unless requested (parity-safe)")

print("uncertainty — k-solid R_jc band")
ru = server.evaluate_payload({"case": CASE, "stack": server.DIE_COVERAGE_STACK, "uncertainty": True})
b = ru["r_jc_band"]
check(b["conservative_k"] == 250.0 and b["optimistic_k"] == 400.0,
      "band spans the Cu-AM k range 250-400")
check(b["R_jc_conservative_K_W"] > b["R_jc_nominal_K_W"] > b["R_jc_optimistic_K_W"],
      f"lower k -> higher R_jc ({b['R_jc_conservative_K_W']:.4f} > {b['R_jc_nominal_K_W']:.4f} > {b['R_jc_optimistic_K_W']:.4f})")
check(abs(b["R_jc_nominal_K_W"] - ru["R_jc_K_W"]) < 1e-12, "band nominal == the result's R_jc")
# denser fins (thicker) weigh more
r_thick = server.evaluate_payload({"case": {**CASE, "fin_thickness_mm": 0.3, "channel_gap_mm": 0.1},
                                   "stack": server.DIE_COVERAGE_STACK})
check(r_thick["mass_g"] > r["mass_g"], "thicker fins -> more mass")

print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed."); sys.exit(0)
print(f"FAILED: {_fails} failed, {_passes} passed."); sys.exit(1)
