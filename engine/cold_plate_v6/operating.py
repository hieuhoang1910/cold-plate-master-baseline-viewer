"""
cold_plate_v6/operating.py
===========================
Operating conditions dataclass — flow rate, inlet temperature, target heat
load. Defaults populate to the v4 design point (2.65 LPM, 25 °C, 450 W
nameplate).
"""

from __future__ import annotations

from dataclasses import dataclass

from .master_constants import (
    DEFAULT_Q_TARGET_W,
    DEFAULT_T_INLET_C,
    DEFAULT_VDOT_LPM,
)


@dataclass
class Operating:
    """Operating conditions for a single solve."""
    V_dot_LPM:   float = DEFAULT_VDOT_LPM       # total volumetric flow rate
    T_inlet_C:   float = DEFAULT_T_INLET_C      # inlet water temperature
    Q_target_W:  float = DEFAULT_Q_TARGET_W     # target / nameplate heat load

    @property
    def V_dot_m3_s(self) -> float:
        """Total volumetric flow rate in m³/s."""
        # 1 LPM = 1 L/min = 1e-3 m³ / 60 s = 1.6667e-5 m³/s
        return self.V_dot_LPM * (1.0e-3 / 60.0)
