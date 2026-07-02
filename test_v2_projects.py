"""
07_WebApp/test_v2_projects.py
=============================
V2.2 acceptance tests: project store + resolver + catalog rescoring.

Contract that must hold: the built-in GB202 project reproduces the V1 catalog
view EXACTLY (same candidates, same gates), while a user project with a
different coolant / target rescoring the same candidates against its own gate.

Run:
    python 07_WebApp/test_v2_projects.py
Exit 0 = all pass.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  (puts engine/ on sys.path, defines GB202_PROJECT + STORE)
import projects  # noqa: E402

_fails = 0
_passes = 0


def check(cond: bool, msg: str) -> None:
    global _fails, _passes
    if cond:
        _passes += 1
        print(f"  [PASS] {msg}")
    else:
        _fails += 1
        print(f"  [FAIL] {msg}")


def approx(a, b, rel=1e-9, abs_=1e-12) -> bool:
    if a is None or b is None:
        return a is b or a == b
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))


# --------------------------------------------------------------------------
print("resolve_project — GB202 built-in resolves to the die-coverage basis")
r = projects.resolve_project(server.GB202_PROJECT)
check(r["stack"] == {k: server.DIE_COVERAGE_STACK[k] for k in r["stack"]},
      "GB202 stack matches DIE_COVERAGE_STACK")
check(approx(r["operating"]["rho_kg_m3"], 997.0) and approx(r["operating"]["k_fluid_W_mK"], 0.60)
      and approx(r["operating"]["cp_J_kgK"], 4181.0) and approx(r["operating"]["mu_Pa_s"], 0.00089),
      "GB202 water props == master defaults")
check(approx(r["gates"]["limit_R_jc_K_W"], 0.078)
      and approx(r["gates"]["limit_deltaP_Pa"], 50000.0)
      and approx(r["gates"]["limit_pump_W"], 5.0),
      "GB202 gates pinned to historical 0.078 / 50k / 5 W")
check(r["architecture"].get("path_length_mm") == 14.0
      and r["architecture"].get("n_parallel_paths") == 2,
      "GB202 architecture == die-coverage arch")

# --------------------------------------------------------------------------
print("catalog rescoring — GB202 project reproduces the V1 GET /api/catalog view")
v1 = server.catalog_payload()
proj_cat = server.project_catalog_payload({"project": "gb202-gpu"})
v1_by_id = {c["design_id"]: c for c in v1["candidates"]}
mismatches = []
for c in proj_cat["candidates"]:
    w = v1_by_id.get(c["design_id"])
    if w is None or not approx(c["R_jc_K_W"], w["R_jc_K_W"]) or c["kpi_status"] != w["kpi_status"]:
        mismatches.append(c["design_id"])
check(not mismatches, f"every candidate identical to V1 (mismatches: {mismatches})")
check(approx(proj_cat["gates"]["limit_R_jc_K_W"], v1["gates"]["limit_R_jc_K_W"]),
      "GB202 project gate == V1 catalog gate")
check(proj_cat.get("project", {}).get("id") == "gb202-gpu" and "coolant" in proj_cat,
      "project catalog carries project + coolant metadata")

# --------------------------------------------------------------------------
print("catalog rescoring — a stricter/glycol project rescoring the SAME candidates")
strict = {
    "id": "strict-test", "name": "Strict test", "problem": {
        **server.DIE_COVERAGE_STACK, "coolant": "pg50"},
    "operating": {"heat_load_W": 450.0, "flow_lpm": 2.65, "T_inlet_C": 25.0},
    "targets": {"R_jc_gate_override": 0.010},   # near-impossible gate
    "architecture": dict(server.DIE_COVERAGE_ARCH),
}
sc = server.project_catalog_payload({"project": strict})
check(approx(sc["gates"]["limit_R_jc_K_W"], 0.010), "strict project uses its 0.010 gate")
any_fail = any("FAIL" in c["kpi_status"] for c in sc["candidates"])
check(any_fail, "impossible gate flips candidates to FAIL")
# pg50 has lower k than water -> candidate R_jc must differ from the water view
moved = any(not approx(c["R_jc_K_W"], v1_by_id[c["design_id"]]["R_jc_K_W"])
            for c in sc["candidates"] if c["design_id"] in v1_by_id)
check(moved, "pg50 coolant changes the computed R_jc vs water")

# --------------------------------------------------------------------------
print("store — list / save / load / delete roundtrip (temp dir)")
tmp = Path(tempfile.mkdtemp(prefix="cp_projects_"))
store = projects.ProjectStore(tmp, builtins=[server.GB202_PROJECT])
check(any(p["id"] == "gb202-gpu" and p["builtin"] for p in store.list()),
      "list() includes the GB202 built-in")
saved = store.save({"name": "My ASIC 300W", "problem": {
    "die_width_mm": 20, "die_length_mm": 20, "core_width_mm": 30, "core_length_mm": 30,
    "core_height_mm": 5, "base_thickness_mm": 0.7, "k_solid_W_mK": 340, "tim_areal_Kcm2_W": 0.05,
    "coolant": "water"},
    "operating": {"heat_load_W": 300.0, "flow_lpm": 2.0, "T_inlet_C": 25.0},
    "targets": {"T_j_max_C": 90.0}}, now_iso="2026-07-02T00:00:00+00:00")
check(saved["id"] == "my-asic-300w" and saved["created"] == "2026-07-02T00:00:00+00:00",
      f"save() slugifies id + stamps created (id={saved['id']})")
check(store.load("my-asic-300w") is not None
      and any(p["id"] == "my-asic-300w" for p in store.list()),
      "saved project loads + appears in list")
check((tmp / "index.json").is_file(), "index.json written")
try:
    store.save({**server.GB202_PROJECT}, now_iso="x")
    check(False, "overwriting a built-in should raise")
except ValueError:
    check(True, "cannot overwrite a built-in project")
check(store.delete("my-asic-300w") and store.load("my-asic-300w") is None,
      "delete() removes the project")

# --------------------------------------------------------------------------
print("validate — catches bad problems")
errs = projects.validate({"name": "bad", "problem": {
    "die_width_mm": 40, "die_length_mm": 40, "core_width_mm": 10, "core_length_mm": 10},
    "operating": {"T_inlet_C": 25}, "targets": {"T_j_max_C": 90}})
check(any("coverage" in e for e in errs), "coverage < 1 flagged")
errs2 = projects.validate({"name": "hot", "problem": {"coolant": "water"},
    "operating": {"T_inlet_C": 25}, "targets": {"T_j_max_C": 20}})
check(any("inlet" in e or "budget" in e for e in errs2), "T_j <= inlet flagged")

# --------------------------------------------------------------------------
print("designs-as-candidates — saved designs appear as named, evaluated candidates")
proj_with_designs = {
    "id": "dz-test", "name": "Designs test",
    "problem": {**server.DIE_COVERAGE_STACK, "coolant": "water"},
    "operating": {"heat_load_W": 450.0, "flow_lpm": 2.65, "T_inlet_C": 25.0},
    "targets": {"R_jc_gate_override": 0.078},
    "architecture": dict(server.DIE_COVERAGE_ARCH),
    "designs": [
        {"name": "My wavy A", "design": {"family": "wavy_fin", "process_route": "LMM",
            "fin_thickness_mm": 0.1, "channel_gap_mm": 0.1, "fin_height_mm": 5.5,
            "side_margin_mm": 0.9, "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5, "flow_lpm": 2.65}},
        {"name": "Pin idea", "design": {"family": "gyroid_tpms", "tpms_type": "pin_fins",
            "process_route": "LMM", "pin_diameter_mm": 0.8, "pin_pitch_mm": 1.4,
            "pin_pattern": "staggered", "fin_height_mm": 5.5, "flow_lpm": 2.65}},
    ],
}
dc = server.project_catalog_payload({"project": proj_with_designs})
saved = [c for c in dc["candidates"] if c.get("saved")]
check(len(dc["candidates"]) == 7 and len(saved) == 2,
      f"5 baseline + 2 saved = 7 candidates (got {len(dc['candidates'])}, {len(saved)} saved)")
check(all(c.get("name") for c in saved), "saved candidates carry their name")
pin_c = next((c for c in saved if c["name"] == "Pin idea"), None)
check(pin_c is not None and pin_c["family"] == "pin_fin" and "SCREENING" not in pin_c["kpi_status"],
      "pin design evaluated via the pin_fin solver (mapped from the gyroid sub-type)")
# the viewer/slider case keeps the ORIGINAL shape so the 3-D view + tuning work
pin_case = next((x for x in dc["cases"] if x.get("design_id") == "saved_pin-idea"), None)
check(pin_case is not None and pin_case.get("family") == "gyroid_tpms"
      and pin_case.get("tpms_type") == "pin_fins",
      "saved case keeps gyroid_tpms+pin_fins so the viewer renders + sliders seed")
# empty / absent designs must not change the 5-candidate baseline
check(len(server.project_catalog_payload({"project": "gb202-gpu"})["candidates"]) == 5,
      "a project with no designs still yields exactly the 5 baseline candidates")

# --------------------------------------------------------------------------
print("-" * 60)
if _fails == 0:
    print(f"OK: {_passes} checks passed.")
    sys.exit(0)
print(f"FAILED: {_fails} check(s) failed, {_passes} passed.")
sys.exit(1)
