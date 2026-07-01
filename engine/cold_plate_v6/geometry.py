"""
cold_plate_v6/geometry.py
==========================
Geometry dataclass and geometric helpers (hydraulic diameter, aspect ratio,
arc-length factor for a wavy planform, fin efficiency for a single rectangular
adiabatic-tip fin).

The Geometry dataclass defaults to PROTO1 as-built. Override any field to
evaluate a Prototype 2 candidate without touching master_constants.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple

from .master_constants import (
    KS_CU_AM_NOMINAL_WPMK,
    PROTO1_AS_PRINTED_BASE_M,
    PROTO1_BASE_THICKNESS_M,
    PROTO1_CENTRE_RIB_WIDTH_M,
    PROTO1_CHANNEL_COUNT,
    PROTO1_FIN_CORE_LENGTH_M,
    PROTO1_FIN_CORE_WIDTH_M,
    PROTO1_FIN_COUNT,
    PROTO1_FIN_HEIGHT_M,
    PROTO1_FIN_THICKNESS_M,
    PROTO1_GAP_M,
    PROTO1_HAS_CENTRE_RIB,
    PROTO1_HEATER_CONTACT_HEIGHT_M,
    PROTO1_HEATER_CONTACT_WIDTH_M,
    PROTO1_RELATIVE_ROUGHNESS,
    PROTO1_WAVE_AMPLITUDE_M,
    PROTO1_WAVE_COUNT,
    PROTO1_WAVELENGTH_M,
)


# ============================================================================
# Geometry dataclass
# ============================================================================

@dataclass
class Geometry:
    """All as-built geometry needed by the solver.

    Defaults populate to PROTO1 (sin fin_0.15mm.stl + Hieu clarifications +
    CFD render). Override any field to evaluate a Prototype 2 candidate
    in-place without editing master_constants.py.
    """
    # --- Fin field
    fin_count:           int   = PROTO1_FIN_COUNT
    channel_count:       int   = PROTO1_CHANNEL_COUNT
    gap_m:               float = PROTO1_GAP_M
    fin_thickness_m:     float = PROTO1_FIN_THICKNESS_M
    fin_height_m:        float = PROTO1_FIN_HEIGHT_M
    base_thickness_m:    float = PROTO1_BASE_THICKNESS_M
    as_printed_base_m:   float = PROTO1_AS_PRINTED_BASE_M

    # --- Fin core footprint
    core_width_m:        float = PROTO1_FIN_CORE_WIDTH_M
    core_length_m:       float = PROTO1_FIN_CORE_LENGTH_M

    # --- Wavy planform
    wave_amplitude_m:    float = PROTO1_WAVE_AMPLITUDE_M
    wavelength_m:        float = PROTO1_WAVELENGTH_M
    wave_count:          float = PROTO1_WAVE_COUNT

    # --- Centre rib (Hieu CFD confirmed)
    has_centre_rib:      bool  = PROTO1_HAS_CENTRE_RIB
    centre_rib_width_m:  float = PROTO1_CENTRE_RIB_WIDTH_M

    # --- Heater contact (spreading/constriction calc)
    heater_contact_width_m:  float = PROTO1_HEATER_CONTACT_WIDTH_M
    heater_contact_height_m: float = PROTO1_HEATER_CONTACT_HEIGHT_M

    # --- Material + finish
    k_solid_wpmk:        float = KS_CU_AM_NOMINAL_WPMK
    relative_roughness:  float = PROTO1_RELATIVE_ROUGHNESS

    # ---- Derived (computed on demand)
    @property
    def pitch_m(self) -> float:
        """Nominal fin center-to-center pitch, t + b."""
        return self.fin_thickness_m + self.gap_m

    @property
    def modeled_pattern_width_m(self) -> float:
        """Width occupied by the modeled fins and equal-width channels."""
        return (self.fin_count * self.fin_thickness_m
                + self.channel_count * self.gap_m)

    @property
    def residual_core_width_m(self) -> float:
        """Transverse width left outside the modeled fin/channel pattern."""
        return self.core_width_m - self.modeled_pattern_width_m

    @property
    def aspect_ratio(self) -> float:
        """α = b / H, the rectangular-duct aspect ratio (always ≤ 1)."""
        b, H = self.gap_m, self.fin_height_m
        if b <= 0 or H <= 0:
            return 0.0
        return min(b, H) / max(b, H)

    @property
    def hydraulic_diameter_m(self) -> float:
        """D_h = 2bH/(b+H) for a rectangular channel of gap b and height H."""
        b, H = self.gap_m, self.fin_height_m
        if (b + H) <= 0:
            return 0.0
        return 2.0 * b * H / (b + H)

    @property
    def flow_area_per_channel_m2(self) -> float:
        return self.gap_m * self.fin_height_m

    @property
    def flow_area_total_m2(self) -> float:
        return self.channel_count * self.flow_area_per_channel_m2

    @property
    def heater_contact_area_m2(self) -> float:
        return self.heater_contact_width_m * self.heater_contact_height_m

    def label(self) -> str:
        return (f"{self.fin_count} fins × "
                f"t={self.fin_thickness_m*1e3:.3f} mm × "
                f"b={self.gap_m*1e3:.3f} mm × "
                f"H={self.fin_height_m*1e3:.3f} mm")


# ============================================================================
# Arc-length helpers
# ============================================================================

def arc_length_factor(amplitude_m: float, wavelength_m: float,
                      method: str = "sqrt_chi2_over_2") -> float:
    """Multiplier on L_proj to get the arc length of a sinusoidal centerline.

    For y(x) = A sin(2π x / λ):

        L_arc / L_proj = (1/L) ∫₀ᴸ √(1 + (2πA/λ)² cos²(2πx/λ)) dx

    Method ``"sqrt_chi2_over_2"`` (default) uses the closed-form approximation
    √(1 + χ²/2)  with  χ = 2πA/λ.  Accurate to ±2 % for χ ≤ 1.5, which covers
    the PROTO1 case (χ ≈ 0.633).

    Method ``"numeric"`` evaluates the exact integral by Simpson's rule with
    400 panels. Slower but exact.
    """
    if amplitude_m <= 0 or wavelength_m <= 0:
        return 1.0
    chi = 2.0 * math.pi * amplitude_m / wavelength_m
    if method == "sqrt_chi2_over_2":
        return math.sqrt(1.0 + 0.5 * chi * chi)
    if method == "numeric":
        n = 400
        # Integrate over one wavelength then average
        L = wavelength_m
        h = L / n
        s = 0.0
        for i in range(n + 1):
            x = i * h
            ds = math.sqrt(1.0 + (2.0 * math.pi * amplitude_m / wavelength_m) ** 2
                                * math.cos(2.0 * math.pi * x / wavelength_m) ** 2)
            w = 1 if (i == 0 or i == n) else (4 if i % 2 else 2)
            s += w * ds
        avg = (h / 3.0) * s / L
        return avg
    raise ValueError(f"Unknown arc-length method: {method!r}")


# ============================================================================
# Fin efficiency
# ============================================================================

def fin_efficiency(h_wpm2k: float,
                   k_solid_wpmk: float,
                   fin_thickness_m: float,
                   fin_height_m: float) -> Tuple[float, float]:
    """Adiabatic-tip rectangular fin efficiency.

    Returns (m·H, η_f) where

        m   = √(2 h / (k · t))
        η_f = tanh(m·H) / (m·H)

    The adiabatic-tip assumption is acceptable when the fin tip sees a
    closed channel (which PROTO1 does, because the silicone manifold sits
    flush on the fin tops). For an exposed-tip fin, add a corrected-length
    H' = H + t/2.

    Returns (0.0, 1.0) if any input is non-positive.
    """
    if h_wpm2k <= 0 or fin_thickness_m <= 0 or k_solid_wpmk <= 0 or fin_height_m <= 0:
        return (0.0, 1.0)
    m = math.sqrt(2.0 * h_wpm2k / (k_solid_wpmk * fin_thickness_m))
    mH = m * fin_height_m
    if mH > 25.0:
        # tanh saturates; avoid math overflow
        return (mH, 1.0 / mH)
    return (mH, math.tanh(mH) / mH)
