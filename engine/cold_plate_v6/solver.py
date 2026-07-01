"""
cold_plate_v6/solver.py
========================
Orchestrator: takes a Geometry + Operating + FlowArchitecture spec and runs
the full PROTO1 analytical solve, returning a SolveResult dataclass.

Solve sequence (deliberately matches the original proto1 worked-example
walk-through so a reader can step through the code and report logic in
lock-step):

    1.  Evaluate fluid properties at T_inlet + ½·caloric ΔT (TD-06)
    2.  Geometric derivations (D_h, α, A_flow, L_arc, A_total wetted)
    3.  Flow split per architecture (bidirectional → 1/2 per side path)
    4.  Reynolds number, regime, transitional warning (TD-14)
    5.  Shah-London Nu_H1, wavy enhancement (TD-12), optional jet enhancement
    6.  Convective h
    7.  Fin efficiency η_f, overall η_o, UA, R_th_conv
    8.  Friction f·Re with Norris-Webb roughness (TD-05), ΔP_friction
    9.  Header minor-loss ΔP, ΔP_total, W_pump
    10. NTU / effectiveness picture
    11. KPI status checks

The dataclass SolveResult is flat (only floats / strs / bools / list[str]) so
it serialises cleanly to CSV and JSON.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from .architecture     import FlowArchitecture
from .correlations     import (
    norris_webb_roughness_factor,
    overall_surface_efficiency,
    shah_london_Nu_rectangular_H1,
    shah_london_fRe_rectangular,
    thermal_entry_factor,
    wavy_nu_enhancement,
)
from .fluids           import FluidProps
from .geometry         import Geometry, arc_length_factor, fin_efficiency
from .master_constants import (
    RE_LAMINAR_CEILING,
    RE_TURBULENT_FLOOR,
    TARGET_DP_PA_MAX,
    TARGET_RTH_KW_MAX,
    TARGET_VDOT_LPM_MIN,
    TARGET_WPUMP_W_MAX,
    V6_THERMAL_ENTRY_DEFAULT_ON,
    WARN_FAIL_KPI,
    WARN_TRANSITIONAL_REGIME,
)
from .operating        import Operating


# ============================================================================
# Result dataclass
# ============================================================================

@dataclass
class SolveResult:
    """Headline output of solve(). Keep flat for clean CSV/JSON export."""
    # --- traceability inputs
    geometry_label:       str
    architecture:         str
    V_dot_LPM:            float
    T_inlet_C:            float
    fluid_T_eval_C:       float
    # --- derived geometry
    pitch_mm:             float
    aspect_ratio:         float
    D_h_m:                float
    A_flow_total_m2:      float
    L_arc_m:              float
    arc_length_factor:    float
    A_fin_sides_m2:       float
    A_base_unfinned_m2:   float
    A_total_wetted_m2:    float
    rib_area_loss_m2:     float
    # --- flow
    V_dot_per_path_m3s:   float
    v_channel_mps:        float
    v_jet_mps:            float
    Re_Dh:                float
    Re_jet:               float
    flow_regime:          str
    # --- heat transfer
    Nu_FD_smooth:         float
    wavy_enhancement:     float
    jet_enhancement:      float
    thermal_entry_factor: float
    thermal_entry_applied: bool
    Nu_used:              float
    h_wpm2k:              float
    m_H_dimless:          float
    eta_f:                float
    eta_o:                float
    UA_wpk:               float
    R_th_conv_kpw:        float
    # --- pressure
    fRe_smooth:           float
    roughness_factor:     float
    fRe_used:             float
    dP_friction_pa:       float
    dP_header_pa:         float
    v_header_ref_mps:     float
    dP_total_pa:          float
    W_pump_ideal_w:       float
    # --- NTU / effectiveness
    NTU:                  float
    effectiveness:        float
    Q_at_dT30_w:          float
    caloric_dT_at_Qtarget_K: float
    # --- KPI checks
    pass_R_th:            bool
    pass_dP:              bool
    pass_V_dot:           bool
    pass_W_pump:          bool
    # --- warnings (exported separately from the numeric block)
    warnings:             List[str] = field(default_factory=list)


# ============================================================================
# solve()
# ============================================================================

def solve(geom: Geometry,
          op:   Operating,
          arch: FlowArchitecture,
          k_solid_wpmk: Optional[float] = None,
          wavy_enhancement_override: Optional[float] = None,
          apply_thermal_entry: bool = V6_THERMAL_ENTRY_DEFAULT_ON) -> SolveResult:
    """Run the PROTO1 analytical model and return a SolveResult.

    Args:
        geom:  Geometry — defaults to PROTO1 as-built.
        op:    Operating — defaults to (2.65 LPM, 25 °C, 450 W).
        arch:  FlowArchitecture — defaults to top-jet centre-rib bidirectional.
        k_solid_wpmk: Override for the solid (copper-AM) thermal conductivity.
            None uses geom.k_solid_wpmk (KS_CU_AM_NOMINAL_WPMK).
        wavy_enhancement_override: Optional forced Nusselt multiplier for
            audit sensitivity cases. Use 1.0 to keep the wavy arc length but
            remove the empirical wavy-channel heat-transfer uplift.
        apply_thermal_entry: If True, fold the developing-flow (thermal-entry)
            Nusselt uplift into Nu_used (audit F-3). Default OFF so the headline
            R_conv stays the conservative fully-developed bound; the entry factor
            is always reported in the result for transparency.
    """
    warnings: List[str] = []
    k_solid = k_solid_wpmk if k_solid_wpmk is not None else geom.k_solid_wpmk

    # --- Step 1: T-dependent fluid properties (TD-06) ---------------------
    fluid = FluidProps.at(op.T_inlet_C)
    V_dot_total = op.V_dot_m3_s
    m_dot_total = V_dot_total * fluid.rho
    if m_dot_total > 0:
        dT_caloric_est = op.Q_target_W / (m_dot_total * fluid.cp)
        T_eval = op.T_inlet_C + 0.5 * dT_caloric_est
        fluid = FluidProps.at(T_eval)
    else:
        T_eval = op.T_inlet_C

    # --- Step 2: Geometric derivations -------------------------------------
    b      = geom.gap_m
    H      = geom.fin_height_m
    t      = geom.fin_thickness_m
    L_proj = arch.path_length_m

    if geom.modeled_pattern_width_m > geom.core_width_m + 1e-12:
        warnings.append(
            "Modeled fin/channel field width "
            f"{geom.modeled_pattern_width_m*1e3:.3f} mm exceeds transverse "
            f"core width {geom.core_width_m*1e3:.3f} mm. Check fin count, "
            "channel count, pitch, and CAD axis assignment."
        )

    A_flow_per_chan = b * H
    A_flow_total    = geom.channel_count * A_flow_per_chan
    D_h             = geom.hydraulic_diameter_m
    alpha           = geom.aspect_ratio
    arc_f           = arc_length_factor(geom.wave_amplitude_m, geom.wavelength_m)
    L_arc           = L_proj * arc_f

    # Wetted area on BOTH sides combined (n_parallel_paths handles the
    # bidirectional doubling). Each half-channel contributes its share.
    A_fin_sides   = geom.fin_count    * 2.0 * H * L_arc * arch.n_parallel_paths
    A_base_unfin  = geom.channel_count * b   * L_arc * arch.n_parallel_paths
    A_total_wet   = A_fin_sides + A_base_unfin

    # Centre-rib area loss (Hieu CFD confirmed, ~5-7 % typically)
    if geom.has_centre_rib:
        A_rib = (geom.fin_count * 2.0 * H * geom.centre_rib_width_m
                 + geom.channel_count * b * geom.centre_rib_width_m)
        A_total_wet  -= A_rib
        A_fin_sides  -= geom.fin_count * 2.0 * H * geom.centre_rib_width_m
        A_base_unfin -= geom.channel_count * b * geom.centre_rib_width_m
    else:
        A_rib = 0.0

    # --- Step 3: Flow split per architecture path -------------------------
    V_dot_per_path = V_dot_total * arch.per_path_flow_fraction
    if A_flow_total > 0:
        v_chan = V_dot_per_path / A_flow_total
    else:
        v_chan = 0.0
    v_jet = arch.jet_velocity_mps(V_dot_total)

    # --- Step 4: Reynolds, regime, transitional warning (TD-14) -----------
    if fluid.mu > 0:
        Re_Dh = fluid.rho * v_chan * D_h / fluid.mu
    else:
        Re_Dh = 0.0
    if arch.jet_slot_width_m > 0:
        Re_jet = fluid.rho * v_jet * arch.jet_slot_width_m / fluid.mu
    else:
        Re_jet = 0.0

    if Re_Dh < RE_LAMINAR_CEILING:
        flow_regime = f"laminar (Re < {RE_LAMINAR_CEILING:.0f})"
    elif Re_Dh < RE_TURBULENT_FLOOR:
        flow_regime = (f"transitional ({RE_LAMINAR_CEILING:.0f} ≤ Re < "
                       f"{RE_TURBULENT_FLOOR:.0f}) — CORRELATIONS NOT VALID")
        if WARN_TRANSITIONAL_REGIME:
            warnings.append(
                f"Re_Dh = {Re_Dh:.0f} is in the transitional band "
                f"({RE_LAMINAR_CEILING:.0f}-{RE_TURBULENT_FLOOR:.0f}). "
                "Shah-London laminar and Dittus-Boelter turbulent "
                "correlations both lose validity here. Cite a CFD result "
                "before any external claim."
            )
    elif Re_Dh < 1e4:
        flow_regime = "early turbulent"
    else:
        flow_regime = "turbulent"

    # --- Step 5-6: Nu and h (with wavy and jet enhancements) --------------
    Nu_FD       = shah_london_Nu_rectangular_H1(alpha)
    wavy_factor = (wavy_enhancement_override
                   if wavy_enhancement_override is not None
                   else wavy_nu_enhancement(geom.wave_amplitude_m,
                                            geom.wavelength_m, Re_Dh))
    jet_factor  = arch.jet_imp_enhancement
    # Thermal-entry (developing-flow) uplift (audit F-3). Always computed for
    # transparency; only folded into Nu_used when apply_thermal_entry is True.
    entry_factor = thermal_entry_factor(Nu_FD, Re_Dh, fluid.Pr, D_h, L_arc)
    entry_applied_factor = entry_factor if apply_thermal_entry else 1.0
    Nu_used     = Nu_FD * wavy_factor * jet_factor * entry_applied_factor
    h           = Nu_used * fluid.k / D_h if D_h > 0 else 0.0

    # --- Step 7: Fin efficiency, η_o, UA, R_th_conv -----------------------
    mH, eta_f = fin_efficiency(h, k_solid, t, H)
    eta_o     = overall_surface_efficiency(eta_f, A_fin_sides, A_total_wet)
    UA        = h * A_total_wet * eta_o * arch.flow_uniformity
    R_th_conv = 1.0 / UA if UA > 0 else float("inf")

    # --- Step 8: Friction ΔP (with Norris-Webb roughness factor — TD-05) --
    fRe_smooth   = shah_london_fRe_rectangular(alpha)
    rough_factor = norris_webb_roughness_factor(geom.relative_roughness, Re_Dh)
    fRe_used     = fRe_smooth * rough_factor
    if D_h > 0:
        # Fanning convention: f = fRe / Re, ΔP = 4·f·(L/D_h)·½·ρ·v²
        # Combined: ΔP_friction = fRe · µ · v · L / (2·D_h²)
        # Wait: the Shah-London tabulation uses the Fanning factor with
        # ΔP = 2·f·(L/D_h)·ρ·v² (4·f is the Darcy form). To stay consistent
        # with the v4 solver and with most rectangular-duct references,
        # we use the formula:
        #   ΔP_friction = (f·Re) · 2 · µ · v · L / D_h²
        # which is equivalent to the f·(L/D_h)·½·ρ·v²·4 Darcy form.
        # See Kandlikar et al. (2006), "Heat Transfer and Fluid Flow in
        # Minichannels and Microchannels", §3.6 for the derivation.
        dP_friction = fRe_used * 2.0 * fluid.mu * v_chan * L_arc / (D_h * D_h)
    else:
        dP_friction = 0.0

    # --- Step 9: Header / manifold minor losses (TD-11; audit F-1 fix) -----
    # Minor losses scale with the velocity head of the high-velocity manifold
    # feature the K lumps (corner expansion into the plenum + re-contraction at
    # the impingement slot), NOT the slow fin-channel velocity. Referencing K to
    # the jet/slot velocity is the physically correct single-reference lumped
    # model. Previously this used v_chan (~0.23 m/s), which made the header-K
    # sweep change ΔP by <0.2 kPa and therefore bound nothing. Fall back to the
    # channel velocity only if the slot area is undefined (v_jet == 0).
    v_header_ref = v_jet if v_jet > 0 else v_chan
    dP_header = 0.5 * fluid.rho * v_header_ref * v_header_ref * arch.header_K_total
    dP_total  = dP_friction + dP_header
    W_pump    = V_dot_total * dP_total

    # --- Step 10: NTU / effectiveness picture -----------------------------
    if m_dot_total > 0 and UA > 0:
        NTU         = UA / (m_dot_total * fluid.cp)
        eff         = 1.0 - math.exp(-NTU)
        Q_at_dT30   = eff * m_dot_total * fluid.cp * 30.0
        caloric_dT  = op.Q_target_W / (m_dot_total * fluid.cp)
    else:
        NTU, eff, Q_at_dT30 = 0.0, 0.0, 0.0
        caloric_dT = float("inf")

    # --- Step 11: KPI checks ----------------------------------------------
    pass_R = R_th_conv  <= TARGET_RTH_KW_MAX
    pass_P = dP_total   <= TARGET_DP_PA_MAX
    pass_V = op.V_dot_LPM >= TARGET_VDOT_LPM_MIN
    pass_W = W_pump     <= TARGET_WPUMP_W_MAX

    if WARN_FAIL_KPI:
        if not pass_R:
            warnings.append(
                f"R_th_conv = {R_th_conv*1000:.2f} mK/W exceeds target "
                f"{TARGET_RTH_KW_MAX*1000:.1f} mK/W."
            )
        if not pass_P:
            warnings.append(
                f"ΔP_total = {dP_total/1000:.2f} kPa exceeds target "
                f"{TARGET_DP_PA_MAX/1000:.1f} kPa."
            )

    return SolveResult(
        geometry_label    = geom.label(),
        architecture      = arch.name,
        V_dot_LPM         = op.V_dot_LPM,
        T_inlet_C         = op.T_inlet_C,
        fluid_T_eval_C    = T_eval,
        pitch_mm          = geom.pitch_m * 1e3,
        aspect_ratio      = alpha,
        D_h_m             = D_h,
        A_flow_total_m2   = A_flow_total,
        L_arc_m           = L_arc,
        arc_length_factor = arc_f,
        A_fin_sides_m2    = A_fin_sides,
        A_base_unfinned_m2= A_base_unfin,
        A_total_wetted_m2 = A_total_wet,
        rib_area_loss_m2  = A_rib,
        V_dot_per_path_m3s= V_dot_per_path,
        v_channel_mps     = v_chan,
        v_jet_mps         = v_jet,
        Re_Dh             = Re_Dh,
        Re_jet            = Re_jet,
        flow_regime       = flow_regime,
        Nu_FD_smooth      = Nu_FD,
        wavy_enhancement  = wavy_factor,
        jet_enhancement   = jet_factor,
        thermal_entry_factor = entry_factor,
        thermal_entry_applied = apply_thermal_entry,
        Nu_used           = Nu_used,
        h_wpm2k           = h,
        m_H_dimless       = mH,
        eta_f             = eta_f,
        eta_o             = eta_o,
        UA_wpk            = UA,
        R_th_conv_kpw     = R_th_conv,
        fRe_smooth        = fRe_smooth,
        roughness_factor  = rough_factor,
        fRe_used          = fRe_used,
        dP_friction_pa    = dP_friction,
        dP_header_pa      = dP_header,
        v_header_ref_mps  = v_header_ref,
        dP_total_pa       = dP_total,
        W_pump_ideal_w    = W_pump,
        NTU               = NTU,
        effectiveness     = eff,
        Q_at_dT30_w       = Q_at_dT30,
        caloric_dT_at_Qtarget_K = caloric_dT,
        pass_R_th         = pass_R,
        pass_dP           = pass_P,
        pass_V_dot        = pass_V,
        pass_W_pump       = pass_W,
        warnings          = warnings,
    )


# ============================================================================
# compare_to_baseline()
# ============================================================================

def compare_to_baseline(candidate: SolveResult,
                        baseline:  Optional[SolveResult] = None) -> Dict[str, Any]:
    """Side-by-side delta of headline KPIs between a Prototype 2 candidate
    and the PROTO1 baseline.

    Returns a dict keyed by metric name with sub-fields:
        {"baseline": float, "candidate": float, "delta_pct": float | None}

    If baseline is None, the function generates one from the defaults of
    Geometry(), Operating(), FlowArchitecture().
    """
    if baseline is None:
        baseline = solve(Geometry(), Operating(), FlowArchitecture())

    def pct(c, b):
        if b in (0, float("inf"), float("-inf")) or b is None:
            return None
        return 100.0 * (c - b) / b

    out: Dict[str, Any] = {}
    for key in (
        "R_th_conv_kpw",
        "dP_total_pa",
        "W_pump_ideal_w",
        "UA_wpk",
        "h_wpm2k",
        "eta_f",
        "Re_Dh",
        "v_channel_mps",
        "A_total_wetted_m2",
    ):
        bv = getattr(baseline,  key)
        cv = getattr(candidate, key)
        out[key] = {"baseline": bv, "candidate": cv, "delta_pct": pct(cv, bv)}
    return out


# Re-export asdict for callers that want raw dict conversion
result_to_dict = asdict
# (v6 audit fixes F-1/F-3 wired in: header-loss ref velocity + thermal-entry factor)
