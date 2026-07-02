"""
07_WebApp/engine/projects.py  (webapp-native)
=============================================
Project store + resolver for the web-app "Design Studio" (V2.2, spec §19/§21).

A *Project* scopes the whole app to a user-defined problem: the die + cold-plate
envelope, operating point, coolant, target junction temperature (which derives
the R_jc gate), flow architecture, and which geometry families are in scope.
Resolving a project produces the engine basis (stack + operating + architecture)
and gates that every downstream call (catalog rescoring, evaluate, sweep) uses.

Webapp-native module: authored and maintained here in engine/, NOT synced from
the parent project — keeps the webapp self-contained (see sync_engine.py).

Design points:
  * Built-in projects (e.g. the GB202 GPU preset) are defined in code and always
    available; the GB202 preset reproduces the V1 catalog view exactly.
  * User projects persist as JSON files under 07_WebApp/projects/ with a small
    index.json (id -> name/file/timestamps) for list/rename/delete (spec §25 Q5).
    These are server-local, LAN-shared via the API (not git-tracked).
  * resolve_project() is a pure function reusing coolants (S4) + targets (S5).

Timestamps are injected by the caller (server) so this module stays free of the
non-deterministic clock — matching the codebase's dependency-light style.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import coolants
import layouts
import targets

SCHEMA_VERSION = 1

# Keys copied from project.problem into the engine StackBasis.
_STACK_KEYS = (
    "die_width_mm", "die_length_mm", "core_width_mm", "core_length_mm",
    "core_height_mm", "base_thickness_mm", "k_solid_W_mK", "tim_areal_Kcm2_W",
)


def slugify(name: str) -> str:
    """Filesystem-safe id from a project name."""
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "project"


# ---------------------------------------------------------------------------
# Resolver — project -> engine basis + gates (pure; reuses S4 + S5)
# ---------------------------------------------------------------------------
def resolve_project(project: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve a project into {stack, operating, architecture, gates, coolant,
    targets, warnings}. `operating` carries fluid properties (from the coolant)
    and the gate limits, so it drops straight into mbc.OperatingPoint.
    """
    prob = dict(project.get("problem") or {})
    op_in = dict(project.get("operating") or {})
    tgt = dict(project.get("targets") or {})
    arch_in = dict(project.get("architecture") or {})

    # V2.5: the named layout is authoritative — it resolves n_paths / path /
    # header_K / flow_uniformity / jet_flux_peaking (S3). Layout parameters
    # (n_pass, n_jets) ride in `arch_in`. GB202's center-feed at core_length 28
    # resolves to exactly its historical knobs (n=2, path=14, header=1.5), so the
    # preset is unchanged.
    layout_name = arch_in.get("name", "center_feed_bidirectional")
    core_length = float(prob.get("core_length_mm", 28.0))
    layout_warnings: List[str] = []
    try:
        resolved = layouts.resolve(layout_name, core_length, arch_in)
    except ValueError as exc:
        resolved = layouts.resolve("center_feed_bidirectional", core_length)
        layout_warnings.append(str(exc))
    layout_warnings += resolved.pop("warnings", [])
    arch = {"name": layout_name, **resolved}

    T_in = float(op_in.get("T_inlet_C", 25.0))
    cool = coolants.resolve(prob.get("coolant", "water"), T_in)

    operating: Dict[str, Any] = {
        "heat_load_W": float(op_in.get("heat_load_W", 450.0)),
        "margin_heat_load_W": float(op_in.get("margin_heat_load_W", 575.0)),
        "flow_lpm": float(op_in.get("flow_lpm", 2.65)),
        "T_inlet_C": T_in,
        "rho_kg_m3": cool["rho_kg_m3"],
        "mu_Pa_s": cool["mu_Pa_s"],
        "k_fluid_W_mK": cool["k_fluid_W_mK"],
        "cp_J_kgK": cool["cp_J_kgK"],
    }

    # Gate resolution (spec §19A): explicit override wins, else derive from
    # T_j,max, else fall back to the historical default gate.
    override = tgt.get("R_jc_gate_override")
    if override is None and tgt.get("T_j_max_C") is None:
        gate_info = {"R_jc_gate_K_W": 0.078, "caloric_dT_K": None,
                     "mean_coolant_C": None, "mdot_cp_W_K": None,
                     "T_j_max_C": None, "derivation": "default gate (no target set)",
                     "warnings": []}
    else:
        gate_info = targets.derive_thermal_gate(
            T_j_max_C=tgt.get("T_j_max_C"), T_in_C=T_in,
            Q_W=operating["heat_load_W"], flow_lpm=operating["flow_lpm"],
            rho_kg_m3=operating["rho_kg_m3"], cp_J_kgK=operating["cp_J_kgK"],
            override_R_jc_gate=override,
        )

    gates = {
        "limit_R_jc_K_W": gate_info["R_jc_gate_K_W"],
        "limit_deltaP_Pa": float(tgt.get("limit_deltaP_Pa", 50000.0)),
        "limit_pump_W": float(tgt.get("limit_pump_W", 5.0)),
    }
    operating.update(gates)

    stack = {k: prob[k] for k in _STACK_KEYS if prob.get(k) is not None}

    return {
        "stack": stack,
        "operating": operating,
        "architecture": arch,
        "gates": gates,
        "coolant": cool,
        "targets": gate_info,
        "warnings": (list(cool.get("warnings", [])) + list(gate_info.get("warnings", []))
                     + layout_warnings),
    }


def validate(project: Dict[str, Any]) -> List[str]:
    """Return a list of human-readable problems (empty = OK)."""
    errs: List[str] = []
    prob = project.get("problem") or {}
    if not project.get("name"):
        errs.append("project needs a name")
    die_w = prob.get("die_width_mm")
    core_w = prob.get("core_width_mm")
    die_l = prob.get("die_length_mm")
    core_l = prob.get("core_length_mm")
    if die_w and core_w and die_l and core_l:
        if float(core_w) * float(core_l) < float(die_w) * float(die_l):
            errs.append("cooled core footprint is smaller than the die (coverage < 1)")
    try:
        resolve_project(project)      # surfaces gate/coolant errors (e.g. T_j<=T_in)
    except Exception as exc:          # noqa: BLE001
        errs.append(str(exc))
    return errs


# ---------------------------------------------------------------------------
# Store — built-ins (in code) + user projects (files + index.json)
# ---------------------------------------------------------------------------
class ProjectStore:
    def __init__(self, projects_dir: Path, builtins: Optional[List[Dict[str, Any]]] = None):
        self.dir = Path(projects_dir)
        self.builtins = {p["id"]: p for p in (builtins or [])}

    # -- index helpers ------------------------------------------------------
    @property
    def _index_path(self) -> Path:
        return self.dir / "index.json"

    def _read_index(self) -> List[Dict[str, Any]]:
        if not self._index_path.is_file():
            return []
        try:
            return json.loads(self._index_path.read_text(encoding="utf-8")).get("projects", [])
        except (json.JSONDecodeError, OSError):
            return []

    def _write_index(self, entries: List[Dict[str, Any]]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self._index_path.write_text(
            json.dumps({"schema_version": SCHEMA_VERSION, "projects": entries}, indent=2),
            encoding="utf-8")

    # -- public API ---------------------------------------------------------
    def list(self) -> List[Dict[str, Any]]:
        """Summaries for the picker: built-ins first, then saved user projects."""
        out = [{"id": p["id"], "name": p["name"], "builtin": True,
                "created": None, "modified": None}
               for p in self.builtins.values()]
        for e in self._read_index():
            if e.get("id") in self.builtins:
                continue
            out.append({**e, "builtin": False})
        return out

    def load(self, project_id: str) -> Optional[Dict[str, Any]]:
        if project_id in self.builtins:
            return self.builtins[project_id]
        f = self.dir / f"{project_id}.json"
        if not f.is_file():
            return None
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def save(self, project: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
        """Persist a user project; returns the stored object. `now_iso` is the
        caller-supplied timestamp (this module avoids the clock)."""
        errs = validate(project)
        if errs:
            raise ValueError("; ".join(errs))
        pid = project.get("id") or slugify(project.get("name", ""))
        if pid in self.builtins:
            raise ValueError(f"'{pid}' is a built-in project and cannot be overwritten")

        self.dir.mkdir(parents=True, exist_ok=True)
        entries = self._read_index()
        existing = next((e for e in entries if e.get("id") == pid), None)
        created = existing.get("created") if existing else now_iso

        stored = {**project, "id": pid, "schema_version": SCHEMA_VERSION,
                  "builtin": False, "created": created, "modified": now_iso}
        (self.dir / f"{pid}.json").write_text(json.dumps(stored, indent=2), encoding="utf-8")

        entry = {"id": pid, "name": stored["name"], "file": f"{pid}.json",
                 "created": created, "modified": now_iso,
                 "schema_version": SCHEMA_VERSION}
        entries = [e for e in entries if e.get("id") != pid] + [entry]
        self._write_index(entries)
        return stored

    def delete(self, project_id: str) -> bool:
        if project_id in self.builtins:
            raise ValueError(f"'{project_id}' is a built-in project and cannot be deleted")
        f = self.dir / f"{project_id}.json"
        existed = f.is_file()
        if existed:
            f.unlink()
        self._write_index([e for e in self._read_index() if e.get("id") != project_id])
        return existed
