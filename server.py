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

then the API is on http://127.0.0.1:8000. CORS is open so a Vite dev server on
another port can call it during development. In production the same server can
also serve the built frontend from ./frontend/dist (see do_GET).

Design note: the request/response contract mirrors MASTER_BASELINE_VIEWER_SPEC.md
section 12. Business logic lives in pure functions (catalog_payload,
evaluate_payload, solve_payload, sweep_payload) so test_api_parity.py can call
the exact code path the HTTP handler uses.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------------------------------------------------------------------------
# Path wiring: the validated solvers are vendored under engine/ so this repo is
# self-contained (see engine/README + sync_engine.py). Put engine/ on sys.path.
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent              # 07_WebApp
ENGINE = ROOT / "engine"
DATA = ENGINE / "data"

if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

import master_baseline_calculator as mbc             # noqa: E402  (path set above)

from cold_plate_v6.architecture import FlowArchitecture as V6Arch   # noqa: E402
from cold_plate_v6.geometry import Geometry                          # noqa: E402
from cold_plate_v6.operating import Operating                        # noqa: E402
from cold_plate_v6.solver import solve                               # noqa: E402
from cold_plate_v6.system_resistance import junction_to_coolant      # noqa: E402

# Vendored data snapshot (synced from the master baseline; parity test guards it).
PARAMS_JSON = DATA / "master_design_parameters.json"
RESULTS_JSON = DATA / "master_baseline_results.json"

HOST = "127.0.0.1"
PORT = 8000

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
def catalog_payload() -> dict:
    """Master parameter registry + the 5 scored candidates + gate limits."""
    params = json.loads(PARAMS_JSON.read_text(encoding="utf-8"))
    candidates = json.loads(RESULTS_JSON.read_text(encoding="utf-8"))
    op = mbc.OperatingPoint()
    gates = {
        "limit_R_jc_K_W": op.limit_R_jc_K_W,
        "limit_deltaP_Pa": op.limit_deltaP_Pa,
        "limit_pump_W": op.limit_pump_W,
    }
    return {
        "design_parameters": params,
        "candidates": candidates,
        "gates": gates,
    }


def evaluate_payload(payload: dict) -> dict:
    """Run the master engine evaluate_case() on an arbitrary design.

    payload = {
        "case":         { design_id?, family, fin_thickness_mm, ... },
        "stack":        { ...StackBasis overrides... },
        "operating":    { ...OperatingPoint overrides... },
        "architecture": { ...FlowArchitecture overrides... },
        "relative_roughness": 0.03
    }

    Omitted groups fall back to the master defaults, which equal the 450/575 W
    die-coverage basis — so posting just a case reproduces the golden results.
    """
    case_in = dict(payload.get("case") or {})
    case_in.setdefault("design_id", "live_design")
    case_in.setdefault("family", "wavy_fin")

    case = mbc.GeometryCase(**_filtered(case_in, _CASE_FIELDS))
    stack = mbc.StackBasis(**_filtered(payload.get("stack"), _STACK_FIELDS))
    op = mbc.OperatingPoint(**_filtered(payload.get("operating"), _OP_FIELDS))
    arch = mbc.FlowArchitecture(**_filtered(payload.get("architecture"), _ARCH_FIELDS))
    rr = float(payload.get("relative_roughness", 0.03))

    result = mbc.evaluate_case(case, stack, op, arch, relative_roughness=rr)
    return _sanitize(asdict(result))


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
            grid.append({
                "x": xv,
                "y": yv,
                "objective": r.get(objective),
                "R_jc_K_W": r.get("R_jc_K_W"),
                "R_th_conv_K_W": r.get("R_th_conv_K_W"),
                "DeltaP_Pa": r.get("DeltaP_Pa"),
                "pump_power_W": r.get("pump_power_W"),
                "kpi_status": r.get("kpi_status"),
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

    optimum = min(pts, key=lambda g: g["R_jc_K_W"]) if pts else None

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
}
_ROUTES_POST = {
    "/api/evaluate": evaluate_payload,
    "/api/solve": solve_payload,
    "/api/sweep": sweep_payload,
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: N802 — quieter logging
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
        fn = _ROUTES_GET.get(self.path)
        if fn is None:
            self._json(404, {"error": f"not found: {self.path}"})
            return
        try:
            self._json(200, fn())
        except Exception as exc:  # noqa: BLE001 — surface to the UI
            self._json(500, {"error": str(exc)})

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
    print(f"  Serving on http://{HOST}:{PORT}")
    print("  GET  /api/health   /api/catalog")
    print("  POST /api/evaluate /api/solve /api/sweep")
    print("  Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
