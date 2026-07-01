"""
07_WebApp/test_api_parity.py
============================
Phase 1 acceptance test: the API must reproduce the 5 golden master-baseline
results exactly.

It drives the *same* code path the HTTP handler uses (server.evaluate_payload)
on every case in baseline_cases.json and diffs the output against the committed
outputs/master_baseline_results.json. Because the API wraps the validated
Python directly, parity should be to machine precision; the tolerance guards
against import-path or wiring regressions.

Run:

    python 07_WebApp/test_api_parity.py

Exit code 0 = all cases match. Non-zero = drift (details printed).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402  (adds the source trees to sys.path on import)

ROOT = Path(__file__).resolve().parent
CASES_JSON = ROOT / "engine" / "data" / "baseline_cases.json"
GOLDEN_JSON = ROOT / "engine" / "data" / "master_baseline_results.json"

REL_TOL = 1e-9
ABS_TOL = 1e-12


def _close(a, b) -> bool:
    if a is None or b is None:
        return a is b or a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= max(ABS_TOL, REL_TOL * max(abs(a), abs(b)))
    return a == b


def main() -> int:
    cfg = json.loads(CASES_JSON.read_text(encoding="utf-8"))
    golden = {row["design_id"]: row
              for row in json.loads(GOLDEN_JSON.read_text(encoding="utf-8"))}

    basis = {
        "stack": cfg.get("stack"),
        "operating": cfg.get("operating"),
        "architecture": cfg.get("architecture"),
    }

    total_fail = 0
    for case in cfg["cases"]:
        design_id = case["design_id"]
        result = server.evaluate_payload({"case": case, **basis})
        want = golden.get(design_id)
        if want is None:
            print(f"[FAIL] {design_id}: no golden row to compare")
            total_fail += 1
            continue

        mismatches = []
        for key, gval in want.items():
            if key not in result:
                mismatches.append(f"{key}: missing in API output")
                continue
            if not _close(result[key], gval):
                mismatches.append(f"{key}: api={result[key]!r} golden={gval!r}")

        if mismatches:
            total_fail += 1
            print(f"[FAIL] {design_id}: {len(mismatches)} mismatch(es)")
            for m in mismatches[:12]:
                print(f"         - {m}")
        else:
            print(f"[PASS] {design_id}  R_jc={result['R_jc_K_W']:.6g} K/W  "
                  f"status={result['kpi_status']}")

    n = len(cfg["cases"])
    print("-" * 60)
    if total_fail == 0:
        print(f"OK: all {n} golden cases reproduced within tol "
              f"(rel {REL_TOL:g}).")
        return 0
    print(f"FAILED: {total_fail}/{n} cases drifted.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
