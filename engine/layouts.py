"""
07_WebApp/engine/layouts.py  (webapp-native)
============================================
Flow-architecture (layout) resolver — the S3 piece of the V2 "Design Studio"
(spec §19D / §20 S3). Maps a named layout + a few parameters to the five knobs
the solvers already consume — n_parallel_paths, path_length_mm, header_K_total,
flow_uniformity — plus a `jet_flux_peaking` scalar that describes how centre-
peaked the base heat flux is (0 = uniform, 1 = strong central jet). The TPMS
solver uses that scalar so jet-adaptive cell grading can actually pay off
(dense cells sitting where the impingement flux is highest).

Everything here is screening-grade; the maldistribution / bend-loss defaults
carry "pending CFD" caveats (TD-10/TD-11). Pure, dependency-free (stdlib only).
Webapp-native — NOT synced from the parent.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# Layouts the resolver understands, with UI metadata (mirrors server _LAYOUTS).
SUPPORTED = {
    "single_pass", "center_feed_bidirectional", "top_jet_slot_centre_rib_bidirectional",
    "serpentine_n_pass", "u_flow_side_feed", "distributed_jet_compartments",
}
DEFERRED = {"multi_jet_array"}

_K_BEND = 2.2          # minor-loss coefficient per 180-degree serpentine bend


def _clampi(v, lo, hi):
    return max(lo, min(hi, int(v)))


def resolve(layout: str, core_length_mm: float,
            params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Resolve a layout into architecture knobs + jet flux peaking.

    Returns {n_parallel_paths, path_length_mm, header_K_total, flow_uniformity,
             jet_flux_peaking, warnings}. Unknown layouts fall back to
    center-feed with a warning; the deferred multi_jet_array raises.
    """
    p = params or {}
    L = float(core_length_mm)
    warns: List[str] = []

    if layout in DEFERRED:
        raise ValueError(f"layout {layout!r} is deferred (needs Martin (1977) + CFD anchor)")

    if layout == "single_pass":
        arch = dict(n_parallel_paths=1, path_length_mm=L, header_K_total=0.5,
                    flow_uniformity=1.0, jet_flux_peaking=0.0)

    elif layout == "center_feed_bidirectional":
        arch = dict(n_parallel_paths=2, path_length_mm=L / 2.0, header_K_total=1.5,
                    flow_uniformity=1.0, jet_flux_peaking=0.0)

    elif layout == "top_jet_slot_centre_rib_bidirectional":
        # v6 hero: a central impingement slot -> strongly centre-peaked base flux.
        arch = dict(n_parallel_paths=2, path_length_mm=L / 2.0, header_K_total=1.5,
                    flow_uniformity=1.0, jet_flux_peaking=1.0)

    elif layout == "serpentine_n_pass":
        n = _clampi(p.get("n_pass", 3), 2, 6)
        arch = dict(n_parallel_paths=1, path_length_mm=n * L,
                    header_K_total=0.5 + _K_BEND * (n - 1),
                    flow_uniformity=0.95, jet_flux_peaking=0.0)
        warns.append(
            f"serpentine {n}-pass: in deep-laminar flow Nu is ~constant, so the extra "
            "passes mostly buy pressure drop, not heat transfer — useful mainly at low "
            "available flow. Bend losses lumped as K += 2.2 per 180-deg bend.")

    elif layout == "u_flow_side_feed":
        arch = dict(n_parallel_paths=1, path_length_mm=L, header_K_total=2.5,
                    flow_uniformity=0.90, jet_flux_peaking=0.0)
        warns.append(
            "U-flow side feed: maldistribution defaults (uniformity 0.90, header_K 2.5) "
            "are placeholders pending CFD (TD-10).")

    elif layout == "distributed_jet_compartments":
        # ICE Proto2 rib-array: n compartments, each fed by a jet and split
        # bidirectionally by its rib -> 2n parallel half-paths, short paths,
        # and a (still centre-peaked per compartment) jet flux.
        n = _clampi(p.get("n_jets", 3), 1, 8)
        arch = dict(n_parallel_paths=2 * n, path_length_mm=L / (2 * n),
                    header_K_total=1.5, flow_uniformity=1.0, jet_flux_peaking=1.0)
        warns.append(
            f"distributed-jet compartments (ICE Proto2, {n} jets): rib-array multi-jet; "
            "per-compartment jet flux + manifold split are pending CFD (TD-10/11).")

    else:
        arch = dict(n_parallel_paths=2, path_length_mm=L / 2.0, header_K_total=1.5,
                    flow_uniformity=1.0, jet_flux_peaking=0.0)
        warns.append(f"unknown layout {layout!r}; using center-feed-bidirectional defaults.")

    arch["warnings"] = warns
    return arch
