"""
07_WebApp/test_v2_targets_coolants.py
=====================================
V2.1 acceptance tests: coolant library (S4) + targets translator (S5) + the
extended /api/evaluate wiring.

The overriding contract: the V2 additions must be PURELY additive — with no
"coolant"/"targets" in the payload the result is byte-identical to V1, and
selecting "water" (the parity anchor) must not move any golden number.

Run:
    python 07_WebApp/test_v2_targets_coolants.py
Exit 0 = all pass.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  (puts engine/ on sys.path)
import coolants  # noqa: E402
import targets  # noqa: E402

CASES_JSON = ROOT / "engine" / "data" / "baseline_cases.json"

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


def approx(a: float, b: float, rel: float = 1e-9, abs_: float = 1e-12) -> bool:
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))


# --------------------------------------------------------------------------
print("S4 coolants — water is the parity anchor")
w = coolants.resolve("water", 25.0)
check(approx(w["rho_kg_m3"], 997.0), f"water@25 rho == 997.0 (got {w['rho_kg_m3']})")
check(approx(w["mu_Pa_s"], 0.00089), f"water@25 mu == 0.00089 (got {w['mu_Pa_s']})")
check(approx(w["k_fluid_W_mK"], 0.60), f"water@25 k == 0.60 (got {w['k_fluid_W_mK']})")
check(approx(w["cp_J_kgK"], 4181.0), f"water@25 cp == 4181.0 (got {w['cp_J_kgK']})")
check(w["warnings"] == [], "water@25 has no warnings")

print("S4 coolants — interpolation & extrapolation")
w32 = coolants.resolve("water", 32.5)  # midway between 25 and 40 knots
check(0.600 < w32["k_fluid_W_mK"] < 0.628, "water@32.5 k between the 25 and 40 knots")
check(w32["mu_Pa_s"] < w["mu_Pa_s"], "water viscosity falls with temperature")
hot = coolants.resolve("pg50", 85.0)  # above the 60 C table top
check(hot["extrapolated"] and hot["warnings"], "pg50@85 flags extrapolation + warning")
cust = coolants.resolve({"name": "custom", "k_fluid_W_mK": 0.7}, 25.0)
check(approx(cust["k_fluid_W_mK"], 0.7) and approx(cust["rho_kg_m3"], 997.0),
      "custom fluid overrides k, fills rho from water")
check(any("missing" in x for x in cust["warnings"]), "partial custom fluid warns about filled props")

# --------------------------------------------------------------------------
print("S5 targets — derived R_jc gate (GB202 example)")
g = targets.derive_thermal_gate(T_j_max_C=100.0, T_in_C=25.0, Q_W=450.0,
                                flow_lpm=2.65, rho_kg_m3=997.0, cp_J_kgK=4181.0)
# hand calc: mcp=0.0440*4181=184.1; dTcal=450/184.1=2.444; gate=(100-25-1.222)/450
check(approx(g["caloric_dT_K"], 450.0 / ((2.65 / 60000.0 * 997.0) * 4181.0)),
      f"caloric rise matches Q/(mdot*cp) (got {g['caloric_dT_K']:.4f} K)")
check(abs(g["R_jc_gate_K_W"] - 0.16395) < 1e-3,
      f"R_jc gate ~ 0.164 K/W (got {g['R_jc_gate_K_W']:.5f})")
ov = targets.derive_thermal_gate(T_j_max_C=100.0, override_R_jc_gate=0.078)
check(approx(ov["R_jc_gate_K_W"], 0.078), "override gate honoured (audit mode)")
try:
    targets.derive_thermal_gate(T_j_max_C=20.0, T_in_C=25.0)
    check(False, "T_j,max below inlet should raise")
except ValueError:
    check(True, "T_j,max below inlet raises ValueError")

print("S5 targets — exact junction temperature vs half-caloric approximation")
# small-NTU limit: exact form -> Q/UA + Q/(2 mcp) + Q(R_tim+R_base)
mcp = (2.65 / 60000.0 * 997.0) * 4181.0
UA = 296.0
Q = 450.0
R_tim, R_base = 0.0067, 0.0028
tj = targets.junction_temperature(25.0, Q, UA, mcp, R_tim, R_base)
approx_form = 25.0 + Q * (R_tim + R_base) + Q / UA + Q / (2.0 * mcp)
check(abs(tj["T_j_C"] - approx_form) < 0.6,
      f"exact T_j ({tj['T_j_C']:.2f} C) within 0.6 K of half-caloric approx "
      f"({approx_form:.2f} C)")
check(tj["T_j_C"] > tj["coolant_out_C"], "junction hotter than coolant outlet")
degen = targets.junction_temperature(25.0, Q, 0.0, mcp, R_tim, R_base)
check(math.isinf(degen["T_j_C"]), "UA=0 gives infinite T_j (no divide error)")

# --------------------------------------------------------------------------
print("API wiring — additive: coolant='water' does not move golden numbers")
cfg = json.loads(CASES_JSON.read_text(encoding="utf-8"))
basis = {"stack": cfg.get("stack"), "operating": cfg.get("operating"),
         "architecture": cfg.get("architecture")}
hero = next(c for c in cfg["cases"] if c["family"] in ("wavy_fin", "straight_fin"))

base = server.evaluate_payload({"case": hero, **basis})
with_water = server.evaluate_payload({"case": hero, **basis, "coolant": "water"})
moved = [k for k in base
         if isinstance(base[k], (int, float)) and base.get(k) is not None
         and with_water.get(k) is not None and not approx(base[k], with_water[k])]
check(not moved, f"water preset leaves every numeric KPI unchanged (moved: {moved})")
check("coolant" not in base and "coolant" in with_water,
      "coolant block only present when requested")

print("API wiring — targets inject the gate and attach exact T_j")
res = server.evaluate_payload({"case": hero, **basis,
                               "targets": {"T_j_max_C": 100.0}})
check("targets" in res and res["targets"]["T_j_C"] is not None,
      f"targets block attached with T_j ({res['targets']['T_j_C']:.2f} C)")
check(res["targets"]["T_j_pass"] is True, "hero passes the 100 C junction target")
check(res["kpi_status"].startswith("PASS"),
      f"hero PASSes the derived R_jc gate (status {res['kpi_status']})")
# a punishing target should flip the gate to FAIL without touching the geometry
strict = server.evaluate_payload({"case": hero, **basis,
                                  "targets": {"R_jc_gate_K_W": 0.005}})
check("R_jc" in strict["kpi_status"] and "FAIL" in strict["kpi_status"],
      f"impossible R_jc gate -> FAIL:R_jc (status {strict['kpi_status']})")
check(approx(strict["R_jc_K_W"], base["R_jc_K_W"]),
      "tightening the gate does not change the computed R_jc (geometry untouched)")

print("API wiring — /api/schema shape")
sch = server.schema_payload()
check({"coolants", "targets", "families", "layouts"} <= set(sch),
      "schema has coolants/targets/families/layouts")
check(any(c["name"] == "water" for c in sch["coolants"]), "schema lists water preset")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} check(s) failed, {_passes} passed.")
sys.exit(1)
