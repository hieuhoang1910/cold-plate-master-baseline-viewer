"""
cold_plate_v6/reporting.py
===========================
Result exporters.

Four output files share a common timestamped prefix:

    cold_plate_v6_<tag>_<YYYYMMDD>_<HHMMSS>.txt   engineer eyeballing
    cold_plate_v6_<tag>_<YYYYMMDD>_<HHMMSS>.md    Obsidian / GitHub viewer
    cold_plate_v6_<tag>_<YYYYMMDD>_<HHMMSS>.csv   long-format analysis table
    cold_plate_v6_<tag>_<YYYYMMDD>_<HHMMSS>.json  machine-readable archive

`export_bundle()` writes all four in one call. Each render function is also
exposed for callers that want a string in memory (e.g. for unit tests).
"""

from __future__ import annotations

import csv
import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import List

from .architecture     import FlowArchitecture
from .geometry         import Geometry
from .master_constants import (
    TARGET_DP_PA_MAX,
    TARGET_RTH_KW_MAX,
    TARGET_VDOT_LPM_MIN,
    TARGET_WPUMP_W_MAX,
)
from .operating        import Operating
from .solver           import SolveResult


DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parents[2] / "04_Analysis_Outputs"


# ============================================================================
# Utilities
# ============================================================================

def _kpi(p: bool) -> str:
    return "PASS" if p else "FAIL"


# ============================================================================
# Plain-text renderer
# ============================================================================

def render_txt(result: SolveResult,
               geom: Geometry,
               op:   Operating,
               arch: FlowArchitecture) -> str:
    """Engineer-friendly plain-text dump with WHY trailers on key lines."""
    L: List[str] = []
    p = L.append

    p("=" * 72)
    p("Cold Plate v6 - Prototype 1 traceability solve")
    p(f"Generated: {datetime.now().isoformat(timespec='seconds')}")
    p("=" * 72)
    p("")
    p("Geometry inputs")
    p("-" * 72)
    p(f"  Label:           {result.geometry_label}")
    p(f"  Fin core W × L:  {geom.core_width_m*1e3:.1f} × {geom.core_length_m*1e3:.1f} mm")
    p(f"  Base thickness:  {geom.base_thickness_m*1e3:.2f} mm (post-CNC)")
    p(f"                   {geom.as_printed_base_m*1e3:.2f} mm as-printed (informational)")
    p(f"  Wave A / λ / N:  {geom.wave_amplitude_m*1e3:.2f} mm / "
      f"{geom.wavelength_m*1e3:.2f} mm / {geom.wave_count:.1f}")
    p(f"  Centre rib:      {'YES, width = '+str(geom.centre_rib_width_m*1e3)+' mm' if geom.has_centre_rib else 'no'}")
    p(f"  k_solid:         {geom.k_solid_wpmk:.0f} W/m·K")
    p(f"  ε/D_h:           {geom.relative_roughness:.3f}")
    p("")
    p("Architecture")
    p("-" * 72)
    p(f"  Name:            {arch.name}")
    p(f"  L_path (per side): {arch.path_length_m*1e3:.2f} mm")
    p(f"  N parallel paths:  {arch.n_parallel_paths}")
    p(f"  Flow uniformity:   {arch.flow_uniformity:.2f}")
    p(f"  Header K (total):  {arch.header_K_total:.2f}")
    p(f"  Jet slot W × L:    {arch.jet_slot_width_m*1e3:.1f} × {arch.jet_slot_length_m*1e3:.1f} mm")
    p(f"  Jet enhancement:   ×{arch.jet_imp_enhancement:.2f}")
    p("")
    p("Operating")
    p("-" * 72)
    p(f"  V_dot total:     {op.V_dot_LPM:.2f} LPM")
    p(f"  T_inlet:         {op.T_inlet_C:.1f} °C")
    p(f"  Q_target:        {op.Q_target_W:.0f} W")
    p(f"  Fluid eval T:    {result.fluid_T_eval_C:.2f} °C "
      f"(T_in + ½·caloric ΔT)")
    p("")
    p("Derived geometry")
    p("-" * 72)
    p(f"  Pitch                = {result.pitch_mm:.4f} mm")
    p(f"  Aspect α = b/H       = {result.aspect_ratio:.4f}")
    p(f"  D_h                  = {result.D_h_m*1e6:.1f} µm")
    p(f"  A_flow total         = {result.A_flow_total_m2*1e6:.2f} mm²  (full field)")
    p(f"  Arc length factor    = {result.arc_length_factor:.3f}")
    p(f"  L_arc per side       = {result.L_arc_m*1e3:.2f} mm")
    p(f"  A_total wetted       = {result.A_total_wetted_m2*1e4:.2f} cm²  (both sides combined)")
    if result.rib_area_loss_m2 > 0:
        p(f"  Rib area loss        = {result.rib_area_loss_m2*1e4:.2f} cm²  "
          f"({100.0*result.rib_area_loss_m2/(result.A_total_wetted_m2+result.rib_area_loss_m2):.1f}% of pre-rib area)")
    p("")
    p("Flow regime")
    p("-" * 72)
    p(f"  V_dot per path       = {result.V_dot_per_path_m3s*1e6:.2f} cm³/s")
    p(f"  v_channel            = {result.v_channel_mps:.4f} m/s")
    p(f"  v_jet (manifold slot)= {result.v_jet_mps:.3f} m/s")
    p(f"  Re_Dh                = {result.Re_Dh:.1f}")
    p(f"  Re_jet (slot W)      = {result.Re_jet:.1f}")
    p(f"  Regime               = {result.flow_regime}")
    p("")
    p("Heat transfer")
    p("-" * 72)
    p(f"  Nu (Shah-London H1)  = {result.Nu_FD_smooth:.3f}")
    p(f"  Wavy enhancement     = ×{result.wavy_enhancement:.3f}   (TD-12, SCREENING)")
    p(f"  Jet enhancement      = ×{result.jet_enhancement:.3f}")
    p(f"  Thermal-entry factor = ×{result.thermal_entry_factor:.3f}   "
      f"({'APPLIED' if result.thermal_entry_applied else 'available, FD bound used'}; F-3)")
    p(f"  Nu used              = {result.Nu_used:.3f}")
    p(f"  h                    = {result.h_wpm2k:.0f} W/m²·K")
    p(f"  m·H                  = {result.m_H_dimless:.3f}")
    p(f"  η_f (fin efficiency) = {result.eta_f:.3f}")
    p(f"  η_o (overall)        = {result.eta_o:.3f}")
    p(f"  UA                   = {result.UA_wpk:.2f} W/K")
    p(f"  R_th_conv            = {result.R_th_conv_kpw*1000:.3f} mK/W "
      f"({result.R_th_conv_kpw:.5f} K/W)")
    p("    WHY: Convective-only. Add TIM + heater block + contact stack "
      "(~0.03 K/W) for junction-to-coolant total.")
    p("")
    p("Pressure drop")
    p("-" * 72)
    p(f"  f·Re smooth (Shah-L) = {result.fRe_smooth:.2f}")
    p(f"  Roughness factor     = ×{result.roughness_factor:.3f}  (Norris-Webb, TD-05)")
    p(f"  f·Re effective       = {result.fRe_used:.2f}")
    p(f"  ΔP_friction          = {result.dP_friction_pa/1000:.3f} kPa")
    p(f"  ΔP_header (K = {arch.header_K_total:.1f}, ref v = {result.v_header_ref_mps:.3f} m/s) "
      f"= {result.dP_header_pa/1000:.3f} kPa  (TD-11, F-1: jet/port reference)")
    p(f"  ΔP_total             = {result.dP_total_pa/1000:.3f} kPa")
    p(f"  W_pump_ideal         = {result.W_pump_ideal_w*1000:.1f} mW")
    p("")
    p("NTU / effectiveness")
    p("-" * 72)
    p(f"  NTU                  = {result.NTU:.3f}")
    p(f"  Effectiveness        = {result.effectiveness:.3f}")
    p(f"  Q absorbed at ΔT=30 K, {op.V_dot_LPM:.2f} LPM = {result.Q_at_dT30_w:.0f} W")
    p(f"  Caloric ΔT @ Q_target = {result.caloric_dT_at_Qtarget_K:.2f} K")
    p("")
    p("KPI checks")
    p("-" * 72)
    p(f"  R_th_conv ≤ {TARGET_RTH_KW_MAX*1000:6.1f} mK/W  →  "
      f"{result.R_th_conv_kpw*1000:6.2f}  →  {_kpi(result.pass_R_th)}")
    p(f"  ΔP_total  ≤ {TARGET_DP_PA_MAX/1000:6.1f} kPa     →  "
      f"{result.dP_total_pa/1000:6.2f}  →  {_kpi(result.pass_dP)}")
    p(f"  V_dot     ≥ {TARGET_VDOT_LPM_MIN:6.1f} LPM       →  "
      f"{op.V_dot_LPM:6.2f}  →  {_kpi(result.pass_V_dot)}")
    p(f"  W_pump    ≤ {TARGET_WPUMP_W_MAX:6.1f} W           →  "
      f"{result.W_pump_ideal_w:6.3f}  →  {_kpi(result.pass_W_pump)}")
    p("")
    p("Warnings")
    p("-" * 72)
    if result.warnings:
        for w in result.warnings:
            p(f"  ! {w}")
    else:
        p("  (none)")
    p("")
    return "\n".join(L)


# ============================================================================
# Markdown renderer
# ============================================================================

def render_md(result: SolveResult,
              geom: Geometry,
              op:   Operating,
              arch: FlowArchitecture) -> str:
    """Markdown output suited to Obsidian / GitHub viewers."""
    md: List[str] = []
    p = md.append

    p("# Cold Plate v6 - PROTO1 traceability solve result")
    p("")
    p(f"*Generated {datetime.now().isoformat(timespec='seconds')}*")
    p("")
    p("## Inputs")
    p("")
    p("| Group | Field | Value |")
    p("|---|---|---|")
    p(f"| Geometry | label | {result.geometry_label} |")
    p(f"| Geometry | fin count / channel count | {geom.fin_count} / {geom.channel_count} |")
    p(f"| Geometry | fin core W × L | {geom.core_width_m*1e3:.1f} × {geom.core_length_m*1e3:.1f} mm |")
    p(f"| Geometry | base thickness (post-CNC) | {geom.base_thickness_m*1e3:.2f} mm |")
    p(f"| Geometry | wave A / λ / N | {geom.wave_amplitude_m*1e3:.2f} / {geom.wavelength_m*1e3:.2f} mm / {geom.wave_count:.1f} |")
    p(f"| Geometry | centre rib | {'yes ('+str(geom.centre_rib_width_m*1e3)+' mm)' if geom.has_centre_rib else 'no'} |")
    p(f"| Geometry | k_solid | {geom.k_solid_wpmk:.0f} W/m·K |")
    p(f"| Geometry | ε/D_h | {geom.relative_roughness:.3f} |")
    p(f"| Architecture | name | `{arch.name}` |")
    p(f"| Architecture | L_path per side | {arch.path_length_m*1e3:.2f} mm |")
    p(f"| Architecture | n_parallel_paths | {arch.n_parallel_paths} |")
    p(f"| Architecture | flow uniformity | {arch.flow_uniformity:.2f} |")
    p(f"| Architecture | header K total | {arch.header_K_total:.2f} |")
    p(f"| Architecture | jet enhancement | ×{arch.jet_imp_enhancement:.2f} |")
    p(f"| Operating | V_dot total | {op.V_dot_LPM:.2f} LPM |")
    p(f"| Operating | T_inlet | {op.T_inlet_C:.1f} °C |")
    p(f"| Operating | Q_target | {op.Q_target_W:.0f} W |")
    p("")
    p("## Results")
    p("")
    p("| Quantity | Value | Unit |")
    p("|---|---:|---|")
    p(f"| Fluid evaluation T | {result.fluid_T_eval_C:.2f} | °C |")
    p(f"| Hydraulic diameter D_h | {result.D_h_m*1e6:.1f} | µm |")
    p(f"| Aspect ratio b/H | {result.aspect_ratio:.4f} | – |")
    p(f"| Arc length factor | {result.arc_length_factor:.3f} | – |")
    p(f"| L_arc per side | {result.L_arc_m*1e3:.2f} | mm |")
    p(f"| Channel velocity | {result.v_channel_mps:.4f} | m/s |")
    p(f"| Jet velocity (slot) | {result.v_jet_mps:.3f} | m/s |")
    p(f"| Re_Dh | {result.Re_Dh:.1f} | – |")
    p(f"| Re_jet | {result.Re_jet:.0f} | – |")
    p(f"| Flow regime | {result.flow_regime} | – |")
    p(f"| Nu smooth (FD) | {result.Nu_FD_smooth:.3f} | – |")
    p(f"| Wavy enhancement | ×{result.wavy_enhancement:.3f} | – |")
    p(f"| Jet enhancement | ×{result.jet_enhancement:.3f} | – |")
    p(f"| Thermal-entry factor (available) | ×{result.thermal_entry_factor:.3f} | – |")
    p(f"| Thermal-entry applied | {'yes' if result.thermal_entry_applied else 'no (FD bound)'} | – |")
    p(f"| Nu used | {result.Nu_used:.3f} | – |")
    p(f"| h | {result.h_wpm2k:.0f} | W/m²·K |")
    p(f"| m·H | {result.m_H_dimless:.3f} | – |")
    p(f"| η_f | {result.eta_f:.3f} | – |")
    p(f"| η_o | {result.eta_o:.3f} | – |")
    p(f"| A_total wetted | {result.A_total_wetted_m2*1e4:.2f} | cm² |")
    p(f"| UA | {result.UA_wpk:.2f} | W/K |")
    p(f"| **R_th_conv** | **{result.R_th_conv_kpw*1000:.3f}** | **mK/W** |")
    p(f"| f·Re effective | {result.fRe_used:.2f} | – |")
    p(f"| Roughness factor | ×{result.roughness_factor:.3f} | – |")
    p(f"| ΔP_friction | {result.dP_friction_pa/1000:.3f} | kPa |")
    p(f"| ΔP_header (ref v={result.v_header_ref_mps:.3f} m/s) | {result.dP_header_pa/1000:.3f} | kPa |")
    p(f"| **ΔP_total** | **{result.dP_total_pa/1000:.3f}** | **kPa** |")
    p(f"| W_pump_ideal | {result.W_pump_ideal_w*1000:.1f} | mW |")
    p(f"| NTU | {result.NTU:.3f} | – |")
    p(f"| Effectiveness | {result.effectiveness:.3f} | – |")
    p(f"| Q at ΔT=30 K | {result.Q_at_dT30_w:.0f} | W |")
    p(f"| Caloric ΔT @ Q_target | {result.caloric_dT_at_Qtarget_K:.2f} | K |")
    p("")
    p("## KPI checks")
    p("")
    p("| KPI | Limit | Actual | Status |")
    p("|---|---:|---:|---|")
    p(f"| R_th_conv | ≤ {TARGET_RTH_KW_MAX*1000:.1f} mK/W | "
      f"{result.R_th_conv_kpw*1000:.2f} | **{_kpi(result.pass_R_th)}** |")
    p(f"| ΔP_total | ≤ {TARGET_DP_PA_MAX/1000:.1f} kPa | "
      f"{result.dP_total_pa/1000:.2f} | **{_kpi(result.pass_dP)}** |")
    p(f"| V_dot | ≥ {TARGET_VDOT_LPM_MIN:.1f} LPM | "
      f"{op.V_dot_LPM:.2f} | **{_kpi(result.pass_V_dot)}** |")
    p(f"| W_pump | ≤ {TARGET_WPUMP_W_MAX:.1f} W | "
      f"{result.W_pump_ideal_w*1000:.1f} mW | **{_kpi(result.pass_W_pump)}** |")
    p("")
    if result.warnings:
        p("## Warnings")
        p("")
        for w in result.warnings:
            p(f"- {w}")
        p("")
    return "\n".join(md)


# ============================================================================
# CSV / JSON / bundle exporters
# ============================================================================

UNITS_BY_KEY = {
    "V_dot_LPM": "LPM", "T_inlet_C": "C", "fluid_T_eval_C": "C",
    "pitch_mm": "mm", "aspect_ratio": "-",
    "D_h_m": "m", "A_flow_total_m2": "m^2",
    "L_arc_m": "m", "arc_length_factor": "-",
    "A_fin_sides_m2": "m^2", "A_base_unfinned_m2": "m^2",
    "A_total_wetted_m2": "m^2", "rib_area_loss_m2": "m^2",
    "V_dot_per_path_m3s": "m^3/s", "v_channel_mps": "m/s", "v_jet_mps": "m/s",
    "Re_Dh": "-", "Re_jet": "-",
    "Nu_FD_smooth": "-", "wavy_enhancement": "-", "jet_enhancement": "-",
    "thermal_entry_factor": "-", "thermal_entry_applied": "bool",
    "Nu_used": "-",
    "h_wpm2k": "W/m^2/K", "m_H_dimless": "-",
    "eta_f": "-", "eta_o": "-", "UA_wpk": "W/K",
    "R_th_conv_kpw": "K/W",
    "fRe_smooth": "-", "roughness_factor": "-", "fRe_used": "-",
    "dP_friction_pa": "Pa", "dP_header_pa": "Pa", "v_header_ref_mps": "m/s",
    "dP_total_pa": "Pa",
    "W_pump_ideal_w": "W",
    "NTU": "-", "effectiveness": "-",
    "Q_at_dT30_w": "W", "caloric_dT_at_Qtarget_K": "K",
    "pass_R_th": "bool", "pass_dP": "bool",
    "pass_V_dot": "bool", "pass_W_pump": "bool",
}
TEXT_KEYS = ("geometry_label", "architecture", "flow_regime")


def export_csv(result: SolveResult, path: Path) -> None:
    """Write a long-format CSV: one row per metric."""
    d = asdict(result)
    rows = [["metric", "value", "unit"]]
    for k, v in d.items():
        if k == "warnings":
            continue
        if k in TEXT_KEYS:
            rows.append([k, v, "label"])
            continue
        rows.append([k, v, UNITS_BY_KEY.get(k, "-")])
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


def export_json(result: SolveResult, path: Path) -> None:
    """Write the result as JSON (machine-readable archive)."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(asdict(result), f, indent=2, default=str)


def export_bundle(result: SolveResult,
                  geom: Geometry,
                  op:   Operating,
                  arch: FlowArchitecture,
                  out_dir: Path = DEFAULT_OUTPUT_DIR,
                  tag: str = "proto1") -> List[Path]:
    """Write .txt, .md, .csv, .json with a common timestamped prefix.

    Returns the list of paths written.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = f"cold_plate_v6_{tag}_{stamp}"

    paths: List[Path] = []

    p_txt = out_dir / f"{prefix}.txt"
    p_txt.write_text(render_txt(result, geom, op, arch), encoding="utf-8")
    paths.append(p_txt)

    p_md  = out_dir / f"{prefix}.md"
    p_md.write_text(render_md(result, geom, op, arch), encoding="utf-8")
    paths.append(p_md)

    p_csv = out_dir / f"{prefix}.csv"
    export_csv(result, p_csv)
    paths.append(p_csv)

    p_json = out_dir / f"{prefix}.json"
    export_json(result, p_json)
    paths.append(p_json)

    return paths
