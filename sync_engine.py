"""
07_WebApp/sync_engine.py
========================
Refresh the vendored engine/ snapshot from the validated source-of-truth code
in the parent Cold Plate project.

The webapp is a standalone git repo (only 07_WebApp is on GitHub), so it carries
a *copy* of the validated solvers under engine/ to stay self-contained and
hostable. This script re-copies them from the parent project. Run it ONLY inside
the full Vinnotek "Hieu - cold plate" folder, whenever the source physics changes:

    python sync_engine.py

Then run `python test_api_parity.py` — parity against the golden results is the
gate that proves the snapshot still matches the source.

If the parent project is not found (e.g. a fresh standalone clone), the script
exits without touching anything.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # 07_WebApp
PROJECT = HERE.parent                           # Cold Plate project root (if present)

# (source relative to the project root) -> (destination under engine/)
V6_SRC = PROJECT / "02_Code" / "cold_plate_v6"

# WEBAPP-NATIVE modules — authored and maintained here in engine/, NOT synced
# from the parent project, so a sync never reverts them. Keeping the webapp
# self-contained is the point:
#   * coolants.py, targets.py, projects.py, pin_fin.py  (V2 Design Studio)
#   * master_baseline_calculator.py  — FORKED at V2.3 to dispatch the pin_fin
#     family to pin_fin.py; the parent copy no longer flows in.
DATA_SRCS = {
    "master_design_parameters.json": PROJECT / "06_MASTER_BASELINE" / "master_design_parameters.json",
    "master_baseline_results.json": PROJECT / "06_MASTER_BASELINE" / "outputs" / "master_baseline_results.json",
    "baseline_cases.json": PROJECT / "06_MASTER_BASELINE" / "python" / "baseline_cases.json",
}

# cold_plate_v6 modules that are part of the import chain used by the API.
# (Standalone scripts — main, sweep_main, figures, webapp, sensitivity — are
# intentionally NOT vendored.)
V6_KEEP = {
    "__init__.py", "architecture.py", "correlations.py", "fluids.py",
    "geometry.py", "master_constants.py", "operating.py", "reporting.py",
    "solver.py", "sweep.py", "sweep_reporting.py", "system_resistance.py",
}


def main() -> int:
    if not V6_SRC.exists():
        print("Source project not found next to this repo — nothing to sync.")
        print(f"  expected: {V6_SRC}")
        return 1

    engine = HERE / "engine"
    v6_dst = engine / "cold_plate_v6"
    data_dst = engine / "data"
    v6_dst.mkdir(parents=True, exist_ok=True)
    data_dst.mkdir(parents=True, exist_ok=True)

    n = 0
    for name in sorted(V6_KEEP):
        src = V6_SRC / name
        if src.exists():
            shutil.copy2(src, v6_dst / name)
            n += 1
        else:
            print(f"  WARNING: expected module missing in source: {name}")
    # master_baseline_calculator.py is a webapp-native fork (see note above) —
    # intentionally not synced.
    for name, src in DATA_SRCS.items():
        shutil.copy2(src, data_dst / name)
        n += 1

    print(f"Synced {n} files into engine/ from {PROJECT.name}.")
    print("Now run: python test_api_parity.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
