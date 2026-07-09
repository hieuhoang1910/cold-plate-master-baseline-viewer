"""
07_WebApp/engine/manufacturing.py  (webapp-native)
==================================================
V3.3a — per-route manufacturing (DfAM) rulebooks + the manufacturability check
(spec §35). Replaces the V1 single wall/gap floor with a two-tier rulebook:

    absolute bound     -> below it the feature cannot be printed/cleaned  (FAIL)
    recommended bound  -> between absolute and recommended is buildable
                          but marginal                                    (MARGINAL)

Routes
------
  LMM        Incus Hammer EVO35 lithography metal manufacturing (printed Cu).
             SUPPLIER-VERIFIED on our own geometry: Paul Peritsch (Incus GmbH)
             email 2026-07-07 + the distilled review
             `cold_plate_v6_incus_manufacturability_review_20260708.md`.
             Bounds below are FINAL (sintered) dimensions — the conservative
             interpretation of Incus's floor (their green-vs-final basis is an
             open question; the green conversion is exposed separately).
  SLM_IR     Standard IR-fiber-laser LPBF, Cu alloy (CuCrZr class). Target OEM:
             Nikon SLM Solutions (SLM 280/500, NXG XII 600). LITERATURE-grade
             (vendor design guides + published thin-wall/channel studies);
             replace with OEM DfM numbers when a supplier review lands.
  SLM_GREEN  Fine green-laser LPBF, pure Cu (TruPrint/AddiReen class,
             25 um spot / 10-25 um layers). LITERATURE-grade (research
             demonstrations; practical bounds are the recommended tier).

The check is a pure function of geometry — it never mutates the design and has
zero coupling to the thermal/hydraulic solvers (golden parity untouched).

LMM process-chain constants (Incus EVO35): pixel 35 um XY, layer 25 um Z,
sinter shrink x1.197 XY / x1.23 Z, overpolymerization ~1 px per side
(pre-compensate in CAD: fin -2 px, channel +2 px — pitch is preserved).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# LMM (Incus EVO35) process constants
# ---------------------------------------------------------------------------
LMM_PIXEL_MM = 0.035          # XY pixel
LMM_LAYER_MM = 0.025          # Z layer
LMM_SHRINK_XY = 1.197         # green = final * shrink
LMM_SHRINK_Z = 1.23
LMM_OVERPOLY_PX = 1           # per side; CAD edit = -+2 px on a width
# Incus proven-cleanable coupon: 7.7 x 7.7 mm gyroid, ~200 um (6 px) channels.
LMM_COUPON_AREA_MM2 = 7.7 * 7.7

PASS, MARGINAL, FAIL, INFO = "PASS", "MARGINAL", "FAIL", "INFO"

# ---------------------------------------------------------------------------
# Rulebooks (data, not code). Bounds in mm on FINAL dimensions unless noted.
# `basis` strings surface in the UI so no number is a magic value.
# ---------------------------------------------------------------------------
ROUTES: Dict[str, Dict[str, Any]] = {
    "LMM": {
        "label": "LMM — Incus EVO35 (printed Cu)",
        "grade": "supplier-verified",
        "source": "Paul Peritsch (Incus GmbH), email 2026-07-07; review doc 2026-07-08",
        "wall_abs": 0.105,   # 3 px green, printed successfully
        "wall_rec": 0.14,    # 4-5 px green band
        "gap_abs": 0.15,     # Incus stated cleanability limit (0.16 already marginal)
        "gap_rec": 0.20,     # M2: green ~7 px, inside the 6-8 px deep-channel band
        "aspect_max": 30.0,  # H/b — "taller fins need thicker fins"
        "notes": "Bounds are FINAL (sintered) dims — conservative reading of the "
                 "Incus floor. Green chain: x1.197/x1.23 shrink, 35/25 um grid, "
                 "overpoly -+2 px in CAD.",
    },
    "SLM_IR": {
        "label": "SLM (IR) — Nikon SLM Solutions, CuCrZr class",
        "grade": "literature",
        "source": "Vendor design guides + LPBF thin-wall/channel literature "
                  "(researched 2026-07-09); OEM DfM review pending",
        "wall_abs": 0.30,    # thin-wall studies reach 0.1-0.15 but not robust
        "wall_rec": 0.40,
        "gap_abs": 0.40,     # printable slot
        "gap_rec": 0.50,     # depowdering of deep channels; HX practice likes more
        "aspect_max": 10.0,  # recoater interaction / distortion on free walls
        "notes": "45 deg overhang rule; self-supporting horizontal channels to "
                 "~8 mm dia; as-built internal Ra 6-15 um; tolerance +-0.1-0.2 mm.",
    },
    "SLM_GREEN": {
        "label": "SLM (green laser) — pure Cu fine-feature",
        "grade": "literature",
        "source": "Green-laser pure-Cu LPBF studies (25 um spot, 10-25 um layers), "
                  "researched 2026-07-09",
        "wall_abs": 0.10,    # demonstrated (research-grade; 0.08 claimed)
        "wall_rec": 0.18,
        "gap_abs": 0.20,
        "gap_rec": 0.30,     # depowdering still governs
        "aspect_max": 10.0,
        "notes": "99.6-99.8 % density, ~76-100 % IACS -> consistent with the "
                 "k = 250/340/400 W/mK band; tolerance +-0.05-0.1 mm.",
    },
}

# Legacy route keys still present in saved cases/projects.
_ALIASES = {
    "lmm": "LMM",
    "lmm_supplier": "LMM",
    "standard_lpbf": "SLM_IR",
    "std_lpbf": "SLM_IR",
    "slm": "SLM_IR",
    "slm_ir": "SLM_IR",
    "slm_green": "SLM_GREEN",
}


def normalize_route(route: Optional[str]) -> str:
    if not route:
        return "LMM"
    key = str(route).strip()
    if key in ROUTES:
        return key
    return _ALIASES.get(key.lower(), "LMM")


# ---------------------------------------------------------------------------
# LMM green/CAD conversion chain (spec §35A / review §6)
# ---------------------------------------------------------------------------
def _snap(value_mm: float, grid_mm: float) -> float:
    return round(value_mm / grid_mm) * grid_mm


def green_chain(final_mm: float, *, axis: str = "xy",
                overpoly_px: int = 0) -> Dict[str, float]:
    """final (sintered) dim -> green (scaled) -> pixel/layer-snapped green ->
    CAD value after the overpoly pre-compensation (overpoly_px: -2 for a fin
    width, +2 for a channel width, 0 for pitch/wave dims)."""
    shrink = LMM_SHRINK_XY if axis == "xy" else LMM_SHRINK_Z
    grid = LMM_PIXEL_MM if axis == "xy" else LMM_LAYER_MM
    green = final_mm * shrink
    snapped = _snap(green, grid)
    cad = snapped + overpoly_px * LMM_PIXEL_MM if axis == "xy" else snapped
    return {
        "final_mm": final_mm,
        "green_mm": green,
        "green_snapped_mm": snapped,
        "grid_units": round(snapped / grid),
        "cad_mm": cad,
    }


def lmm_recipe(t_mm: float, b_mm: float, H_mm: float,
               A_mm: float = 0.0, lambda_mm: float = 0.0) -> List[Dict[str, Any]]:
    """The full final->green->CAD table for the converter readout (review §6)."""
    rows = [
        {"name": "fin t", **green_chain(t_mm, overpoly_px=-2 * LMM_OVERPOLY_PX)},
        {"name": "gap b", **green_chain(b_mm, overpoly_px=+2 * LMM_OVERPOLY_PX)},
        {"name": "pitch t+b", **green_chain(t_mm + b_mm)},
        {"name": "height H", **green_chain(H_mm, axis="z")},
    ]
    if A_mm > 0:
        rows.append({"name": "wave A", **green_chain(A_mm)})
    if lambda_mm > 0:
        rows.append({"name": "wavelength λ", **green_chain(lambda_mm)})
    return rows


# ---------------------------------------------------------------------------
# The manufacturability check
# ---------------------------------------------------------------------------
def _status(value: float, abs_bound: float, rec_bound: float) -> str:
    if value < abs_bound - 1e-9:
        return FAIL
    if value < rec_bound - 1e-9:
        return MARGINAL
    return PASS


def _check(rule: str, label: str, value: Optional[float], abs_bound: Optional[float],
           rec_bound: Optional[float], status: str, message: str) -> Dict[str, Any]:
    return {"rule": rule, "label": label, "value": value,
            "abs": abs_bound, "rec": rec_bound, "status": status, "message": message}


def check_case(case: Dict[str, Any], stack: Dict[str, Any]) -> Dict[str, Any]:
    """Manufacturability verdict for a design case against its process route.

    `case` / `stack` are plain dicts (GeometryCase / StackBasis shaped). Pure
    geometry -> {route, grade, source, verdict, checks[]}; verdict is FAIL if
    any hard rule is below absolute, MARGINAL if below recommended, else PASS.
    """
    route = normalize_route(case.get("process_route"))
    rb = ROUTES[route]
    family = str(case.get("family", "wavy_fin")).lower().strip()
    checks: List[Dict[str, Any]] = []

    core_h = stack.get("core_height_mm", 5.5)
    H = case.get("fin_height_mm") or core_h

    if family in ("straight_fin", "wavy_fin"):
        t = case.get("fin_thickness_mm")
        b = case.get("channel_gap_mm")
        if t is not None:
            checks.append(_check(
                "wall_min", "fin thickness t", t, rb["wall_abs"], rb["wall_rec"],
                _status(t, rb["wall_abs"], rb["wall_rec"]),
                f"t = {t:.3f} mm vs floor {rb['wall_abs']:.3f} / rec {rb['wall_rec']:.3f} mm"))
        if b is not None:
            checks.append(_check(
                "gap_min", "channel gap b", b, rb["gap_abs"], rb["gap_rec"],
                _status(b, rb["gap_abs"], rb["gap_rec"]),
                f"b = {b:.3f} mm vs floor {rb['gap_abs']:.3f} / rec {rb['gap_rec']:.3f} mm"))
        if b:
            ar = H / b
            checks.append(_check(
                "aspect", "fin aspect ratio H/b", ar, None, rb["aspect_max"],
                PASS if ar <= rb["aspect_max"] else MARGINAL,
                f"H/b = {ar:.0f} vs max ~{rb['aspect_max']:.0f} "
                "(deformation risk grows with slenderness)"))
        if route == "LMM" and t and b:
            # pixel alignment is advisory: does the green pitch land on the grid?
            pitch_green = (t + b) * LMM_SHRINK_XY
            off = abs(pitch_green / LMM_PIXEL_MM - round(pitch_green / LMM_PIXEL_MM))
            # advisory (not verdict-grading): the green→CAD converter does the snap
            checks.append(_check(
                "pixel_snap", "green pitch on 35 µm grid", pitch_green, None, None, INFO,
                f"green pitch {pitch_green:.4f} mm = {pitch_green / LMM_PIXEL_MM:.2f} px "
                + ("(on grid)" if off < 0.02 else "(off grid — snap before CAD export)")))
            # constant-width rule: in-phase parallel fins keep b constant by
            # construction; flag it as the checklist item it is.
            checks.append(_check(
                "pinch", "constant channel width along wavy path", None, None, None, INFO,
                "adjacent fins are drawn in phase (constant gap); verify no remesh "
                "pinch below the floor before STL submission"))
    elif family == "pin_fin":
        d = case.get("pin_diameter_mm")
        S = case.get("pin_pitch_mm")
        if d is not None:
            checks.append(_check(
                "wall_min", "pin diameter", d, rb["wall_abs"], rb["wall_rec"],
                _status(d, rb["wall_abs"], rb["wall_rec"]),
                f"d = {d:.3f} mm vs floor {rb['wall_abs']:.3f} / rec {rb['wall_rec']:.3f} mm"))
        if d is not None and S is not None:
            gap = S - d
            checks.append(_check(
                "gap_min", "pin-to-pin gap S−d", gap, rb["gap_abs"], rb["gap_rec"],
                _status(gap, rb["gap_abs"], rb["gap_rec"]),
                f"S−d = {gap:.3f} mm vs floor {rb['gap_abs']:.3f} / rec {rb['gap_rec']:.3f} mm"))
        if d:
            ar = H / d
            checks.append(_check(
                "aspect", "pin aspect ratio H/d", ar, None, rb["aspect_max"],
                PASS if ar <= rb["aspect_max"] else MARGINAL,
                f"H/d = {ar:.0f} vs max ~{rb['aspect_max']:.0f}"))
    else:
        # TPMS / generic surface: wall = sheet thickness; channel via D_h when known.
        w = case.get("wall_thickness_mm")
        if w is not None:
            checks.append(_check(
                "wall_min", "sheet wall w", w, rb["wall_abs"], rb["wall_rec"],
                _status(w, rb["wall_abs"], rb["wall_rec"]),
                f"w = {w:.3f} mm vs floor {rb['wall_abs']:.3f} / rec {rb['wall_rec']:.3f} mm"))
        dh = case.get("hydraulic_diameter_mm")
        if dh:
            checks.append(_check(
                "gap_min", "channel size (D_h proxy)", dh, rb["gap_abs"], rb["gap_rec"],
                _status(dh, rb["gap_abs"], rb["gap_rec"]),
                f"D_h = {dh:.3f} mm as the channel-size proxy vs floor "
                f"{rb['gap_abs']:.3f} / rec {rb['gap_rec']:.3f} mm"))

    # Part-size cleanability warning (Incus "big part, small channel").
    if route == "LMM":
        core_area = stack.get("core_width_mm", 35.0) * stack.get("core_length_mm", 28.0)
        gap_like = case.get("channel_gap_mm") or case.get("hydraulic_diameter_mm")
        # warning tier (not verdict-grading): flags the open cleanability question
        if gap_like and core_area > 4.0 * LMM_COUPON_AREA_MM2 and gap_like < 0.25:
            checks.append(_check(
                "big_part", "cleanability at part size", core_area, None, None, INFO,
                f"core {core_area:.0f} mm² is ~{core_area / LMM_COUPON_AREA_MM2:.0f}× the "
                f"proven 7.7×7.7 mm coupon with channels < 0.25 mm — cleanability at "
                "this size is unproven (Incus Option-2 coupon matrix required)"))
        checks.append(_check(
            "drainage", "drainage + gravity drain path", None, None, None, INFO,
            "add drainage holes at pocket low points + channel ends; orient for "
            "gravity drainage (checklist, not a geometric check)"))

    graded = [c["status"] for c in checks if c["status"] in (PASS, MARGINAL, FAIL)]
    verdict = FAIL if FAIL in graded else (MARGINAL if MARGINAL in graded else PASS)
    return {
        "route": route,
        "label": rb["label"],
        "grade": rb["grade"],
        "source": rb["source"],
        "verdict": verdict,
        "checks": checks,
    }


def schema() -> Dict[str, Any]:
    """Rulebooks + LMM process constants for /api/schema (UI never hard-codes)."""
    return {
        "routes": [{"key": k, **v} for k, v in ROUTES.items()],
        "lmm_process": {
            "pixel_mm": LMM_PIXEL_MM,
            "layer_mm": LMM_LAYER_MM,
            "shrink_xy": LMM_SHRINK_XY,
            "shrink_z": LMM_SHRINK_Z,
            "overpoly_px_per_side": LMM_OVERPOLY_PX,
            "coupon_area_mm2": LMM_COUPON_AREA_MM2,
        },
        "enforcement_modes": [
            {"key": "enforce", "label": "Design-to-manufacture",
             "hint": "sliders + optimizer clamped at the recommended bounds"},
            {"key": "marginal", "label": "Allow marginal (project default)",
             "hint": "clamped at the absolute bounds; amber zone reachable, shown MARGINAL"},
            {"key": "explore", "label": "Explore / audit",
             "hint": "no clamps — verdicts annotate only (reproduce old studies)"},
        ],
    }
