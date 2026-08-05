"""
07_WebApp/server.py
===================
Phase 1 backend for the Cold Plate Master Baseline Viewer.

A zero-dependency (Python standard library only) HTTP API that wraps the two
*validated* solvers so the browser never runs a second physics model:

    * master engine  -> 06_MASTER_BASELINE/python/master_baseline_calculator.py
                        (family-neutral breadth: wavy/straight/pin/gyroid)
    * v6 engine      -> 02_Code/cold_plate_v6/solver.py
                        (validated depth on the wavy hero)

Endpoints
---------
    GET  /api/health    -> liveness probe
    GET  /api/catalog   -> master parameter registry + the 5 scored candidates
    POST /api/evaluate  -> master evaluate_case() for arbitrary parameters
    POST /api/solve     -> v6 solve() for the wavy hero drill-down
    POST /api/sweep     -> 2-variable grid sweep (heatmap + Pareto data)

Run from the project root (or anywhere):

    python 07_WebApp/server.py

then the API is on http://127.0.0.1:8000 and, because it binds 0.0.0.0, also
on http://<this-machine's-LAN-IP>:8000 for other devices on the same LAN/WiFi
(both URLs are printed at startup). CORS is open so a Vite dev server on
another port can call it during development. In production the same server can
also serve the built frontend from ./frontend/dist (see do_GET).

Design note: the request/response contract mirrors MASTER_BASELINE_VIEWER_SPEC.md
section 12. Business logic lives in pure functions (catalog_payload,
evaluate_payload, solve_payload, sweep_payload) so test_api_parity.py can call
the exact code path the HTTP handler uses.
"""

from __future__ import annotations

import json
import mimetypes
import socket
import sys
from dataclasses import asdict, fields, replace
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------------------------------------------------------------------------
# Path wiring: the validated solvers are vendored under engine/ so this repo is
# self-contained (see engine/README + sync_engine.py). Put engine/ on sys.path.
# Frozen into a standalone exe (PyInstaller), the read-only assets (engine/,
# frontend/dist) are unpacked under sys._MEIPASS, while anything the server
# WRITES (saved projects) must live next to the exe so it survives restarts.
# ---------------------------------------------------------------------------
FROZEN = getattr(sys, "frozen", False)
if FROZEN:
    ROOT = Path(sys._MEIPASS)                        # bundled read-only assets
    APP_DIR = Path(sys.executable).resolve().parent  # writable, beside the exe
else:
    ROOT = Path(__file__).resolve().parent           # 07_WebApp
    APP_DIR = ROOT
ENGINE = ROOT / "engine"
DATA = ENGINE / "data"
DIST = ROOT / "frontend" / "dist"                   # built frontend (production single-origin)

if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

import master_baseline_calculator as mbc             # noqa: E402  (path set above)
import coolants                                       # noqa: E402  (V2 fluid library)
import targets                                        # noqa: E402  (V2 targets->gate)
import projects                                       # noqa: E402  (V2.2 project store)
import manufacturing                                  # noqa: E402  (V3.3 DfAM rulebooks)
import flow_network                                   # noqa: E402  (V5.1 S6 network)

from cold_plate_v6.architecture import FlowArchitecture as V6Arch   # noqa: E402
from cold_plate_v6.geometry import Geometry                          # noqa: E402
from cold_plate_v6.operating import Operating                        # noqa: E402
from cold_plate_v6.solver import solve                               # noqa: E402
from cold_plate_v6.system_resistance import junction_to_coolant      # noqa: E402

# Vendored data snapshot (synced from the master baseline; parity test guards it).
PARAMS_JSON = DATA / "master_design_parameters.json"
RESULTS_JSON = DATA / "master_baseline_results.json"
CASES_JSON = DATA / "baseline_cases.json"

# v6 die-coverage footprint — the design the app actually targets.
# Physical envelope is 28 mm wide x 35 mm long. In the solver axes the fins run
# parallel to the 28 mm side (short water path), so core_width = 35 mm is the
# transverse axis that sets fin count and core_length = 28 mm is the flow path.
# Source: 02_Code/cold_plate_v6/master_constants.py section 13 + sensitivity.py.
# (The master-baseline record stays at 28x31 for traceability + the parity test;
# the app applies die-coverage on top.)
DIE_COVERAGE_STACK = {
    "die_width_mm": 24.0,
    "die_length_mm": 31.0,
    "core_width_mm": 35.0,   # transverse (fin count) = physical 35 mm length
    "core_length_mm": 28.0,  # flow path = physical 28 mm width
    "core_height_mm": 5.5,
    "base_thickness_mm": 0.7,
    "k_solid_W_mK": 340.0,
    "tim_areal_Kcm2_W": 0.05,
}
DIE_COVERAGE_ARCH = {
    "name": "center_feed_bidirectional",
    "n_parallel_paths": 2,
    "path_length_mm": 14.0,   # core_length / 2 = 28 / 2
    "header_K_total": 1.5,
    "flow_uniformity": 1.0,
}
PHYSICAL_FOOTPRINT = {"width_mm": 28.0, "length_mm": 35.0}

# ---------------------------------------------------------------------------
# V2.2 projects: the built-in GB202 preset is defined FROM the die-coverage
# constants above (single source, no drift), and its R_jc gate is pinned to the
# historical validated 0.078 K/W so `POST /api/catalog {project: gb202}`
# reproduces the V1 `GET /api/catalog` view exactly. User projects persist under
# 07_WebApp/projects/ (server-local, LAN-shared).
# ---------------------------------------------------------------------------
GB202_PROJECT = {
    "id": "gb202-gpu",
    "name": "GB202 GPU cold plate",
    "schema_version": projects.SCHEMA_VERSION,
    "builtin": True,
    "description": "The validated V1 baseline: RTX 5090-class GB202 die, water, "
                   "die-coverage core. Reproduces the master baseline view.",
    "problem": {**DIE_COVERAGE_STACK, "coolant": "water"},
    "operating": {"heat_load_W": 450.0, "margin_heat_load_W": 575.0,
                  "flow_lpm": 2.65, "T_inlet_C": 25.0},
    "targets": {"T_j_max_C": 100.0, "R_jc_gate_override": 0.078,
                "limit_deltaP_Pa": 50000.0, "limit_pump_W": 5.0},
    "architecture": dict(DIE_COVERAGE_ARCH),
    "families": ["wavy_fin", "straight_fin", "gyroid_tpms", "pin_fin"],
    "physical_footprint": PHYSICAL_FOOTPRINT,
}

PROJECTS_DIR = APP_DIR / "projects"
STORE = projects.ProjectStore(PROJECTS_DIR, builtins=[GB202_PROJECT])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Bind to all interfaces so colleagues on the same LAN/WiFi can open the app
# via this machine's LAN IP (printed at startup). Use "127.0.0.1" to restrict
# access to this machine only.
HOST = "0.0.0.0"
PORT = 8000


def _lan_ip() -> str:
    """Best-effort LAN IP of this machine (no packets are actually sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"

# Allowed dataclass field names, so stray JSON keys are ignored, not fatal.
_CASE_FIELDS = {f.name for f in fields(mbc.GeometryCase)}
_STACK_FIELDS = {f.name for f in fields(mbc.StackBasis)}
_OP_FIELDS = {f.name for f in fields(mbc.OperatingPoint)}
_ARCH_FIELDS = {f.name for f in fields(mbc.FlowArchitecture)}

_V6_GEOM_FIELDS = {f.name for f in fields(Geometry)}
_V6_OP_FIELDS = {f.name for f in fields(Operating)}
_V6_ARCH_FIELDS = {f.name for f in fields(V6Arch)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _filtered(d, allowed):
    """Keep only keys the target dataclass accepts."""
    return {k: v for k, v in (d or {}).items() if k in allowed}


def _sanitize(obj):
    """Replace non-finite floats (inf/nan) with None so json.dumps stays valid."""
    if isinstance(obj, float):
        if obj != obj or obj in (float("inf"), float("-inf")):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


def _linspace(lo: float, hi: float, n: int):
    if n <= 1:
        return [lo]
    step = (hi - lo) / (n - 1)
    return [lo + step * i for i in range(n)]


# ---------------------------------------------------------------------------
# V3.2 — area readouts. Fin-only (structure) surface area per user decision
# 2026-07-09: fin faces / pin laterals / TPMS sheet — no channel-floor base.
# ---------------------------------------------------------------------------
def _areas(result: dict, stack_d: dict | None) -> dict:
    s = mbc.StackBasis(**_filtered(stack_d, _STACK_FIELDS))
    die_mm2 = s.die_area_m2 * 1e6
    cooled_mm2 = s.cooled_area_m2 * 1e6
    fin_m2 = result.get("fin_area_m2") or result.get("wetted_area_m2") or 0.0
    wet_m2 = result.get("wetted_area_m2") or 0.0
    flow_m2 = result.get("flow_area_m2") or 0.0
    # Effective derate: fins work at eta_f; uniformity x access is recovered from
    # the SA/V pair (eff/raw = eta_o x uniformity x access). Surface families
    # (eta_f undefined) use the eff/raw ratio directly.
    eta_f = result.get("eta_f")
    eta_o = result.get("eta_o")
    raw_sav = result.get("raw_SA_V_m2_m3") or 0.0
    eff_sav = result.get("effective_SA_V_m2_m3") or 0.0
    ratio = (eff_sav / raw_sav) if raw_sav > 0 else 1.0
    if eta_f is not None and eta_o:
        derate = eta_f * (ratio / eta_o)
    else:
        derate = ratio
    fin_mm2 = fin_m2 * 1e6
    fin_eff_mm2 = fin_mm2 * derate
    return {
        "die_mm2": die_mm2,
        "cooled_mm2": cooled_mm2,
        "fin_mm2": fin_mm2,
        "fin_eff_mm2": fin_eff_mm2,
        "flow_mm2": flow_m2 * 1e6,
        "wetted_mm2": wet_m2 * 1e6,
        "amplification": (fin_mm2 / die_mm2) if die_mm2 > 0 else None,
        "amplification_eff": (fin_eff_mm2 / die_mm2) if die_mm2 > 0 else None,
    }


def _augment(out: dict, case_d: dict, stack_d: dict | None) -> dict:
    """V3 additive blocks on every evaluated result: areas + manufacturability."""
    out["areas"] = _sanitize(_areas(out, stack_d))
    stack_for_mfg = {**asdict(mbc.StackBasis()), **(stack_d or {})}
    out["manufacturability"] = _sanitize(manufacturing.check_case(case_d, stack_for_mfg))
    return out


# ---------------------------------------------------------------------------
# V3.3 — the LMM presets (review §4–§6). M1 was the primary manufacturing
# target (team decision 2026-07-09) but the official guidelines
# (Incus_Design_Guidelines.pdf July 2026 + Peritsch email 2026-07-29) put
# deep channels at 6-8 px green, so M1's ~5 px gap now honestly FAILs; M2/M3
# are the buildable presets. Appended to every catalog, rescored per project.
# ---------------------------------------------------------------------------
M_PRESET_CASES = [
    {"design_id": "v6_lmm_M1_primary", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 0.12, "channel_gap_mm": 0.15, "fin_height_mm": 5.5,
     "side_margin_mm": 0.9, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5,
     "notes": "M1 — was the primary target; gap ≈ 5 px green is below the 6 px "
              "deep-channel floor (guidelines 07/2026): Incus says it won't clean."},
    {"design_id": "v6_lmm_M2_backup", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 0.15, "channel_gap_mm": 0.20, "fin_height_mm": 5.5,
     "side_margin_mm": 0.9, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5,
     "notes": "M2 — backup: green 7 px inside the Incus 6–8 px band "
              "(marginal vs the 8 px recommendation)."},
    {"design_id": "v6_lmm_M3_easyclean", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 0.15, "channel_gap_mm": 0.25, "fin_height_mm": 5.0,
     "side_margin_mm": 0.9, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5,
     "notes": "M3 — easy-clean: matches the proven 0.25 mm build."},
    # M4 (2026-07-30): the constrained optimum under the official guidelines —
    # px-exact 6 px fin / 8 px gap green (t 0.175 / b 0.234 final). Best R_jc
    # among fully-PASS designs: 6 px fins beat 4 px on fin efficiency at
    # H 5.5, gap sits on the 8 px deep-channel recommendation, gap > fin.
    {"design_id": "v6_lmm_M4_guideline", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 6 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "channel_gap_mm": 8 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "fin_height_mm": 5.5,
     "side_margin_mm": 0.9, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5,
     "notes": "M4 — was the guideline optimum on nominal widths; the hero wave "
              "(A 0.55/λ 2.5, 54° slope) pinches the perpendicular passage to "
              "≈2 px at the steep sections — fails gap_perp (2026-07-31)."},
    # 2026-07-31 — wave-slope revision: between in-phase wavy fins the true
    # passage at max slope is (t+b)·cosθ − t, which is what Incus's slicer
    # measures (their "only 2 px" findings on rev5). M4b/M2b carry the largest
    # px-snapped wave the 6 px floor allows at their dims (joint sweep).
    {"design_id": "v6_lmm_M4b_wavesafe", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 6 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "channel_gap_mm": 8 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "fin_height_mm": 5.5, "side_margin_mm": 0.9,
     "wave_amplitude_mm": 8 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "wavelength_mm": 2.5,
     "notes": "M4b — wave-safe target (2026-07-31): M4 dims with the wave tamed "
              "to 30° (A 8 px) so the perpendicular passage holds the 6 px "
              "floor at max slope. PASS-tier joint optimum."},
    {"design_id": "v6_lmm_M2b_wavesafe", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 5 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "channel_gap_mm": 7 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "fin_height_mm": 5.5, "side_margin_mm": 0.9,
     "wave_amplitude_mm": 5 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "wavelength_mm": 2.5,
     "notes": "M2b — aggressive wave-safe corner (2026-07-31): px-exact 5/7 px "
              "with A 5 px (20°); best R_jc in the allow-marginal tier (gap "
              "7 px is inside the 6–8 band, under the 8 px rec)."},
    # 2026-07-31 — Prototype 1 lineage anchor, CORRECTED same day: the mesh
    # files are GREEN-scaled (x1.197 — SW01.02's pitch 0.600 green = 0.501
    # final, matching the documented 0.25/0.25 exactly, drawn with ~0.7 px/
    # side overpoly comp). The anchor part is SW01.02 "sinter welding" —
    # fins-only + separate base, bonded during sinter (the guidelines §6
    # route) — WHICH INCUS PRINTED SUCCESSFULLY. Final dims mesh-measured:
    # t 0.25 / b 0.25 / pitch 0.50, wave A 0.72 / λ 2.58 -> 60° slope,
    # H ≈ 5.0. On paper the strongest R_jc in the catalog — but its
    # perpendicular passage ≈ 0 px at max slope (raster of the actual green
    # file: median local width 2.7 px, p5 2.0 px), so it honestly FAILs
    # gap_perp. The open question this row poses: Incus printed these ~2 px
    # passages on the OPEN-TOP fins-only part — does the sinter-weld route
    # relax the enclosed-channel 6 px cleaning floor? (Ask Paul; the rev5
    # rejections were judged on the same bitmaps.)
    {"design_id": "proto1_reference", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 0.25, "channel_gap_mm": 0.25, "fin_height_mm": 5.0,
     "side_margin_mm": 0.9, "wave_amplitude_mm": 0.719, "wavelength_mm": 2.581,
     # FIXED reference: the part physically exists — score it on its own
     # as-sent envelope (mesh-measured, green ÷ shrink) + the rig's flow,
     # never on the active project's die/core. Fin field final ≈ 23.4 mm
     # transverse × 22.6 mm flow, H 5.0, sinter base 2.3 green -> 1.87 final;
     # die/TIM pinned to the GB202 basis it was introduced under so the row
     # reads identically in every project.
     "pinned_stack": {"die_width_mm": 24.0, "die_length_mm": 31.0,
                      "core_width_mm": 23.4, "core_length_mm": 22.6,
                      "core_height_mm": 5.0, "base_thickness_mm": 1.87,
                      "k_solid_W_mK": 340.0, "tim_areal_Kcm2_W": 0.05},
     "pinned_operating": {"flow_lpm": 2.65},
     "notes": "Prototype 1 (SW01.02 sinter-weld) — the 2026-05 tested baseline; "
              "fins printed separately by Incus + base bonded in sinter. PINNED "
              "to its as-sent envelope (23.4×22.6 core, its own base + rig flow) "
              "— project settings never rescale this row. Best paper R_jc, but "
              "perp passage ≈ 0 px at its 60° wave — FAILs the slope rule. Open "
              "Q for Paul: does open-top sinter-weld printing relax the 6 px "
              "floor? Its print success says maybe; rev5's rejection says the "
              "bar moved."},
    # 2026-08-05 — Prototype 2 AS SENT to Incus, ray-probed straight off
    # "wavy 28x28mm scaled 6pix fin 16pix gap 0.34mm amp.stl" (green file,
    # ÷1.197 XY / ÷1.23 Z here). Fins-only + central rib, prismatic in Z (no
    # base — the SW01.02 sinter-weld route), 55 fins over a 28×28 core.
    # Green px measured on the raster: fin 6.00, gap 10.00, pitch 16.00 —
    # EXACTLY what Paul's slicer reported ("the fins are now 6 px and the gaps
    # are 10 px", 2026-08-05). The file name's "16 px gap" is the PITCH; the
    # gap is 10 px. "0.34 mm amp" is the GREEN amplitude (0.3417) = 0.2855
    # final. λ 3.0115 green = 86 px = 2.5159 final.
    {"design_id": "proto2_as_sent", "family": "wavy_fin", "process_route": "LMM",
     "fin_thickness_mm": 6 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "channel_gap_mm": 10 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "fin_height_mm": 6.7752 / manufacturing.LMM_SHRINK_Z,     # 5.508 final
     "side_margin_mm": 1.13,
     "wave_amplitude_mm": 0.3417 / manufacturing.LMM_SHRINK_XY,  # 0.2855 final
     "wavelength_mm": 86 * manufacturing.LMM_PIXEL_MM / manufacturing.LMM_SHRINK_XY,
     "pinned_stack": {"die_width_mm": 24.0, "die_length_mm": 31.0,
                      "core_width_mm": 28.0, "core_length_mm": 28.0,
                      "core_height_mm": 6.7752 / manufacturing.LMM_SHRINK_Z,
                      "base_thickness_mm": 1.87,
                      "k_solid_W_mK": 340.0, "tim_areal_Kcm2_W": 0.05},
     "notes": "Prototype 2 AS SENT (2026-08-04 mesh, Incus-sliced 2026-08-05) — "
              "mesh-measured 6 px fin / 10 px gap / 16 px pitch green, wave "
              "A 0.34 green (0.286 final) / λ 86 px → 35.5° slope. Paul: "
              "\"this version actually looks quite feasible\". PINNED to its "
              "as-sent 28×28 envelope. NB the file name says \"16 px gap\" but "
              "16 px is the pitch — quote fin/gap/pitch separately from now on."},
]


# ---------------------------------------------------------------------------
# Business logic (pure functions — tested directly by test_api_parity.py)
# ---------------------------------------------------------------------------
def _build_catalog(stack_d: dict, arch_d: dict, op_d: dict, *,
                   coolant=None, targets_info=None, project=None) -> dict:
    """Parameter registry + candidates + geometry inputs + gate limits, computed
    against an explicit basis. Candidates are (re)scored with `op_d` (which may
    carry coolant fluid properties and the project's gate), so this one builder
    serves both the GB202 default (GET) and project rescoring (POST).
    """
    params = json.loads(PARAMS_JSON.read_text(encoding="utf-8"))
    cases_cfg = json.loads(CASES_JSON.read_text(encoding="utf-8"))
    cases = cases_cfg.get("cases", [])

    stack = mbc.StackBasis(**_filtered(stack_d, _STACK_FIELDS))
    arch = mbc.FlowArchitecture(**_filtered(arch_d, _ARCH_FIELDS))
    op = mbc.OperatingPoint(**_filtered(op_d, _OP_FIELDS))

    candidates = []
    for c in cases:
        case = mbc.GeometryCase(**_filtered(c, _CASE_FIELDS))
        out = _sanitize(asdict(mbc.evaluate_case(case, stack, op, arch)))
        candidates.append(_augment(out, c, stack_d))

    # V3.3 — Incus-compliant LMM presets ride along as first-class candidates.
    # A preset may carry `pinned_stack` / `pinned_operating` (Prototype 1): a
    # FIXED reference scored on its own as-sent envelope + rig operating point
    # — switching projects must never rescale a part that physically exists.
    m_cases = []
    for c in M_PRESET_CASES:
        case = mbc.GeometryCase(**_filtered(c, _CASE_FIELDS))
        ps = c.get("pinned_stack")
        if ps:
            stack_c = replace(stack, **_filtered(ps, _STACK_FIELDS))
            arch_c = replace(arch, path_length_mm=stack_c.core_length_mm / 2.0)
            po = c.get("pinned_operating")
            op_c = replace(op, **_filtered(po, _OP_FIELDS)) if po else op
            stack_cd = {**(stack_d or {}), **ps}
        else:
            stack_c, arch_c, op_c, stack_cd = stack, arch, op, stack_d
        out = _sanitize(asdict(mbc.evaluate_case(case, stack_c, op_c, arch_c)))
        out["preset"] = True
        if ps:
            out["pinned"] = True
        candidates.append(_augment(out, c, stack_cd))
        m_cases.append(c)
    cases = cases + m_cases

    gates = {
        "limit_R_jc_K_W": op.limit_R_jc_K_W,
        "limit_deltaP_Pa": op.limit_deltaP_Pa,
        "limit_pump_W": op.limit_pump_W,
    }
    out = {
        "design_parameters": params,
        "candidates": candidates,
        "cases": cases,
        "basis": {"stack": stack_d, "operating": op_d, "architecture": arch_d},
        "physical_footprint": PHYSICAL_FOOTPRINT,
        "gates": gates,
    }
    if coolant is not None:
        out["coolant"] = _sanitize(coolant)
    if targets_info is not None:
        out["targets"] = _sanitize(targets_info)
    if project is not None:
        out["project"] = {"id": project.get("id"), "name": project.get("name"),
                          "builtin": bool(project.get("builtin")),
                          "families": project.get("families")}
    return out


def catalog_payload() -> dict:
    """GET /api/catalog — the GB202 die-coverage default (V1 view, unchanged).

    `cases` and `basis` carry the input geometry (the results JSON has only
    outputs) so the 3D viewer can reconstruct each design's implicit body.
    """
    cases_cfg = json.loads(CASES_JSON.read_text(encoding="utf-8"))
    return _build_catalog(DIE_COVERAGE_STACK, DIE_COVERAGE_ARCH,
                          cases_cfg.get("operating", {}))


def _case_from_design(ds: dict, design_id: str) -> dict:
    """V2.2 designs-as-candidates: turn a saved design (a DesignState-shaped
    dict) into a master GeometryCase dict, mirroring the frontend evalPayload
    family routing (pin-fins drawn as a gyroid sub-type -> family=pin_fin)."""
    fam = ds.get("family", "wavy_fin")
    base = {"design_id": design_id, "process_route": ds.get("process_route", "LMM")}
    if fam == "gyroid_tpms" and ds.get("tpms_type") == "pin_fins":
        return {**base, "family": "pin_fin",
                "pin_diameter_mm": ds.get("pin_diameter_mm"),
                "pin_pitch_mm": ds.get("pin_pitch_mm"),
                "pin_pattern": ds.get("pin_pattern", "staggered"),
                "fin_height_mm": ds.get("fin_height_mm")}
    if fam == "gyroid_tpms":
        return {**base, "family": "gyroid_tpms",
                "tpms_type": ds.get("tpms_type"),
                "unit_cell_mm": ds.get("unit_cell_mm"),
                "wall_thickness_mm": ds.get("wall_thickness_mm"),
                "cell_grading": ds.get("cell_grading", 0.0),
                "void_fraction": ds.get("void_fraction"),
                "surface_area_density_m2_m3": ds.get("surface_area_density_m2_m3"),
                "hydraulic_diameter_mm": ds.get("hydraulic_diameter_mm"),
                "heat_transfer_multiplier": ds.get("heat_transfer_multiplier", 1.0),
                "pressure_loss_multiplier": ds.get("pressure_loss_multiplier", 1.0)}
    return {**base, "family": fam,
            "fin_thickness_mm": ds.get("fin_thickness_mm"),
            "channel_gap_mm": ds.get("channel_gap_mm"),
            "fin_height_mm": ds.get("fin_height_mm"),
            "side_margin_mm": ds.get("side_margin_mm", 0.9),
            "wave_amplitude_mm": ds.get("wave_amplitude_mm", 0.0),
            "wavelength_mm": ds.get("wavelength_mm", 2.5)}


def project_catalog_payload(payload: dict) -> dict:
    """POST /api/catalog — the catalog rescored against a project.

    payload = { "project": <full project object> | "<project id>" }. Resolves
    the project (coolant + derived gate) and re-scores every candidate against
    it, so a stricter T_j or a glycol coolant flips PASS/FAIL app-wide.

    A project's saved `designs` (spec §9 "pin designs") are appended as named
    candidates — each re-evaluated against the project basis — so an optimized /
    hand-tuned design shows up in the candidate list and can be fine-tuned.
    """
    proj = payload.get("project")
    if isinstance(proj, str):
        proj = STORE.load(proj)
    if not proj:
        raise ValueError("project not found (pass a full project object or a known id)")
    r = projects.resolve_project(proj)
    cat = _build_catalog(r["stack"], r["architecture"], r["operating"],
                         coolant=r["coolant"], targets_info=r["targets"], project=proj)

    designs = proj.get("designs") or []
    if designs:
        stack = mbc.StackBasis(**_filtered(r["stack"], _STACK_FIELDS))
        arch = mbc.FlowArchitecture(**_filtered(r["architecture"], _ARCH_FIELDS))
        for entry in designs:
            ds = entry.get("design") or {}
            name = entry.get("name") or "design"
            did = "saved_" + projects.slugify(name)
            case = mbc.GeometryCase(**_filtered(_case_from_design(ds, did), _CASE_FIELDS))
            op_over = dict(r["operating"])
            if ds.get("flow_lpm"):
                op_over["flow_lpm"] = float(ds["flow_lpm"])
            op2 = mbc.OperatingPoint(**_filtered(op_over, _OP_FIELDS))
            res = _sanitize(asdict(mbc.evaluate_case(case, stack, op2, arch)))
            _augment(res, _case_from_design(ds, did), r["stack"])
            res["saved"] = True
            res["name"] = name
            cat["candidates"].append(res)
            # the case for the viewer/sliders keeps the ORIGINAL design shape
            # (e.g. gyroid_tpms+pin_fins) so the 3-D view + tuning work.
            cat["cases"].append({**ds, "design_id": did})
    return cat


# --- V2.2 project store route helpers --------------------------------------
def projects_list_payload() -> dict:
    return {"projects": STORE.list()}


def project_get_payload(project_id: str) -> dict:
    proj = STORE.load(project_id)
    if proj is None:
        raise KeyError(project_id)
    return proj


def project_save_payload(payload: dict) -> dict:
    proj = payload.get("project") if "project" in payload else payload
    stored = STORE.save(proj, _now_iso())
    return {"saved": True, "project": stored}


def project_delete_payload(project_id: str) -> dict:
    existed = STORE.delete(project_id)
    return {"deleted": existed, "id": project_id}


# Geometry-family pedigree for the wizard (spec §19C). Kept here (not in the
# engine) because it is UI metadata, not physics.
_FAMILY_PEDIGREE = [
    {"family": "straight_fin", "label": "Straight fin",
     "model": "Shah-London H1 laminar Nu + fRe", "status": "ANALYTICAL", "viewable": True},
    {"family": "wavy_fin", "label": "Wavy fin",
     "model": "Shah-London x wavy multiplier (chi, Re); v6 depth available",
     "status": "ANALYTICAL", "viewable": True},
    {"family": "pin_fin", "label": "Pin fin (inline / staggered)",
     "model": "Zukauskas single-cylinder Nu + Gaddis-Gnielinski laminar ΔP + pin efficiency (S1)",
     "status": "ANALYTICAL_LIT", "viewable": True},
    {"family": "gyroid_tpms", "label": "TPMS lattice",
     "model": "Gyroid & Diamond: Renon-Jeanningros Nu/f + minimal-surface geometry (S2, turbulent fit extrapolated to laminar); Schwarz-P & others: generic screening w/ derived geometry",
     "status": "ANALYTICAL_LIT", "viewable": True},
    {"family": "generic_surface", "label": "Generic surface (SA/V + porosity)",
     "model": "generic surface model", "status": "SCREENING_ONLY", "viewable": False},
]

# Flow layouts (spec §19D). Only the first three have engine support today;
# the rest are declared so the wizard can show them (greyed) with their status.
_LAYOUTS = [
    {"layout": "single_pass", "label": "Single pass", "status": "SUPPORTED",
     "resolves": "n_parallel_paths = 1, path = core_length"},
    {"layout": "center_feed_bidirectional", "label": "Center-feed bidirectional",
     "status": "SUPPORTED", "resolves": "n_parallel_paths = 2, path = L/2, header_K 1.5"},
    {"layout": "top_jet_slot_centre_rib_bidirectional", "label": "Top-jet + centre rib (v6 hero)",
     "status": "SUPPORTED", "resolves": "+ jet Nu enhancement, slot dims (v6 solver)"},
    {"layout": "distributed_jet_compartments", "label": "Distributed-jet compartments (ICE Proto2)",
     "status": "SUPPORTED", "resolves": "n jets -> 2n paths, path = L/2n, centre-peaked jet flux"},
    {"layout": "serpentine_n_pass", "label": "Serpentine (n-pass)",
     "status": "SUPPORTED", "resolves": "path = n*L, +K_bend (2.2) per 180deg bend"},
    {"layout": "u_flow_side_feed", "label": "U-flow side feed",
     "status": "SUPPORTED", "resolves": "path = L, uniformity 0.90, header_K 2.5"},
    {"layout": "multi_jet_array", "label": "Multi-jet array (free grid)",
     "status": "DEFERRED", "resolves": "Martin (1977) + CFD anchor"},
]


def schema_payload() -> dict:
    """Wizard schema (spec §21): coolant presets, target defaults/bounds,
    family pedigree, layouts. Read-only and additive; never affects parity."""
    return {
        "coolants": coolants.schema(),
        "targets": targets.target_schema(),
        "families": _FAMILY_PEDIGREE,
        "layouts": _LAYOUTS,
        "manufacturing": manufacturing.schema(),   # V3.3 — DfAM rulebooks
    }


def evaluate_payload(payload: dict) -> dict:
    """Run the master engine evaluate_case() on an arbitrary design.

    payload = {
        "case":         { design_id?, family, fin_thickness_mm, ... },
        "stack":        { ...StackBasis overrides... },
        "operating":    { ...OperatingPoint overrides... },
        "architecture": { ...FlowArchitecture overrides... },
        "coolant":      "water" | {name?, rho_kg_m3?, mu_Pa_s?, ...},   # V2
        "targets":      { T_j_max_C?, R_jc_gate_K_W?, limit_deltaP_Pa?,  # V2
                          limit_pump_W? },
        "relative_roughness": 0.03
    }

    Omitted groups fall back to the master defaults, which equal the 450/575 W
    die-coverage basis — so posting just a case reproduces the golden results.

    V2 additions are purely additive: when "coolant"/"targets" are absent the
    result is byte-identical to V1 (this is what test_api_parity.py guards).
      * coolant -> resolves fluid properties (rho, mu, k_fluid, cp) at the inlet
        temperature and fills them into the operating point (explicit operating
        overrides still win).
      * targets -> derives the R_jc gate from T_j,max (spec §19A), injects it as
        the R_jc limit, and attaches the exact junction temperature to the result.
    """
    case_in = dict(payload.get("case") or {})
    case_in.setdefault("design_id", "live_design")
    case_in.setdefault("family", "wavy_fin")

    case = mbc.GeometryCase(**_filtered(case_in, _CASE_FIELDS))
    stack = mbc.StackBasis(**_filtered(payload.get("stack"), _STACK_FIELDS))
    arch = mbc.FlowArchitecture(**_filtered(payload.get("architecture"), _ARCH_FIELDS))
    rr = float(payload.get("relative_roughness", 0.03))

    op_overrides = dict(payload.get("operating") or {})

    # --- V2: coolant preset -> fluid properties (skipped when absent) --------
    coolant_info = None
    if payload.get("coolant") is not None:
        T_in = op_overrides.get("T_inlet_C")
        if T_in is None and isinstance(payload["coolant"], dict):
            T_in = payload["coolant"].get("T_inlet_C")
        if T_in is None:
            T_in = mbc.OperatingPoint().T_inlet_C
        coolant_info = coolants.resolve(payload["coolant"], float(T_in))
        for k in ("rho_kg_m3", "mu_Pa_s", "k_fluid_W_mK", "cp_J_kgK"):
            op_overrides.setdefault(k, coolant_info[k])   # explicit op wins
        op_overrides.setdefault("T_inlet_C", float(T_in))

    op = mbc.OperatingPoint(**_filtered(op_overrides, _OP_FIELDS))

    # --- V2: targets -> derived R_jc gate (skipped when absent) --------------
    target_info = None
    tgt = payload.get("targets")
    if tgt is not None:
        target_info = targets.derive_thermal_gate(
            T_j_max_C=tgt.get("T_j_max_C"),
            T_in_C=op.T_inlet_C,
            Q_W=op.heat_load_W,
            flow_lpm=op.flow_lpm,
            rho_kg_m3=op.rho_kg_m3,
            cp_J_kgK=op.cp_J_kgK,
            override_R_jc_gate=tgt.get("R_jc_gate_K_W"),
        )
        gate_overrides = {"limit_R_jc_K_W": target_info["R_jc_gate_K_W"]}
        if tgt.get("limit_deltaP_Pa") is not None:
            gate_overrides["limit_deltaP_Pa"] = float(tgt["limit_deltaP_Pa"])
        if tgt.get("limit_pump_W") is not None:
            gate_overrides["limit_pump_W"] = float(tgt["limit_pump_W"])
        op = replace(op, **gate_overrides)

    # --- V5.1 (S6): flow-network block (fin families) — additive; optional
    # KPI coupling via use_computed_uniformity (spec §47, default off) --------
    fn_block = None
    if str(case.family).lower().strip() in {"straight_fin", "wavy_fin"}:
        try:
            fn_block = flow_network.compute(
                case, stack, op, arch, relative_roughness=rr,
                params=payload.get("flow_network_params"))
        except Exception as exc:  # the viz solver must never break evaluate
            fn_block = {"supported": False, "error": str(exc)}
        if (payload.get("use_computed_uniformity") and fn_block.get("supported")
                and fn_block.get("uniformity_computed") is not None):
            arch = replace(arch, flow_uniformity=float(fn_block["uniformity_computed"]))
            fn_block["applied_to_kpis"] = True

    result = mbc.evaluate_case(case, stack, op, arch, relative_roughness=rr)
    out = _sanitize(asdict(result))
    _augment(out, case_in, payload.get("stack"))   # V3: areas + manufacturability

    if fn_block is not None:
        if fn_block.get("supported"):
            flow_network.reconcile(fn_block, result.DeltaP_Pa)
            if fn_block.get("applied_to_kpis"):
                out["warnings"] = list(out.get("warnings") or []) + [
                    "flow_uniformity replaced by the S6 network-computed value "
                    f"({fn_block['uniformity_computed']:.4f}) — user opt-in "
                    "(use_computed_uniformity), pending Ansys cross-check."]
        out["flow_network"] = _sanitize(fn_block)

    # --- V2: attach coolant + exact junction temperature (when requested) ----
    if coolant_info is not None:
        out["coolant"] = _sanitize(coolant_info)
    if target_info is not None:
        tj = targets.junction_temperature(
            T_in_C=op.T_inlet_C, Q_W=op.heat_load_W, UA_W_K=result.UA_W_K,
            mdot_cp_W_K=target_info["mdot_cp_W_K"],
            R_tim_K_W=result.R_TIM_K_W, R_base_K_W=result.R_base_K_W)
        tj_max = target_info["T_j_max_C"]
        out["targets"] = _sanitize({
            **target_info, **tj,
            "T_j_pass": (tj["T_j_C"] <= tj_max) if tj_max is not None else None,
        })

    # --- V2.6: mass/material (always) + k-solid R_jc uncertainty band (on ask) --
    mass = _mass_estimate(out, payload.get("stack"))
    out["mass_g"] = mass["mass_g"]
    out["material_cost_usd"] = mass["material_cost_usd"]
    if payload.get("uncertainty"):
        lo_k, hi_k = _K_BAND_W_MK
        band = {
            kv: mbc.evaluate_case(case, replace(stack, k_solid_W_mK=kv), op, arch,
                                  relative_roughness=rr).R_jc_K_W
            for kv in (lo_k, hi_k)
        }
        out["r_jc_band"] = _sanitize({
            "conservative_k": lo_k, "R_jc_conservative_K_W": band[lo_k],
            "optimistic_k": hi_k, "R_jc_optimistic_K_W": band[hi_k],
            "nominal_k": stack.k_solid_W_mK, "R_jc_nominal_K_W": result.R_jc_K_W,
        })
    return out


def solve_payload(payload: dict) -> dict:
    """Run the v6 solver for the wavy hero drill-down (SI lengths, as webapp.py).

    Adds a junction-to-coolant breakdown computed on the candidate's OWN cooled
    footprint so R_jc is comparable with the master engine.
    """
    geom = Geometry(**_filtered(payload.get("geometry"), _V6_GEOM_FIELDS))
    op = Operating(**_filtered(payload.get("operating"), _V6_OP_FIELDS))
    arch = V6Arch(**_filtered(payload.get("architecture"), _V6_ARCH_FIELDS))

    opts = payload.get("options") or {}
    k_override = opts.get("k_solid_wpmk")
    wavy_override = opts.get("wavy_enhancement_override")
    apply_entry = bool(opts.get("apply_thermal_entry", False))

    result = solve(
        geom, op, arch,
        k_solid_wpmk=(float(k_override) if k_override not in (None, "") else None),
        wavy_enhancement_override=(
            float(wavy_override) if wavy_override not in (None, "") else None),
        apply_thermal_entry=apply_entry,
    )
    out = _sanitize(asdict(result))
    jc = junction_to_coolant(
        result.R_th_conv_kpw,
        cooled_area_m2=geom.core_width_m * geom.core_length_m,
        t_base_m=geom.base_thickness_m,
        k_wpmk=geom.k_solid_wpmk,
    )
    out["junction_to_coolant"] = _sanitize(asdict(jc))
    return out


# Variables the sweep can vary. Geometry vars live on GeometryCase (mm); flow
# rate lives on the operating point (L/min) — the strongest thermal-hydraulic
# lever, so it earns a sweep axis (spec optimizer tier 1).
_SWEEP_VARS = {
    # fin families
    "fin_thickness_mm", "channel_gap_mm", "fin_height_mm",
    "wave_amplitude_mm", "wavelength_mm",
    # TPMS sheet (S2) + pin (S1) geometry — so the optimizer works per family
    "unit_cell_mm", "wall_thickness_mm", "cell_grading",
    "pin_diameter_mm", "pin_pitch_mm",
}
_SWEEP_OP_VARS = {"flow_lpm"}

# Objectives the heatmap/optimum can rank by, with the "better" direction.
# (The Pareto axes stay R_jc vs pump — the canonical thermal-hydraulic trade.)
_OBJECTIVE_DIR = {
    "R_jc_K_W": "min", "DeltaP_Pa": "min", "pump_power_W": "min",
    "mass_g": "min", "cop": "max",
}
_RHO_CU_KG_M3 = 8960.0        # bulk copper (printed Cu ~8900; screening)
_CU_POWDER_USD_PER_KG = 60.0  # copper powder, MATERIAL only (excludes AM machine time)
# Cu-AM conductivity band for the uncertainty estimate (spec §15 Q7).
_K_BAND_W_MK = (250.0, 400.0)  # (conservative, optimistic); nominal is the design's own k


def _mass_estimate(result: dict, stack_d=None) -> dict:
    """Copper mass (g) + material cost of the core solid + base slab, from the
    open-volume fraction — a screening print-mass/material proxy (spec §23)."""
    s = {**DIE_COVERAGE_STACK, **(stack_d or {})}
    cw = s["core_width_mm"] * 1e-3
    cl = s["core_length_mm"] * 1e-3
    ch = s["core_height_mm"] * 1e-3
    bt = s["base_thickness_mm"] * 1e-3
    open_frac = result.get("open_volume_fraction") or 0.0
    core_solid = max(1.0 - open_frac, 0.0) * (cw * cl * ch)
    mass_kg = (core_solid + cw * cl * bt) * _RHO_CU_KG_M3
    return {"mass_g": mass_kg * 1000.0, "material_cost_usd": mass_kg * _CU_POWDER_USD_PER_KG}


def _sweep_mass_g(result: dict, stack_d=None) -> float:
    return _mass_estimate(result, stack_d)["mass_g"]


def _axis(spec: dict, default_lo: float, default_hi: float, default_n: int = 21):
    """Resolve an axis spec into (name, [values])."""
    name = spec.get("var")
    if spec.get("values"):
        return name, [float(v) for v in spec["values"]]
    lo = float(spec.get("min", default_lo))
    hi = float(spec.get("max", default_hi))
    n = int(spec.get("steps", default_n))
    return name, _linspace(lo, hi, n)


def sweep_payload(payload: dict) -> dict:
    """2-variable grid sweep for the heatmap + Pareto (spec section 8).

    payload = {
        "base":   { case, stack, operating, architecture },   # held fixed
        "x":      { var, min, max, steps }  |  { var, values },
        "y":      { var, min, max, steps }  |  { var, values },
        "objective": "R_jc_K_W"            # colour metric (default)
    }
    Default axes: x = fin_thickness_mm, y = channel_gap_mm.
    """
    base = payload.get("base") or {}
    base_case = dict(base.get("case") or {})
    base_case.setdefault("design_id", "sweep_point")
    base_case.setdefault("family", "wavy_fin")

    x_spec = payload.get("x") or {"var": "fin_thickness_mm"}
    y_spec = payload.get("y") or {"var": "channel_gap_mm"}
    x_spec.setdefault("var", "fin_thickness_mm")
    y_spec.setdefault("var", "channel_gap_mm")
    objective = payload.get("objective", "R_jc_K_W")
    if objective not in _OBJECTIVE_DIR:
        raise ValueError(f"objective {objective!r} not in {sorted(_OBJECTIVE_DIR)}")

    allowed = _SWEEP_VARS | _SWEEP_OP_VARS
    for spec in (x_spec, y_spec):
        if spec["var"] not in allowed:
            raise ValueError(f"sweep var {spec['var']!r} not in {sorted(allowed)}")

    x_name, xs = _axis(x_spec, 0.05, 0.30)
    y_name, ys = _axis(y_spec, 0.05, 0.30)
    base_op = dict(base.get("operating") or {})
    stack_d = base.get("stack")
    Q = float(base_op.get("heat_load_W", 450.0))
    # V3.3 — manufacturability enforcement over the sweep (spec §35F): every
    # point is annotated with its DfAM verdict; `enforce` restricts which
    # verdicts the ★ optimum may come from ("enforce" -> PASS only,
    # "marginal" -> PASS+MARGINAL, "explore"/absent -> unrestricted).
    mfg_enforce = str((payload.get("manufacturability") or {}).get("enforce", "")) or None
    _MFG_ALLOWED = {"enforce": {"PASS"}, "marginal": {"PASS", "MARGINAL"}}
    # V2 problem context: coolant + targets (T_j gate, ΔP/pump budgets) ride
    # along on every grid point so `feasible` means "fits THIS problem" and the
    # optimum is the constrained optimum, not the unconstrained corner.
    base_coolant = base.get("coolant")
    base_targets = base.get("targets")

    def _apply(var, val, case_in, op_in):
        (op_in if var in _SWEEP_OP_VARS else case_in)[var] = val

    grid = []
    gates_out = None
    for xv in xs:
        for yv in ys:
            case_in = dict(base_case)
            op_in = dict(base_op)
            _apply(x_name, xv, case_in, op_in)
            _apply(y_name, yv, case_in, op_in)
            point = {
                "case": case_in,
                "stack": stack_d,
                "operating": op_in,
                "architecture": base.get("architecture"),
                "relative_roughness": base.get("relative_roughness", 0.03),
            }
            if base_coolant is not None:
                point["coolant"] = base_coolant
            if base_targets is not None:
                point["targets"] = base_targets
            try:
                r = evaluate_payload(point)
            except Exception:  # noqa: BLE001 — an invalid combo (e.g. pin pitch <= dia)
                grid.append({
                    "x": xv, "y": yv, "objective": None,
                    "R_jc_K_W": None, "R_th_conv_K_W": None, "DeltaP_Pa": None,
                    "pump_power_W": None, "mass_g": None, "cop": None,
                    "kpi_status": "INVALID", "feasible": False, "mfg": None,
                })
                continue
            status = r.get("kpi_status") or ""
            pump = r.get("pump_power_W")
            mass = _sweep_mass_g(r, stack_d)
            cop = (Q / pump) if pump else None
            if gates_out is None:
                # Echo the budgets each point was judged against (targets win,
                # else operating overrides, else engine defaults). When flow is
                # a sweep axis a T_j-derived gate varies slightly per point;
                # this echo is the first point's — indicative for chart lines.
                dflt = mbc.OperatingPoint()
                tinfo = r.get("targets") or {}
                tgt_in = base_targets or {}
                gates_out = {
                    "limit_R_jc_K_W": tinfo.get(
                        "R_jc_gate_K_W",
                        op_in.get("limit_R_jc_K_W", dflt.limit_R_jc_K_W)),
                    "limit_deltaP_Pa": tgt_in.get(
                        "limit_deltaP_Pa",
                        op_in.get("limit_deltaP_Pa", dflt.limit_deltaP_Pa)),
                    "limit_pump_W": tgt_in.get(
                        "limit_pump_W",
                        op_in.get("limit_pump_W", dflt.limit_pump_W)),
                }
            metrics = {
                "R_jc_K_W": r.get("R_jc_K_W"),
                "R_th_conv_K_W": r.get("R_th_conv_K_W"),
                "DeltaP_Pa": r.get("DeltaP_Pa"),
                "pump_power_W": pump,
                "mass_g": mass,
                "cop": cop,
            }
            grid.append({
                "x": xv, "y": yv,
                "objective": metrics.get(objective),
                **metrics,
                "kpi_status": status,
                "feasible": "FAIL" not in status,
                "mfg": (r.get("manufacturability") or {}).get("verdict"),
            })

    # Pareto front (minimise R_jc and pump_power) over finite points.
    pts = [g for g in grid
           if g["R_jc_K_W"] is not None and g["pump_power_W"] is not None]
    pareto = []
    for c in pts:
        dominated = any(
            (o["R_jc_K_W"] <= c["R_jc_K_W"] and o["pump_power_W"] <= c["pump_power_W"])
            and (o["R_jc_K_W"] < c["R_jc_K_W"] or o["pump_power_W"] < c["pump_power_W"])
            for o in pts if o is not c
        )
        if not dominated:
            pareto.append(c)
    pareto.sort(key=lambda g: g["R_jc_K_W"])

    # Optimum = best objective among feasible (fall back to best overall).
    # V3.3: with manufacturability enforcement, ★ comes from the rule-compliant
    # pool and ☆ (optimum_unconstrained, gates-only) shows the price of
    # manufacturability.
    maximise = _OBJECTIVE_DIR[objective] == "max"
    scored = [g for g in grid if g.get("objective") is not None]
    feasible = [g for g in scored if g["feasible"]]
    best_of = lambda pool: (max if maximise else min)(pool, key=lambda g: g["objective"]) if pool else None  # noqa: E731
    optimum_unconstrained = best_of(feasible or scored)
    allowed = _MFG_ALLOWED.get(mfg_enforce or "")
    if allowed is not None:
        mfg_pool = [g for g in feasible if g.get("mfg") in allowed]
        optimum = best_of(mfg_pool) or optimum_unconstrained
    else:
        optimum = optimum_unconstrained

    # R_jc floor = R_base + R_TIM (fixed; convection can't beat it). Constant
    # across the sweep, so read it off any finite point as R_jc - R_conv.
    floor = None
    for g in grid:
        if g["R_jc_K_W"] is not None and g["R_th_conv_K_W"] is not None:
            floor = g["R_jc_K_W"] - g["R_th_conv_K_W"]
            break

    return {
        "x_var": x_name,
        "y_var": y_name,
        "objective": objective,
        "objective_dir": _OBJECTIVE_DIR[objective],
        "grid": grid,
        "pareto": pareto,
        "optimum": optimum,
        "optimum_unconstrained": optimum_unconstrained,
        "mfg_enforce": mfg_enforce,
        "r_jc_floor_K_W": floor,
        "r_jc_gate_K_W": (gates_out or {}).get("limit_R_jc_K_W",
                                               base_op.get("limit_R_jc_K_W")),
        "gates": gates_out,
    }


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------
_ROUTES_GET = {
    "/api/health": lambda: {"status": "ok"},
    "/api/catalog": catalog_payload,
    "/api/schema": schema_payload,
    "/api/projects": projects_list_payload,
}
_ROUTES_POST = {
    "/api/evaluate": evaluate_payload,
    "/api/solve": solve_payload,
    "/api/sweep": sweep_payload,
    "/api/catalog": project_catalog_payload,   # V2.2: rescore against a project
    "/api/projects": project_save_payload,      # V2.2: save a user project
}

# Prefix for the per-id project routes: GET/DELETE /api/projects/<id>
_PROJECT_ID_PREFIX = "/api/projects/"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: N802 — quieter logging
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, body: bytes, ctype: str):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_OPTIONS(self):  # noqa: N802 — CORS preflight
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        fn = _ROUTES_GET.get(path)
        if fn is not None:
            try:
                self._json(200, fn())
            except Exception as exc:  # noqa: BLE001 — surface to the UI
                self._json(500, {"error": str(exc)})
            return
        # GET /api/projects/<id> — one project (built-in or saved)
        if path.startswith(_PROJECT_ID_PREFIX):
            pid = path[len(_PROJECT_ID_PREFIX):]
            try:
                self._json(200, project_get_payload(pid))
            except KeyError:
                self._json(404, {"error": f"project not found: {pid}"})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"error": str(exc)})
            return
        if path.startswith("/api/"):
            self._json(404, {"error": f"not found: {path}"})
            return
        self._serve_static(path)

    def do_DELETE(self):  # noqa: N802 — DELETE /api/projects/<id>
        path = self.path.split("?", 1)[0]
        if path.startswith(_PROJECT_ID_PREFIX):
            pid = path[len(_PROJECT_ID_PREFIX):]
            try:
                self._json(200, project_delete_payload(pid))
            except Exception as exc:  # noqa: BLE001
                self._json(400, {"error": str(exc)})
            return
        self._json(404, {"error": f"not found: {path}"})

    def _serve_static(self, path):
        """Serve the built frontend (production single-origin) with SPA fallback."""
        if not DIST.is_dir():
            self._json(404, {"error": "frontend not built — run `npm run build` in frontend/"})
            return
        rel = path.lstrip("/") or "index.html"
        target = (DIST / rel).resolve()
        # path-traversal guard + single-page-app fallback to index.html
        if target != DIST and DIST not in target.parents:
            target = DIST / "index.html"
        if not target.is_file():
            target = DIST / "index.html"
        if not target.is_file():
            self._json(404, {"error": "index.html missing"})
            return
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)

    def do_POST(self):  # noqa: N802
        fn = _ROUTES_POST.get(self.path)
        if fn is None:
            self._json(404, {"error": f"not found: {self.path}"})
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            self._json(400, {"error": f"bad JSON: {exc}"})
            return
        try:
            self._json(200, fn(payload))
        except Exception as exc:  # noqa: BLE001 — surface to the UI
            self._json(500, {"error": str(exc)})


def main() -> int:
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        # Port taken. In the standalone exe this usually means the viewer is
        # already running — just bring it up in the browser instead of dying.
        if FROZEN:
            import urllib.request
            import webbrowser
            url = f"http://127.0.0.1:{PORT}"
            try:
                with urllib.request.urlopen(url + "/api/health", timeout=3) as r:
                    already_running = r.status == 200
            except Exception:
                already_running = False
            if already_running:
                print(f"Viewer is already running - opening {url}")
                webbrowser.open(url)
                return 0
            print(f"Could not start on port {PORT}: {exc}")
            print("Another program is using this port. Close it and try again.")
            input("Press Enter to close.")
            return 1
        raise
    print("=" * 64)
    print("Cold Plate Master Baseline Viewer - API (Phase 1)")
    print("=" * 64)
    print(f"  This machine:  http://127.0.0.1:{PORT}")
    print(f"  Same LAN/WiFi: http://{_lan_ip()}:{PORT}")
    print("  GET  /api/health /api/catalog /api/schema /api/projects[/<id>]")
    print("  POST /api/evaluate /api/solve /api/sweep /api/catalog /api/projects")
    print("  Ctrl+C to stop.")
    if FROZEN:
        # Standalone exe: open the app in the default browser once the server
        # is up (closing the console window stops it, like the .bat launcher).
        import threading
        import webbrowser
        print("  Close this window to stop the app.")
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
