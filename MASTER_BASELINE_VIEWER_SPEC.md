---
type: design_spec
aliases:
  - Master Baseline Viewer Spec
  - Cold Plate Web App Spec
project: "[[Hieu's Coldplate R&D]]"
umbrella: "[[R&D Projects]]"
status: Draft
priority: High
date_created: 2026-07-01
date_updated: 2026-07-01
document_role: webapp_design_spec
tags:
  - vinnotek/projects
  - umbrella/r-and-d
  - project/coldplate-rd
  - document/spec
  - workflow/webapp
---

# Cold Plate — Master Baseline Viewer (Design Spec)

Project: [[Hieu's Coldplate R&D]] | Folder map: `PROJECT_FOLDER_STRUCTURE.md` | Roadmap: [[Cold Plate Milestones]]

> **Status: DRAFT for review.** This spec captures the design agreed during the 2026-07-01 brainstorm. Nothing is built yet. Edit freely; we iterate here before writing code.

---

## 1. Purpose

An **internal engineering-review web app** that lets us:

1. **View** each cold-plate candidate as a live **implicit-body (SDF) 3D geometry** — the same modelling idea nTop uses — reconstructed directly from design parameters (nTop meshes are not exported yet).
2. **See the KPIs** for that design next to the geometry (R_jc, R_th, ΔP, pump, SA/V, coverage, warnings), always from the **validated Python solvers** so browser numbers match the audit reports.
3. **Tune** the design with sliders and watch geometry **and** results react live.
4. **Solve for the best** design as a **multi-objective Pareto trade-off**, with a grid landscape / heatmap showing the feasible region and the optimum.

The hero (default "best real outcome") is the **v6 wavy fin, validated**, R_jc ≈ 0.0133 K/W. The gyroid is the best *number* (0.0126) but is `SCREENING_ONLY` pending nTop + CFD.

## 2. Audience & scope

- **Audience:** the engineering team (you + Hieu). Density and provenance over polish.
- **In scope:** wavy/straight fin (hero depth), pin fin, gyroid/TPMS (screening), the 5 existing master candidates, live tuning, Pareto optimization, SDF viewer.
- **Non-goals (for now):** CFD/CHT replacement, client-facing polish, editing the Python physics, importing nTop meshes, cloud multi-user. See §13.

## 3. Key decisions (brainstorm log)

| # | Decision | Rationale |
|---|---|---|
| D1 | Live **parametric explorer**, not a static page | Core value is interactive what-if. |
| D2 | Hero = **v6 wavy fin (validated)**; gyroid shown as aspirational `SCREENING_ONLY` | Defensible vs. best-number. |
| D3 | **React + TS + react-three-fiber** frontend, **thin Python API** backend | Best 3D dev experience; reuse validated physics = no model drift. |
| D4 | **Both engines, layered** | `evaluate_case()` for family breadth; v6 `solve()` for hero depth. |
| D5 | Optimizer objective = **multi-objective Pareto** (R_jc vs pump/ΔP) | Honest: R_jc is ~71% fixed, so no single "winner". |
| D6 | Find/show best via **grid sweep → heatmap + Pareto** | Shows the landscape and feasible region, not just a point. |
| D7 | Headline sliders = **t, b, H, A, λ**; contextual = flow rate, gyroid cell/wall | Focus on the wavy hero, cover other levers. |
| D8 | Physics stays **client-free**; only geometry rendering is client-side | Geometry is pure visualization → no drift risk. |
| D9 | Local dev first; publish later by serving `/dist` from the Python app | Matches "host locally, publish properly later". |

## 4. Architecture

```
Browser  ── React + TypeScript + react-three-fiber ───────────────┐
  • Raymarched implicit-body viewer (SDF fragment shader)         │  fetch (JSON)
  • KPI panels, gauges, resistance stackup, Pareto, heatmap       │
  • Sliders (one shared design-state object)                      │
                                                                  ▼
Python API  (stdlib http.server — zero new Python deps, same pattern as
             02_Code/cold_plate_v6/webapp.py; CORS for the dev origin)
  GET  /api/catalog   → candidates + schema + presets + gates
  POST /api/evaluate  → master evaluate_case()   (breadth: all families)
  POST /api/solve     → v6 solve()               (depth: wavy hero)
  POST /api/sweep     → grid sweep               (heatmap + Pareto data)
  ↳ reads canonical JSONs directly → single source of truth
```

- **Local dev:** `vite dev` (frontend, hot reload) + `python 07_WebApp/server.py` (API).
- **Production later:** `vite build` → `/dist`; the Python server serves the static bundle → one process on any Python-capable host (Render / Railway / Fly / HF Spaces). No physics change.
- **State model:** one `DesignState` object (family + all parameters). It feeds **two consumers**: the SDF shader uniforms (updates every frame) and the physics API call (debounced ~100 ms). Same numbers, two outputs.

## 5. Physics engines & data sources

| Engine | File | Role in app | Families |
|---|---|---|---|
| Master baseline | `06_MASTER_BASELINE/python/master_baseline_calculator.py` → `evaluate_case()` | Breadth: 5-candidate comparison, Pareto, gyroid screening | straight, wavy, pin, gyroid, generic |
| v6 solver | `02_Code/cold_plate_v6/solver.py` → `solve()` | Depth: hero drill-down (jet impingement, center rib, thermal entry, roughness, NTU/effectiveness, flow regime, flow sweep) | wavy/straight fin only |

**Data read at API startup (source of truth):**
- `06_MASTER_BASELINE/master_design_parameters.json` — parameter registry, families, presets, basis.
- `06_MASTER_BASELINE/outputs/master_baseline_results.json` — the 5 scored candidates (also the **golden fixtures** the API must reproduce).

## 6. Inputs

Three tiers, because they behave differently in the UI and the optimizer.

### 6A. Design basis — problem definition (editable rarely)

| Input | Symbol | Units | Default | Notes |
|---|---|---|---|---|
| Heat load (nominal) | Q | W | 450 | |
| Heat load (margin) | Q_margin | W | 575 | Drives sizing / margin ΔT |
| Flow rate | V̇ | L/min | 2.65 | Also a design lever (see 6B) |
| Inlet temp | T_in | °C | 25 | |
| Coolant props | ρ, μ, k, cp | — | water | Locked by default |
| Die footprint | — | mm | 24 × 31 | GB202 basis |
| Core footprint (default) | — | mm | **28 × 31 die-coverage** | Selector: as-built current 28×15 · master die-coverage 28×31 · physical target 28×35 (axis-swap). See §15 Q2 |
| Core height | H_core | mm | 5.5 | Caps fin height |
| Base thickness | — | mm | 0.7 | |
| TIM areal resistance | — | K·cm²/W | 0.05 | |
| Solid conductivity | k_solid | W/m·K | 340 (nominal) | Cu-AM band: **250** conservative / **340** nominal / **400** optimistic (see §15 Q7) |
| Gate: R_jc | — | K/W | ≤ 0.078 | |
| Gate: ΔP | — | Pa | ≤ 50 000 | |
| Gate: pump | — | W | ≤ 5 | |

### 6B. Design variables — sliders + optimizer search space

| Variable | Symbol | Units | Hero default | Range / step | Slider | Notes |
|---|---|---|---|---|---|---|
| Fin thickness | t | mm | 0.10 | floor…0.30, step 0.01 | **headline** | Floor per route (0.10/0.12/0.20); H/t ≤ 40 |
| Channel gap | b | mm | 0.10 | floor…0.40, step 0.01 | **headline** | Floor per route; R_th ∝ b, ΔP ∝ 1/b² |
| Fin height | H | mm | 5.5 | 2.0…6.5 (≤ H_core), step 0.05 | **headline** | Weak lever; area vs η_f trade |
| Wave amplitude | A | mm | 0.55 | 0…1.0, step 0.01 | **headline** | A=0 ⇒ straight; A/λ band [0.05, 0.30] |
| Wavelength | λ | mm | 2.5 | 1.5…6.0, step 0.05 | **headline** | Strongest lever via A/λ; χ = 2πA/λ |
| Flow rate | V̇ | L/min | 2.65 | 1.0…4.0, step 0.05 | contextual | ≥ 1.5 useful; h vs pump |
| Gyroid unit cell | c | mm | 2.5 | 1.0…4.0, step 0.1 | contextual | family = gyroid |
| Gyroid wall thickness | w | mm | 0.12 | floor…0.30, step 0.01 | contextual | family = gyroid |
| Family | — | — | wavy_fin | {wavy, straight, pin, gyroid} | dropdown | Switches SDF + engine |
| Process route | — | — | LMM | {LMM, supplier-qualified, std-LPBF} | dropdown | **Sets min wall/gap floor → clamps sliders** |
| Center rib | — | — | on, 1.0 mm | on/off + width | toggle | v6 hero |
| Parallel paths | n | — | 2 | 1…4 | advanced | |
| Side margin | — | mm | 0.9 | 0…3 | advanced | |

**Process-route floors** (clamp the sliders; manufacturability is shown as feasible-region *shading*, not a hard gate — per the LMM-intent philosophy in `sweep.py`):

| Process route | min wall t (mm) | min gap b (mm) | min pitch (mm) | Notes |
|---|---|---|---|---|
| LMM (micro-LPBF) — **primary** | 0.10 | 0.10 | 0.20 | Defensible analytical floor; below needs CFD + tolerance study |
| LMM supplier-qualified | 0.12 | 0.12 | 0.24 | Use if 0.10 mm not coupon-qualified |
| Standard LPBF — fallback | 0.20 | 0.20 | 0.35 | `ManufacturabilityRules` default (std copper, post-HIP) |

Other manufacturability annotations: fin aspect H/t ≤ 40, A/λ ∈ [0.05, 0.30], fin count ≤ 80.

Derived-and-shown next to sliders (not inputs): **pitch = t+b**, **fin_count** (from usable width / pitch), **open fraction**, **χ = 2πA/λ**.

### 6C. Audit / fidelity knobs (advanced drawer)

k_solid override, wavy-Nu override, apply thermal-entry uplift, relative roughness, wetted-area multiplier, surface-access factor, heat-transfer/pressure multipliers, header K, flow uniformity, jet slot width/length/enhancement (v6).

## 7. Outputs / KPIs

**Primary (both engines):** `R_jc`, `R_th_conv`, `R_base`, `R_TIM`, `conv_fraction`, `ΔP` (friction + header), `pump_power`, `velocity`, `Re`, `D_h`, `open_volume_fraction`, `raw_SA_V`, `effective_SA_V`, `wetted_area`, `flow_area`, `UA`, `eta_f`, `eta_o`, `coverage`, `heat_load_ΔT`, `margin_ΔT`, `kpi_status`, `warnings`.

**Hero-only (v6 solve()):** `NTU`, `effectiveness`, `wavy_enhancement`, `jet_enhancement`, `thermal_entry_factor`, `Nu_used`, `fRe`, `roughness_factor`, `flow_regime`, `Q_at_dT30`, plus the flow-rate sweep.

**KPI panel presentation:**
- **R_jc gauge** vs the 0.078 gate.
- **Resistance stackup bar**: R_base / R_TIM / R_conv — makes visible that TIM+base ≈ 71% and convection ≈ 29%.
- ΔP and pump vs limits (pass/fail badges).
- **SA/V raw vs effective** side by side (shows the fin-efficiency plateau).
- Coverage, Re/velocity, η_f/η_o.
- Validation-stage badge + warnings list (never hide `SCREENING_ONLY`).

## 8. Optimizer (Pareto + grid landscape)

**Objective:** multi-objective — minimize **R_jc** and **pump power** (ΔP selectable) → present the **Pareto front**, let the user pick the knee.

**Constraints:** ΔP ≤ 50 kPa · pump ≤ 5 W · t ≥ process floor · b ≥ process floor · H ≤ H_core · coverage ≥ 1 · open fraction within a depowdering band.

**Method:** grid sweep (reuse `02_Code/cold_plate_v6/sweep.py` logic) over 2–3 variables. The model is closed-form (ms), so brute-force grid is robust and also feeds the visuals; optional local refine (Nelder-Mead) for a precise point.

**Visualizations:**
- **2D heatmap** over a chosen variable pair — **default t × b** (richest manufacturability feasible region + the t=b guideline); one-click preset **b × A** (the two strongest R_th levers). R_jc contours, **shaded feasible region**, constraint lines (ΔP limit, process floor), optimum marker. The other 3 variables are held at slider values.
- **Pareto front** — **default R_jc vs pump power** (pump has its own 5 W gate); toggle to **R_jc vs ΔP** (cold-plate 50 kPa gate, the v6-native axis). At fixed flow pump = V̇·ΔP so the axes are equivalent — they diverge only when flow is swept. All 5 candidates + the live design plotted; click a point → load it.
- **Tornado / sensitivity**: which variable moves R_jc most.
- **"Load into sliders"** on any optimum/candidate → hand-tune from there.

**Discipline:** label optimizer output as a **screening optimum (uncalibrated multipliers until CFD)** — a design direction, not frozen CAD.

### Engineering framing surfaced by the tool
- **R_jc is ~71% fixed** (TIM 0.0067 + base 0.0028 vs 0.0133 total) → fin optimization has bounded payoff; the big cost is TIM.
- **Thin/tall fins → diminishing returns**: raw SA/V rises but fin efficiency drops, so *effective* SA/V plateaus — the true sweet spot before efficiency collapse, at manufacturable t/b.
- **Manufacturing floor is the dominant constraint** and clamps the sliders.

## 9. Interaction model

- **Instant geometry, debounced physics.** SDF uniforms update every frame while dragging; physics call fires ~100 ms after release.
- **Two-way geometric coupling.** Drag t → fins thicken in the shader, pitch changes → fin_count recomputes → open fraction / R_conv / ΔP update → gauges + Pareto dot move.
- **Constraint-aware sliders.** Track turns red past the process floor or when ΔP/pump exceeds a gate (live feasibility).
- **Lock / couple.** Option to lock t = b (current design assumption) or lock open fraction.
- **Ghost vs. hero.** Delta readouts against the v6 baseline (ΔR_jc, ΔΔP) while exploring.
- **Snapshot / pin designs.** Capture current slider state as a candidate → adds to the comparison table + Pareto. Pins persist across reloads via browser **localStorage** (no backend/DB), practical cap ~10, with **JSON export/import** for sharing. Server-side save to `07_WebApp/snapshots/` is deferred (see §15 Q4).

## 10. Implicit geometry viewer (SDF)

Raymarched signed-distance field in a Three.js fragment shader. Shared: **core box** (honoring the axis contract) + **0.7 mm base slab** + **section-cut plane** to see inside. Same design parameters drive both the SDF and the physics.

**Axis contract (must be correct):** physically the 28 mm width is the wavy flow path; the 35 mm length is transverse and sets fin count — but v6 solver variables swap this (`core_width_m` = transverse pattern width; wave runs along the flow path). Render in true physical orientation. Ref: `02_Code/cold_plate_v6/README.md` rule 6.

**Per-family implicit definitions (conceptual):**
- **Wavy / straight fin.** Walls periodic in the transverse coordinate `u` at pitch `p = t + b`, centerline displaced along the flow path `s` by `A·sin(2π s/λ)`; fin distance `d = |mod(u − A·sin(2π s/λ), p) − p/2| − t/2`; intersect with height band `[base_t, base_t+H]` and core footprint; add **center rib** slab at mid-span; straight = A→0.
- **Gyroid.** `f = cos(2πx/c)·sin(2πy/c) + cos(2πy/c)·sin(2πz/c) + cos(2πz/c)·sin(2πx/c)`; solid where `|f| < iso(w)`; clipped to core box + base.
- **Pin fin.** Cylinder array at `pin_pitch`, radius `pin_diameter/2`, height H; inline or staggered.

**Viewer extras:** orbit/zoom, dimension annotations, wave-phase animation, flow-direction arrows, exploded base/fin view. **Color-by-temperature:** default geometric; an optional **1-D analytical temperature tint** (fin `cosh(m(H−x))/cosh(mH)` profile + linear coolant caloric rise — quantities the solver already computes) is deferred to Phase 6 and clearly labelled *screening, not CFD* (see §15 Q3).

## 11. UI layout

```
┌───────────── header: design id · family · process route · validation badge ─────────────┐
├───────────┬─────────────────────────────────────────────┬───────────────────────────────┤
│ LEFT      │ CENTER                                        │ RIGHT                         │
│ candidate │ 3D implicit-body viewer                       │ R_jc gauge (vs 0.078)         │
│ selector  │ (orbit · section cut · dims)                  │ resistance stackup bar        │
│ family    │                                               │ ΔP / pump vs limits           │
│ sliders   │                                               │ SA/V raw vs effective         │
│  t b H    │                                               │ Re · velocity · η_f · η_o     │
│  A λ      │                                               │ coverage · warnings           │
│  flow     │                                               │                               │
│ derived:  │                                               │                               │
│  pitch    │                                               │                               │
│  fin_cnt  │                                               │                               │
│  open %   │                                               │                               │
├───────────┴─────────────────────────────────────────────┴───────────────────────────────┤
│ BOTTOM: candidate comparison table  ·  Pareto (R_jc vs pump)  ·  t×b heatmap              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## 12. API contract (draft)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/catalog` | — | `{ basis, families, presets, parameters[schema], candidates[5], gates }` |
| POST | `/api/evaluate` | `{ family, basisOverrides?, geometry{...} }` | master `BaselineResult` (§7 primary) |
| POST | `/api/solve` | `{ operating, geometry, architecture, options }` | v6 result (§7 primary + hero-only) |
| POST | `/api/sweep` | `{ base, sweep:{varX,rangeX,varY,rangeY}, objective, constraints }` | `{ grid[], pareto[], optimum }` |

Lengths posted in SI (m) as in the existing webapp; mm↔m conversion in the frontend. Non-finite floats sanitized to `null`.

## 13. Non-goals

- Not a CFD/CHT solver or a replacement for supplier coupon tests.
- Not editing or forking the Python physics (single source of truth).
- Not importing nTop meshes (geometry is reconstructed from parameters).
- No auth / multi-user / persistence beyond in-session snapshots (initially).

## 14. Build roadmap

| Phase | Deliverable | Acceptance |
|---|---|---|
| 1 | Python API (`server.py`): catalog/evaluate/solve/sweep | Reproduces the 5 golden results to ~1e-9 |
| 2 | React/Vite/r3f scaffold: candidate table + KPI panel on live data | Table + KPIs match the API |
| 3 | Implicit viewer: wavy/straight hero + center rib + section cut | Geometry matches axis contract & fin_count |
| 4 | Live sliders (t,b,H,A,λ,flow) → geometry + physics; gauges, stackup, derived readouts | Drag updates both, debounced, feasible-aware |
| 5 | Optimizer: `/api/sweep` → t×b heatmap + Pareto + "load into sliders" | Feasible region + optimum render; click loads |
| 6 | Gyroid + pin families, comparison polish, prod serving (`/dist`) | All families view; single-process prod build |

## 15. Resolved decisions (2026-07-01)

Resolved from `02_Code/cold_plate_v6/master_constants.py` and `sweep.py`.

1. **Default heatmap pair = t × b** — richest manufacturability feasible region + the t=b design guideline, most intuitive. One-click preset **b × A** = the two strongest R_th levers (per the §11 sweep rationale: wave A/λ is #1, gap b #2; t=b is a shallow optimum, H is weak). The other 3 variables are held at slider values.
2. **Default footprint = die-coverage 28 × 31 mm** — the master-baseline hero footprint, coverage ≈ 1.17 over the 24×31 GB202 die. Selector also offers **as-built current 28 × 15 mm** (covers only ~56% of the die → coverage < 1, triggers the coverage warning) and the **physical target 28 × 35 mm** (solver-axis swap: core_width 35 = transverse/fin-count, core_length 28 = flow path).
3. **Color-by-temperature: geometric by default; optional 1-D analytical tint deferred to Phase 6.** The solvers produce no spatial field, so a true CFD colour is out of scope. The optional tint uses the fin conduction profile `cosh(m(H−x))/cosh(mH)` + linear coolant caloric rise (m, η_f, ΔT are already computed) and is labelled *screening, not CFD*.
4. **Snapshots persist in browser localStorage** (survive reload, no backend), practical cap ~10, each shown on the comparison table + Pareto, with **JSON export/import** for sharing. Optional server-side save to `07_WebApp/snapshots/` via the API is deferred.
5. **Default Pareto axes = R_jc vs pump power** (pump has its own 5 W gate; matches D5). Toggle to **R_jc vs ΔP** (cold-plate 50 kPa gate, the v6-native axis used by `sweep.pareto_front`). At fixed flow pump = V̇·ΔP so the two are equivalent; they diverge only when flow is a swept variable.
6. **Slider ranges & process floors locked** (see §6B tables). Design-space ranges follow the established v6 sweep (t,b 0.05–0.30; H 4.5–6.5; A 0.25–0.55; λ 2.5–5.0), widened slightly for exploration. Process-route floors: **LMM 0.10 / supplier-qualified 0.12 / std-LPBF 0.20** mm wall & gap. Manufacturability is an *annotation* (feasible-region shading), not a hard gate — per the LMM-intent philosophy in `sweep.py`.
7. **k_solid band = 250 / 340 / 400 W/m·K** (conservative IR-LPBF no-HIP ~75% IACS / nominal green-laser+HIP ~95% IACS headline / optimistic peak-density ~100% IACS). Because the 0.10 mm LMM fins run at low η_f (0.12–0.18), R_conv is materially k-sensitive (7.57 / 8.17 / 9.43 mK/W at k = 400 / 340 / 250) — the conservative case must appear alongside any headline number.

## 16. Still to confirm (non-blocking)

These do not block the build; they refine inputs as real data arrives.

- Supplier coupon status — confirms whether the LMM 0.10 mm floor holds or we default the process route to 0.12 mm.
- Jet-slot dimensions & impingement enhancement (v6) — pending caliper measurement of the silicone manifold; default enhancement stays 1.0 (conservative) until CFD.
- Center-rib width from nTop (currently 1.0 mm estimate).
- Header K and flow-uniformity bounds — pending CFD (TD-10/TD-11).

## 17. Source references

- `PROJECT_FOLDER_STRUCTURE.md` — folder map & conventions.
- `06_MASTER_BASELINE/README.md`, `master_design_parameters.json`, `outputs/master_baseline_results.json`, `python/master_baseline_calculator.py`.
- `06_MASTER_BASELINE/nTop_MASTER_INPUTS.md`, `05_nTop_parameter_schema.md` — nTop input/output contract.
- `02_Code/cold_plate_v6/` — `solver.py`, `geometry.py`, `sweep.py`, `webapp.py`, `README.md`, `master_constants.py`.
