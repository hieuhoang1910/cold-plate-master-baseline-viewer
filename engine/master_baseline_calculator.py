"""Geometry-family-neutral first-pass cold-plate baseline calculator.

The model is intentionally conservative and dependency-free. It is used before
nTop work to compare candidate families on the same terms:

    coverage, open volume, raw SA/V, effective SA/V, R_th_conv,
    R_base, R_TIM, R_jc, pressure drop, pump power.

It does not replace CFD/CHT or supplier coupon testing.

WEBAPP-NATIVE FORK (V2.3): this engine/ copy has diverged from the parent
06_MASTER_BASELINE source — it dispatches the pin_fin family to the S1 solver
(pin_fin.py). It is therefore excluded from sync_engine.py so a sync never
reverts the fork. Keep the webapp self-contained (see sync_engine.py notes).
"""

from __future__ import annotations

import csv
import json
import math
import argparse
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pin_fin  # V2.3 S1 pin-fin solver (webapp-native, co-located in engine/)


@dataclass
class OperatingPoint:
    heat_load_W: float = 450.0
    margin_heat_load_W: float = 575.0
    flow_lpm: float = 2.65
    T_inlet_C: float = 25.0
    rho_kg_m3: float = 997.0
    mu_Pa_s: float = 0.00089
    k_fluid_W_mK: float = 0.60
    cp_J_kgK: float = 4181.0
    limit_R_jc_K_W: float = 0.078
    limit_deltaP_Pa: float = 50_000.0
    limit_pump_W: float = 5.0

    @property
    def flow_m3_s(self) -> float:
        return self.flow_lpm / 1000.0 / 60.0

    @property
    def mass_flow_kg_s(self) -> float:
        return self.flow_m3_s * self.rho_kg_m3

    def caloric_deltaT_K(self, heat_W: Optional[float] = None) -> float:
        q = self.heat_load_W if heat_W is None else heat_W
        mcp = self.mass_flow_kg_s * self.cp_J_kgK
        return q / mcp if mcp > 0 else float("inf")


@dataclass
class StackBasis:
    die_width_mm: float = 24.0
    die_length_mm: float = 31.0
    core_width_mm: float = 28.0
    core_length_mm: float = 31.0
    core_height_mm: float = 5.5
    base_thickness_mm: float = 0.70
    k_solid_W_mK: float = 340.0
    tim_areal_Kcm2_W: float = 0.05

    @property
    def die_area_m2(self) -> float:
        return self.die_width_mm * 1e-3 * self.die_length_mm * 1e-3

    @property
    def cooled_area_m2(self) -> float:
        return self.core_width_mm * 1e-3 * self.core_length_mm * 1e-3

    @property
    def core_volume_m3(self) -> float:
        return (
            self.core_width_mm * 1e-3
            * self.core_length_mm * 1e-3
            * self.core_height_mm * 1e-3
        )


@dataclass
class FlowArchitecture:
    name: str = "center_feed_bidirectional"
    n_parallel_paths: int = 2
    path_length_mm: Optional[float] = None
    header_K_total: float = 1.5
    flow_uniformity: float = 1.0

    def resolved_path_length_m(self, stack: StackBasis) -> float:
        if self.path_length_mm is not None and self.path_length_mm > 0:
            return self.path_length_mm * 1e-3
        n = max(self.n_parallel_paths, 1)
        return stack.core_length_mm * 1e-3 / n


@dataclass
class GeometryCase:
    design_id: str
    family: str
    process_route: str = "LMM"
    validation_stage: str = "analytical"
    fin_thickness_mm: Optional[float] = None
    channel_gap_mm: Optional[float] = None
    fin_height_mm: Optional[float] = None
    side_margin_mm: float = 0.9
    fin_count: Optional[int] = None
    channel_count: Optional[int] = None
    wave_amplitude_mm: float = 0.0
    wavelength_mm: float = 1.0
    wetted_area_multiplier: float = 1.0
    void_fraction: Optional[float] = None
    surface_area_density_m2_m3: Optional[float] = None
    hydraulic_diameter_mm: Optional[float] = None
    surface_access_factor: float = 1.0
    heat_transfer_multiplier: float = 1.0
    pressure_loss_multiplier: float = 1.0
    # V2.3 pin-fin family (S1) — cylinder array geometry.
    pin_diameter_mm: Optional[float] = None
    pin_pitch_mm: Optional[float] = None
    pin_pattern: str = "staggered"
    notes: str = ""


@dataclass
class BaselineResult:
    design_id: str
    family: str
    process_route: str
    validation_stage: str
    coverage: float
    R_th_conv_K_W: float
    R_base_K_W: float
    R_TIM_K_W: float
    R_jc_K_W: float
    conv_fraction: float
    DeltaP_Pa: float
    pump_power_W: float
    velocity_m_s: float
    Re: float
    hydraulic_diameter_mm: float
    open_volume_fraction: float
    raw_SA_V_m2_m3: float
    effective_SA_V_m2_m3: float
    wetted_area_m2: float
    flow_area_m2: float
    UA_W_K: float
    eta_f: Optional[float]
    eta_o: Optional[float]
    heat_load_deltaT_K: float
    margin_heat_load_deltaT_K: float
    kpi_status: str
    warnings: List[str] = field(default_factory=list)

    def display_row(self) -> Dict[str, Any]:
        return {
            "design_id": self.design_id,
            "family": self.family,
            "coverage": round(self.coverage, 3),
            "open_volume_fraction": round(self.open_volume_fraction, 4),
            "raw_SA_V_m2_m3": round(self.raw_SA_V_m2_m3, 1),
            "effective_SA_V_m2_m3": round(self.effective_SA_V_m2_m3, 1),
            "R_th_conv_mK_W": round(self.R_th_conv_K_W * 1000.0, 3),
            "R_base_mK_W": round(self.R_base_K_W * 1000.0, 3),
            "R_TIM_mK_W": round(self.R_TIM_K_W * 1000.0, 3),
            "R_jc_mK_W": round(self.R_jc_K_W * 1000.0, 3),
            "DeltaP_kPa": round(self.DeltaP_Pa / 1000.0, 3),
            "pump_power_W": round(self.pump_power_W, 4),
            "velocity_m_s": round(self.velocity_m_s, 4),
            "Re": round(self.Re, 1),
            "hydraulic_diameter_mm": round(self.hydraulic_diameter_mm, 4),
            "wetted_area_m2": round(self.wetted_area_m2, 6),
            "UA_W_K": round(self.UA_W_K, 3),
            "kpi_status": self.kpi_status,
        }


def _shah_london_nu_h1(alpha: float) -> float:
    a = min(max(alpha, 1e-6), 1.0)
    return 8.235 * (
        1.0
        - 2.0421 * a
        + 3.0853 * a**2
        - 2.4765 * a**3
        + 1.0578 * a**4
        - 0.1861 * a**5
    )


def _shah_london_fre(alpha: float) -> float:
    a = min(max(alpha, 1e-6), 1.0)
    return 24.0 * (
        1.0
        - 1.3553 * a
        + 1.9467 * a**2
        - 1.7012 * a**3
        + 0.9564 * a**4
        - 0.2537 * a**5
    )


def _arc_factor(amplitude_m: float, wavelength_m: float) -> float:
    if amplitude_m <= 0.0 or wavelength_m <= 0.0:
        return 1.0
    chi = 2.0 * math.pi * amplitude_m / wavelength_m
    return math.sqrt(1.0 + 0.5 * chi * chi)


def _wavy_nu_multiplier(amplitude_m: float, wavelength_m: float, reynolds: float) -> float:
    if amplitude_m <= 0.0 or wavelength_m <= 0.0:
        return 1.0
    chi = 2.0 * math.pi * amplitude_m / wavelength_m
    return 1.0 + 0.40 * (chi ** 1.5) * math.tanh(reynolds / 300.0)


def _roughness_factor(relative_roughness: float, reynolds: float) -> float:
    if relative_roughness <= 0:
        return 1.0
    return 1.0 + 12.0 * min(relative_roughness, 0.05) * math.tanh(reynolds / 50.0)


def _fin_efficiency(h: float, k_solid: float, thickness_m: float, height_m: float) -> tuple[float, float]:
    if h <= 0 or k_solid <= 0 or thickness_m <= 0 or height_m <= 0:
        return 0.0, 1.0
    m = math.sqrt(2.0 * h / (k_solid * thickness_m))
    mH = m * height_m
    if mH > 25.0:
        return mH, 1.0 / mH
    return mH, math.tanh(mH) / mH


def _overall_surface_efficiency(eta_f: float, fin_area: float, wetted_area: float) -> float:
    if wetted_area <= 0:
        return 1.0
    return 1.0 - (fin_area / wetted_area) * (1.0 - eta_f)


def _computed_fin_count(stack: StackBasis, case: GeometryCase) -> int:
    if case.fin_count is not None and case.fin_count > 0:
        return case.fin_count
    if not case.fin_thickness_mm or not case.channel_gap_mm:
        return 0
    usable_mm = stack.core_width_mm - 2.0 * case.side_margin_mm
    pitch_mm = case.fin_thickness_mm + case.channel_gap_mm
    if pitch_mm <= 0 or usable_mm <= 0:
        return 0
    return max(1, int((usable_mm + 1e-9) / pitch_mm))


def _stack_resistances(stack: StackBasis) -> tuple[float, float, float]:
    die_area = stack.die_area_m2
    cooled_area = stack.cooled_area_m2
    funnel_area = min(die_area, cooled_area)
    base_t = stack.base_thickness_mm * 1e-3
    R_base = base_t / (stack.k_solid_W_mK * funnel_area)
    R_tim = stack.tim_areal_Kcm2_W * 1e-4 / die_area
    coverage = cooled_area / die_area
    return coverage, R_base, R_tim


def evaluate_case(
    case: GeometryCase,
    stack: StackBasis,
    op: OperatingPoint,
    arch: FlowArchitecture,
    relative_roughness: float = 0.03,
) -> BaselineResult:
    family = case.family.lower().strip()
    warnings: List[str] = []
    coverage, R_base, R_tim = _stack_resistances(stack)
    flow_per_path = op.flow_m3_s / max(arch.n_parallel_paths, 1)
    path_length_m = arch.resolved_path_length_m(stack)

    if family in {"straight_fin", "wavy_fin"}:
        result = _evaluate_fin_family(case, stack, op, arch, path_length_m, flow_per_path, relative_roughness)
    elif family == "pin_fin":
        result = _evaluate_pin_fin_family(case, stack, op, arch)
    else:
        result = _evaluate_generic_surface(case, stack, op, arch, path_length_m, flow_per_path)

    R_conv = result["R_conv"]
    R_jc = R_conv + R_base + R_tim
    delta_p = result["delta_p"]
    pump = op.flow_m3_s * delta_p
    status_reasons = []
    if coverage < 1.0:
        status_reasons.append("coverage")
        warnings.append("Cooled footprint is smaller than die footprint; CHT coverage analysis is required.")
    if R_jc > op.limit_R_jc_K_W:
        status_reasons.append("R_jc")
    if delta_p > op.limit_deltaP_Pa:
        status_reasons.append("DeltaP")
    if pump > op.limit_pump_W:
        status_reasons.append("pump")
    screening_only = family not in {"straight_fin", "wavy_fin", "pin_fin"}
    if screening_only:
        warnings.append("Generic-surface pressure and heat-transfer model is screening only; use nTop measurements plus CFD.")

    kpi_status = "PASS" if not status_reasons else "FAIL:" + ",".join(status_reasons)
    if screening_only:
        kpi_status = "SCREENING_ONLY:" + kpi_status
    return BaselineResult(
        design_id=case.design_id,
        family=case.family,
        process_route=case.process_route,
        validation_stage=case.validation_stage,
        coverage=coverage,
        R_th_conv_K_W=R_conv,
        R_base_K_W=R_base,
        R_TIM_K_W=R_tim,
        R_jc_K_W=R_jc,
        conv_fraction=R_conv / R_jc if R_jc > 0 else 0.0,
        DeltaP_Pa=delta_p,
        pump_power_W=pump,
        velocity_m_s=result["velocity"],
        Re=result["reynolds"],
        hydraulic_diameter_mm=result["hydraulic_diameter_m"] * 1e3,
        open_volume_fraction=result["open_volume_fraction"],
        raw_SA_V_m2_m3=result["raw_SA_V_m2_m3"],
        effective_SA_V_m2_m3=result["effective_SA_V_m2_m3"],
        wetted_area_m2=result["wetted_area"],
        flow_area_m2=result["flow_area"],
        UA_W_K=result["UA"],
        eta_f=result.get("eta_f"),
        eta_o=result.get("eta_o"),
        heat_load_deltaT_K=R_jc * op.heat_load_W,
        margin_heat_load_deltaT_K=R_jc * op.margin_heat_load_W,
        kpi_status=kpi_status,
        warnings=warnings + result.get("warnings", []),
    )


def _evaluate_fin_family(
    case: GeometryCase,
    stack: StackBasis,
    op: OperatingPoint,
    arch: FlowArchitecture,
    path_length_m: float,
    flow_per_path: float,
    relative_roughness: float,
) -> Dict[str, float]:
    if case.fin_thickness_mm is None or case.channel_gap_mm is None:
        raise ValueError(f"{case.design_id}: fin_thickness_mm and channel_gap_mm are required")
    H_mm = case.fin_height_mm if case.fin_height_mm is not None else stack.core_height_mm
    t = case.fin_thickness_mm * 1e-3
    b = case.channel_gap_mm * 1e-3
    H = H_mm * 1e-3
    n_fin = _computed_fin_count(stack, case)
    n_channel = case.channel_count if case.channel_count else n_fin + 1
    arc = 1.0
    if case.family.lower().strip() == "wavy_fin":
        arc = _arc_factor(case.wave_amplitude_mm * 1e-3, case.wavelength_mm * 1e-3)
    L_arc = path_length_m * arc
    flow_area = n_channel * b * H
    velocity = flow_per_path / flow_area if flow_area > 0 else 0.0
    Dh = 2.0 * b * H / (b + H) if (b + H) > 0 else 0.0
    alpha = min(b, H) / max(b, H) if b > 0 and H > 0 else 0.0
    reynolds = op.rho_kg_m3 * velocity * Dh / op.mu_Pa_s if op.mu_Pa_s > 0 else 0.0
    Nu = _shah_london_nu_h1(alpha)
    if case.family.lower().strip() == "wavy_fin":
        Nu *= _wavy_nu_multiplier(case.wave_amplitude_mm * 1e-3, case.wavelength_mm * 1e-3, reynolds)
    Nu *= case.heat_transfer_multiplier
    h = Nu * op.k_fluid_W_mK / Dh if Dh > 0 else 0.0
    A_fin = n_fin * 2.0 * H * L_arc * max(arch.n_parallel_paths, 1)
    A_base = n_channel * b * L_arc * max(arch.n_parallel_paths, 1)
    A_wet = (A_fin + A_base) * case.wetted_area_multiplier
    _, eta_f = _fin_efficiency(h, stack.k_solid_W_mK, t, H)
    eta_o = _overall_surface_efficiency(eta_f, A_fin * case.wetted_area_multiplier, A_wet)
    useful_area_factor = eta_o * arch.flow_uniformity * case.surface_access_factor
    UA = h * A_wet * useful_area_factor
    R_conv = 1.0 / UA if UA > 0 else float("inf")
    fRe = _shah_london_fre(alpha) * _roughness_factor(relative_roughness, reynolds)
    dP_friction = fRe * 2.0 * op.mu_Pa_s * velocity * L_arc / (Dh * Dh) if Dh > 0 else 0.0
    dP_header = 0.5 * op.rho_kg_m3 * velocity * velocity * arch.header_K_total
    active_width_m = n_fin * t + n_channel * b
    computed_open_fraction = n_channel * b / active_width_m if active_width_m > 0 else 0.0
    open_fraction = case.void_fraction if case.void_fraction is not None else computed_open_fraction
    core_volume = stack.core_volume_m3
    raw_sa_v = A_wet / core_volume if core_volume > 0 else 0.0
    effective_sa_v = A_wet * useful_area_factor / core_volume if core_volume > 0 else 0.0
    return {
        "R_conv": R_conv,
        "delta_p": (dP_friction + dP_header) * case.pressure_loss_multiplier,
        "velocity": velocity,
        "reynolds": reynolds,
        "hydraulic_diameter_m": Dh,
        "open_volume_fraction": open_fraction,
        "raw_SA_V_m2_m3": raw_sa_v,
        "effective_SA_V_m2_m3": effective_sa_v,
        "wetted_area": A_wet,
        "flow_area": flow_area,
        "UA": UA,
        "eta_f": eta_f,
        "eta_o": eta_o,
        "warnings": [],
    }


def _evaluate_pin_fin_family(
    case: GeometryCase,
    stack: StackBasis,
    op: OperatingPoint,
    arch: FlowArchitecture,
) -> Dict[str, float]:
    """V2.3 (S1): dispatch a pin_fin case to the webapp-native pin_fin solver."""
    if case.pin_diameter_mm is None or case.pin_pitch_mm is None:
        raise ValueError(f"{case.design_id}: pin_diameter_mm and pin_pitch_mm are required for pin_fin")
    H_mm = case.fin_height_mm if case.fin_height_mm is not None else stack.core_height_mm
    return pin_fin.evaluate_pin_fin(
        pin_diameter_mm=case.pin_diameter_mm,
        pin_pitch_mm=case.pin_pitch_mm,
        fin_height_mm=H_mm,
        pattern=case.pin_pattern,
        core_width_mm=stack.core_width_mm,
        core_length_mm=stack.core_length_mm,
        core_volume_m3=stack.core_volume_m3,
        cooled_area_m2=stack.cooled_area_m2,
        flow_m3_s=op.flow_m3_s,
        n_parallel_paths=arch.n_parallel_paths,
        rho=op.rho_kg_m3, mu=op.mu_Pa_s, k_fluid=op.k_fluid_W_mK, cp=op.cp_J_kgK,
        k_solid=stack.k_solid_W_mK,
        header_K_total=arch.header_K_total,
        flow_uniformity=arch.flow_uniformity,
        surface_access_factor=case.surface_access_factor,
        wetted_area_multiplier=case.wetted_area_multiplier,
        heat_transfer_multiplier=case.heat_transfer_multiplier,
        pressure_loss_multiplier=case.pressure_loss_multiplier,
    )


def _evaluate_generic_surface(
    case: GeometryCase,
    stack: StackBasis,
    op: OperatingPoint,
    arch: FlowArchitecture,
    path_length_m: float,
    flow_per_path: float,
) -> Dict[str, float]:
    void_fraction = case.void_fraction if case.void_fraction is not None else 0.50
    sad = case.surface_area_density_m2_m3 if case.surface_area_density_m2_m3 else 9000.0
    wetted_area = sad * stack.core_volume_m3 * case.wetted_area_multiplier
    frontal_area = stack.core_width_mm * 1e-3 * stack.core_height_mm * 1e-3
    flow_area = frontal_area * void_fraction
    velocity = flow_per_path / flow_area if flow_area > 0 else 0.0
    if case.hydraulic_diameter_mm and case.hydraulic_diameter_mm > 0:
        Dh = case.hydraulic_diameter_mm * 1e-3
    else:
        Dh = 4.0 * void_fraction * stack.core_volume_m3 / wetted_area if wetted_area > 0 else 0.0
    reynolds = op.rho_kg_m3 * velocity * Dh / op.mu_Pa_s if op.mu_Pa_s > 0 else 0.0
    Nu = 3.66 * case.heat_transfer_multiplier
    h = Nu * op.k_fluid_W_mK / Dh if Dh > 0 else 0.0
    useful_area_factor = arch.flow_uniformity * case.surface_access_factor
    UA = h * wetted_area * useful_area_factor
    R_conv = 1.0 / UA if UA > 0 else float("inf")
    dP = case.pressure_loss_multiplier * 0.5 * op.rho_kg_m3 * velocity * velocity * (path_length_m / Dh) if Dh > 0 else 0.0
    dP += 0.5 * op.rho_kg_m3 * velocity * velocity * arch.header_K_total
    core_volume = stack.core_volume_m3
    raw_sa_v = wetted_area / core_volume if core_volume > 0 else 0.0
    effective_sa_v = wetted_area * useful_area_factor / core_volume if core_volume > 0 else 0.0
    return {
        "R_conv": R_conv,
        "delta_p": dP,
        "velocity": velocity,
        "reynolds": reynolds,
        "hydraulic_diameter_m": Dh,
        "open_volume_fraction": void_fraction,
        "raw_SA_V_m2_m3": raw_sa_v,
        "effective_SA_V_m2_m3": effective_sa_v,
        "wetted_area": wetted_area,
        "flow_area": flow_area,
        "UA": UA,
        "eta_f": None,
        "eta_o": None,
        "warnings": [],
    }


def load_config(path: Path) -> tuple[OperatingPoint, StackBasis, FlowArchitecture, List[GeometryCase]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    op = OperatingPoint(**data.get("operating", {}))
    stack = StackBasis(**data.get("stack", {}))
    arch = FlowArchitecture(**data.get("architecture", {}))
    cases = [GeometryCase(**item) for item in data.get("cases", [])]
    return op, stack, arch, cases


def evaluate_config(path: Path) -> List[BaselineResult]:
    op, stack, arch, cases = load_config(path)
    return [evaluate_case(case, stack, op, arch) for case in cases]


def write_results(results: Iterable[BaselineResult], output_dir: Path, stem: str = "master_baseline_results") -> Dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    result_list = list(results)
    json_path = output_dir / f"{stem}.json"
    csv_path = output_dir / f"{stem}.csv"
    md_path = output_dir / f"{stem}.md"

    json_path.write_text(
        json.dumps([asdict(r) for r in result_list], indent=2),
        encoding="utf-8",
    )

    rows = [r.display_row() for r in result_list]
    if rows:
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    md_path.write_text(_markdown_summary(result_list), encoding="utf-8")
    return {"json": json_path, "csv": csv_path, "md": md_path}


def _markdown_summary(results: List[BaselineResult]) -> str:
    lines = [
        "# MASTER BASELINE Number Run",
        "",
        "Generated by `06_MASTER_BASELINE/python/master_baseline_calculator.py`.",
        "",
        "| design_id | family | coverage | open vol | raw SA/V | effective SA/V | R_th_conv (mK/W) | R_jc (mK/W) | DeltaP (kPa) | pump (W) | KPI |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for r in results:
        row = r.display_row()
        lines.append(
            f"| {row['design_id']} | {row['family']} | {row['coverage']} | "
            f"{row['open_volume_fraction']} | {row['raw_SA_V_m2_m3']} | "
            f"{row['effective_SA_V_m2_m3']} | {row['R_th_conv_mK_W']} | "
            f"{row['R_jc_mK_W']} | {row['DeltaP_kPa']} | "
            f"{row['pump_power_W']} | {row['kpi_status']} |"
        )
    lines.extend(
        [
            "",
            "## How To Read This Result",
            "",
            "This table is a first-pass design-navigation table. It is meant to show whether a geometry family is worth building in nTop and sending to CFD/CHT. It is not a final customer claim.",
            "",
            "| Column | Meaning | Engineering use |",
            "|---|---|---|",
            "| `coverage` | Cooled footprint area divided by die area. | Must usually be >= 1.0 before die-level claims. Below 1.0 means the die is under-covered and local spreading/CHT becomes mandatory. |",
            "| `open vol` | Open coolant volume fraction inside the active core. For fins this is close to channel width divided by pitch. | Flow, pressure drop, depowdering, and cleaning variable. Too low blocks flow; too high removes useful surface and copper conduction path. |",
            "| `raw SA/V` | Raw wetted surface area divided by active core volume, in m2/m3. | Compactness metric. It says how much surface the geometry packs into the envelope, but not whether that surface is useful. |",
            "| `effective SA/V` | Raw SA/V derated by surface efficiency, flow uniformity, and surface access. | Better family-comparison metric. It estimates how much of the packed surface is thermally and hydraulically useful. |",
            "| `R_th_conv` | Convective resistance of the core only. | Use this to compare geometry families fairly. |",
            "| `R_jc` | TIM + base conduction + convective resistance. | Use this for build decisions because it is closer to what the die actually feels. |",
            "| `DeltaP` and `pump` | Pressure loss and ideal hydraulic pumping power. | Hydraulic gates. A low thermal number is not useful if the pressure cost is unacceptable. |",
            "| `KPI` | Pass/fail/screening status against current limits. | `SCREENING_ONLY` means the numbers are placeholders until nTop measurements and CFD close the model. |",
            "",
            "## Raw SA/V Versus Effective SA/V",
            "",
            "Raw SA/V is a geometry density number:",
            "",
            "```text",
            "raw_SA_V = wetted_surface_area / active_core_volume",
            "```",
            "",
            "Effective SA/V is the more useful engineering number:",
            "",
            "```text",
            "effective_SA_V = raw_SA_V * surface_efficiency * flow_uniformity * surface_access_factor",
            "```",
            "",
            "Why this matters:",
            "",
            "- A design can have very high raw SA/V but poor fin efficiency, so the extra surface does not strongly reduce `R_jc`.",
            "- A design can have high raw SA/V but poor surface access, meaning coolant does not wash the area effectively.",
            "- A design can increase raw SA/V by closing channels, but pressure drop and depowdering risk may rise faster than thermal performance improves.",
            "- For fins, effective SA/V is strongly reduced by fin efficiency. For TPMS/lattice, effective SA/V must eventually be derated by measured flow access and CFD.",
            "",
            "## Open Volume Versus SA/V",
            "",
            "Open volume and SA/V pull against each other. More copper surface usually means less open coolant volume; more open volume usually means less surface area. The useful design region is the balance point where `R_jc` improves without unacceptable pressure drop, pump power, cleaning risk, or manufacturing risk.",
            "",
            "Do not optimize like this:",
            "",
            "```text",
            "maximize raw_SA_V",
            "maximize open_volume_fraction",
            "```",
            "",
            "Optimize like this:",
            "",
            "```text",
            "minimize R_jc",
            "subject to: coverage, DeltaP, pump power, open volume, manufacturability, depowdering, and validation gates",
            "track: raw_SA_V and effective_SA_V as diagnostics",
            "```",
            "",
            "## Current Table Reading",
            "",
            "- The fin cases sit near `open vol = 0.50` because the starting designs mostly use `t = b`, meaning the pitch is split roughly half wall and half coolant channel.",
            "- The v6-style 0.10 mm wavy fin has the highest raw SA/V among the fin cases, but its effective SA/V is much lower because very thin, tall fins have low fin efficiency.",
            "- The 0.12 mm and 0.20 mm wavy cases have lower raw SA/V, but their effective SA/V is close to the 0.10 mm case because thicker fins conduct heat into their surface more effectively.",
            "- The gyroid/TPMS row is marked `SCREENING_ONLY`; its effective SA/V currently equals raw SA/V only because no nTop/CFD surface-access derate has been applied yet.",
            "",
        ]
    )
    lines.extend(["", "## Warnings", ""])
    any_warning = False
    for r in results:
        for warning in r.warnings:
            any_warning = True
            lines.append(f"- {r.design_id}: {warning}")
    if not any_warning:
        lines.append("- None.")
    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- Use `R_th_conv` to compare geometry families.",
            "- Use `R_jc` for build decisions because it includes TIM and base conduction.",
            "- Use open volume and raw/effective SA/V as design variables and screening diagnostics, not final objectives by themselves.",
            "- Generic TPMS/lattice results are only screening values until nTop measurements and CFD replace the placeholders.",
            "- Coverage below 1.0 blocks customer-facing die-level thermal claims.",
            "",
        ]
    )
    return "\n".join(lines)


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run MASTER BASELINE first-pass cold-plate screening.")
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to a baseline_cases.json-style config. Defaults to python/baseline_cases.json.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory. Defaults to 06_MASTER_BASELINE/outputs.",
    )
    parser.add_argument("--stem", default="master_baseline_results", help="Output filename stem.")
    args = parser.parse_args(argv)

    here = Path(__file__).resolve().parent
    config = args.config if args.config is not None else here / "baseline_cases.json"
    output_dir = args.output_dir if args.output_dir is not None else here.parent / "outputs"
    results = evaluate_config(config)
    paths = write_results(results, output_dir, stem=args.stem)
    print("MASTER BASELINE results written:")
    for kind, path in paths.items():
        print(f"  {kind}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
