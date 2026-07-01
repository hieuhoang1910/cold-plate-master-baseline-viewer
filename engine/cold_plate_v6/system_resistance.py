"""
cold_plate_v6/system_resistance.py
==================================
Junction-to-coolant thermal-resistance add-on.

The base solver returns only the CONVECTIVE resistance R_th_conv = 1/UA (fin +
fluid). That is the right metric for RANKING fin geometries, but it is not the
number that sets junction temperature. The full series stack from the GPU die
to the coolant is:

    R_jc = R_TIM + R_spread/coverage + R_base + R_th_conv

This module adds the non-convective terms so a candidate can also be judged on
the metric that actually moves T_junction. Every term is documented and the
model is deliberately conservative.

Anchored to the target device: NVIDIA RTX 5090 (GB202 die, ~24 × 31 mm).

Resistances are in K/W throughout (the codebase's "_kpw" suffix means K/W;
multiply by 1000 for mK/W on display).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .master_constants import (
    FIN_FIELD_FOOTPRINT_M2,
    GPU_DIE_AREA_M2,
    KS_CU_AM_NOMINAL_WPMK,
    PROTO1_BASE_THICKNESS_M,
    TIM_AREAL_RESISTANCE_KCM2_W,
)


def base_conduction_resistance(area_m2: float,
                               t_base_m: float = PROTO1_BASE_THICKNESS_M,
                               k_wpmk: float = KS_CU_AM_NOMINAL_WPMK) -> float:
    """1-D conduction through the cold-plate base over `area_m2` (K/W)."""
    if area_m2 <= 0 or k_wpmk <= 0:
        return float("inf")
    return t_base_m / (k_wpmk * area_m2)


def tim_resistance(area_m2: float,
                   areal_kcm2_w: float = TIM_AREAL_RESISTANCE_KCM2_W) -> float:
    """TIM resistance over `area_m2` (K/W). `areal_kcm2_w` is in K·cm²/W."""
    if area_m2 <= 0:
        return float("inf")
    areal_si = areal_kcm2_w * 1e-4          # K·cm²/W -> K·m²/W
    return areal_si / area_m2


def halfspace_spreading_reference(area_source_m2: float,
                                  k_wpmk: float = KS_CU_AM_NOMINAL_WPMK) -> float:
    """Isothermal circular source on a semi-infinite spreader: R = 1/(4·k·a).

    ORDER-OF-MAGNITUDE REFERENCE ONLY. It applies when a small source spreads
    into a thick block. Here the 0.70 mm base is thin AND the die is larger
    than the fin field, so the operative effect is coverage/constriction, not
    classic spreading — use this purely as a sanity bound, not a design number.
    """
    if area_source_m2 <= 0 or k_wpmk <= 0:
        return float("inf")
    a = math.sqrt(area_source_m2 / math.pi)
    return 1.0 / (4.0 * k_wpmk * a)


@dataclass
class JunctionToCoolant:
    """Series junction-to-coolant breakdown for one candidate (K/W)."""
    R_conv_kpw:       float    # fin + fluid (from the solver)
    R_base_kpw:       float    # 1-D base conduction over the cooled footprint
    R_tim_kpw:        float    # TIM over the die
    R_jc_kpw:         float    # conv + base + tim (coverage/spreading flagged separately)
    conv_fraction:    float    # R_conv / R_jc  (how much of the stack the fin owns)
    coverage:         float    # cooled footprint / die area  (< 1 => under-covered)
    spreading_ref_kpw: float   # half-space bound (reference only)
    needs_coverage_cfd: bool   # True when coverage < 1.0 and local peaks need CHT


def junction_to_coolant(R_conv_kpw: float,
                        die_area_m2: float = GPU_DIE_AREA_M2,
                        cooled_area_m2: float = FIN_FIELD_FOOTPRINT_M2,
                        t_base_m: float = PROTO1_BASE_THICKNESS_M,
                        k_wpmk: float = KS_CU_AM_NOMINAL_WPMK,
                        tim_areal_kcm2_w: float = TIM_AREAL_RESISTANCE_KCM2_W
                        ) -> JunctionToCoolant:
    """Add the non-convective stack terms to a candidate's convective R.

    Conservative assumptions:
      * base 1-D conduction is taken over the COOLED (fin-field) footprint —
        the bottleneck the heat must funnel into;
      * TIM is taken over the full die area;
      * coverage = cooled/die is reported separately. When < 1 (die bigger than
        the fin field) there is an additional coverage/constriction penalty that
        is NOT folded into R_jc here — it is a design action (enlarge the fin
        field), surfaced via `coverage`.
    """
    A_cool = min(die_area_m2, cooled_area_m2)
    R_base = base_conduction_resistance(A_cool, t_base_m, k_wpmk)
    R_tim = tim_resistance(die_area_m2, tim_areal_kcm2_w)
    R_jc = R_conv_kpw + R_base + R_tim
    return JunctionToCoolant(
        R_conv_kpw=R_conv_kpw,
        R_base_kpw=R_base,
        R_tim_kpw=R_tim,
        R_jc_kpw=R_jc,
        conv_fraction=(R_conv_kpw / R_jc) if R_jc > 0 else 0.0,
        coverage=(cooled_area_m2 / die_area_m2) if die_area_m2 > 0 else float("inf"),
        spreading_ref_kpw=halfspace_spreading_reference(die_area_m2, k_wpmk),
        needs_coverage_cfd=(cooled_area_m2 < die_area_m2),
    )
