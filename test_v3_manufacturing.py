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

    # --- V3.3a verdicts (spec §36 acceptance; rev 2026-07-30 = official
    # Incus_Design_Guidelines.pdf px bounds + the 2026-07-29 px review) -------
    check("hero 0.10 -> FAIL", by_id["v6_reference_wavy_fin_0p10"]["manufacturability"]["verdict"] == "FAIL")
    check("M1 -> FAIL (gap ~5 px < 6 px deep-channel floor)",
          by_id["v6_lmm_M1_primary"]["manufacturability"]["verdict"] == "FAIL")
    check("M2 -> FAIL (hero wave pinch; was MARGINAL on nominal widths)",
          by_id["v6_lmm_M2_backup"]["manufacturability"]["verdict"] == "FAIL")
    # rev 2026-07-31 — the wave-slope pinch (gap_perp): the hero wave
    # (A 0.55/λ 2.5, 54°) pinches the perpendicular passage to ~2 px at the
    # steep sections regardless of nominal widths, so every hero-wave preset
    # honestly FAILs; the wave-safe presets M4b/M2b carry a tamed wave.
    check("M3 -> FAIL (hero wave pinch)",
          by_id["v6_lmm_M3_easyclean"]["manufacturability"]["verdict"] == "FAIL")
    check("M4 -> FAIL (hero wave pinch)",
          by_id["v6_lmm_M4_guideline"]["manufacturability"]["verdict"] == "FAIL")
    m4_rules = {c["rule"]: c for c in by_id["v6_lmm_M4_guideline"]["manufacturability"]["checks"]}
    check("M4 gap_perp FAIL cites the slope",
          m4_rules["gap_perp"]["status"] == "FAIL" and "cos" in m4_rules["gap_perp"]["message"],
          str(m4_rules.get("gap_perp")))
    check("M4b -> PASS (wave-safe target)",
          by_id["v6_lmm_M4b_wavesafe"]["manufacturability"]["verdict"] == "PASS")
    m4b_rules = {c["rule"]: c["status"] for c in
                 by_id["v6_lmm_M4b_wavesafe"]["manufacturability"]["checks"]}
    check("M4b passes gap_perp", m4b_rules.get("gap_perp") == "PASS", str(m4b_rules))
    check("M2b -> MARGINAL (7 px gap, wave-safe)",
          by_id["v6_lmm_M2b_wavesafe"]["manufacturability"]["verdict"] == "MARGINAL")
    m2b_rules = {c["rule"]: c["status"] for c in
                 by_id["v6_lmm_M2b_wavesafe"]["manufacturability"]["checks"]}
    check("M2b passes gap_perp", m2b_rules.get("gap_perp") == "PASS", str(m2b_rules))
    check("M2b beats M4b thermally (tighter pitch)",
          by_id["v6_lmm_M2b_wavesafe"]["R_jc_K_W"] < by_id["v6_lmm_M4b_wavesafe"]["R_jc_K_W"])
    # Prototype 1 lineage anchor (SW01.02 sinter-weld, green-scale-corrected
    # mesh measurement). On paper it is the strongest R_jc in the catalog —
    # and it FAILs gap_perp (perp ≈ 0 px at its 60° wave). The honest claim
    # is therefore: M4b is the best RULE-PASSING design, not the best paper
    # design; Proto 1's thermal edge rides on passages Incus now rejects.
    check("Proto1 reference present", "proto1_reference" in by_id)
    check("Proto1 -> FAIL (60° wave, gap_perp ~0 px)",
          by_id["proto1_reference"]["manufacturability"]["verdict"] == "FAIL")
    check("Proto1 beats M4b on paper (tight gap + steep wave)",
          by_id["proto1_reference"]["R_jc_K_W"] < by_id["v6_lmm_M4b_wavesafe"]["R_jc_K_W"])
    passing = [c for c in cat["candidates"]
               if c.get("manufacturability", {}).get("verdict") == "PASS"
               and c.get("family") in ("wavy_fin", "straight_fin")]
    check("M4b is the best rule-PASSING fin design",
          bool(passing) and min(passing, key=lambda c: c["R_jc_K_W"])["design_id"] == "v6_lmm_M4b_wavesafe",
          str([(c["design_id"], round(c["R_jc_K_W"] * 1000, 2)) for c in passing]))
    check("M4 beats M3 thermally, costs vs M2",
          by_id["v6_lmm_M2_backup"]["R_jc_K_W"] < by_id["v6_lmm_M4_guideline"]["R_jc_K_W"]
          < by_id["v6_lmm_M3_easyclean"]["R_jc_K_W"])
    hero_rules = {c["rule"]: c["status"] for c in
                  by_id["v6_reference_wavy_fin_0p10"]["manufacturability"]["checks"]}
    check("hero fails gap_min", hero_rules.get("gap_min") == "FAIL", str(hero_rules))
    # rev 2026-07-30: fin bounds are green-px based — hero t 0.10 final is
    # 3.4 px green, above the 3 px printable floor but under the 4 px rec.
    check("hero wall_min MARGINAL (3.4 px green)",
          hero_rules.get("wall_min") == "MARGINAL", str(hero_rules))

    # --- 2026-07-30 guideline revision: gap_ratio + depth band + advisories --
    m1_rules = {c["rule"]: c for c in by_id["v6_lmm_M1_primary"]["manufacturability"]["checks"]}
    check("M1 gap_min FAIL cites the deep-channel band",
          m1_rules["gap_min"]["status"] == "FAIL" and "deep-channel" in m1_rules["gap_min"]["message"],
          str(m1_rules.get("gap_min")))
    check("M1 passes gap_ratio (b 0.15 > t 0.12)", m1_rules["gap_ratio"]["status"] == "PASS")
    check("tall-fin advisory present (H 5.5 mm >> 1 mm tested)",
          m1_rules.get("fin_height", {}).get("status") == "INFO")
    ratio_case = server.evaluate_payload({"case": {
        "family": "wavy_fin", "process_route": "LMM", "fin_thickness_mm": 0.30,
        "channel_gap_mm": 0.25, "fin_height_mm": 5.5,
        "wave_amplitude_mm": 0.55, "wavelength_mm": 2.5}})
    rr = {c["rule"]: c["status"] for c in ratio_case["manufacturability"]["checks"]}
    check("fins wider than gaps -> gap_ratio MARGINAL", rr.get("gap_ratio") == "MARGINAL", str(rr))
    lmm = manufacturing.ROUTES["LMM"]
    check("LMM bounds derive from green px (/1.197)",
          abs(lmm["wall_abs"] - 0.0877) < 1e-4 and abs(lmm["wall_rec"] - 0.1170) < 1e-4
          and abs(lmm["gap_abs"] - 0.1754) < 1e-4 and abs(lmm["gap_rec"] - 0.2339) < 1e-4,
          str(lmm))

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
