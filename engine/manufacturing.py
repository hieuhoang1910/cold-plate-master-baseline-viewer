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

2026-07-30 revision — LMM bounds re-anchored to the OFFICIAL guidelines doc
(Incus_Design_Guidelines.pdf, July 2026: all dims GREEN px) + Paul Peritsch's
2026-07-29 px review of our rev5/ICE parts: fins 3 px abs / 4-5 px rec;
channels deeper than 1 mm 6 px abs / 8 px rec (<= 1 mm: 5 px); NEW gap_ratio
rule (gaps wider than fins); tall-fin advisory (tested at ~1 mm height only).

2026-08-05 revision — anchored to Incus's OWN Chitubox machine configs
(Chitubox_Evo35_config.cfgx / Chitubox_Pro25_confic.cfgx + "Installation
manual.txt", Peritsch 2026-08-05, archived in 01_Inputs_and_References):
  * pixel size is now DERIVED from the config, not assumed — Evo35 is
    56.0 mm / 1600 px = 35.000 um exactly (Pro25: 200.0/8000 = 25 um).
    Layer 25 um confirmed on every Evo35 profile. Both were already right.
  * NEW machine envelope rule — the GREEN part must fit the 56 x 89.6 x 150
    platform. The app had no such check.
  * NEW slice_px readout — the three numbers Incus actually counts on the
    raster (fin / gap / PITCH in green px). Added because the Proto 2 mesh
    shipped as "6 px fin 16 px gap" when 16 px is its PITCH and the gap is
    10 px, which cost a supplier review cycle (Peritsch 2026-08-05: "could
    you please clarify which mesh you intended to send?").
  * gap_perp CORRECTED to the shear construction (see below) and joined by a
    new wall_perp — the wave thins the FIN perpendicular too.
  * NEW shrink_basis advisory — Incus's own profiles carry SC x121/y122/z125
    (anisotropic!) against this app's x1.197 / x1.23. Open question for Paul.

The wave-slope model (corrected 2026-08-05 against a measured mesh)
-------------------------------------------------------------------
Both nTop and this app's own rasterizer build a wavy fin field by SHEARING a
straight array: x -> x - A*sin(2*pi*y/lambda). Under a shear the horizontal
widths are invariant and the PERPENDICULAR ones scale by cos(theta):
      gap_perp = b*cos(theta),  fin_perp = t*cos(theta),  tan(theta) = 2*pi*A/lambda
The 2026-07-31 rule used (t+b)*cos(theta) - t, which is the perpendicular gap
of an OFFSET construction (a constant-thickness band swept along the curve) —
not what we build. Verified by ray-probing the mesh actually sent to Incus
("wavy 28x28mm scaled 6pix fin 16pix gap 0.34mm amp.stl"): horizontal fin/gap
are constant to 0.4 % / 0.2 % across all 55 fins (a shear signature), and the
measured minimum perpendicular passage is 8.11 px against 8.14 px predicted
by b*cos(theta) — the old form predicted 7.03 px.
CAVEAT: this closed form assumes a UNIFORM, IN-PHASE wave. Legacy meshes
(rev5/rev6, Prototype 1) grade the amplitude across the field, so adjacent
fins converge and the passage pinches far below b*cos(theta) — rev6 measures
1.4 px horizontal gaps where the nominal is 13.9 px. For those the Verify
tab's raster/EDT neck scan is authoritative, not this rule.
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
LMM_OVERPOLY_PX = 1           # per side (~25-35 um); CAD edit = -+2 px on a width
# Incus proven-cleanable coupon: 7.7 x 7.7 mm gyroid, ~200 um (6 px) channels.
LMM_COUPON_AREA_MM2 = 7.7 * 7.7

# Official Incus design guidelines (Incus_Design_Guidelines.pdf, July 2026).
# ALL guideline dimensions are GREEN-state px (1 px = 35 um) — this closes the
# old green-vs-final open question (the rulebook previously stored the
# conservative final-basis reading). Bounds below convert green px -> FINAL mm.
LMM_FIN_ABS_PX = 3            # fins printed successfully at 3 px (105 um green)
LMM_FIN_REC_PX = 4            # recommended 4-5 px for process reliability
LMM_GAP_ABS_PX_DEEP = 6       # open channels > 1 mm deep: min 6-8 px band
LMM_GAP_REC_PX_DEEP = 8
LMM_GAP_ABS_PX_SHALLOW = 5    # <= 1 mm deep: cleaned down to 5 px (reliability drops)
LMM_GAP_REC_PX_SHALLOW = 6
LMM_DEEP_CHANNEL_MM_GREEN = 1.0   # depth threshold separating the two bands
LMM_FIN_TESTED_H_MM_GREEN = 1.0   # fin rules tested at ~1 mm height only

# ---------------------------------------------------------------------------
# Incus machines, read out of the Chitubox configs Paul shipped 2026-08-05.
# pixel_mm is DERIVED (platform / resolution), so it can never drift from the
# supplier's own file: Evo35 56.0/1600 = 0.035 exactly, Pro25 200.0/8000 = 0.025.
# ---------------------------------------------------------------------------
LMM_MACHINES: Dict[str, Dict[str, Any]] = {
    "EVO35": {
        "label": "Incus Hammer Evo35",
        "resolution_px": [1600, 2560],
        "platform_mm": [56.0, 89.6, 150.02],
        "pixel_mm": 56.0 / 1600,      # = 0.035
        "layer_mm": 0.025,
        "preferred": True,            # Peritsch 2026-08-05: "for these parts
                                      # please always use the HammerEvo35"
    },
    "PRO25": {
        "label": "Incus Hammer Pro25",
        "resolution_px": [8000, 8128],
        "platform_mm": [200.0, 203.2, 140.0],
        "pixel_mm": 200.0 / 8000,     # = 0.025
        "layer_mm": 0.025,
        "preferred": False,
    },
}
LMM_MACHINE = "EVO35"                 # the route's machine (all bounds are its px)

# Incus's own Chitubox shrinkage-compensation profiles ("SCx121y122z125") vs
# the x1.197 / x1.23 basis this rulebook has used since the 2026-07 review.
# Theirs is ANISOTROPIC in XY. Which one governs OUR Cu-OF feedstock is an
# open question (asked 2026-08-05) — the rulebook keeps 1.197/1.23 (that is
# what the shipped Proto 2 mesh was scaled by) and flags the delta instead of
# silently re-scaling every number in the app.
LMM_SC_PROFILE = {"x": 1.21, "y": 1.22, "z": 1.25, "name": "SCx121y122z125"}


def _px_final(px: float) -> float:
    """Green px -> final (sintered) mm through the XY shrink. Unrounded so a
    px-exact design (e.g. a 4 px fin = 0.116959... mm) sits ON its bound, not
    a rounding hair below it."""
    return px * LMM_PIXEL_MM / LMM_SHRINK_XY


def _green_px(final_mm: float) -> float:
    """FINAL mm -> green px (35 um) — the unit Incus counts on the slice."""
    return final_mm * LMM_SHRINK_XY / LMM_PIXEL_MM


PASS, MARGINAL, FAIL, INFO = "PASS", "MARGINAL", "FAIL", "INFO"

# ---------------------------------------------------------------------------
# Rulebooks (data, not code). Bounds in mm on FINAL dimensions unless noted.
# `basis` strings surface in the UI so no number is a magic value.
# ---------------------------------------------------------------------------
ROUTES: Dict[str, Dict[str, Any]] = {
    "LMM": {
        "label": "LMM — Incus EVO35 (printed Cu)",
        "grade": "supplier-verified",
        "source": "Incus_Design_Guidelines.pdf (July 2026); Paul Peritsch emails "
                  "2026-07-07 (STL review) + 2026-07-29 (rev5/ICE px feedback)",
        "wall_abs": _px_final(LMM_FIN_ABS_PX),        # 3 px green = 0.0877 final
        "wall_rec": _px_final(LMM_FIN_REC_PX),        # 4 px green = 0.1170 final (rec band 4-5 px)
        "gap_abs": _px_final(LMM_GAP_ABS_PX_DEEP),    # 6 px green = 0.1754 final (channels > 1 mm deep)
        "gap_rec": _px_final(LMM_GAP_REC_PX_DEEP),    # 8 px green = 0.2339 final
        "aspect_max": 30.0,  # H/b — "taller fins need thicker fins"
        "notes": "Guideline dims are GREEN px (1 px = 35 um; basis question closed "
                 "by the July 2026 doc) — converted to final via /1.197. Deep "
                 "channels (> 1 mm) need 6-8 px; <= 1 mm cleaned down to 5 px. "
                 "Gaps must be wider than fins (2026-07-29). Green chain: "
                 "x1.197/x1.23 shrink, 35/25 um grid, overpoly ~1 px per side, "
                 "-+2 px pre-compensation in CAD.",
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

    # LMM channel bounds are depth-dependent (guidelines §4): > 1 mm (green)
    # deep needs the 6-8 px band; <= 1 mm has been cleaned down to 5 px.
    gap_abs, gap_rec = rb["gap_abs"], rb["gap_rec"]
    gap_basis = f"floor {gap_abs:.3f} / rec {gap_rec:.3f} mm"
    if route == "LMM":
        deep = (H * LMM_SHRINK_Z) > LMM_DEEP_CHANNEL_MM_GREEN
        if not deep:
            gap_abs = _px_final(LMM_GAP_ABS_PX_SHALLOW)
            gap_rec = _px_final(LMM_GAP_REC_PX_SHALLOW)
        band = (f"{LMM_GAP_ABS_PX_DEEP}-{LMM_GAP_REC_PX_DEEP} px deep-channel band"
                if deep else f"{LMM_GAP_ABS_PX_SHALLOW} px shallow (<= 1 mm) floor")
        gap_basis = f"floor {gap_abs:.3f} / rec {gap_rec:.3f} mm ({band}, green)"

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
                "gap_min", "channel gap b", b, gap_abs, gap_rec,
                _status(b, gap_abs, gap_rec),
                f"b = {b:.3f} mm vs {gap_basis}"))
        if route == "LMM" and t and b:
            # Incus 2026-07-29 (rev5/ICE review): "Gaps should be wider than
            # fins" — cleaning needs the open channel to dominate the pitch.
            checks.append(_check(
                "gap_ratio", "gap wider than fin (b ≥ t)", b / t, None, 1.0,
                PASS if b >= t - 1e-9 else MARGINAL,
                f"b/t = {b / t:.2f} — Incus: gaps should be wider than fins "
                "(email 2026-07-29); overpoly shrinks the printed channel further"))
        A = case.get("wave_amplitude_mm") or 0.0
        lam = case.get("wavelength_mm") or 0.0
        if route == "LMM" and t and b and family == "wavy_fin" and A > 0 and lam > 0:
            # 2026-07-31, CORRECTED 2026-08-05 — the wave-slope pinch. The fin
            # field is a SHEAR of a straight array (x -> x − A·sin(2πy/λ)), so
            # horizontal widths are invariant and the perpendicular ones scale
            # by cosθ with tanθ = 2πA/λ: gap_perp = b·cosθ, fin_perp = t·cosθ.
            # (The 2026-07-31 form (t+b)·cosθ − t belongs to an OFFSET sweep,
            # which is not what nTop or our own rasterizer builds.) Validated
            # on the mesh sent to Incus: measured 8.11 px vs 8.14 px predicted.
            # Hard rule vs the abs floor only — the rec tier stays on the
            # nominal gap_min so a wave never re-grades an already-graded gap.
            theta = math.atan(2.0 * math.pi * A / lam)
            cos_t = math.cos(theta)
            perp = b * cos_t
            fin_perp = t * cos_t
            # largest A that still holds BOTH floors at this λ:
            # b·cosθ ≥ gap_abs and t·cosθ ≥ wall_abs
            c_need = max(gap_abs / b, rb["wall_abs"] / t)
            A_budget = (lam * math.tan(math.acos(c_need)) / (2.0 * math.pi)
                        if c_need < 1.0 else 0.0)
            checks.append(_check(
                "gap_perp", "min perpendicular passage (wave slope)", perp,
                gap_abs, None,
                PASS if perp >= gap_abs - 1e-9 else FAIL,
                f"b·cos{math.degrees(theta):.0f}° = {perp:.3f} mm "
                f"({_green_px(perp):.1f} px green) vs floor {gap_abs:.3f} "
                f"({_green_px(gap_abs):.0f} px) / rec {gap_rec:.3f} "
                f"({_green_px(gap_rec):.0f} px) — the wave's steep sections "
                f"narrow the passage; max A ≈ {A_budget:.3f} mm at λ {lam:.2f}. "
                "Uniform in-phase wave assumed — a graded wave pinches further "
                "(use the ⌖ neck scan on imported meshes)"))
            checks.append(_check(
                "wall_perp", "fin thickness across the wave", fin_perp,
                rb["wall_abs"], rb["wall_rec"],
                _status(fin_perp, rb["wall_abs"], rb["wall_rec"]),
                f"t·cos{math.degrees(theta):.0f}° = {fin_perp:.3f} mm "
                f"({_green_px(fin_perp):.1f} px green) vs floor "
                f"{rb['wall_abs']:.3f} / rec {rb['wall_rec']:.3f} — the slope "
                "thins the fin as well as the channel (the slice still shows "
                f"the full {_green_px(t):.1f} px horizontally)"))
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
            # 2026-08-05 — the three numbers Incus counts in GIMP on the sliced
            # PNG. Quote all three by name: the Proto 2 mesh went out labelled
            # "6 px fin 16 px gap" when 16 px is the PITCH and the gap is 10 px,
            # and Paul had to ask which mesh we meant.
            checks.append(_check(
                "slice_px", "what Incus counts on the slice (green px)",
                _green_px(b), None, None, INFO,
                f"fin {_green_px(t):.1f} px · gap {_green_px(b):.1f} px · "
                f"pitch {_green_px(t + b):.1f} px — horizontal runs on the "
                "raster, the wave does not change them. Name all three when "
                "sending a mesh: pitch is NOT the gap"))
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
                "gap_min", "pin-to-pin gap S−d", gap, gap_abs, gap_rec,
                _status(gap, gap_abs, gap_rec),
                f"S−d = {gap:.3f} mm vs {gap_basis}"))
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
                "gap_min", "channel size (D_h proxy)", dh, gap_abs, gap_rec,
                _status(dh, gap_abs, gap_rec),
                f"D_h = {dh:.3f} mm as the channel-size proxy vs {gap_basis}"))

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
        H_green = H * LMM_SHRINK_Z
        if H_green > LMM_FIN_TESTED_H_MM_GREEN + 1e-9:
            checks.append(_check(
                "fin_height", "fin height vs tested envelope", H_green, None, None, INFO,
                f"green fin height {H_green:.2f} mm is beyond the ~1 mm Incus has "
                "tested — taller fins may deform during cleaning/processing "
                "(guidelines §4)"))
        # 2026-08-05 — the part is submitted GREEN (we pre-scale in CAD), so it
        # is the green envelope that has to fit the platform Paul slices on.
        mach = LMM_MACHINES[LMM_MACHINE]
        px, py, pz = mach["platform_mm"]
        gw = stack.get("core_width_mm", 35.0) * LMM_SHRINK_XY
        gl = stack.get("core_length_mm", 28.0) * LMM_SHRINK_XY
        gh = (stack.get("base_thickness_mm", 0.7) + H) * LMM_SHRINK_Z
        # allow either in-plane orientation on the platform
        fits = (max(gw, gl) <= max(px, py) and min(gw, gl) <= min(px, py) and gh <= pz)
        checks.append(_check(
            "build_envelope", f"green part fits the {mach['label']} platform",
            max(gw / max(px, py), gl / min(px, py)), None, 1.0,
            PASS if fits else FAIL,
            f"green {gw:.1f} × {gl:.1f} × {gh:.2f} mm vs platform "
            f"{px:.0f} × {py:.1f} × {pz:.0f} mm "
            f"({mach['resolution_px'][0]}×{mach['resolution_px'][1]} px @ "
            f"{mach['pixel_mm'] * 1000:.0f} µm) — the submitted mesh is "
            "green-scaled, so the platform sees the ×1.197 footprint"))
        # Incus's own Chitubox profiles disagree with our shrink basis.
        sc = LMM_SC_PROFILE
        dx = stack.get("core_width_mm", 35.0) * (LMM_SHRINK_XY / sc["x"] - 1.0)
        dy = stack.get("core_length_mm", 28.0) * (LMM_SHRINK_XY / sc["y"] - 1.0)
        checks.append(_check(
            "shrink_basis", "shrink basis vs Incus's slicer profile", None, None, None, INFO,
            f"this app scales green = final × {LMM_SHRINK_XY} XY / {LMM_SHRINK_Z} Z; "
            f"Incus's Chitubox profile '{sc['name']}' carries x{sc['x']} y{sc['y']} "
            f"z{sc['z']} (anisotropic). If theirs governs, the sintered part lands "
            f"{dx:+.2f} mm in X and {dy:+.2f} mm in Y — open question for Paul "
            "(2026-08-05). Slice our meshes with shrink compensation OFF: they "
            "are already green-scaled, and a profile with SC on would apply it twice"))
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
            # Incus_Design_Guidelines.pdf (July 2026) px rules — GREEN px basis
            "fin_abs_px": LMM_FIN_ABS_PX,
            "fin_rec_px": LMM_FIN_REC_PX,
            "gap_abs_px_deep": LMM_GAP_ABS_PX_DEEP,
            "gap_rec_px_deep": LMM_GAP_REC_PX_DEEP,
            "gap_abs_px_shallow": LMM_GAP_ABS_PX_SHALLOW,
            "gap_rec_px_shallow": LMM_GAP_REC_PX_SHALLOW,
            "deep_channel_mm_green": LMM_DEEP_CHANNEL_MM_GREEN,
            "gap_wider_than_fin": True,
            # 2026-08-05 — straight out of Incus's Chitubox configs
            "machine": LMM_MACHINE,
            "machines": LMM_MACHINES,
            "sc_profile": LMM_SC_PROFILE,
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
