"""
cold_plate_v6/architecture.py
==============================
FlowArchitecture dataclass — describes how the inlet water is delivered to
the fin field and how the fin channels are arranged in parallel.

For PROTO1 the architecture is ``top_jet_slot_centre_rib_bidirectional``:
    * water enters at a corner port of the top silicone manifold;
    * diffuses through the upper cavity to the central recessed pocket;
    * drops through an impingement slot onto the fin tops at Y = middle;
    * a physical rib in the fin block at Y = middle splits the flow into
      symmetric +Y and -Y half-channels;
    * each half-channel discharges 7.5 mm to the outer plenum;
    * the outlet manifold collects both halves and exits at the opposite
      corner port.

The dataclass also carries the inputs for the optional jet-impingement Nu
enhancement, the header minor-loss coefficient, and the flow-uniformity
penalty (TD-10).
"""

from __future__ import annotations

from dataclasses import dataclass

from .master_constants import (
    PROTO1_FLOW_ARCHITECTURE,
    PROTO1_FLOW_UNIFORMITY,
    PROTO1_HEADER_K_TOTAL,
    PROTO1_JET_IMP_ENHANCEMENT,
    PROTO1_JET_SLOT_LENGTH_M,
    PROTO1_JET_SLOT_WIDTH_M,
    PROTO1_N_PARALLEL_PATHS,
    PROTO1_PATH_LENGTH_M,
)


@dataclass
class FlowArchitecture:
    """Describes the flow path through the cold plate."""
    name:                  str   = PROTO1_FLOW_ARCHITECTURE
    path_length_m:         float = PROTO1_PATH_LENGTH_M
    n_parallel_paths:      int   = PROTO1_N_PARALLEL_PATHS
    flow_uniformity:       float = PROTO1_FLOW_UNIFORMITY
    header_K_total:        float = PROTO1_HEADER_K_TOTAL
    jet_slot_width_m:      float = PROTO1_JET_SLOT_WIDTH_M
    jet_slot_length_m:     float = PROTO1_JET_SLOT_LENGTH_M
    jet_imp_enhancement:   float = PROTO1_JET_IMP_ENHANCEMENT

    @property
    def per_path_flow_fraction(self) -> float:
        """Fraction of total flow each parallel path sees."""
        if self.n_parallel_paths <= 0:
            return 1.0
        return 1.0 / self.n_parallel_paths

    @property
    def jet_slot_area_m2(self) -> float:
        return self.jet_slot_width_m * self.jet_slot_length_m

    def jet_velocity_mps(self, V_dot_total_m3s: float) -> float:
        """Average velocity through the impingement slot.

        Useful for plausibility-checking the header K coefficient against
        CFD-observed jet velocities.
        """
        A = self.jet_slot_area_m2
        if A <= 0:
            return 0.0
        return V_dot_total_m3s / A
