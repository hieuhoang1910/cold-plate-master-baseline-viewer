"""
07_WebApp/engine/targets.py  (webapp-native)
============================================
Targets translator for the web-app "Design Studio" (V2.1, spec §19A + §20 S5).

Webapp-native module: authored and maintained here in engine/, NOT synced from
the parent project (sync_engine.py deliberately excludes it) so the webapp stays
self-contained and independent.

Users think in degrees Celsius ("keep the die under 100 C"); the solvers gate
in K/W. This module is the pure, tested bridge between them:

  1. derive_thermal_gate(...)  -> the R_jc budget a design must meet, from
     T_j,max, inlet temp, heat load and coolant flow. This replaces the old
     hard-coded 0.078 K/W gate with a number the user can see derived.

  2. junction_temperature(...) -> the EXACT junction temperature of an
     evaluated design, using the inlet-referenced effectiveness form. This is
     the honest number to display; the gate above is a conservative budget.

Reference-temperature convention (resolved, spec §25 Q2): the master/v6 engines
reference the convective resistance R_conv = 1/UA to the MEAN coolant
temperature (properties at T_in + 1/2 dT_caloric, TD-06). So the budget form
uses half the caloric rise:

    R_jc_gate = (T_j,max - T_in - dT_caloric/2) / Q,   dT_caloric = Q / (m_dot*cp)

The exact junction temperature does not need that approximation — for a fixed-Q
load into a single coolant stream with an isothermal-wall (epsilon-NTU) closure:

    NTU  = UA / (m_dot*cp)
    T_j  = T_in + Q*(R_TIM + R_base) + Q / (m_dot*cp * (1 - exp(-NTU)))

which reduces to the budget form at small NTU (1/(1-e^-NTU) -> 1/NTU + 1/2, i.e.
Q/UA + Q/(2 m_dot cp)). Both are provided so the UI can show gate vs actual.

Dependency-free (stdlib only), pure functions.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

# Master defaults, used only to fill missing inputs so the function is total.
_DEFAULT_Q_W = 450.0
_DEFAULT_T_IN_C = 25.0
_DEFAULT_FLOW_LPM = 2.65
_DEFAULT_RHO = 997.0
_DEFAULT_CP = 4181.0
_DEFAULT_T_J_MAX_C = 100.0     # spec §25 Q1


def mdot_cp_W_K(flow_lpm: float, rho_kg_m3: float, cp_J_kgK: float) -> float:
    """Coolant heat-capacity rate m_dot*cp (W/K) from volumetric flow."""
    m_dot = (flow_lpm / 1000.0 / 60.0) * rho_kg_m3     # L/min -> m^3/s -> kg/s
    return m_dot * cp_J_kgK


def caloric_rise_K(Q_W: float, mcp_W_K: float) -> float:
    """Coolant bulk temperature rise Q/(m_dot*cp) (K)."""
    return Q_W / mcp_W_K if mcp_W_K > 0 else float("inf")


def derive_thermal_gate(T_j_max_C: Optional[float] = None,
                        T_in_C: float = _DEFAULT_T_IN_C,
                        Q_W: float = _DEFAULT_Q_W,
                        flow_lpm: float = _DEFAULT_FLOW_LPM,
                        rho_kg_m3: float = _DEFAULT_RHO,
                        cp_J_kgK: float = _DEFAULT_CP,
                        override_R_jc_gate: Optional[float] = None) -> Dict[str, Any]:
    """Derive the R_jc gate (K/W) from user targets.

    Returns {R_jc_gate_K_W, caloric_dT_K, mean_coolant_C, mdot_cp_W_K,
             T_j_max_C, derivation, warnings}. If `override_R_jc_gate` is given
    it is used verbatim (audit mode) and flagged in `derivation`.
    """
    warnings: List[str] = []
    T_j_max = _DEFAULT_T_J_MAX_C if T_j_max_C is None else float(T_j_max_C)
    mcp = mdot_cp_W_K(flow_lpm, rho_kg_m3, cp_J_kgK)
    dT_cal = caloric_rise_K(Q_W, mcp)
    mean_coolant_C = T_in_C + 0.5 * dT_cal

    if override_R_jc_gate is not None:
        gate = float(override_R_jc_gate)
        derivation = f"user override: R_jc_gate = {gate:.5g} K/W (audit mode)"
    else:
        if T_j_max <= T_in_C:
            raise ValueError(
                f"T_j,max ({T_j_max} C) must exceed inlet temp ({T_in_C} C)")
        budget_K = T_j_max - T_in_C - 0.5 * dT_cal
        if budget_K <= 0:
            raise ValueError(
                "no thermal budget: T_j,max minus inlet minus half the caloric "
                f"rise is {budget_K:.2f} K (flow too low for this heat load?)")
        gate = budget_K / Q_W
        derivation = (
            f"({T_j_max:g} - {T_in_C:g} - {0.5 * dT_cal:.2f}) / {Q_W:g} "
            f"= {gate:.5g} K/W")

    if dT_cal > 0.5 * (T_j_max - T_in_C):
        warnings.append(
            f"caloric rise {dT_cal:.1f} K is large vs the {T_j_max - T_in_C:.0f} K "
            "budget; flow rate is the binding lever, not fin geometry.")

    return {
        "R_jc_gate_K_W": gate,
        "caloric_dT_K": dT_cal,
        "mean_coolant_C": mean_coolant_C,
        "mdot_cp_W_K": mcp,
        "T_j_max_C": T_j_max,
        "derivation": derivation,
        "warnings": warnings,
    }


def junction_temperature(T_in_C: float,
                         Q_W: float,
                         UA_W_K: float,
                         mdot_cp_W_K: float,
                         R_tim_K_W: float,
                         R_base_K_W: float) -> Dict[str, Any]:
    """Exact junction temperature of an evaluated design (epsilon-NTU closure).

    Returns {T_j_C, NTU, effectiveness, coolant_out_C, wall_to_inlet_K,
             conduction_rise_K}. Robust to degenerate UA/mcp (returns inf).
    """
    if UA_W_K <= 0 or mdot_cp_W_K <= 0:
        return {
            "T_j_C": float("inf"), "NTU": 0.0, "effectiveness": 0.0,
            "coolant_out_C": float("inf"), "wall_to_inlet_K": float("inf"),
            "conduction_rise_K": Q_W * (R_tim_K_W + R_base_K_W),
        }
    NTU = UA_W_K / mdot_cp_W_K
    eff = 1.0 - math.exp(-NTU)
    wall_to_inlet_K = Q_W / (mdot_cp_W_K * eff)     # fluid heating + film drop
    conduction_rise_K = Q_W * (R_tim_K_W + R_base_K_W)
    T_j = T_in_C + conduction_rise_K + wall_to_inlet_K
    return {
        "T_j_C": T_j,
        "NTU": NTU,
        "effectiveness": eff,
        "coolant_out_C": T_in_C + Q_W / mdot_cp_W_K,
        "wall_to_inlet_K": wall_to_inlet_K,
        "conduction_rise_K": conduction_rise_K,
    }


def target_schema() -> Dict[str, Any]:
    """Default values + bounds for the wizard's Targets step (spec §19A)."""
    return {
        "T_j_max_C": {"default": _DEFAULT_T_J_MAX_C, "min": 40.0, "max": 125.0,
                      "soft_target": 90.0,
                      "help": "Silicon ceiling. A soft 90 C design line is drawn "
                              "in the KPI panel for headroom."},
        "T_inlet_C": {"default": _DEFAULT_T_IN_C, "min": 5.0, "max": 60.0},
        "heat_load_W": {"default": _DEFAULT_Q_W, "min": 50.0, "max": 1500.0},
        "margin_heat_load_W": {"default": 575.0, "min": 50.0, "max": 2000.0},
        "flow_lpm": {"default": _DEFAULT_FLOW_LPM, "min": 0.5, "max": 8.0},
        "limit_deltaP_Pa": {"default": 50000.0, "min": 1000.0, "max": 300000.0},
        "limit_pump_W": {"default": 5.0, "min": 0.1, "max": 50.0},
    }
