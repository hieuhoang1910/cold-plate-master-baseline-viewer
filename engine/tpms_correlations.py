"""
07_WebApp/engine/tpms_correlations.py  (webapp-native)
======================================================
TPMS sheet convective solver — the S2 heat-transfer physics of the V2 "Design
Studio" (spec §20 S2 part 2). Builds on tpms_geometry.py (SA/V, void, D_h from
the minimal-surface area coefficients) and adds a literature Nusselt/friction
correlation so Gyroid and Diamond leave the generic Nu=3.66 fallback.

CORRELATION (Renon & Jeanningros, 2025):
    Nu = 0.2644 * Re^0.69 * Pr^(1/3) * (mu/mu_w)^0.20
    f_Fanning = 1.850 * Re^(-0.17)            (fitted to Diamond)
    gyroid f is ~15% higher than diamond at matched Re.
The authors found Gyroid and Diamond thermally identical, so the SAME Nu applies
to both. Reynolds/Prandtl are built on the MEAN INTERSTITIAL velocity and the
hydraulic diameter D_h = 4*V_fluid/A_solid-fluid (we use tpms_geometry's D_h,
which is the same 4*porosity/(SA/V) definition).
    Citation: C. Renon & X. Jeanningros (2025), "A numerical investigation of
    heat transfer and pressure drop correlations in Gyroid and Diamond TPMS-based
    heat exchanger channels", Int. J. Heat and Mass Transfer 239:126599,
    DOI 10.1016/j.ijheatmasstransfer.2024.126599.

CRITICAL REGIME CAVEAT (spec §27): the fit is Re 2961-18254 / Pr 3-5 (turbulent).
This cold plate runs deep laminar (Re_Dh ~ 200), 15x below the fitted floor, so
every evaluation here is an EXTRAPOLATION and is flagged as such. It is retained
because (a) it is the only peer-reviewed, fully-extracted TPMS correlation, and
(b) extrapolated to Re~200 it gives Nu~18, consistent to order-of-magnitude with
independent in-regime experimental data (Re 50-300: gyroid Nu~28, diamond~24).
Treat as ANALYTICAL_LIT screening, not validated, until CFD/coupon data.

Schwarz-P is deliberately NOT covered — no peer-reviewed in-regime coefficient
set was found, and inventing one was refused. It keeps the generic screening
model (with tpms_geometry-derived geometry).

Pure, dependency-free (stdlib math). Webapp-native — NOT synced from the parent.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

import tpms_geometry

# Renon & Jeanningros coefficients (gyroid == diamond thermally).
_NU_A, _NU_B, _NU_C = 0.2644, 0.69, 1.0 / 3.0
_F_G, _F_H = 1.850, -0.17          # Fanning, fitted to Diamond
_GYROID_F_FACTOR = 1.15            # gyroid friction ~12-17% higher; midpoint
_RE_FIT_LO, _RE_FIT_HI = 2961.0, 18254.0
_PR_FIT_LO, _PR_FIT_HI = 3.0, 5.0

# Types this correlation covers (Schwarz-P intentionally excluded).
CORR_TYPES = {"gyroid", "diamond"}


def nusselt(Re: float, Pr: float) -> float:
    """Renon & Jeanningros Nu (mu/mu_w set to 1: small-dT screening)."""
    if Re <= 0 or Pr <= 0:
        return 0.0
    return _NU_A * (Re ** _NU_B) * (Pr ** _NU_C)


def fanning_friction(Re: float, tpms_type: str) -> float:
    if Re <= 0:
        return 0.0
    f = _F_G * (Re ** _F_H)
    return f * (_GYROID_F_FACTOR if tpms_type == "gyroid" else 1.0)


def evaluate_tpms(
    *,
    tpms_type: str,
    unit_cell_mm: float,
    wall_thickness_mm: float,
    core_width_mm: float,
    core_length_mm: float,
    core_height_mm: float,
    core_volume_m3: float,
    flow_m3_s: float,
    n_parallel_paths: int,
    path_length_m: float,
    rho: float, mu: float, k_fluid: float, cp: float,
    k_solid: float,
    header_K_total: float = 1.5,
    flow_uniformity: float = 1.0,
    surface_access_factor: float = 1.0,
    cell_grading: float = 0.0,
) -> Dict[str, Any]:
    """Screening thermal-hydraulics for a Gyroid/Diamond sheet TPMS core.

    Radial cell grading (jet-adaptive: dense at the centre, coarser outward,
    matching the viewer's law c(r) = cell*(1 + grade*clamp(r/R, 0, 1.5)),
    R = 0.5*min(W,L)) is integrated over annular footprint zones: each zone has
    its own local cell size -> local SA/V, void, D_h, Re, Nu and sheet
    efficiency, combined as parallel conductances (UA = sum). At grade = 0 this
    reduces exactly to the uniform single-zone model. Returns the same
    result-dict shape the fin/pin evaluators do.
    """
    if tpms_type not in CORR_TYPES:
        raise ValueError(f"tpms_correlations covers {sorted(CORR_TYPES)}, not {tpms_type!r}")

    Pr = mu * cp / k_fluid if k_fluid > 0 else 0.0
    wall_m = wall_thickness_mm * 1e-3
    flow_per_path = flow_m3_s / max(n_parallel_paths, 1)
    frontal = core_width_mm * 1e-3 * core_height_mm * 1e-3        # W x H (flow along L)
    v_superficial = flow_per_path / frontal if frontal > 0 else 0.0
    Lc = core_height_mm * 1e-3 * 0.5                              # sheet conduction half-length

    grade = max(float(cell_grading), 0.0)
    R_ref = 0.5 * min(core_width_mm, core_length_mm)              # grading reference radius (mm)
    zones = (_radial_zones(core_width_mm, core_length_mm)
             if grade > 0 and R_ref > 0 else [(0.0, 1.0)])

    UA = A_wet_tot = A_wet_eff = dP_core = 0.0
    Re_m = Nu_m = v_m = Dh_m = eps_m = f_m = 0.0
    for r_mid, w in zones:
        c_i = unit_cell_mm * (1.0 + grade * min(max(r_mid / R_ref, 0.0), 1.5)) if R_ref > 0 else unit_cell_mm
        gz = tpms_geometry.geometry(tpms_type, c_i, wall_thickness_mm)
        eps = gz["void_fraction"]
        sav = gz["surface_area_density_m2_m3"]
        Dh = gz["hydraulic_diameter_mm"] * 1e-3
        v = v_superficial / eps if eps > 0 else 0.0
        Re = rho * v * Dh / mu if mu > 0 else 0.0
        Nu = nusselt(Re, Pr)
        h = Nu * k_fluid / Dh if Dh > 0 else 0.0
        A_wet_i = sav * (w * core_volume_m3)
        if h > 0 and k_solid > 0 and wall_m > 0:
            m = math.sqrt(2.0 * h / (k_solid * wall_m))
            mLc = m * Lc
            eta_o = 1.0 / mLc if mLc > 25.0 else math.tanh(mLc) / mLc
        else:
            eta_o = 1.0
        UA += h * A_wet_i * eta_o
        A_wet_tot += A_wet_i
        A_wet_eff += A_wet_i * eta_o
        f = fanning_friction(Re, tpms_type)
        dP_core += w * (4.0 * f * (path_length_m / Dh) * 0.5 * rho * v * v if Dh > 0 else 0.0)
        Re_m += w * Re; Nu_m += w * Nu; v_m += w * v
        Dh_m += w * Dh; eps_m += w * eps; f_m += w * f

    useful_extra = flow_uniformity * surface_access_factor
    UA *= useful_extra
    R_conv = 1.0 / UA if UA > 0 else float("inf")
    delta_p = dP_core + 0.5 * rho * v_m * v_m * header_K_total
    eta_o_mean = A_wet_eff / A_wet_tot if A_wet_tot > 0 else 1.0

    # base geometry warnings from the densest (centre) cell = nominal unit cell.
    warnings: List[str] = list(tpms_geometry.geometry(tpms_type, unit_cell_mm, wall_thickness_mm)["warnings"])
    if Re_m < _RE_FIT_LO or Re_m > _RE_FIT_HI:
        warnings.append(
            f"{tpms_type}: Re_Dh = {Re_m:.0f} is OUTSIDE the Renon & Jeanningros fit "
            f"({_RE_FIT_LO:.0f}-{_RE_FIT_HI:.0f}); Nu/f are EXTRAPOLATED (deep-laminar "
            "here vs the turbulent fit). Screening only.")
    if Pr < _PR_FIT_LO or Pr > _PR_FIT_HI:
        warnings.append(f"{tpms_type}: Pr = {Pr:.1f} is outside the fitted 3-5 range; extrapolated.")
    if grade > 0:
        c_edge = unit_cell_mm * (1.0 + grade * 1.5)
        warnings.append(
            f"radial cell grading g={grade:.2f}: {len(zones)} zones, cell "
            f"{unit_cell_mm:.2f}-{c_edge:.2f} mm (dense centre, jet-adaptive); parallel-zone "
            "integration over the footprint (screening; Renon's fit is per uniform cell). "
            "NOTE: modelled under UNIFORM base flux, so grading only trades centre density "
            "for coarser (larger-area) edges here -> slightly less net area; the jet-adaptive "
            "BENEFIT needs a centre-peaked impingement flux, coupled to the jet layout (V2.5).")
    warnings.append(
        "TPMS Nu/f from Renon & Jeanningros (2025), gyroid=diamond; ANALYTICAL_LIT "
        "screening (turbulent fit extrapolated to laminar), not CFD/coupon-validated.")

    return {
        "R_conv": R_conv,
        "delta_p": delta_p,
        "velocity": v_m,
        "reynolds": Re_m,
        "hydraulic_diameter_m": Dh_m,
        "open_volume_fraction": eps_m,
        "raw_SA_V_m2_m3": A_wet_tot / core_volume_m3 if core_volume_m3 > 0 else 0.0,
        "effective_SA_V_m2_m3": A_wet_eff * useful_extra / core_volume_m3 if core_volume_m3 > 0 else 0.0,
        "wetted_area": A_wet_tot,
        "flow_area": frontal * eps_m,
        "UA": UA,
        "eta_f": eta_o_mean,
        "eta_o": eta_o_mean,
        "warnings": warnings,
        "Nu": Nu_m,
        "Pr": Pr,
        "fanning_f": f_m,
    }


def _radial_zones(core_width_mm: float, core_length_mm: float,
                  n_zones: int = 12, samples: int = 40):
    """Area weights of concentric radial zones over the rectangular footprint.
    Returns [(r_mid_mm, area_weight), ...] with weights summing to 1."""
    r_max = 0.5 * math.hypot(core_width_mm, core_length_mm)
    if r_max <= 0:
        return [(0.0, 1.0)]
    counts = [0] * n_zones
    for ix in range(samples):
        x = (-0.5 + (ix + 0.5) / samples) * core_width_mm
        for iy in range(samples):
            y = (-0.5 + (iy + 0.5) / samples) * core_length_mm
            k = min(int(math.hypot(x, y) / r_max * n_zones), n_zones - 1)
            counts[k] += 1
    tot = float(samples * samples)
    return [((i + 0.5) / n_zones * r_max, counts[i] / tot)
            for i in range(n_zones) if counts[i]]
