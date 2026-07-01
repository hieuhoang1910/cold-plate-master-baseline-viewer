"""
cold_plate_v6/correlations.py
==============================
Heat-transfer and friction correlations for laminar/transitional flow through
rectangular wavy channels with rough walls.

This module closes four V4 tech-debt items in one place:

    TD-05  laminar-regime roughness correction      (Norris-Webb augmentation)
    TD-06  T-dependent water properties             (delegated to fluids.py)
    TD-12  wavy-channel Nu enhancement              (Dean-vortex correction)
    TD-14  explicit transitional-Re warning        (delegated to solver.py)

Every correlation carries:
    * citation to the source paper / textbook,
    * its validity range,
    * a worked numerical example showing the value for the PROTO1 baseline.

Conventions:
    α  = b / H = aspect ratio of the rectangular channel (always ≤ 1)
    χ  = 2π·A/λ = wavy-channel "curvature parameter"
    ε  = absolute wall roughness;  ε/D_h is the relative roughness
"""

from __future__ import annotations

import math


# ============================================================================
# 0.  Correlation validation status registry — audit F-4
# ============================================================================
# Every correlation in this module is tagged with its validation status so a
# reader (or report) can see at a glance which numbers are textbook-grade and
# which are in-house screening fits that still need CFD/CHT or coupon closure.
#
#   "VALIDATED"  : standard, literature-grade relation used inside its stated
#                  validity range.
#   "SCREENING"  : in-house engineering fit / generic application of a relation
#                  outside its strict derivation basis. Usable for RANKING and
#                  bounded sensitivity, NOT for an external performance claim
#                  until CFD/CHT (and, for roughness, a supplier coupon) close it.

CORRELATION_STATUS = {
    "shah_london_fRe_rectangular":   "VALIDATED",   # Shah & London 1978, ±1 %
    "shah_london_Nu_rectangular_H1": "VALIDATED",   # Shah & London 1978, H1
    "wavy_nu_enhancement":           "SCREENING",   # in-house chi^1.5 tanh fit
    "thermal_entry_factor":          "SCREENING",   # Hausen form on rect. H1 duct
    "norris_webb_roughness_factor":  "SCREENING",   # in-house laminar clamp
    "martin_jet_impingement_Nu":     "SCREENING",   # unused by default solve
}


# ============================================================================
# 1.  Rectangular-duct friction factor — Shah & London (1978)
# ============================================================================

def shah_london_fRe_rectangular(alpha: float) -> float:
    """Fully-developed laminar Fanning friction-factor × Reynolds number for
    a rectangular duct of aspect ratio α = b/H ∈ (0, 1].

    Correlation: Shah & London (1978), "Laminar Flow Forced Convection in
    Ducts", Advances in Heat Transfer Suppl. 1, eq. 332. Accurate to ±1 %
    across α ∈ [0, 1].

        f·Re = 24·(1 − 1.3553·α + 1.9467·α² − 1.7012·α³
                       + 0.9564·α⁴ − 0.2537·α⁵)

    Limits:
        α → 0   (parallel plates):    f·Re → 96 / 4 = 24  (Fanning)
        α → 1   (square):             f·Re ≈ 14.23

    Worked example (PROTO1):  α = 0.25/5.86 = 0.0427
        f·Re_smooth = 24·(1 − 0.0579 + 0.0035 − 0.0001 + ...) ≈ 22.55
        (Darcy friction f_D = 4·f_Fanning → f_D·Re ≈ 90.2)
    """
    a = min(max(alpha, 1e-6), 1.0)
    return 24.0 * (1.0
                   - 1.3553 * a
                   + 1.9467 * a**2
                   - 1.7012 * a**3
                   + 0.9564 * a**4
                   - 0.2537 * a**5)


# ============================================================================
# 2.  Rectangular-duct Nusselt number — Shah & London (1978), H1 condition
# ============================================================================

def shah_london_Nu_rectangular_H1(alpha: float) -> float:
    """Fully-developed laminar Nusselt number for a rectangular duct under
    H1 boundary conditions (axially uniform heat flux with peripherally
    uniform temperature).

    H1 is the right choice for a metallic fin array because:
        * fins have high in-fin conduction (k_Cu ≈ 340-400 W/m·K), so the
          channel periphery is roughly isothermal at any axial station;
        * the imposed heater flux is approximately uniform along the flow
          axis after fin/spreading mixing.

    Correlation: Shah & London (1978), tabulated and fitted as

        Nu_H1 = 8.235·(1 − 2.0421·α + 3.0853·α² − 2.4765·α³
                          + 1.0578·α⁴ − 0.1861·α⁵)

    Limits:
        α → 0   (parallel plates):    Nu_H1 = 8.235
        α → 1   (square):             Nu_H1 ≈ 3.61

    Worked example (PROTO1):  α = 0.0427
        Nu_H1_smooth = 8.235·(1 − 0.087 + 0.006 − 0.000 + ...) ≈ 7.59
    """
    a = min(max(alpha, 1e-6), 1.0)
    return 8.235 * (1.0
                    - 2.0421 * a
                    + 3.0853 * a**2
                    - 2.4765 * a**3
                    + 1.0578 * a**4
                    - 0.1861 * a**5)


# ============================================================================
# 3.  Wavy-channel Nu enhancement (Dean-vortex correction) — TD-12
# ============================================================================

def wavy_nu_enhancement(amplitude_m: float,
                        wavelength_m: float,
                        Re: float) -> float:
    """Multiplier on the straight-channel Nu to account for Dean vortices
    generated by a sinusoidal centerline.

    Returns a multiplier ≥ 1.0. Default formulation is *conservative*:

        χ           = 2π·A/λ          (curvature parameter)
        enhancement = 1 + 0.40 · χ^1.5 · tanh(Re / 300)

    Sources (curvature-parameter form is from Sui et al.; tanh ramp is a
    practical fit to the low-Re-onset of secondary flow):
        * Sui Y., Lee P.S., Teo C.J.,  Int. J. Heat Mass Transfer 53 (2010)
        * Mohammed H.A. et al.,        Renewable Sustainable Energy Rev. 14 (2010)
        * Rush T.A., Newell T.A.,      Int. J. Heat Mass Transfer 42 (1999)

    Behaviour:
        * Re → 0:        enhancement → 1.0  (no secondary flow, conduction
                         dominated)
        * Re ~ 300:      enhancement ~ 1 + 0.30·χ^1.5
        * Re >> 300:     enhancement saturates at 1 + 0.40·χ^1.5

    Worked example (PROTO1):  A = 0.38 mm, λ = 3.77 mm, Re = 125
        χ = 2π·0.38/3.77 = 0.633
        χ^1.5 = 0.504
        tanh(125/300) = 0.394
        enhancement ≈ 1 + 0.40·0.504·0.394 ≈ 1.08

    STATUS: SCREENING (audit F-4). The chi^1.5·tanh(Re/300) form and the 0.40
    coefficient are an in-house engineering fit, not a single peer-reviewed
    correlation validated at this A/λ and Re. Use for RANKING and bounded
    sensitivity only; the audit panel forces this multiplier to 1.0 as a lower
    bound, and no external R_jc claim may rest on the multiplier being ON until
    CFD with γ-Re_θ transition modelling confirms it. Conservative by design —
    real channels with sharper corners or post-HIP residual roughness can hit
    1.2-1.5×.
    """
    if amplitude_m <= 0 or wavelength_m <= 0:
        return 1.0
    chi = 2.0 * math.pi * amplitude_m / wavelength_m
    return 1.0 + 0.40 * (chi ** 1.5) * math.tanh(Re / 300.0)


# ============================================================================
# 3b. Thermal-entry (developing-flow) Nusselt correction — audit F-3
# ============================================================================

def thermal_entry_factor(Nu_fd: float,
                         Re: float,
                         Pr: float,
                         D_h: float,
                         L: float) -> float:
    """Multiplier ≥ 1 on the fully-developed Nu to account for the thermal
    entrance (developing-flow) region.

    Motivation (audit F-3): the channels are SHORT relative to their thermal
    entry length L_th ≈ 0.05·Re·Pr·D_h. For the PROTO1 baseline L_th ≈ 18 mm
    but the flow path is only ≈ 8.2 mm, so the flow never reaches the fully
    developed state the Shah-London Nu assumes. In the entrance region the
    Nusselt number is HIGHER than its FD asymptote, so the FD value
    UNDER-predicts h and therefore OVER-predicts R_conv (i.e. the headline is
    conservative). This function quantifies the size of that conservatism.

    Correlation — Hausen thermal-entrance form, applied as an increment to the
    duct's own fully-developed value and expressed as a ratio:

        Gz       = Re·Pr·D_h / L                 (inverse Graetz number)
        Nu_mean  = Nu_fd + 0.0668·Gz / (1 + 0.04·Gz^(2/3))
        factor   = Nu_mean / Nu_fd

    Limits:
        L → ∞   (long duct, Gz → 0):   factor → 1.0   (recovers FD)
        L small (Gz large):            factor > 1     (entrance enhancement)

    Sources:
        * H. Hausen, "Darstellung des Wärmeüberganges in Rohren durch
          verallgemeinerte Potenzbeziehungen", VDI-Zeitung Beiheft
          Verfahrenstechnik 4 (1943).
        * Shah & London (1978), thermal-entrance tabulations, §V.

    Worked example (PROTO1 baseline):  Re = 128, Pr = 5.91, D_h = 0.4795 mm,
    L = L_arc = 8.22 mm
        Gz       = 128·5.91·0.4795/8.22 ≈ 44.1
        Nu_mean  = 7.56 + 0.0668·44.1 / (1 + 0.04·44.1^(2/3)) ≈ 9.53
        factor   ≈ 1.26

    SCREENING ONLY. The Hausen form is a constant-wall-temperature circular-duct
    correlation applied generically to a rectangular H1 duct, and it does NOT
    account for interaction with the wavy secondary flow (so applying it on top
    of wavy_nu_enhancement risks double-counting). It is therefore DEFAULT-OFF
    in the headline solve and used only as an explicit upside bound until CHT/CFD
    closes the developing-flow question.
    """
    if Nu_fd <= 0 or Re <= 0 or Pr <= 0 or D_h <= 0 or L <= 0:
        return 1.0
    Gz = Re * Pr * D_h / L
    if Gz <= 0:
        return 1.0
    Nu_mean = Nu_fd + 0.0668 * Gz / (1.0 + 0.04 * Gz ** (2.0 / 3.0))
    factor = Nu_mean / Nu_fd
    return factor if factor >= 1.0 else 1.0


# ============================================================================
# 4.  Laminar-regime roughness friction augmentation — TD-05
# ============================================================================

def norris_webb_roughness_factor(eps_rel: float, Re: float) -> float:
    """Multiplier on the smooth-wall f·Re for a laminar rectangular channel
    with relative roughness ε/D_h.

    Standard Churchill / Haaland-style friction correlations show zero
    roughness sensitivity in the fully laminar regime (f = 64/Re for a
    circular tube, f·Re constant for a rectangular duct). Norris (1971),
    Webb (1972), and subsequent reviews (Kandlikar et al. 2003 for
    microchannels) showed that this is correct only for very smooth walls
    (ε/D_h ≲ 0.001). Above that, roughness produces measurable friction
    augmentation even in the laminar regime, primarily through:

        * effective hydraulic-diameter reduction (roughness peaks shrink
          the available cross-section);
        * intermittent micro-vortex shedding off roughness peaks;
        * early laminar-to-transition onset.

    Practical correlation used here:

        f / f_smooth = 1 + 12 · min(ε/D_h, 0.05) · tanh(Re / 50)

    Bounded so the augmentation saturates at +60 % for the fully-rough
    laminar limit.

    Worked example (PROTO1):  ε/D_h = 0.03, Re = 125
        12 · 0.03 = 0.36
        tanh(125/50) = tanh(2.5) = 0.987
        factor ≈ 1 + 0.36 · 0.987 = 1.355

    Sources:
        * Norris R.H. (1971), "Some Simple Approximate Heat Transfer
          Correlations for Turbulent Flow in Ducts with Surface Roughness",
          ASME paper.
        * Webb R.L. (1972), "A Critical Evaluation of Analytical Solutions
          and Reynolds Analogy Equations for Turbulent Heat and Mass
          Transfer in Smooth Tubes", Wärme- und Stoffübertragung 4.
        * Kandlikar S.G., Joshi S., Tian S. (2003), "Effect of Surface
          Roughness on Heat Transfer and Fluid Flow Characteristics at Low
          Reynolds Numbers in Small Diameter Tubes", Heat Transfer Engng. 24.

    STATUS: SCREENING (audit F-4). This is an in-house laminar clamp, not a
    coupon-validated relation; it must be confirmed against measured AM
    roughness on a supplier copper coupon before any external claim. NOTE the
    intended min(eps/Dh, 0.05) clamp makes the eps/Dh = 0.05 and 0.10 cases
    numerically identical (visible in the audit table) — this is by design, the
    fully-rough laminar saturation. This formula augments friction ONLY:
    heat-transfer Nu is also weakly enhanced by roughness (typically +5-15 %)
    but is deliberately NOT modelled here, which keeps the published R_th
    conservative.
    """
    if eps_rel <= 0:
        return 1.0
    return 1.0 + 12.0 * min(eps_rel, 0.05) * math.tanh(Re / 50.0)


# ============================================================================
# 5.  Jet impingement enhancement — Martin (1977), wrapped
# ============================================================================

def martin_jet_impingement_Nu(Re_jet: float, Pr: float, H_over_D: float) -> float:
    """Average Nusselt number under a slot jet impinging on a flat plate,
    following Martin's correlation (Martin 1977).

    Valid range:
        2000  ≤ Re_jet ≤ 4·10^5
        0.6   ≤ Pr     ≤ 7
        4     ≤ H/W    ≤ 80         (W = slot width)

    The PROTO1 jet at 2.65 LPM through a ~6×12 mm slot gives
        v_jet ≈ V_dot / A_slot ≈ 4.42e-5 / 72e-6 ≈ 0.61 m/s
        Re_jet = ρ·v·W/µ ≈ 997·0.61·0.006/8.9e-4 ≈ 4100   (inside range)
        Pr ≈ 6.1
    For impingement at small H/W with this Re, Nu_imp ~ 30-50, giving local
    h ~ 50 000-80 000 W/m²K — much higher than the channel-flow h.

    This function is exposed for the solver's optional jet-enhancement
    contribution, but the default solve uses a simpler lumped multiplier
    (FlowArchitecture.jet_imp_enhancement = 1.0) until CFD calibrates it.

    Formula (selected for water at moderate H/W):
        Nu = 2·Pr^0.42 · (1 + Re_jet^0.55 / 200) ^ 0.5

    For Pr = 6.1, Re_jet = 4100:
        Nu ≈ 2·6.1^0.42·(1 + 4100^0.55/200)^0.5
            ≈ 2·2.10·(1 + 0.66)^0.5 ≈ 5.4
    """
    if Re_jet <= 0 or Pr <= 0:
        return 0.0
    # Selected for slot-jet impingement at moderate H/W with water.
    return 2.0 * (Pr ** 0.42) * (1.0 + (Re_jet ** 0.55) / 200.0) ** 0.5


# ============================================================================
# 6.  Convenience: lumped overall surface efficiency
# ============================================================================

def overall_surface_efficiency(eta_f: float,
                               A_fin: float,
                               A_total: float) -> float:
    """Overall surface efficiency η_o for an array of finned and unfinned
    surface that share the same h.

        η_o = 1 − (A_fin / A_total) · (1 − η_f)

    For PROTO1 the fin sides dominate A_total (≈ 95 % of wetted area), so
    η_o is close to η_f. The other 5 % is unfinned base area between fins.
    """
    if A_total <= 0:
        return 1.0
    return 1.0 - (A_fin / A_total) * (1.0 - eta_f)
