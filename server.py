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
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent              # 07_WebApp
ENGINE = ROOT / "engine"
DATA = ENGINE / "data"
DIST = ROOT / "frontend" / "dist"                   # built frontend (production single-origin)

if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

import master_baseline_calculator as mbc             # noqa: E402  (path set above)
import coolants                                       # noqa: E402  (V2 fluid library)
import targets                                        # noqa: E402  (V2 targets->gate)
import projects                                       # noqa: E402  (V2.2 project store)

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

PROJECTS_DIR = ROOT / "projects"
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
        candidates.append(_sanitize(asdict(mbc.evaluate_case(case, stack, op, arch))))

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

    result = mbc.evaluate_case(case, stack, op, arch, relative_roughness=rr)
    out = _sanitize(asdict(result))

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


# Variables the sweep can vary (all live on GeometryCase, in mm).
_SWEEP_VARS = {
    "fin_thickness_mm", "channel_gap_mm", "fin_height_mm",
    "wave_amplitude_mm", "wavelength_mm",
}


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

    for spec in (x_spec, y_spec):
        if spec["var"] not in _SWEEP_VARS:
            raise ValueError(
                f"sweep var {spec['var']!r} not in {sorted(_SWEEP_VARS)}")

    x_name, xs = _axis(x_spec, 0.05, 0.30)
    y_name, ys = _axis(y_spec, 0.05, 0.30)

    grid = []
    for xv in xs:
        for yv in ys:
            case_in = dict(base_case)
            case_in[x_name] = xv
            case_in[y_name] = yv
            r = evaluate_payload({
                "case": case_in,
                "stack": base.get("stack"),
                "operating": base.get("operating"),
                "architecture": base.get("architecture"),
                "relative_roughness": base.get("relative_roughness", 0.03),
            })
            status = r.get("kpi_status") or ""
            grid.append({
                "x": xv,
                "y": yv,
                "objective": r.get(objective),
                "R_jc_K_W": r.get("R_jc_K_W"),
                "R_th_conv_K_W": r.get("R_th_conv_K_W"),
                "DeltaP_Pa": r.get("DeltaP_Pa"),
                "pump_power_W": r.get("pump_power_W"),
                "kpi_status": status,
                "feasible": "FAIL" not in status,
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

    # Prefer the best *feasible* point (all gates pass); fall back to best overall.
    feasible = [g for g in pts if g["feasible"]]
    opt_pool = feasible or pts
    optimum = min(opt_pool, key=lambda g: g["R_jc_K_W"]) if opt_pool else None

    return {
        "x_var": x_name,
        "y_var": y_name,
        "objective": objective,
        "grid": grid,
        "pareto": pareto,
        "optimum": optimum,
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
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 64)
    print("Cold Plate Master Baseline Viewer - API (Phase 1)")
    print("=" * 64)
    print(f"  This machine:  http://127.0.0.1:{PORT}")
    print(f"  Same LAN/WiFi: http://{_lan_ip()}:{PORT}")
    print("  GET  /api/health /api/catalog /api/schema /api/projects[/<id>]")
    print("  POST /api/evaluate /api/solve /api/sweep /api/catalog /api/projects")
    print("  Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
