"""
cold_plate_v6/sweep_reporting.py
=================================
Exporters for v6 SweepResult objects.

V6 keeps the thermal-hydraulic candidate ranking, but it exports the
full-stack terms candidate-by-candidate so the current 28 x 15 mm footprint and
the physical 28 x 35 mm die-coverage footprint are visibly different.
"""

from __future__ import annotations

import csv
import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import List

from .master_constants import (
    TARGET_DP_PA_MAX,
    TARGET_RTH_JC_MAX,
    TARGET_WPUMP_W_MAX,
)
from .reporting import DEFAULT_OUTPUT_DIR
from .sweep import CandidateRecord, SweepResult


def kpi_flag(c: CandidateRecord) -> str:
    """Hydraulic / junction KPI compliance for one candidate.

    Returns "PASS" when the candidate clears all hard ceilings, otherwise
    "FAIL:<reasons>". The ΔP and pump ceilings were dormant on the 15 mm
    current core but can become active on enlarged die-coverage cores, so this
    flag must be visible in the ranking tables — a low-R_th candidate is not
    a valid pick if it breaches the pressure or pump budget.
    """
    r = c.result
    fails = []
    if r.dP_total_pa > TARGET_DP_PA_MAX:
        fails.append("dP")
    if r.W_pump_ideal_w > TARGET_WPUMP_W_MAX:
        fails.append("pump")
    if c.R_jc_kpw > TARGET_RTH_JC_MAX:
        fails.append("Rjc")
    return "PASS" if not fails else "FAIL:" + ",".join(fails)


CSV_HEADER = [
    "index", "manufacturable",
    "fin_count", "fin_thickness_mm", "gap_mm", "fin_height_mm",
    "core_width_mm", "core_length_mm", "coverage_ratio",
    "wave_amplitude_mm", "wavelength_mm", "wave_count",
    "pitch_mm", "D_h_um", "Re_Dh",
    "h_wpm2k", "eta_f", "eta_o", "UA_wpk",
    "R_th_conv_mKpW", "R_base_mKpW", "R_TIM_mKpW", "R_jc_mKpW",
    "dP_total_kPa", "W_pump_mW",
    "score_R_th", "score_JF", "score_composite",
    "pass_R_th", "pass_dP", "pass_V_dot", "pass_W_pump", "kpi_overall",
    "mfg_min_fin_thickness", "mfg_min_gap", "mfg_min_pitch",
    "mfg_max_fin_aspect", "mfg_amp_lambda_band", "mfg_max_fin_count",
]


def _candidate_row(c: CandidateRecord) -> list:
    g = c.geometry
    r = c.result
    mfg = c.manufacturability_detail
    return [
        c.index,
        c.manufacturable,
        g.fin_count,
        g.fin_thickness_m * 1e3,
        g.gap_m * 1e3,
        g.fin_height_m * 1e3,
        g.core_width_m * 1e3,
        g.core_length_m * 1e3,
        c.stack.coverage,
        g.wave_amplitude_m * 1e3,
        g.wavelength_m * 1e3,
        g.wave_count,
        g.pitch_m * 1e3,
        r.D_h_m * 1e6,
        r.Re_Dh,
        r.h_wpm2k,
        r.eta_f,
        r.eta_o,
        r.UA_wpk,
        r.R_th_conv_kpw * 1000.0,
        c.stack.R_base_kpw * 1000.0,
        c.stack.R_tim_kpw * 1000.0,
        c.R_jc_kpw * 1000.0,
        r.dP_total_pa / 1000.0,
        r.W_pump_ideal_w * 1000.0,
        c.score_R_th * 1000.0,
        c.score_JF,
        c.score_composite,
        r.pass_R_th,
        r.pass_dP,
        r.pass_V_dot,
        r.pass_W_pump,
        kpi_flag(c),
        mfg.get("min_fin_thickness", False),
        mfg.get("min_gap", False),
        mfg.get("min_pitch", False),
        mfg.get("max_fin_aspect", False),
        mfg.get("amp_lambda_band", False),
        mfg.get("max_fin_count", False),
    ]


def export_sweep_csv(result: SweepResult, path: Path) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        for c in result.all_records:
            writer.writerow(_candidate_row(c))


def export_sweep_json(result: SweepResult, path: Path) -> None:
    payload = {
        "operating": asdict(result.op),
        "architecture": asdict(result.arch),
        "rules": asdict(result.rules),
        "ranges": {
            "fin_thickness_m": list(result.ranges.fin_thickness_m),
            "gap_m": list(result.ranges.gap_m),
            "fin_height_m": list(result.ranges.fin_height_m),
            "wave_amplitude_m": list(result.ranges.wave_amplitude_m),
            "wavelength_m": list(result.ranges.wavelength_m),
            "core_width_m": result.ranges.core_width_m,
            "core_length_m": result.ranges.core_length_m,
            "side_margin_m": result.ranges.side_margin_m,
        },
        "baseline": {
            "geometry": asdict(result.baseline.geometry),
            "result": asdict(result.baseline.result),
            "stack": asdict(result.baseline.stack),
        },
        "candidates": [
            {
                "index": c.index,
                "manufacturable": c.manufacturable,
                "manufacturability": c.manufacturability_detail,
                "geometry": asdict(c.geometry),
                "result": asdict(c.result),
                "stack": asdict(c.stack),
                "score_R_th": c.score_R_th,
                "score_JF": c.score_JF,
                "score_composite": c.score_composite,
                "R_jc_kpw": c.R_jc_kpw,
            }
            for c in result.all_records
        ],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)


def _ranking_table(records: List[CandidateRecord], baseline: CandidateRecord) -> str:
    rows = [
        "| # | t (mm) | b (mm) | H (mm) | core (mm) | A (mm) | lambda (mm) | N_fin | R_conv (mK/W) | R_jc (mK/W) | coverage | dP (kPa) | eta_f | KPI |",
        "|--:|-------:|-------:|-------:|---:|-------:|-------:|-----:|------------:|------------:|---:|---------:|----:|---|",
    ]
    for rank, c in enumerate(records, start=1):
        g = c.geometry
        r = c.result
        rows.append(
            f"| {rank} | {g.fin_thickness_m*1e3:.2f} | {g.gap_m*1e3:.2f} | "
            f"{g.fin_height_m*1e3:.2f} | {g.core_width_m*1e3:.0f}x{g.core_length_m*1e3:.0f} | "
            f"{g.wave_amplitude_m*1e3:.2f} | {g.wavelength_m*1e3:.2f} | {g.fin_count} | "
            f"{r.R_th_conv_kpw*1000:.2f} | {c.R_jc_kpw*1000:.1f} | {c.stack.coverage:.2f} | "
            f"{r.dP_total_pa/1000:.2f} | {r.eta_f:.3f} | {kpi_flag(c)} |"
        )
    rows.append(
        f"| **PROTO1** | {baseline.geometry.fin_thickness_m*1e3:.2f} | "
        f"{baseline.geometry.gap_m*1e3:.2f} | {baseline.geometry.fin_height_m*1e3:.2f} | "
        f"{baseline.geometry.core_width_m*1e3:.0f}x{baseline.geometry.core_length_m*1e3:.0f} | "
        f"{baseline.geometry.wave_amplitude_m*1e3:.2f} | "
        f"{baseline.geometry.wavelength_m*1e3:.2f} | {baseline.geometry.fin_count} | "
        f"**{baseline.result.R_th_conv_kpw*1000:.2f}** | {baseline.R_jc_kpw*1000:.1f} | "
        f"{baseline.stack.coverage:.2f} | **{baseline.result.dP_total_pa/1000:.2f}** | "
        f"{baseline.result.eta_f:.3f} | {kpi_flag(baseline)} |"
    )
    return "\n".join(rows)


def render_sweep_md(result: SweepResult) -> str:
    lines = []
    p = lines.append

    p("# Cold Plate v6 - Prototype 2 design sweep")
    p("")
    p(f"*Generated {datetime.now().isoformat(timespec='seconds')}*")
    p("")
    p("## Operating point")
    p("")
    p(f"- V_dot = **{result.op.V_dot_LPM:.2f} LPM**, T_inlet = {result.op.T_inlet_C:.1f} C, Q_target = {result.op.Q_target_W:.0f} W")
    p(f"- Architecture = `{result.arch.name}` (L_path = {result.arch.path_length_m*1e3:.2f} mm x {result.arch.n_parallel_paths} paths)")
    p("")
    p("## Sweep size")
    p("")
    p(f"- Total candidates: **{len(result.all_records)}**")
    p(f"- Cooled footprint per candidate: **{result.ranges.core_width_m*1e3:.0f} x {result.ranges.core_length_m*1e3:.0f} mm**")
    p(f"- Pareto front size: **{len(result.pareto)}**")
    p(f"- Std-LPBF-manufacturable subset: **{len(result.manufacturable)}** ({100.0*len(result.manufacturable)/len(result.all_records):.1f} %)")
    p("")
    p("## PROTO1 baseline")
    p("")
    p(f"- R_th_conv = **{result.baseline.result.R_th_conv_kpw*1000:.2f} mK/W**")
    p(f"- R_jc = **{result.baseline.R_jc_kpw*1000:.1f} mK/W**")
    p(f"- Coverage ratio = **{result.baseline.stack.coverage:.2f}**")
    p(f"- dP_total = **{result.baseline.result.dP_total_pa/1000:.2f} kPa**")
    p("")
    p("## Top 15 by lowest R_th_conv")
    p("")
    p(_ranking_table(result.top_by_R_th, result.baseline))
    p("")
    p("## Top 15 by JF factor")
    p("")
    p(_ranking_table(result.top_by_JF, result.baseline))
    p("")
    p("## Top 15 by composite score")
    p("")
    p(_ranking_table(result.top_by_composite, result.baseline))
    p("")
    p("## Pareto front")
    p("")
    p(_ranking_table(result.pareto, result.baseline))
    p("")
    return "\n".join(lines)


def export_sweep_bundle(result: SweepResult,
                        out_dir: Path = DEFAULT_OUTPUT_DIR,
                        tag: str = "proto2_sweep") -> List[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = f"cold_plate_v6_{tag}_{stamp}"

    paths: List[Path] = []
    p_csv = out_dir / f"{prefix}.csv"
    export_sweep_csv(result, p_csv)
    paths.append(p_csv)

    p_md = out_dir / f"{prefix}.md"
    p_md.write_text(render_sweep_md(result), encoding="utf-8")
    paths.append(p_md)

    p_json = out_dir / f"{prefix}.json"
    export_sweep_json(result, p_json)
    paths.append(p_json)

    return paths
