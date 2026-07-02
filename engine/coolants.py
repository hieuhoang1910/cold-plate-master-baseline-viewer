"""
06_MASTER_BASELINE/python/coolants.py
=====================================
Coolant property library for the Master Baseline / web-app "Design Studio"
(V2.1, spec §20 S4).

The master `OperatingPoint` carries four fluid properties (rho, mu, k_fluid,
cp). Until V2 those were hard-coded to 25 C water. This module turns a coolant
*choice* (a preset name, or explicit custom properties) plus an inlet
temperature into those four numbers, so a user can pick water / glycol mixes in
the wizard and have every downstream KPI recompute consistently.

PARITY ANCHOR (do not change without re-running test_api_parity.py):
    water @ 25.0 C resolves EXACTLY to the master defaults
        rho = 997.0 kg/m^3, mu = 0.00089 Pa.s, k = 0.60 W/mK, cp = 4181.0 J/kgK
    so selecting "water" in the GB202 preset reproduces the golden results
    bit-for-bit. The 25.0 C row below is a table knot; linear interpolation at a
    knot returns the knot exactly.

Fidelity: these are SCREENING-GRADE fits (small tables + linear interpolation),
adequate for the project's 20-60 C working band. Verify against a supplier
datasheet before quoting a glycol design. Single-phase only (no boiling).

Dependency-free (stdlib only), pure functions — safe to import from the API and
to unit-test directly.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Union

# --- Property tables -------------------------------------------------------
# Each row: (T_C, rho_kg_m3, mu_Pa_s, k_fluid_W_mK, cp_J_kgK)
# Rows sorted by temperature. Interpolation is linear between rows; queries
# outside [first, last] clamp to the nearest row and flag `extrapolated`.

# Water: the 25.0 C row is the master-default parity anchor (see module docstring).
_WATER: List[Tuple[float, float, float, float, float]] = [
    (15.0, 999.1, 0.001138, 0.589, 4186.0),
    (20.0, 998.2, 0.001002, 0.598, 4182.0),
    (25.0, 997.0, 0.00089, 0.600, 4181.0),   # <-- PARITY ANCHOR (master defaults)
    (40.0, 992.2, 0.000653, 0.628, 4179.0),
    (60.0, 983.2, 0.000466, 0.651, 4185.0),
]

# 25 vol% propylene glycol in water (inhibited). ASHRAE-style screening values.
_PG25: List[Tuple[float, float, float, float, float]] = [
    (20.0, 1016.0, 0.00201, 0.492, 3974.0),
    (25.0, 1014.0, 0.00175, 0.497, 3980.0),
    (40.0, 1007.0, 0.00120, 0.512, 3995.0),
    (60.0, 995.0, 0.00078, 0.527, 4015.0),
]

# 50 vol% propylene glycol in water (inhibited).
_PG50: List[Tuple[float, float, float, float, float]] = [
    (20.0, 1042.0, 0.00575, 0.383, 3560.0),
    (25.0, 1040.0, 0.00470, 0.388, 3575.0),
    (40.0, 1032.0, 0.00268, 0.404, 3620.0),
    (60.0, 1018.0, 0.00150, 0.424, 3680.0),
]

# 50 vol% ethylene glycol in water (inhibited).
_EG50: List[Tuple[float, float, float, float, float]] = [
    (20.0, 1071.0, 0.00393, 0.384, 3285.0),
    (25.0, 1068.0, 0.00342, 0.389, 3300.0),
    (40.0, 1058.0, 0.00212, 0.405, 3345.0),
    (60.0, 1043.0, 0.00126, 0.424, 3405.0),
]

_PRESETS: Dict[str, Dict[str, Any]] = {
    "water": {"label": "Water", "table": _WATER,
              "note": "Pure water; 25 C = master parity anchor."},
    "pg25": {"label": "Propylene glycol 25%", "table": _PG25,
             "note": "25 vol% PG/water, inhibited (freeze ~ -10 C). Screening fit."},
    "pg50": {"label": "Propylene glycol 50%", "table": _PG50,
             "note": "50 vol% PG/water, inhibited (freeze ~ -33 C). Screening fit."},
    "eg50": {"label": "Ethylene glycol 50%", "table": _EG50,
             "note": "50 vol% EG/water, inhibited (freeze ~ -37 C). Screening fit."},
}

_FIELDS = ("rho_kg_m3", "mu_Pa_s", "k_fluid_W_mK", "cp_J_kgK")


def preset_names() -> List[str]:
    return list(_PRESETS.keys())


def _interp_row(table: List[Tuple[float, float, float, float, float]],
                T_C: float) -> Tuple[Dict[str, float], bool]:
    """Linear-interpolate a property row at T_C. Returns (props, extrapolated)."""
    lo_T = table[0][0]
    hi_T = table[-1][0]
    extrapolated = T_C < lo_T or T_C > hi_T
    Tq = min(max(T_C, lo_T), hi_T)     # clamp into the table range

    # find the bracketing rows
    for i in range(len(table) - 1):
        Ta, Tb = table[i][0], table[i + 1][0]
        if Ta <= Tq <= Tb:
            f = 0.0 if Tb == Ta else (Tq - Ta) / (Tb - Ta)
            props = {}
            for j, name in enumerate(_FIELDS, start=1):
                a, b = table[i][j], table[i + 1][j]
                props[name] = a + f * (b - a)
            return props, extrapolated
    # Tq == hi_T exactly (loop misses only when single row)
    last = table[-1]
    return {name: last[j] for j, name in enumerate(_FIELDS, start=1)}, extrapolated


def resolve(coolant: Union[str, Dict[str, Any], None],
            T_inlet_C: float = 25.0) -> Dict[str, Any]:
    """Resolve a coolant choice + inlet temperature into fluid properties.

    `coolant` may be:
      * a preset name string, e.g. "water", "pg50";
      * a dict {"name": "<preset>"} optionally with property overrides;
      * a dict of explicit custom properties (any of rho_kg_m3, mu_Pa_s,
        k_fluid_W_mK, cp_J_kgK) with "name": "custom" — missing props fall back
        to water at T_inlet_C so a partial custom fluid is still usable;
      * None -> water.

    Returns a dict with the four master `OperatingPoint` property fields plus
    metadata: {rho_kg_m3, mu_Pa_s, k_fluid_W_mK, cp_J_kgK, coolant, label,
    T_eval_C, extrapolated, warnings}.
    """
    warnings: List[str] = []

    # Normalise input into (name, overrides)
    if coolant is None:
        name, overrides = "water", {}
    elif isinstance(coolant, str):
        name, overrides = coolant.strip().lower(), {}
    elif isinstance(coolant, dict):
        name = str(coolant.get("name", "custom")).strip().lower()
        overrides = {k: coolant[k] for k in _FIELDS if coolant.get(k) is not None}
    else:
        raise TypeError(f"coolant must be str, dict, or None (got {type(coolant)!r})")

    if name in _PRESETS:
        preset = _PRESETS[name]
        props, extrapolated = _interp_row(preset["table"], float(T_inlet_C))
        label = preset["label"]
        if extrapolated:
            lo, hi = preset["table"][0][0], preset["table"][-1][0]
            warnings.append(
                f"{label} properties requested at {T_inlet_C:g} C are outside the "
                f"tabulated {lo:g}-{hi:g} C range; clamped (screening only).")
    elif name == "custom":
        # start from water at T, then apply whatever custom props were given
        props, _ = _interp_row(_WATER, float(T_inlet_C))
        label = "Custom fluid"
        missing = [k for k in _FIELDS if k not in overrides]
        if missing:
            warnings.append(
                "Custom fluid missing " + ", ".join(missing)
                + "; filled from water at the inlet temperature.")
    else:
        raise ValueError(
            f"unknown coolant {name!r}; known presets: {preset_names()} or 'custom'")

    # apply explicit overrides last (custom values win over the preset/table)
    for k in _FIELDS:
        if k in overrides:
            props[k] = float(overrides[k])

    # sanity guards
    for k in _FIELDS:
        if props[k] <= 0:
            raise ValueError(f"coolant property {k} must be positive (got {props[k]!r})")

    return {
        **props,
        "coolant": name,
        "label": label,
        "T_eval_C": float(T_inlet_C),
        "extrapolated": bool(warnings and name in _PRESETS and
                             (T_inlet_C < _PRESETS[name]["table"][0][0]
                              or T_inlet_C > _PRESETS[name]["table"][-1][0])),
        "warnings": warnings,
    }


def schema() -> List[Dict[str, Any]]:
    """Preset descriptors for the wizard (name, label, 25 C preview, note)."""
    out = []
    for name, preset in _PRESETS.items():
        p, _ = _interp_row(preset["table"], 25.0)
        out.append({
            "name": name,
            "label": preset["label"],
            "note": preset["note"],
            "preview_25C": {k: round(p[k], 6) for k in _FIELDS},
            "T_range_C": [preset["table"][0][0], preset["table"][-1][0]],
        })
    return out
