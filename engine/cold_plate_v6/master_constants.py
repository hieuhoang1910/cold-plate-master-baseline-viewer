"""
cold_plate_v6/master_constants.py
==================================
Tunable physical constants for the V6 solver.

EVERY value the team might want to change lives here. The physics modules
(geometry.py, correlations.py, solver.py, ...) import from this file so a
single edit propagates everywhere.

Each constant follows this convention:

    NAME_UNITS = value            # 1-line tag
    # WHAT     : ...               # plain-English meaning
    # WHERE    : ...               # source (STL, photo, datasheet, literature)
    # WHY      : ...               # design / selection rationale
    # TYP BAND : ...               # plausible range for sensitivity sweeps

Sections
--------
    1.  Material library (copper AM + water reference)
    2.  Project KPI targets (Cold Plate Milestones roadmap)
    3.  PROTO1 fin field (the team-tunable knobs)
    4.  PROTO1 fin core footprint
    5.  PROTO1 wavy planform
    6.  PROTO1 flow architecture (top-jet centre-rib bidirectional)
    7.  PROTO1 heater contact footprint
    8.  Operating conditions (flow band + nominal Q)
    9.  Reynolds-regime thresholds
    10. Solver behaviour defaults (warnings, sensitivity bands)

Units — SI throughout
---------------------
    length      m         |  conductivity W/m·K
    temperature K         |  density      kg/m³
    mass flow   kg/s      |  specific heat J/kg·K
    volume flow m³/s (helpers convert to LPM)
    viscosity   Pa·s      |  pressure     Pa
    power       W
"""

# ============================================================================
# 1.  MATERIAL LIBRARY — copper AM + water
# ============================================================================

KS_CU_AM_NOMINAL_WPMK      = 340.0
# WHAT     : Nominal Cu-AM thermal conductivity for default solves.
# WHERE    : Green-laser LPBF + HIP, ~95 % IACS literature centerpoint.
# WHY      : Matches the Cold Plate Milestones roadmap baseline.
# TYP BAND : 320-380 W/m·K with HIP; 280-340 W/m·K without.

KS_CU_AM_CONSERVATIVE_WPMK = 250.0
# WHAT     : Pessimistic Cu-AM k for safety-side solves.
# WHERE    : IR-LPBF with remelt, ~75 % IACS.

KS_CU_AM_OPTIMISTIC_WPMK   = 400.0
# WHAT     : Optimistic Cu-AM k for "best-case" solves.
# WHERE    : Green-laser LPBF + HIP at peak density (≥99.5 %), 100 % IACS.

# Water reference at 25 °C — used as the inlet condition. The fluids module
# computes T-dependent properties from these starting points.
WATER_T_REF_C       = 25.0
WATER_RHO_KG_PER_M3 = 997.0
WATER_MU_PA_S       = 0.00089
WATER_K_W_PER_MK    = 0.60
WATER_CP_J_PER_KGK  = 4181.0
# WHERE    : NIST water tables at 25 °C. Replace if the coolant is changed
#            (e.g. EG/water mix, dielectric fluid).


# ============================================================================
# 2.  PROJECT KPI TARGETS — Cold Plate Milestones roadmap
# ============================================================================

TARGET_RTH_KW_MAX       = 0.05       # K/W
# WHAT     : Cold-plate convective contribution only (excludes TIM/IHS/contact).
# WHERE    : Cold Plate Milestones, R_th budget allocation.

TARGET_DP_PA_MAX        = 50_000.0   # Pa
# WHAT     : Maximum cold-plate-only ΔP at design flow.
# WHERE    : Industry custom-loop ceiling (Optimus / EK / Watercool).

TARGET_VDOT_LPM_MIN     = 1.5        # LPM
# WHAT     : Lower bound for useful loop flow.

TARGET_WPUMP_W_MAX      = 5.0        # W (ideal hydraulic V̇·ΔP)
# WHAT     : Pumping-power ceiling at design flow.

TARGET_RTH_JC_MAX       = 0.078      # K/W
# WHAT     : Full junction-to-coolant budget (die → coolant).


# ============================================================================
# 3.  PROTO1 FIN FIELD — the team-tunable knobs
# ============================================================================
# Confirmed by Hieu on 2026-05-28. Sources:
#   * STL (sin fin_0.15mm.stl) — 64 fins, ~5.86 mm fin height as-printed,
#     ~1.14 mm base as-printed.
#   * Hieu chat — fin thickness = 0.16 mm, gap = 0.25 mm, base post-CNC = 0.70 mm.
#   * CFD streamline render — confirms bidirectional split via centre rib.

PROTO1_GAP_M             = 0.25e-3
# WHAT     : Channel gap between adjacent wavy fins (b).
# WHERE    : Hieu chat 2026-05-28.
# WHY      : Sits comfortably above the 0.20 mm depowdering floor for
#            copper LPBF (post-HIP).

PROTO1_FIN_THICKNESS_M   = 0.16e-3
# WHAT     : Fin thickness (t).
# WHERE    : Hieu chat 2026-05-28. STL filename "sin fin_0.15mm.stl" refers
#            to the design-intent 0.15 mm; as-built target is 0.16 mm.
# WHY      : Pushes fin efficiency lower than the legacy 0.25 mm; trade for
#            higher fin count and wetted area at the same pitch.
# TYP BAND : 0.14-0.20 mm depending on beam offset.

PROTO1_FIN_COUNT         = 64
PROTO1_CHANNEL_COUNT     = 65
# WHAT     : N_fin and N_ch in the active wavy region. N_ch = N_fin + 1.
# WHERE    : STL scan-line at Z=33 mm (128 X-crossings = 64 walls).

PROTO1_FIN_HEIGHT_M      = 5.86e-3
# WHAT     : Fin height (H), root to tip.
# WHERE    : STL Z-profile — fin root at Z ≈ 30.25, fin tip at Z ≈ 36.11.
# TYP BAND : ±0.10 mm print resolution.

PROTO1_BASE_THICKNESS_M  = 0.70e-3
# WHAT     : Cold-plate base thickness POST-CNC.
# WHERE    : Hieu chat 2026-05-28 ("after the cnc, we changed it to 0.7 mm").
# WHY      : The STL shows ~1.14 mm pre-CNC; the production part is machined
#            down to 0.70 mm. The thermal model uses 0.70 mm.

PROTO1_AS_PRINTED_BASE_M = 1.14e-3
# WHAT     : Pre-CNC base thickness from the STL. NOT used in the thermal
#            calculation — kept for CNC-allowance verification (0.44 mm
#            machined off).

PROTO1_RELATIVE_ROUGHNESS = 0.03
# WHAT     : Channel-wall relative roughness ε/D_h after HIP + light internal
#            polish on copper LPBF surfaces.
# WHERE    : Roadmap "post-HIP Ra ≈ 5-10 µm with D_h ≈ 0.3-0.5 mm → ε/D_h
#            ≈ 0.01-0.03".
# WHY      : Drives the Norris-Webb laminar friction augmentation. Default
#            0.03 is the conservative (rough) end of the band.


# ============================================================================
# 4.  PROTO1 FIN CORE FOOTPRINT
# ============================================================================

PROTO1_FIN_CORE_WIDTH_M  = 28.0e-3
# WHAT     : X span of the active fin core (perpendicular to fin axis).
# WHERE    : STL X bounds at Z=33 mm.

PROTO1_FIN_CORE_LENGTH_M = 15.0e-3
# WHAT     : Y span of the active fin core (along fin axis).
# WHERE    : STL Y range with 128 X-crossings at Z=33 mm (Y ≈ 8 to 23 mm).
# WHY      : Total Y span; the centre rib splits this into two 7.5 mm halves.


# ============================================================================
# 5.  PROTO1 WAVY PLANFORM
# ============================================================================

PROTO1_WAVE_AMPLITUDE_M  = 0.38e-3
# WHAT     : Centerline-to-peak amplitude of the sinusoidal fin.
# WHERE    : STL — tracked one fin's X position across Y at Z=33 mm.
# WHY      : A/λ = 0.10, inside the literature's 0.10-0.30 useful range.
# TYP BAND : Confirm against nTop design intent before sign-off.

PROTO1_WAVELENGTH_M      = 3.77e-3
# WHAT     : Wavelength along the flow (Y) direction.
# WHERE    : STL zero-crossings of the tracked fin centerline.

PROTO1_WAVE_COUNT        = 4.0
# WHAT     : Full sine waves across PROTO1_FIN_CORE_LENGTH_M.
# WHERE    : 15 mm / 3.77 mm.


# ============================================================================
# 6.  PROTO1 FLOW ARCHITECTURE — top-jet, centre-rib, bidirectional
# ============================================================================

PROTO1_FLOW_ARCHITECTURE = "top_jet_slot_centre_rib_bidirectional"
# WHAT     : Identifier consumed by the solver.
# WHERE    : Hieu manifold photos + CFD streamline render (2026-05-28).
# WHY      : Water enters at one corner of the top silicone manifold, diffuses
#            to the central recessed pocket, drops through the impingement
#            slot onto the fin tops at Y = middle of the fin core. A physical
#            rib in the fin block at Y=middle splits the flow into +Y and -Y
#            halves; each half flows 7.5 mm to the outer plenum, recollects,
#            and exits at the opposite corner port.

PROTO1_PATH_LENGTH_M     = 7.5e-3
# WHAT     : Single-pass fin-channel flow length per side (bidirectional split).
# WHERE    : Half of PROTO1_FIN_CORE_LENGTH_M (15 mm / 2).

PROTO1_N_PARALLEL_PATHS  = 2
# WHAT     : Number of symmetric flow paths (+Y and -Y halves).

PROTO1_FLOW_UNIFORMITY   = 1.0
# WHAT     : Uniformity factor for flow across the parallel channels.
# WHERE    : Default 1.0 = perfectly uniform. The CFD streamline render
#            suggests this is defensible because the centre rib mechanically
#            forces the symmetric split.
# WHY      : Sweep at 0.85 and 0.70 to bound the maldistribution penalty
#            (open item TD-10).

PROTO1_HEADER_K_TOTAL    = 1.5
# WHAT     : Lumped minor-loss coefficient for inlet + outlet manifolds.
# WHERE    : Engineering estimate. Diagonal-corner expansion (K≈1.0) +
#            re-contraction (K≈0.5). CFD shows jet velocities ~10 m/s at
#            the slot — real K may be 2.5-4.0; default is conservative-low.
# WHY      : Adds 0.5·ρ·v²·K to the block ΔP. Open item TD-11 (CFD needed).

PROTO1_JET_SLOT_WIDTH_M  = 6.0e-3
PROTO1_JET_SLOT_LENGTH_M = 12.0e-3
# WHAT     : Approximate slot dimensions of the manifold jet feed (from photo).
# WHERE    : Engineering estimate pending caliper measurement of the silicone
#            manifold.
# TYP BAND : ±2 mm — please measure and update.

PROTO1_JET_IMP_ENHANCEMENT = 1.0
# WHAT     : Convective enhancement multiplier on h in the impingement footprint.
# WHERE    : Default 1.0 (no enhancement). Plausible band 1.15-1.30 from
#            Martin's correlation; can reach 2-3× for very high-velocity arrays.
# WHY      : DEFAULT CONSERVATIVE. Turn on only after CFD quantifies it.

PROTO1_HAS_CENTRE_RIB     = True
PROTO1_CENTRE_RIB_WIDTH_M = 1.0e-3
# WHAT     : The fin block has a physical rib running ACROSS the fin axis at
#            Y = middle, sealing the channels at the centreline.
# WHERE    : Hieu CFD render — streamlines fan outward from the rib.
# WHY      : Confirms n_parallel_paths = 2 and L_path = 7.5 mm.
#            Rib also removes ~rib_width × N_ch × b × H of wetted-area
#            service — a ~5-7 % correction for a 1 mm rib.
# TYP BAND : 0.5-2.0 mm; please confirm from nTop.


# ============================================================================
# 7.  PROTO1 HEATER CONTACT FOOTPRINT
# ============================================================================

PROTO1_HEATER_CONTACT_WIDTH_M  = 23.40e-3
PROTO1_HEATER_CONTACT_HEIGHT_M = 26.40e-3
PROTO1_HEATER_CONTACT_AREA_M2  = PROTO1_HEATER_CONTACT_WIDTH_M * PROTO1_HEATER_CONTACT_HEIGHT_M
# WHAT     : Heater-block contact footprint with the cold-plate base.
# WHERE    : Setup deck — explicit heater contact area = 6.18 cm².
# WHY      : Used for spreading/constriction resistance and the TIM/contact
#            stack back-calculation.


# ============================================================================
# 8.  OPERATING CONDITIONS
# ============================================================================

DEFAULT_VDOT_LPM         = 2.65
# WHAT     : Default flow rate for the design-point solve.
# WHERE    : Mean of the 24-row Codex-strict workbook stable population.

DEFAULT_T_INLET_C        = 25.0
# WHAT     : Default inlet water temperature.

DEFAULT_Q_TARGET_W       = 450.0
# WHAT     : Nameplate heater load from the setup deck. The rig currently
#            absorbs ~300 W on the water side — see [[cowork_knowledge_update_20260521]]
#            for the unresolved heater calorimetric balance.

FLOW_SWEEP_LPM_TUPLE = (1.0, 1.5, 2.0, 2.65, 3.0)
# WHAT     : Flow rates the main.py entry point sweeps for the operating-point
#            curve.


# ============================================================================
# 9.  REYNOLDS-REGIME THRESHOLDS (TD-14)
# ============================================================================

RE_LAMINAR_CEILING       = 300.0
# WHAT     : Below this Re, the Shah-London laminar correlations are valid.
# WHERE    : Standard rectangular-duct laminar/transition boundary.

RE_TURBULENT_FLOOR       = 2300.0
# WHAT     : Above this Re, Dittus-Boelter-style turbulent correlations apply.

# Re_Dh in [300, 2300] is the transitional band — neither correlation set is
# valid. The solver emits an explicit warning when the design point falls
# in this band (TD-14 from the v4 audit).


# ============================================================================
# 10. SOLVER BEHAVIOUR DEFAULTS
# ============================================================================

WARN_TRANSITIONAL_REGIME = True
# WHAT     : If True, the solver appends a warning when Re lies in the
#            transitional band 300 ≤ Re ≤ 2300.

WARN_FAIL_KPI            = True
# WHAT     : If True, the solver appends a warning whenever any project
#            KPI fails.

ARC_LENGTH_APPROX        = "sqrt_chi2_over_2"
# WHAT     : Selector for the arc-length-factor approximation in
#            correlations.arc_length_factor. Valid: "sqrt_chi2_over_2"
#            (default, ±2 % for χ ≤ 1.5) or "numeric" (exact integral,
#            ±0 % but slower).


# ============================================================================
# 11. PROTOTYPE 2 — design-sweep result retained as the v6 baseline
# ============================================================================
# Source: the proto2 675-candidate wavy-fin sweep plus the first-principles
# t = b analysis.
#
# Two design points are recorded. LMM (micro-LPBF) is the PRIMARY process;
# standard LPBF is the FALLBACK if LMM is unavailable (report §4):
#     11b. PROTO2_LMM_* — PRIMARY: the LMM target, t = b = 0.10 mm. Build this.
#     11a. PROTO2_*     — FALLBACK: best std-LPBF pick, t = b = 0.20 mm.
# (Constant names are kept for stability; PROTO2_LMM_* is the one to build.)
#
# Design rationale — the levers that set R_th, in order of how much they move
# it (from the sweep data; see report §0b, §0c.6, §4.3):
#     1. WAVE  (A/λ → 0.22): the strongest single R_th lever. A sharper sine
#        lengthens the channel arc by √(1+χ²/2), adding ~20 % wetted area for
#        the same envelope, plus a 6-12 % Dean-vortex Nu enhancement.
#     2. GAP b: tighten to the process floor. R_th ∝ b (linear); ΔP ∝ 1/b².
#     3. t = b: set fin thickness equal to the gap. A SHALLOW optimum — worth
#        only a few % on R_th — but it locks ε_void = 0.50 (TPMS-class
#        partition) and keeps the fin off PROTO1's thin-fin, low-η_f side.
#        It is a guideline, not a hard law; it lands in the pick mainly
#        because the process min-wall and min-gap are nearly equal.
#     4. FIN HEIGHT H: weak — an area-vs-efficiency trade set by manifold fit.
#
# The legacy PROTO1_* constants above stay in place for as-built reference.

# ---- 11a. STD-LPBF FALLBACK (balanced, standard copper LPBF) ---------------

PROTO2_FIN_THICKNESS_M   = 0.20e-3
# WHAT     : Fin thickness t. At the LPBF reliable-wall floor; equals the gap (t = b).
# WHY      : +25 % vs PROTO1's 0.16 mm — buys process-tolerance margin and keeps
#            η_f from slipping as the gap tightens (η_f stays ≈ 0.28).

PROTO2_GAP_M             = 0.20e-3
# WHAT     : Channel gap b. At the depowdering floor — the tightest manufacturable.
# WHY      : −20 % vs PROTO1's 0.25 mm. The gap is one of the two dominant R_th levers.

PROTO2_FIN_HEIGHT_M      = 5.50e-3
# WHAT     : Fin height H. Close to PROTO1's 5.86 mm so the silicone manifold
#            seal is likely reusable with a minor (0.36 mm) cavity adjustment.

PROTO2_FIN_COUNT         = 65
PROTO2_CHANNEL_COUNT     = 66
# WHAT     : N_fin / N_ch, derived from (28 − 2·0.9 mm) / (t + b) = 26.2 / 0.40.

PROTO2_WAVE_AMPLITUDE_M  = 0.55e-3
# WHAT     : Wave amplitude A. Top of the useful band; the dominant R_th lever.
# WHY      : +45 % vs PROTO1's 0.38 mm — most of the gain is the longer arc length
#            (more wetted area), with a secondary Dean-vortex Nu enhancement.

PROTO2_WAVELENGTH_M      = 2.50e-3
# WHAT     : Wavelength λ. Short wave; A/λ = 0.22 (top of the 0.05-0.30 band).

PROTO2_WAVE_COUNT        = 6.0
# WHAT     : Full sine waves across the 15 mm fin core: round(15 / 2.5).

# Predicted at 2.65 LPM / 25 °C (prior solver): R_th_conv = 16.26 mK/W,
# ΔP_total = 1.17 kPa, h = 14 555 W/m²·K, η_f = 0.277, UA = 60.9 W/K;
# ε_void = 0.50, SA/V ≈ 6 300 m⁻¹. All four KPIs PASS. Δ vs PROTO1: −42 % R_th.

# ---- 11b. PRIMARY: LMM TARGET (micro-LPBF, ~0.10 mm reliable wall + channel) --------

PROTO2_LMM_FIN_THICKNESS_M  = 0.10e-3   # t = b = 0.10 mm (the defensible analytical floor)
PROTO2_LMM_GAP_M            = 0.10e-3
PROTO2_LMM_FIN_HEIGHT_M     = 5.50e-3
PROTO2_LMM_FIN_COUNT        = 131
PROTO2_LMM_CHANNEL_COUNT    = 132
PROTO2_LMM_WAVE_AMPLITUDE_M = 0.55e-3
PROTO2_LMM_WAVELENGTH_M     = 2.50e-3
PROTO2_LMM_WAVE_COUNT       = 6.0
# Predicted at 2.65 LPM / 25 °C (prior solver): R_th_conv ≈ 8.3 mK/W,
# ΔP_total ≈ 4.3 kPa (12× under ceiling); ε_void = 0.50,
# SA/V ≈ 12 600 m⁻¹ (AM-LPBF microchannel class). Δ vs PROTO1: −71 % R_th.
# This is the defensible analytical floor (report §0c.5): below b = 0.10 mm the
# roughness / tolerance / maldistribution corrections grow large and the prior
# numbers need CFD + a tolerance study before being quoted externally.
# If the supplier's process-qualified minimum is 0.12 mm, use t = b = 0.12 mm
# (R_th ≈ 9.9 mK/W — still inside the defensible band).


# ============================================================================
# 12. TARGET GPU + JUNCTION-TO-COOLANT STACK — RTX 5090 (GB202)
# ============================================================================
# Target device for Prototype 2: NVIDIA GeForce RTX 5090, INNO3D iChill X3.
# Die: GB202 (Blackwell, TSMC N4P). These feed the junction-to-coolant
# resistance add-on (system_resistance.py), which adds the non-convective
# terms (TIM + base conduction) the fin sweep ignores.
# Sources: NVIDIA / VideoCardz / Tom's Hardware GB202 die-shot reporting, 2025.

GPU_LABEL                   = "NVIDIA RTX 5090 (GB202, INNO3D iChill X3)"

GPU_DIE_WIDTH_M             = 24.0e-3
GPU_DIE_HEIGHT_M            = 31.0e-3
GPU_DIE_AREA_M2            = GPU_DIE_WIDTH_M * GPU_DIE_HEIGHT_M   # ≈ 744 mm²
# WHAT  : GB202 die footprint (~24 × 31 mm = 744 mm²; NVIDIA quotes ~750 mm²).
# WHY   : Heat source for the spreading/coverage check and junction-to-coolant R.

GPU_TDP_W                   = 575.0
# WHAT  : RTX 5090 board power (TBP up to ~600 W).
# NOTE  : Exceeds the 450 W rig nameplate / ~300 W rig-absorbed design point —
#         a flag for the OPERATING point, not the geometry. R_th is Q-independent;
#         caloric ΔT and T_junction are not (recompute margins at 575 W).

TIM_AREAL_RESISTANCE_KCM2_W = 0.05
# WHAT  : Thermal-interface-material areal resistance over the die (K·cm²/W).
# WHERE : Good performance paste 0.03-0.10 K·cm²/W; liquid metal ~0.005-0.02.
#         Default 0.05 (good paste). R_TIM = this / A_die.
# WHY   : Junction-to-coolant stack term; NOT part of the cold-plate solver.

FIN_FIELD_FOOTPRINT_M2      = PROTO1_FIN_CORE_WIDTH_M * PROTO1_FIN_CORE_LENGTH_M  # 28×15 = 420 mm²
# WHAT  : Cooled (fin-field) footprint = core_width × core_length.
# NOTE  : 420 mm² < the 744 mm² GB202 die — the PROTO1-derived fin field covers
#         only ~56 % of the RTX 5090 die. A production cold plate must enlarge
#         the fin field/manifold to ≥ the die footprint (see report). Until then
#         the uncovered die area is a coverage/spreading penalty on top of R_jc.


# ============================================================================
# 13. V6 AUDIT-RESPONSE GEOMETRY AND SENSITIVITY DEFAULTS
# ============================================================================

V6_CURRENT_CORE_WIDTH_M = PROTO1_FIN_CORE_WIDTH_M
V6_CURRENT_CORE_LENGTH_M = PROTO1_FIN_CORE_LENGTH_M
# WHAT: Current analytical footprint. Kept for traceability.

V6_DIE_COVERAGE_PHYSICAL_WIDTH_M = PROTO1_FIN_CORE_WIDTH_M
V6_DIE_COVERAGE_PHYSICAL_LENGTH_M = 35.0e-3
# WHAT: Team-selected physical die-coverage envelope for the next CAD study:
# 28 mm wide x 35 mm long. This keeps side margin beyond the GB202 working
# footprint and gives CAD/manifold room beyond the 31 mm die long axis.

V6_DIE_COVERAGE_CORE_WIDTH_M = V6_DIE_COVERAGE_PHYSICAL_LENGTH_M
V6_DIE_COVERAGE_CORE_LENGTH_M = V6_DIE_COVERAGE_PHYSICAL_WIDTH_M
# WHAT: Solver-axis representation of the 28 x 35 mm physical envelope.
# Fins/waves run parallel to the 28 mm side so the water path is short.
# Therefore the 35 mm physical length is transverse to the fins and sets
# fin count, while the 28 mm physical width is the flow-axis length.

V6_ROUGHNESS_SENSITIVITY = (0.00, 0.03, 0.05, 0.10)
V6_HEADER_K_SENSITIVITY = (1.5, 3.0, 4.0, 6.0)
V6_FLOW_UNIFORMITY_SENSITIVITY = (1.00, 0.95, 0.90, 0.85)
V6_BASE_THICKNESS_SENSITIVITY_M = (0.60e-3, 0.70e-3, 0.80e-3, 1.00e-3)
V6_TIM_AREAL_SENSITIVITY_KCM2_W = (0.03, 0.05, 0.10)
V6_HEAT_LOAD_SENSITIVITY_W = (450.0, 575.0)
# WHY: Bounding inputs for the v6 audit response. They do not replace coupon,
# CFD, or hardware validation.

V6_KSOLID_SENSITIVITY_WPMK = (
    KS_CU_AM_CONSERVATIVE_WPMK,   # 250 — IR-LPBF / no HIP, ~75 % IACS (safe side)
    KS_CU_AM_NOMINAL_WPMK,        # 340 — green-laser + HIP, ~95 % IACS (headline)
    KS_CU_AM_OPTIMISTIC_WPMK,     # 400 — peak density, ~100 % IACS (upside)
)
# WHAT : Copper-AM solid-conductivity band for the v6 audit panel (audit F-2).
# WHY  : The 0.10 mm LMM fins run at low fin efficiency (eta_f ~ 0.12-0.18), so
#        R_conv is materially sensitive to k_solid: a low-eta_f fin leans on
#        solid conduction. Measured impact on the current footprint is
#        R_conv = 7.57 / 8.17 / 9.43 mK/W for k = 400 / 340 / 250 W/m·K.
#        Until a supplier coupon fixes IACS, the conservative k = 250 case must
#        appear alongside any headline number.

V6_THERMAL_ENTRY_DEFAULT_ON = False
# WHAT : Whether the headline solve folds the developing-flow (thermal-entry)
#        Nusselt uplift into Nu_used (audit F-3).
# WHY  : DEFAULT OFF. The fully-developed Nu is a CONSERVATIVE lower bound on h
#        (the channel is shorter than its thermal entry length, so it never
#        fully develops). The audit panel turns the correction ON as an explicit
#        UPSIDE case so the conservatism is quantified, not assumed. CHT/CFD must
#        confirm before the entry-corrected number is used externally.
