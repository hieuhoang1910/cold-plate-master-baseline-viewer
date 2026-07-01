"""
cold_plate_v6
=============
Standalone v6 analytical and audit-response package for the Vinnotek copper-AM
GPU cold-plate project.

V6 is intentionally separate from the previous analytical track. It preserves
the fin-channel calculation chain for traceability, then adds candidate-specific full-stack
R_jc reporting, die-coverage footprint studies, and audit sensitivity cases.
"""

from .architecture import FlowArchitecture
from .geometry import Geometry
from .operating import Operating
from .solver import SolveResult, compare_to_baseline, solve
from .reporting import export_bundle, render_md, render_txt
from .sweep import (
    CandidateRecord,
    ManufacturabilityRules,
    SweepRanges,
    SweepResult,
    evaluate_candidates,
    generate_candidates,
    is_manufacturable,
    pareto_front,
    rank_candidates,
    run_sweep,
)
from .sweep_reporting import (
    export_sweep_bundle,
    export_sweep_csv,
    export_sweep_json,
    render_sweep_md,
)
__version__ = "6.0"
__date__ = "2026-06-03"

__all__ = [
    "Geometry",
    "Operating",
    "FlowArchitecture",
    "SolveResult",
    "solve",
    "compare_to_baseline",
    "export_bundle",
    "render_txt",
    "render_md",
    "SweepRanges",
    "ManufacturabilityRules",
    "CandidateRecord",
    "SweepResult",
    "generate_candidates",
    "is_manufacturable",
    "evaluate_candidates",
    "pareto_front",
    "rank_candidates",
    "run_sweep",
    "render_sweep_md",
    "export_sweep_csv",
    "export_sweep_json",
    "export_sweep_bundle",
    "__version__",
    "__date__",
]
