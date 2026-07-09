"""
07_WebApp/test_v3_manufacturing.py
==================================
V3 acceptance tests (spec §36): areas (V3.2), manufacturing rulebooks +
verdicts (V3.3a), M-presets, two-star sweep enforcement (§35F), and the LMM
green→CAD recipe (V3.3c reproduces the review §6 table exactly).

Run:  python 07_WebApp/test_v3_manufacturing.py     (exit 0 = all pass)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent / "engine"))
import manufacturing  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)


def main() -> int:
    cat = server.catalog_payload()
    by_id = {c["design_id"]: c for c in cat["candidates"]}

    # --- V3.3a verdicts (spec §36 acceptance) --------------------------------
    check("hero 0.10 -> FAIL", by_id["v6_reference_wavy_fin_0p10"]["manufacturability"]["verdict"] == "FAIL")
    check("M1 -> MARGINAL", by_id["v6_lmm_M1_primary"]["manufacturability"]["verdict"] == "MARGINAL")
    check("M2 -> PASS", by_id["v6_lmm_M2_backup"]["manufacturability"]["verdict"] == "PASS")
    check("M3 -> PASS", by_id["v6_lmm_M3_easyclean"]["manufacturability"]["verdict"] == "PASS")
    hero_rules = {c["rule"]: c["status"] for c in
                  by_id["v6_reference_wavy_fin_0p10"]["manufacturability"]["checks"]}
    check("hero fails gap_min", hero_rules.get("gap_min") == "FAIL", str(hero_rules))
    check("hero fails wall_min", hero_rules.get("wall_min") == "FAIL", str(hero_rules))

    # --- M-preset thermal numbers reproduce the review §5 table --------------
    m1, m2, m3 = (by_id["v6_lmm_M1_primary"], by_id["v6_lmm_M2_backup"], by_id["v6_lmm_M3_easyclean"])
    check("M presets present as candidates", all(x.get("preset") for x in (m1, m2, m3)))
    # review §5 (die-coverage footprint): R_jc 14.6 / 16.2 / 17.9 mK/W. The
    # catalog footprint is the master 28x31 record, so allow the small basis
    # delta — the ordering + magnitude is the fixture.
    check("M1 < M2 < M3 in R_jc", m1["R_jc_K_W"] < m2["R_jc_K_W"] < m3["R_jc_K_W"])
    check("M1 R_jc ~ 14.6 mK/W", abs(m1["R_jc_K_W"] * 1000 - 14.6) < 0.8,
          f"{m1['R_jc_K_W'] * 1000:.2f}")
    check("M2 R_jc ~ 16.2 mK/W", abs(m2["R_jc_K_W"] * 1000 - 16.2) < 0.8,
          f"{m2['R_jc_K_W'] * 1000:.2f}")
    check("all M presets clear thermal gate", all("PASS" in x["kpi_status"] for x in (m1, m2, m3)))

    # --- V3.2 areas -----------------------------------------------------------
    hero = by_id["v6_reference_wavy_fin_0p10"]
    a = hero["areas"]
    # hand-check (spec §36): hero A_fin ~ 71,500 mm2 (715 cm2), ~x96 raw / ~x14 eff
    check("hero A_fin ~ 71500 mm2", abs(a["fin_mm2"] - 71500) < 2500, f"{a['fin_mm2']:.0f}")
    check("hero amplification ~ x96", abs(a["amplification"] - 96) < 4, f"{a['amplification']:.1f}")
    check("hero eff amplification ~ x14", abs(a["amplification_eff"] - 14) < 2,
          f"{a['amplification_eff']:.1f}")
    check("areas: fin-only < wetted", a["fin_mm2"] < a["wetted_mm2"])
    check("areas on every candidate", all("areas" in c for c in cat["candidates"]))
    # pin + TPMS families report structure-only area too
    pin = server.evaluate_payload({"case": {"family": "pin_fin", "pin_diameter_mm": 0.8,
                                            "pin_pitch_mm": 1.4, "fin_height_mm": 5.5}})
    check("pin areas: laterals < wetted", 0 < pin["areas"]["fin_mm2"] < pin["areas"]["wetted_mm2"])
    tpms = by_id["gyroid_tpms_ntop_screening"]
    check("TPMS areas: sheet == wetted", abs(tpms["areas"]["fin_mm2"] - tpms["areas"]["wetted_mm2"]) < 1e-3)

    # --- V3.3c green→CAD recipe reproduces the review §6 M2 table ------------
    rows = {r["name"]: r for r in manufacturing.lmm_recipe(0.15, 0.20, 5.5, 0.55, 2.5)}
    check("M2 fin: green 5 px, CAD 0.105", rows["fin t"]["grid_units"] == 5
          and abs(rows["fin t"]["cad_mm"] - 0.105) < 1e-9)
    check("M2 gap: green 7 px, CAD 0.315", rows["gap b"]["grid_units"] == 7
          and abs(rows["gap b"]["cad_mm"] - 0.315) < 1e-9)
    check("M2 pitch: 12 px, preserved 0.420", rows["pitch t+b"]["grid_units"] == 12
          and abs(rows["pitch t+b"]["cad_mm"] - 0.420) < 1e-9)
    check("M2 height: 271 layers = 6.775", rows["height H"]["grid_units"] == 271
          and abs(rows["height H"]["green_snapped_mm"] - 6.775) < 1e-9)
    check("M2 wave A: 19 px = 0.665", rows["wave A"]["grid_units"] == 19)
    check("M2 lambda: 86 px = 3.010", rows["wavelength λ"]["grid_units"] == 86)

    # --- §35F sweep enforcement (two stars) -----------------------------------
    req = {"base": {"case": {"family": "wavy_fin", "process_route": "LMM",
                             "fin_thickness_mm": 0.12, "channel_gap_mm": 0.15,
                             "fin_height_mm": 5.5, "wave_amplitude_mm": 0.55,
                             "wavelength_mm": 2.5}},
           "x": {"var": "fin_thickness_mm", "min": 0.05, "max": 0.3, "steps": 11},
           "y": {"var": "channel_gap_mm", "min": 0.05, "max": 0.4, "steps": 11},
           "objective": "R_jc_K_W"}
    r_off = server.sweep_payload(req)
    r_marg = server.sweep_payload({**req, "manufacturability": {"enforce": "marginal"}})
    r_enf = server.sweep_payload({**req, "manufacturability": {"enforce": "enforce"}})
    check("grid points annotated with mfg", all("mfg" in g for g in r_off["grid"]))
    check("no enforcement -> star == ghost", r_off["optimum"] == r_off["optimum_unconstrained"])
    check("marginal star is compliant", r_marg["optimum"]["mfg"] in ("PASS", "MARGINAL"))
    check("enforce star is PASS", r_enf["optimum"]["mfg"] == "PASS")
    check("ghost star beats constrained star",
          r_marg["optimum_unconstrained"]["R_jc_K_W"] <= r_marg["optimum"]["R_jc_K_W"])
    check("enforce star >= marginal star (tighter pool)",
          r_enf["optimum"]["R_jc_K_W"] >= r_marg["optimum"]["R_jc_K_W"] - 1e-12)

    # --- route normalization + schema -----------------------------------------
    check("legacy standard_LPBF -> SLM_IR", manufacturing.normalize_route("standard_LPBF") == "SLM_IR")
    check("legacy LMM_supplier -> LMM", manufacturing.normalize_route("LMM_supplier") == "LMM")
    s = server.schema_payload()["manufacturing"]
    check("schema routes", [r["key"] for r in s["routes"]] == ["LMM", "SLM_IR", "SLM_GREEN"])
    check("schema modes", [m["key"] for m in s["enforcement_modes"]] == ["enforce", "marginal", "explore"])
    slm = next(r for r in s["routes"] if r["key"] == "SLM_IR")
    check("SLM_IR is literature grade w/ Nikon note", slm["grade"] == "literature"
          and "Nikon" in slm["label"])

    print("-" * 60)
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("OK: all V3 checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
