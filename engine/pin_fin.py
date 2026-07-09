"""
07_WebApp/engine/pin_fin.py  (webapp-native)
============================================
Pin-fin (cylinder array) thermal-hydraulic screening solver — the S1 physics of
the V2 "Design Studio" (spec §20 S1). Moves the pin_fin family off the generic
Nu = 3.66 fallback onto literature correlations (ANALYTICAL_LIT, not yet
test-validated).

Correlations & why (all screening-grade, cited):

  * Nu (convection): Zukauskas single-cylinder in crossflow,
        Nu_D = 0.51 * Re_D^0.5 * Pr^0.37
    valid Re_D 40-1000 (Zukauskas, in Incropera & DeWitt, "Fundamentals of Heat
    and Mass Transfer", Table 7.4). Zukauskas prescribes single-cylinder
    treatment for tube/pin banks at Re < 1e3, which is exactly this cold plate's
    regime (Re_D ~ 100-500, water). The spec (§25 Q3) chose Khan-Culham-
    Yovanovich as the "preferred" model, but KCY's published form is a
    von Karman-Pohlhausen integral over a potential-flow field, not a closable
    coefficient; Zukauskas is the correlation KCY itself validates against and
    is used here. It ignores endwall suppression on short pins, so it OVER-
    predicts h for low H/d — the pin efficiency below and the ANALYTICAL_LIT
    label carry that caveat until CFD/coupon data close the loop.

  * Re based on the CONSTRICTION (maximum) velocity through the minimum gap:
        v_max = v_approach * S / (S - d),  Re_D = rho * v_max * d / mu.

  * Pressure drop: tube-bank Euler number per row, laminar term of
    Gaddis & Gnielinski (1985, "Pressure Drop in Cross Flow across Tube
    Bundles", Int. Chem. Eng. 25(1):1-15; VDI Heat Atlas):
        Eu_row = f_lam / Re_D,   dP = N_rows * Eu_row * 0.5 * rho * v_max^2
    (+ a lumped header minor-loss term, as the fin families do). The laminar
    term dominates in this Re band.

  * Pin (fin) efficiency: adiabatic-tip cylindrical fin with the standard tip
    correction (Bergman/Incropera Ch. 3):
        m = sqrt(4 h / (k_solid * d)),  H_c = H + d/4,
        eta_pin = tanh(m H_c) / (m H_c).

Pure, dependency-free (stdlib math). Takes primitive numbers so it is trivially
unit-testable and imports nothing from the master calculator (no import cycle).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List


def _gg_laminar_coeff(a: float, b: float, staggered: bool) -> float:
    """Gaddis-Gnielinski laminar drag coefficient f_lam for Eu_row = f_lam/Re.

    a = transverse pitch ratio S_T/d, b = longitudinal pitch ratio S_L/d.
    Staggered banks use the diagonal pitch in the denominator exponent.
    """
    core = (math.sqrt(b) - 0.6) ** 2 + 0.75
    denom_pitch = a
    if staggered:
        c = math.sqrt((a / 2.0) ** 2 + b ** 2)   # diagonal pitch ratio
        denom_pitch = c
    void = 4.0 * a * b - math.pi
    if void <= 0:
        return float("inf")
    return 280.0 * math.pi * core / (void * denom_pitch ** 1.6)


def evaluate_pin_fin(
    *,
    pin_diameter_mm: float,
    pin_pitch_mm: float,
    fin_height_mm: float,
    pattern: str,
    core_width_mm: float,
    core_length_mm: float,
    core_volume_m3: float,
    cooled_area_m2: float,
    flow_m3_s: float,
    n_parallel_paths: int,
    rho: float, mu: float, k_fluid: float, cp: float,
    k_solid: float,
    header_K_total: float = 1.5,
    flow_uniformity: float = 1.0,
    surface_access_factor: float = 1.0,
    wetted_area_multiplier: float = 1.0,
    heat_transfer_multiplier: float = 1.0,
    pressure_loss_multiplier: float = 1.0,
) -> Dict[str, Any]:
    """Screening thermal-hydraulics for a cylindrical pin-fin array. Returns the
    same result dict shape the master calculator's fin-family evaluator does."""
    warnings: List[str] = []
    d = pin_diameter_mm * 1e-3
    S = pin_pitch_mm * 1e-3
    H = fin_height_mm * 1e-3
    if d <= 0 or S <= 0 or H <= 0:
        raise ValueError("pin_diameter_mm, pin_pitch_mm and fin_height_mm must be > 0")
    if S <= d:
        raise ValueError(f"pin pitch ({pin_pitch_mm} mm) must exceed diameter ({pin_diameter_mm} mm)")

    staggered = str(pattern).lower().strip() == "staggered"
    a = S / d          # transverse pitch ratio
    b = S / d          # longitudinal pitch ratio (square array to start, spec S1)

    # --- pin count from the footprint (one geometry source w/ viewer + STL) ---
    W = core_width_mm * 1e-3
    L = core_length_mm * 1e-3
    n_trans = max(1, int(W / S))       # columns across the width
    n_rows = max(1, int(L / S))        # rows along the flow path
    n_pins = n_trans * n_rows

    # --- velocities (constriction) + Reynolds ---
    flow_per_path = flow_m3_s / max(n_parallel_paths, 1)
    frontal_area = W * H
    v_approach = flow_per_path / frontal_area if frontal_area > 0 else 0.0
    v_max = v_approach * S / (S - d)
    Re_d = rho * v_max * d / mu if mu > 0 else 0.0
    Pr = mu * cp / k_fluid if k_fluid > 0 else 0.0

    # --- Nu / h (Zukauskas single cylinder, Table 7.4, valid Re 40-1000) ---
    Nu = 0.51 * (Re_d ** 0.5) * (Pr ** 0.37) * heat_transfer_multiplier
    h = Nu * k_fluid / d if d > 0 else 0.0

    # --- areas + pin efficiency ---
    A_pins = n_pins * math.pi * d * H
    A_base = max(cooled_area_m2 - n_pins * math.pi * d * d / 4.0, 0.0)
    A_wet = (A_pins + A_base) * wetted_area_multiplier
    if h > 0 and k_solid > 0:
        m = math.sqrt(4.0 * h / (k_solid * d))
        mHc = m * (H + d / 4.0)         # corrected length for an adiabatic tip
        eta_pin = 1.0 / mHc if mHc > 25.0 else math.tanh(mHc) / mHc
    else:
        eta_pin = 1.0
    eta_o = 1.0 - (A_pins * wetted_area_multiplier / A_wet) * (1.0 - eta_pin) if A_wet > 0 else 1.0
    useful = eta_o * flow_uniformity * surface_access_factor
    UA = h * A_wet * useful
    R_conv = 1.0 / UA if UA > 0 else float("inf")

    # --- pressure drop (Gaddis-Gnielinski laminar Euler per row + header) ---
    f_lam = _gg_laminar_coeff(a, b, staggered)
    Eu_row = f_lam / Re_d if Re_d > 0 else 0.0
    dP_bank = n_rows * Eu_row * 0.5 * rho * v_max * v_max
    dP_header = 0.5 * rho * v_max * v_max * header_K_total
    delta_p = (dP_bank + dP_header) * pressure_loss_multiplier

    # --- volume fractions + SA/V ---
    solid_vol = n_pins * math.pi * d * d / 4.0 * H
    open_fraction = 1.0 - solid_vol / core_volume_m3 if core_volume_m3 > 0 else 0.0
    flow_area = frontal_area * (S - d) / S      # minimum-gap flow area
    Dh = 4.0 * open_fraction * core_volume_m3 / A_wet if A_wet > 0 else 0.0
    raw_sa_v = A_wet / core_volume_m3 if core_volume_m3 > 0 else 0.0
    eff_sa_v = A_wet * useful / core_volume_m3 if core_volume_m3 > 0 else 0.0

    # --- validity guardrails (spec §25 Q3) ---
    if Re_d < 40 or Re_d > 1000:
        warnings.append(
            f"pin Re_D = {Re_d:.0f} is outside the Zukauskas single-cylinder fit "
            "(40-1000); Nu is extrapolated.")
    if S / d < 1.25:
        warnings.append(f"pitch/diameter = {S / d:.2f} < 1.25; correlations degrade for tight arrays.")
    if H / d > 8.0:
        warnings.append(f"height/diameter = {H / d:.1f} > 8; slender-pin conduction penalty may be underestimated.")
    warnings.append("Pin-fin model is ANALYTICAL_LIT (Zukauskas single-cylinder + Gaddis-Gnielinski, "
                    "no endwall correction); screening only until CFD/coupon data.")

    return {
        "R_conv": R_conv,
        "delta_p": delta_p,
        "velocity": v_max,
        "reynolds": Re_d,
        "hydraulic_diameter_m": Dh,
        "open_volume_fraction": open_fraction,
        "raw_SA_V_m2_m3": raw_sa_v,
        "effective_SA_V_m2_m3": eff_sa_v,
        "wetted_area": A_wet,
        "flow_area": flow_area,
        "fin_area": A_pins * wetted_area_multiplier,
        "UA": UA,
        "eta_f": eta_pin,
        "eta_o": eta_o,
        "warnings": warnings,
        "pin_count": n_pins,
        "Nu": Nu,
        "Pr": Pr,
    }
