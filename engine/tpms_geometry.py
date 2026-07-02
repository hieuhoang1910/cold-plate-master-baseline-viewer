"""
07_WebApp/engine/tpms_geometry.py  (webapp-native)
==================================================
TPMS sheet geometry from first principles — the S2 geometry foundation of the
V2 "Design Studio" (spec §20 S2). Replaces the hand-typed surface_area_density /
void_fraction / hydraulic_diameter for the literature-backed TPMS types with
values derived from the surface the viewer actually draws.

Each triply-periodic minimal surface has a well-known dimensionless area per
cubic unit cell A0/a^2 (Gandy et al.; standard TPMS references):

    gyroid     3.0915
    diamond    3.8385   (Schwarz D)
    schwarz_p  2.3451

For a SHEET TPMS (a wall of thickness t centred on the minimal surface) in a
cell of size a:

    SA/V        = 2 * (A0/a^2) / a            (both wetted faces), units m^2/m^3
    rho*        = (A0/a^2) * (t / a)          (relative density, thin-sheet limit)
    porosity e  = 1 - rho*
    D_h         = 4 * e / (SA/V)

This is exact for the minimal surface itself (that's the coefficient's meaning),
and the thin-sheet relative-density law is the standard first-order fit; it is
labelled a screening approximation (a curvature term grows for thick walls).
Solid-network TPMS are intentionally out of scope (spec §25 Q4 — hidden from the
wizard). Only these three "literature" types are handled; the other viewer
shapes keep the generic hand-entered geometry.

Pure, dependency-free (stdlib only). Webapp-native — NOT synced from the parent.
"""

from __future__ import annotations

from typing import Any, Dict

# Dimensionless minimal-surface area per cubic unit cell, A0 / a^2.
AREA_COEFF: Dict[str, float] = {
    "gyroid": 3.0915,
    "diamond": 3.8385,
    "schwarz_p": 2.3451,
}

# Types with a literature area coefficient (others fall back to generic geometry).
LIT_TYPES = set(AREA_COEFF)

# Relative-density clamp so a silly cell/wall combo can't produce <2% or >90% solid.
_RHO_MIN, _RHO_MAX = 0.02, 0.90


def is_lit_type(tpms_type: str) -> bool:
    return tpms_type in LIT_TYPES


def geometry(tpms_type: str, unit_cell_mm: float, wall_thickness_mm: float) -> Dict[str, Any]:
    """Derive {surface_area_density_m2_m3, void_fraction, hydraulic_diameter_mm,
    relative_density, area_coeff, warnings} for a sheet TPMS from its cell size
    and wall thickness. Raises KeyError for a non-literature type."""
    k = AREA_COEFF[tpms_type]
    a = float(unit_cell_mm) * 1e-3
    t = float(wall_thickness_mm) * 1e-3
    if a <= 0 or t <= 0:
        raise ValueError("unit_cell_mm and wall_thickness_mm must be > 0")

    warnings = []
    sav = 2.0 * k / a                       # m^2/m^3 (both faces of the sheet)
    rho = k * (t / a)                        # thin-sheet relative density
    if rho > _RHO_MAX or rho < _RHO_MIN:
        warnings.append(
            f"{tpms_type} relative density {rho:.2f} clamped to [{_RHO_MIN}, {_RHO_MAX}] "
            "(wall/cell outside the thin-sheet range).")
    rho = min(max(rho, _RHO_MIN), _RHO_MAX)
    porosity = 1.0 - rho
    Dh_m = 4.0 * porosity / sav if sav > 0 else 0.0

    if t / a > 0.25:
        warnings.append(
            f"wall/cell = {t / a:.2f} > 0.25; thin-sheet area/density model is "
            "approximate for thick walls (screening).")

    return {
        "surface_area_density_m2_m3": sav,
        "void_fraction": porosity,
        "hydraulic_diameter_mm": Dh_m * 1e3,
        "relative_density": rho,
        "area_coeff": k,
        "warnings": warnings,
    }
