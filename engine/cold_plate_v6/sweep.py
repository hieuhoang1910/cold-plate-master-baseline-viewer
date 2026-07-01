"""
cold_plate_v6/sweep.py
=======================
Prototype 2 design sweep — generates a grid of candidate Geometry objects,
filters them against copper-LPBF manufacturability rules, runs each through
the v6 solver, computes a Pareto front (R_th_conv vs ΔP_total) and several
ranking scores, and returns a structured sweep result.

Scope: same architecture as PROTO1 (top-jet centre-rib bidirectional). The
sweep varies fin thickness, channel gap, fin height, wave amplitude, and
wavelength. Architecture changes (pin-fin, TPMS, MMC, jet-impingement
matrix) are out of scope — those would need a v6 solver with additional
architecture handlers.

Public entry points:

    SweepRanges               – container for the parameter ranges
    generate_candidates()     – Cartesian product of the parameter grid
    is_manufacturable()       – LPBF design-rule filter
    evaluate_candidates()     – runs solve() on each candidate
    pareto_front()            – non-dominated front in (R_th, ΔP) space
    rank_candidates()         – three ranking scores (R_th-only, JF factor,
                                composite budget-aware)
    run_sweep()               – full pipeline; returns SweepResult
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from itertools import product
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .architecture     import FlowArchitecture
from .geometry         import Geometry
from .master_constants import (
    PROTO1_FIN_CORE_WIDTH_M,
    TARGET_DP_PA_MAX,
    TARGET_RTH_KW_MAX,
    TARGET_WPUMP_W_MAX,
)
from .operating        import Operating
from .solver           import SolveResult, solve
from .system_resistance import JunctionToCoolant, junction_to_coolant


# ============================================================================
# Sweep parameter container
# ============================================================================

@dataclass
class SweepRanges:
    """Parameter grid for the Prototype 2 design sweep.

    Defaults span a sensible Prototype 2 design space around the PROTO1
    baseline. Override any sequence to widen, narrow, or refine the grid.

    Total candidates = product of the lengths. Default (LMM-intent, 0.05-0.30 mm
    walls and gaps) is 6·6·3·3·3 = 972.
    """
    fin_thickness_m: Sequence[float] = field(
        default_factory=lambda: (0.05e-3, 0.10e-3, 0.15e-3, 0.20e-3, 0.25e-3, 0.30e-3)
    )
    gap_m:           Sequence[float] = field(
        default_factory=lambda: (0.05e-3, 0.10e-3, 0.15e-3, 0.20e-3, 0.25e-3, 0.30e-3)
    )
    fin_height_m:    Sequence[float] = field(
        default_factory=lambda: (4.5e-3, 5.5e-3, 6.5e-3)
    )
    wave_amplitude_m: Sequence[float] = field(
        default_factory=lambda: (0.25e-3, 0.40e-3, 0.55e-3)
    )
    wavelength_m:    Sequence[float] = field(
        default_factory=lambda: (2.5e-3, 3.75e-3, 5.0e-3)
    )

    # Fixed parameters held at PROTO1 values during the sweep
    core_width_m:    float = PROTO1_FIN_CORE_WIDTH_M
    core_length_m:   float = 15.0e-3
    side_margin_m:   float = 1.8e-3 / 2.0      # 0.9 mm per side (from STL fit)

    def total_candidates(self) -> int:
        return (len(self.fin_thickness_m)
                * len(self.gap_m)
                * len(self.fin_height_m)
                * len(self.wave_amplitude_m)
                * len(self.wavelength_m))


# ============================================================================
# Manufacturability rules
# ============================================================================

@dataclass
class ManufacturabilityRules:
    """Copper-LPBF design rules (from Cold Plate Milestones roadmap §2).

    These are the *recommended* values for a robust, depowderable, post-HIP
    pure-copper LPBF part. Tighter limits are sometimes achievable with
    green-laser process tuning but should not be assumed without a
    process-qualified supplier coupon.
    """
    min_fin_thickness_m:  float = 0.20e-3       # reliable wall thickness post-HIP
    min_gap_m:            float = 0.20e-3       # depowdering minimum
    min_pitch_m:          float = 0.35e-3       # assembly + tolerance
    max_fin_aspect:       float = 40.0          # H / t — self-supporting overhang
    max_amp_to_lambda:    float = 0.30          # A/λ — roadmap useful range
    min_amp_to_lambda:    float = 0.05
    max_fins_in_core:     int   = 80            # tolerance accumulation guard

    def evaluate(self, g: Geometry) -> Dict[str, bool]:
        """Return per-rule pass/fail flags for a Geometry."""
        pitch = g.gap_m + g.fin_thickness_m
        amp_over_lambda = (g.wave_amplitude_m / g.wavelength_m
                           if g.wavelength_m > 0 else 0.0)
        fin_aspect = g.fin_height_m / g.fin_thickness_m if g.fin_thickness_m > 0 else 1e9
        return {
            "min_fin_thickness":  g.fin_thickness_m >= self.min_fin_thickness_m,
            "min_gap":            g.gap_m           >= self.min_gap_m,
            "min_pitch":          pitch             >= self.min_pitch_m,
            "max_fin_aspect":     fin_aspect        <= self.max_fin_aspect,
            "amp_lambda_band":    (self.min_amp_to_lambda
                                   <= amp_over_lambda
                                   <= self.max_amp_to_lambda),
            "max_fin_count":      g.fin_count       <= self.max_fins_in_core,
        }

    def is_pass(self, g: Geometry) -> bool:
        return all(self.evaluate(g).values())


def is_manufacturable(g: Geometry,
                      rules: Optional[ManufacturabilityRules] = None) -> bool:
    return (rules or ManufacturabilityRules()).is_pass(g)


# ============================================================================
# Candidate generator
# ============================================================================

def _fin_count_for_pitch(core_width_m: float,
                         pitch_m: float,
                         side_margin_m: float) -> int:
    """How many fins fit in (core_width − 2·side_margin) at the given pitch?"""
    usable = core_width_m - 2.0 * side_margin_m
    if pitch_m <= 0 or usable <= 0:
        return 0
    return max(1, int(usable / pitch_m))


def generate_candidates(ranges: SweepRanges) -> List[Geometry]:
    """Cartesian product of the parameter grid → list of Geometry objects."""
    candidates: List[Geometry] = []
    for t, b, H, A, lam in product(ranges.fin_thickness_m,
                                   ranges.gap_m,
                                   ranges.fin_height_m,
                                   ranges.wave_amplitude_m,
                                   ranges.wavelength_m):
        pitch = t + b
        N_fin = _fin_count_for_pitch(ranges.core_width_m, pitch,
                                     ranges.side_margin_m)
        N_ch  = N_fin + 1
        wave_count = max(1.0, round(ranges.core_length_m / lam))
        cand = Geometry(
            fin_count        = N_fin,
            channel_count    = N_ch,
            gap_m            = b,
            fin_thickness_m  = t,
            fin_height_m     = H,
            wave_amplitude_m = A,
            wavelength_m     = lam,
            wave_count       = wave_count,
            core_width_m      = ranges.core_width_m,
            core_length_m     = ranges.core_length_m,
            # everything else defaults to PROTO1
        )
        candidates.append(cand)
    return candidates


# ============================================================================
# Evaluator
# ============================================================================

@dataclass
class CandidateRecord:
    """A single candidate plus its solve result + manufacturability flags."""
    index:               int
    geometry:            Geometry
    result:              SolveResult
    manufacturable:      bool
    manufacturability_detail: Dict[str, bool]
    score_R_th:          float        # primary: R_th_conv (lower better)
    score_JF:            float        # Webb thermal-performance factor (higher better)
    score_composite:     float        # composite budget-aware (lower better)
    R_jc_kpw:            float        # junction-to-coolant R (conv+base+TIM), K/W
    stack:               JunctionToCoolant


def evaluate_candidates(candidates: Sequence[Geometry],
                        op:   Optional[Operating]       = None,
                        arch: Optional[FlowArchitecture] = None,
                        rules: Optional[ManufacturabilityRules] = None,
                        ) -> List[CandidateRecord]:
    """Run solve() on every candidate and return CandidateRecords.

    Order of records matches the order of candidates.
    """
    op    = op    or Operating()
    arch  = arch  or FlowArchitecture()
    rules = rules or ManufacturabilityRules()

    records: List[CandidateRecord] = []
    for i, g in enumerate(candidates):
        r = solve(g, op, arch)
        flags = rules.evaluate(g)
        mfg_ok = all(flags.values())

        # Scoring
        rth = r.R_th_conv_kpw
        dp  = r.dP_total_pa

        # JF factor (Webb 1981): proxy h ∝ Nu/D_h vs proxy f from f·Re.
        # Simple j and f proxies from the solver's own Nu_used and fRe_used so
        # the relative ranking captures wavy + roughness effects too.
        j_proxy = r.Nu_used / max(r.Re_Dh, 1e-3)        # ∝ Stanton·Pr^(2/3)
        f_proxy = r.fRe_used / max(r.Re_Dh, 1e-3)
        score_JF = j_proxy / (f_proxy ** (1.0 / 3.0)) if f_proxy > 0 else 0.0

        # Composite (lower better): R_th penalised by the fraction of the ΔP
        # budget consumed. At fixed flow W_pump = V̇·ΔP, so ΔP and W_pump carry
        # the SAME information — ΔP is counted ONCE (no W_pump double-count).
        # No manufacturability penalty: in the LMM-intent sweep, manufacturability
        # is an annotation (see is_manufacturable / the add-on view), not a gate.
        composite = rth * 1000.0 * (1.0 + dp / TARGET_DP_PA_MAX)

        # Junction-to-coolant add-on. V6 uses the candidate's own cooled
        # footprint so current and die-coverage cases are not silently
        # collapsed into the same stack.
        jc = junction_to_coolant(
            rth,
            cooled_area_m2=g.core_width_m * g.core_length_m,
            t_base_m=g.base_thickness_m,
            k_wpmk=g.k_solid_wpmk,
        )

        records.append(CandidateRecord(
            index=i,
            geometry=g,
            result=r,
            manufacturable=mfg_ok,
            manufacturability_detail=flags,
            score_R_th=rth,
            score_JF=score_JF,
            score_composite=composite,
            R_jc_kpw=jc.R_jc_kpw,
            stack=jc,
        ))
    return records


# ============================================================================
# Pareto front (R_th_conv vs ΔP_total)
# ============================================================================

def pareto_front(records: Sequence[CandidateRecord],
                 manufacturable_only: bool = True
                 ) -> List[CandidateRecord]:
    """Return the non-dominated subset of records in (R_th, ΔP) space.

    A point (R, P) dominates (R', P') if R ≤ R' and P ≤ P' with at least
    one strict inequality. Pareto-optimal points are non-dominated.
    """
    pool = [r for r in records if (r.manufacturable or not manufacturable_only)]
    front: List[CandidateRecord] = []
    for c in pool:
        dominated = False
        cR, cP = c.score_R_th, c.result.dP_total_pa
        for other in pool:
            if other is c:
                continue
            oR, oP = other.score_R_th, other.result.dP_total_pa
            if oR <= cR and oP <= cP and (oR < cR or oP < cP):
                dominated = True
                break
        if not dominated:
            front.append(c)
    front.sort(key=lambda r: r.score_R_th)
    return front


# ============================================================================
# Ranking helpers
# ============================================================================

def rank_candidates(records: Sequence[CandidateRecord],
                    metric: str = "composite",
                    manufacturable_only: bool = True,
                    top_n: int = 15) -> List[CandidateRecord]:
    """Return the top-N records by the chosen metric.

    metric is one of: "R_th", "JF", "composite".
    """
    pool = [r for r in records if (r.manufacturable or not manufacturable_only)]
    if metric == "R_th":
        pool.sort(key=lambda r: r.score_R_th)
    elif metric == "JF":
        pool.sort(key=lambda r: -r.score_JF)        # higher = better
    elif metric == "composite":
        pool.sort(key=lambda r: r.score_composite)
    else:
        raise ValueError(f"Unknown ranking metric: {metric!r}")
    return pool[:top_n]


# ============================================================================
# Top-level sweep
# ============================================================================

@dataclass
class SweepResult:
    """Container for the full sweep output."""
    ranges:                SweepRanges
    rules:                 ManufacturabilityRules
    op:                    Operating
    arch:                  FlowArchitecture
    baseline:              CandidateRecord
    all_records:           List[CandidateRecord]
    manufacturable:        List[CandidateRecord]
    pareto:                List[CandidateRecord]
    top_by_R_th:           List[CandidateRecord]
    top_by_JF:             List[CandidateRecord]
    top_by_composite:      List[CandidateRecord]


def run_sweep(ranges: Optional[SweepRanges]                   = None,
              op:     Optional[Operating]                     = None,
              arch:   Optional[FlowArchitecture]              = None,
              rules:  Optional[ManufacturabilityRules]        = None,
              top_n:  int                                     = 15
              ) -> SweepResult:
    """Run the full Prototype 2 design sweep and return a SweepResult."""
    ranges = ranges or SweepRanges()
    op     = op     or Operating()
    arch   = arch   or FlowArchitecture()
    rules  = rules  or ManufacturabilityRules()

    candidates = generate_candidates(ranges)
    records    = evaluate_candidates(candidates, op, arch, rules)

    # PROTO1 baseline for delta reporting. The baseline must represent the REAL
    # as-built PROTO1, so it is solved on PROTO1's OWN flow path (core_length/2),
    # not the sweep architecture. Otherwise a longer-path die-coverage sweep
    # can silently halve PROTO1's R_conv and understate
    # how much the swept candidates beat the as-built part. Header/uniformity are
    # inherited from the sweep arch so only the flow path is corrected.
    baseline_g = Geometry()        # defaults to PROTO1
    baseline_arch = replace(arch, path_length_m=baseline_g.core_length_m / 2.0)
    baseline_r = solve(baseline_g, op, baseline_arch)
    baseline_flags = rules.evaluate(baseline_g)
    baseline_rec = CandidateRecord(
        index=-1,
        geometry=baseline_g,
        result=baseline_r,
        manufacturable=all(baseline_flags.values()),
        manufacturability_detail=baseline_flags,
        score_R_th=baseline_r.R_th_conv_kpw,
        score_JF=(baseline_r.Nu_used / max(baseline_r.Re_Dh, 1e-3))
                 / ((baseline_r.fRe_used / max(baseline_r.Re_Dh, 1e-3)) ** (1/3))
                 if baseline_r.fRe_used > 0 else 0.0,
        score_composite=(baseline_r.R_th_conv_kpw * 1000.0
                          * (1.0 + baseline_r.dP_total_pa / TARGET_DP_PA_MAX)),
        R_jc_kpw=junction_to_coolant(
            baseline_r.R_th_conv_kpw,
            cooled_area_m2=baseline_g.core_width_m * baseline_g.core_length_m,
            t_base_m=baseline_g.base_thickness_m,
            k_wpmk=baseline_g.k_solid_wpmk,
        ).R_jc_kpw,
        stack=junction_to_coolant(
            baseline_r.R_th_conv_kpw,
            cooled_area_m2=baseline_g.core_width_m * baseline_g.core_length_m,
            t_base_m=baseline_g.base_thickness_m,
            k_wpmk=baseline_g.k_solid_wpmk,
        ),
    )

    # LMM-intent: rank over ALL candidates (manufacturability is an annotation,
    # not a gate). The manufacturable subset is kept for the add-on view.
    return SweepResult(
        ranges=ranges,
        rules=rules,
        op=op,
        arch=arch,
        baseline=baseline_rec,
        all_records=records,
        manufacturable=[r for r in records if r.manufacturable],
        pareto=pareto_front(records, manufacturable_only=False),
        top_by_R_th     = rank_candidates(records, "R_th",       False, top_n),
        top_by_JF       = rank_candidates(records, "JF",         False, top_n),
        top_by_composite= rank_candidates(records, "composite",  False, top_n),
    )
