---
type: design_spec
aliases:
  - Master Baseline Viewer Spec
  - Cold Plate Web App Spec
project: "[[Hieu's Coldplate R&D]]"
umbrella: "[[R&D Projects]]"
status: Active
priority: High
date_created: 2026-07-01
date_updated: 2026-07-24
document_role: webapp_design_spec
author: Hieu Hoang — Vinnotek
tags:
  - vinnotek/projects
  - umbrella/r-and-d
  - project/coldplate-rd
  - document/spec
  - workflow/webapp
---

# Cold Plate — Master Baseline Viewer (Design Spec)

Project: [[Hieu's Coldplate R&D]] | Folder map: `PROJECT_FOLDER_STRUCTURE.md` | Roadmap: [[Cold Plate Milestones]]

> **Status: V1 SHIPPED · V2 SHIPPED (through V2.6 + §30 addenda) · V3 SHIPPED (2026-07-09).**
> §1–§17 describe V1; §18–§31 are V2 (accepted 2026-07-02, built through §30–31).
> §32–§37 are V3 — About rewrite, area readouts, LMM/SLM manufacturing
> constraints — accepted and **built 2026-07-09** (all §36 phases; see the V3
> changelog at the end of §37). Change control: edits to accepted sections
> should note the date and rationale.

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
  **(BUILT 2026-08-03 for every swept point — see the dated addendum: click any
  heatmap cell or Pareto point, not just the ★ optimum.)**

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

---

## V2 — "Design Studio" update (ACCEPTED — official V2 plan)

> **Status: ACCEPTED 2026-07-02 — official V2 plan; implementation not yet started.**
> V1 (§1–§17) shipped: viewer, live tuning, optimizer, STL export, LAN serving. V2 turns the
> app from a *viewer of our problem* into a *design tool for a user-defined problem*: on entry
> the user states **targets** and the **problem definition** in a Design tab, picks geometry
> families / correlations / layout, and the whole app (candidates, gates, optimizer, viewer)
> re-scores against *their* problem. All §25 open questions are resolved; build proceeds per
> the §24 roadmap, starting at V2.1.

## 18. V2 concept & user flow

```
DESIGN (new, entry tab) ──▶ EXPLORE (V1 viewer+sliders) ──▶ OPTIMIZE (V1 sweep) ──▶ REPORT (new)
   define targets +             tune the chosen                sweep vs USER          export MD
   problem + families           family live                    gates                  + STL
```

- The Design tab is a **4-step wizard** (§19). Completing it produces a **Project** — one JSON
  object `{targets, basis, selections}` that scopes everything downstream (gates, defaults,
  which families/layouts are offered).
- V1 behaviour is preserved as the built-in **"GB202 GPU cold plate" preset project** — loading
  it reproduces today's app exactly (golden fixtures still pass).
- Projects save server-side to `07_WebApp/projects/<slug>.json` (plain files, no DB) so anyone
  on the LAN opens the same problem. Browser localStorage keeps per-user pins as in V1.

## 19. Design tab — the wizard

### 19A. Step 1 — Targets (what "good" means)

Three tiers, mirrored from how the solvers already gate (§6A) but now user-defined:

| Tier | Target | Symbol / unit | Default (GB202 preset) | Notes |
|---|---|---|---|---|
| **T1 hard gates** | Max junction temp | T_j,max °C | 100 (silicon ceiling; 90 drawn as a soft design-target line) | Primary thermal input. The app derives the R_jc gate from it (below) — users think in °C, solvers in K/W. |
| | Heat load nominal / margin | Q / Q_m W | 450 / 575 | Margin drives sizing honesty. |
| | Coolant inlet temp | T_in °C | 25 | Loop-level input. |
| | Max pressure drop | ΔP_max Pa | 50 000 | Pump/loop budget. |
| | Max pump power | W_pump,max W | 5 | Ideal hydraulic. |
| **T2 design rules** | Coverage | ≥ 1 | 1 | Keeps the 1-D stack model honest (no spreading model). |
| | Open-volume band | ε ∈ [lo, hi] | [0.35, 0.75] | Depowdering / clog floor, metal-mass ceiling. |
| | Process route | — | LMM | Sets wall/gap floors (§6B table) → clamps sliders. |
| | Envelope | W×L×H mm | 28×35×6.2 | Max footprint & height; base thickness. |
| **T3 objectives** | Pareto pair | — | R_jc vs pump | Pick 2 of {R_jc, ΔP, pump, mass}; the rest stay diagnostics. |

**Derived thermal gate** (replaces the hard-coded 0.078). S5 checks T_j with the exact
inlet-referenced effectiveness form — both engines already expose UA and ṁ·cp:

```
T_j = T_in + Q·(R_TIM + R_base) + Q / (ṁ·cp · (1 − e^(−UA/ṁ·cp)))      gate: T_j ≤ T_j,max
```

shown to the user as the equivalent budget `R_jc ≲ (T_j,max − T_in − ΔT_caloric/2) / Q` with
`ΔT_caloric = Q/(ṁ·cp)`. Resolved (§25 Q2): v6 references R_conv = 1/UA to the *mean* coolant
temperature (fluid properties at T_in + ½·ΔT_cal, TD-06), so the half-caloric shortcut is the
consistent approximation — at the hero point (NTU = UA/ṁcp ≈ 1.6) it is ~0.3 K optimistic where
full-caloric is ~0.9 K pessimistic; the exact form above costs nothing and settles the debate.
Show the derivation live in the wizard — "your 100 °C at 450 W and 25 °C water means
R_jc ≤ 0.166 K/W" — so the gate is never a magic number. Users may still override the gate
directly (audit mode).

### 19B. Step 2 — Problem definition (physics inputs)

| Input | Options / range | Default | Notes |
|---|---|---|---|
| Die footprint | W×L mm, free | 24 × 31 | Warn if die > cooled footprint (coverage < 1). |
| TIM areal resistance | K·cm²/W | 0.05 | Preset list: solder 0.008 · liquid metal 0.02 · premium grease 0.05 · pad 0.10 · custom. |
| Solid material | k_solid W/m·K | Cu-AM 340 | Band selector (250/340/400) per §15 Q7 + Al-AM 130 + custom. KPI panel shows the conservative case alongside nominal. |
| Coolant | preset + custom | water | **New property library** (§20 S4): water · PG25 · PG50 · EG50 · custom(ρ, μ, k, cp). Props evaluated at T_in. |
| Flow rate | L/min | 2.65 | Or "find required flow" helper (solve flow for gates at chosen geometry — v6 flow sweep already exists). |

### 19C. Step 3 — Geometry families & correlation sets

The wizard lists every family with its **model pedigree** so choosing a family is also choosing
how much to trust it (never hide screening status):

| Family | Correlation set (user-visible) | Status after V2 |
|---|---|---|
| Straight fin | Shah–London H1 laminar Nu + fRe (+ optional thermal-entry, roughness) | ANALYTICAL (validated for hero) |
| Wavy fin | Shah–London × wavy multiplier (χ, Re) — v6 depth available | ANALYTICAL (validated hero) |
| Pin fin (inline / staggered) | **NEW solver S1** — Khan–Culham–Yovanovich Nu + Gaddis–Gnielinski bank ΔP | ANALYTICAL_LIT (new) |
| TPMS gyroid / diamond / Schwarz-P | **NEW solver S2** — literature Nu(Re,Pr), f(Re) power laws + numeric geometry | ANALYTICAL_LIT (new) |
| TPMS lidinoid / split-P / I-WP / neovius / Fischer-Koch | generic surface model (unchanged) | SCREENING_ONLY (viewer-accurate, physics placeholder) |
| Generic surface (SA/V + ε entered by hand) | current `_evaluate_generic_surface` | SCREENING_ONLY |

Turbulent extension (Gnielinski Nu + Blasius f when Re > 2300) is offered as an **opt-in flag**
for all duct families — off by default because every current design point is deeply laminar.

Resolved (§25 Q4): **solid-network TPMS variants are hidden from the wizard** — sheet variants
carry ~2× the area density at equal porosity and the comparative literature finds sheet equal or
better on heat transfer at matched ΔP in liquid cooling; the S2 correlations are sheet-only.
Solid stays available in the Explore viewer as a geometry-only screening toggle.

### 19D. Step 4 — Layout (flow architecture)

**Current layouts** (what exists today, to be listed in the UI):

| Layout | Where it lives today | Model |
|---|---|---|
| `single_pass` | master engine, `n_parallel_paths = 1` (degenerate) | path = core_length |
| `center_feed_bidirectional` | master engine **default**, `n_parallel_paths = 2` | path = L/2, header_K 1.5 |
| `top_jet_slot_centre_rib_bidirectional` | v6 hero solver | + jet Nu enhancement, slot dims |

**New layouts in V2** (all resolve to the same 5 knobs the solvers already consume —
`n_paths, path_length, header_K, flow_uniformity, jet_enhancement` — via resolver S3):

| Layout | Resolves to | Honest caveat shown in UI |
|---|---|---|
| `serpentine_n_pass` (n = 2…6) | path = n·L, velocity ×n (flow through 1/n of the width), + K_bend ≈ 2.2 per 180° bend | In deep laminar flow Nu is ~constant, so serpentine mostly buys ΔP, not h — useful mainly at low available flow. |
| `u_flow_side_feed` | path = L, uniformity 0.85–0.95, header_K higher (default 2.5) | Maldistribution defaults pending CFD (TD-10). |
| `distributed_jet_compartments` (**ICE, Proto2 as-built**) | n_ribs transverse walls at pitch p_c partition the fin field into (n_ribs − 1) compartments with alternating feed/return slots from the manifold ⇒ n_paths = 2·(n_ribs − 1), path = p_c/2 | Mesh-verified from `Heatsink wavy fins mesh_remeshed.stl`: 10 ribs ≈ 0.25 mm at 3.0 mm pitch over the 28 mm axis → 9 compartments, half-path ≈ 1.4 mm. **Thermal-entry-dominated** — the entry model becomes load-bearing; slot/turning losses dominate ΔP; needs the CFD anchor before numbers are quotable. |
| `multi_jet_array` (free 2-D jet grid) | **deferred** | Martin (1977) correlation + CFD anchor; listed greyed-out. |

Layout availability is family-aware (jet slot: fin families only; TPMS: single-pass and
center-feed only for now).

### 19E. Centre-rib editor (part of Step 4)

**Current state (V1):** the rib exists in three inconsistent fidelities — v6 models it as
on/off + width (1.0 mm, Hieu CFD streamline render) whose only physics effect is a **wetted-area
penalty** (~5–7 % for 1 mm, `solver.py`); it is also the stated justification for
`flow_uniformity = 1.0`. The master engine has no rib at all, and the viewer draws a fixed
1.0 mm slab whenever n_paths ≥ 2. V2 unifies this: one rib definition drives viewer, STL,
and both engines.

| Rib parameter | Options / range | Physics effect in V2 | Status |
|---|---|---|---|
| Presence | on/off (tied to layout) | Off in a center-feed layout ⇒ uniformity drops to the no-rib bound (0.70–0.85 sweep, per master_constants) + warning | physics-backed now |
| Width | 0.5 … 2.0 mm, default 1.0 | Existing wetted-area penalty scales; **new**: path length = (L − w_rib)/2 instead of L/2; mass estimate includes rib | physics-backed now (S3 + small v6 change) |
| Face credit | off (default) / on | Counts the rib's two faces (2·H·W_trans, η ≈ 1 — a 1 mm rib is a *thick* fin) as wetted area at plain channel h. Conservative opt-in; the faces actually sit in the jet-turning zone where h is higher | opt-in + warning until CFD |
| Top crown | flat / chamfered / filleted | Viewer + STL geometry; AM overhang benefit noted. Header-K reduction from smoother turning is **annotation only** (no credit) pending CFD | geometry only |
| Perforation | none / bleed holes (% open) | Viewer + STL; pressure equalisation between halves → uniformity effect pending CFD (TD-10) | geometry only |
| Segmentation | solid / n gaps along the rib | Viewer + STL; transverse redistribution + depowdering aid | geometry only |
| Offset | 0 (center) / ± mm | Asymmetric split for off-center hotspots ⇒ unequal path lengths — needs a two-path weighted solver | deferred (V2.5+) |

**What the referenced research says about the rib** (§ About refs):

- **Jet impingement (About refs 8–10):** the rib is the *stagnation target* directly under the slot —
  the highest-h region of the plate. Martin's slot-jet correlation (ref 9) is written in slot width
  and slot-to-target spacing, i.e. the rib crown position/shape is part of the jet geometry;
  the split's turning loss is what header_K lumps. This is the literature hook for eventually
  crediting rib faces and crown shape — but only via the jet enhancement path (currently held
  at 1.0 conservative until CFD).
- **Entry-length theory (About refs 11–12):** the split restarts hydrodynamic + thermal boundary layers
  in each half-path — the shorter the path, the larger the (favourable) entry fraction. The v6
  thermal-entry option is physically a *rib consequence*; V2 surfaces that link in the UI.
- **Fin theory (About ref 13):** at 1.0 mm thick, m·H is small ⇒ η_rib ≈ 1 — the rib is the most
  efficient "fin" on the plate and sits over the die's hottest zone (center). Subtracting its
  area with zero credit (current model) is deliberately conservative; the face-credit toggle
  makes the assumption explicit instead of silent.
**Rib arrays (Proto2 ICE, resolved §25 Q6):** the `distributed_jet_compartments` layout (§19D)
generalises the single centre rib into an **array** — count, pitch, and thickness editable, with
the same face-credit / perforation / crown options per rib. Mesh inspection shows the wavy-fin
field runs *through* the compartments (walls chop the fins every 3.0 mm), so the rib array is a
**layout property**, and the V1 single centre rib is its n_ribs = 1 special case. The
(L − w_rib)/2 path correction generalises to (p_c − w_rib)/2.

- **AM cold-plate practice (About ref 15):** center-feed distribution features double as structural
  stiffeners for thin AM fin fields (print distortion, HIP, clamping) — the rib's width floor
  is likely structural, not thermal. No cited paper parametrically optimises the rib itself:
  rib width/shape beyond the area-penalty model is CFD territory (TD-10/11), so V2 exposes the
  geometry but credits physics only where a correlation exists.

## 20. New solvers (the V2 physics work)

All implemented in the **main solver home** (`06_MASTER_BASELINE/python/` + `02_Code/`), then
re-vendored into `07_WebApp/engine/` via `sync_engine.py` — the webapp never gets private physics
(V1 rule D8 stands). Each solver ships with golden fixtures + a literature-anchor test.

### S1 — Pin-fin solver (`_evaluate_pin_fin_family`)

Replaces the generic-surface fallback for `family = pin_fin`. Inputs: `pin_diameter_mm d`,
`pin_pitch_mm S` (transverse = longitudinal to start), `pin_pattern` inline|staggered,
`fin_height_mm H`.

- Pin count from footprint/pitch (same logic as the viewer/STL — one geometry source).
- Constriction velocity: `v_max = v_approach · S/(S − d)`; `Re_d = ρ·v_max·d/μ`.
- **Nu:** Khan–Culham–Yovanovich (2006) closed-form for pin-fin heat sinks,
  `Nu_d = C1(S_T/d, S_L/d, arrangement) · Re_d^0.5 · Pr^(1/3)` — chosen over raw Zukauskas
  because it is continuous (no Re-band patchwork) and was fitted for heat sinks with endwall;
  Zukauskas retained as a cross-check in tests. Coefficients pinned from the paper at
  implementation time.
- **Pin efficiency:** `m = √(4h/(k_solid·d))`, corrected length `H_c = H + d/4`,
  `η_pin = tanh(m·H_c)/(m·H_c)`; areas `A_pins = N·π·d·H`, `A_end = A_cooled − N·π·d²/4`;
  standard η_o.
- **ΔP:** Gaddis–Gnielinski (1985) tube-bank correlation (valid Re 1…3×10⁵, inline &
  staggered), per-row Euler number × N_rows × ½ρv_max², + header_K term.
- **Warnings:** Re_d outside fit range, S/d < 1.25, H/d > 8 (endwall model degrades);
  guardrail Re_d ∈ [40, 1000].
- **Fixtures (§25 Q3):** KCY and Zukauskas pedigrees are air-heavy, so the acceptance test is a
  **water** micro-pin literature anchor (candidates: Koşar & Peles 2006; Prasher et al. 2007 —
  pin the exact datapoint when the papers are pulled at implementation).

### S2 — TPMS solver (`_evaluate_tpms_family`, gyroid/diamond/schwarz_p)

Replaces the generic fallback for the three types with published correlations.

- **Geometry from the implicit field, not hand-entered numbers:** SA/V(type, w/c), ε(type, w/c)
  and tortuosity τ(type) are **pre-tabulated numerically from the exact same level-set the
  viewer renders and the STL exporter meshes** (the V1.1 surface-nets mesher already computes
  watertight area/volume — run it offline over a (type, w/c) grid, bake a small JSON table).
  This kills the current inconsistency where `surface_area_density_m2_m3` is typed by hand.
- `D_h = 4ε/ (SA/V)`; velocity from frontal area × ε.
- **Nu / f:** power laws `Nu = a·Re^b·Pr^c`, `f = d·Re^e` per type from Renon & Jeanningros
  (2025) (gyroid & diamond sheet, already reference [2] in the About tab) and Chouhan et al.
  (2025) [1] for cross-check; coefficients + validity Re range pinned from the papers at
  implementation. Below the fitted Re range → fall back to conservative Nu = 3.66 **with a
  warning**, never extrapolate silently.
- **Sheet-wall efficiency:** treat the sheet as a meandering fin: `m = √(2h/(k_solid·w))`,
  effective conduction length `H_eff = τ·H/2` (τ from the geometry table), η_o over sheet area.
  Labelled a model assumption in warnings until CFD.
- Status: gyroid/diamond/Schwarz-P move `SCREENING_ONLY → ANALYTICAL_LIT` (literature-anchored,
  still not test-validated). The other five TPMS types stay screening.

### S3 — Layout resolver (`resolve_architecture(layout, params, stack)`)

Pure function mapping a named layout + its parameters to the `FlowArchitecture` fields
(`n_paths, path_length, header_K, flow_uniformity, jet_*`). Adds serpentine bend losses as
`header_K += 2.2·(n_pass − 1)`. Defaults per layout carry "pending CFD" warnings (TD-10/11).

### S4 — Coolant property library (`coolants.py`)

Presets (water, PG25, PG50, EG50) with ρ, μ, k, cp at 20/25/40/60 °C + linear interpolation at
T_in; custom fluid entry. Warning when μ(T_in) is extrapolated. Single-phase only (non-goal:
boiling/two-phase).

### S5 — Targets translator (`targets.py`)

`{T_j_max, T_in, Q, flow, coolant} → {R_jc_gate, caloric ΔT, warnings}` (equation in §19A) +
validation (die ≤ envelope, floors vs route, band sanity). Pure, tested, shared by API and
report.

## 21. API v2 additions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/schema` | Wizard schema: families + pedigree, layouts + knobs, coolant presets, target defaults/bounds — so the UI never hard-codes options. |
| GET/POST | `/api/projects` | List / save project JSONs under `07_WebApp/projects/` + a tiny `index.json` (id → name/file/created/modified/schema-version) for list/rename/delete UX (§25 Q5). LAN-shared, no auth — same trust model as V1.1 LAN serving. |
| POST | `/api/evaluate` (extended) | Accepts the **full basis** (stack + operating + architecture + coolant + gates) instead of merging into the fixed GB202 basis. V1 payloads keep working (defaults = preset project). |
| POST | `/api/sweep` (extended) | Same basis extension; constraints come from **user gates**. |

Candidate table re-scores against user gates: same 5 catalog designs, PASS/FAIL recomputed per
project (a candidate that passes GB202 gates may fail a stricter T_j,max).

## 22. V2 UI changes

- **Design tab first** on entry when no project is loaded; afterwards a header chip
  (`project: GB202 GPU ▾`) switches/edits projects. Explore/Optimize/Compare stay as in V1.
- Wizard = 4 steps (§19A–D) with live derived readouts (R_jc gate derivation, floors, coverage)
  and a preview card ("your problem: 450 W into 24×31 mm, water 2.65 L/min, gate 0.142 K/W").
- KPI panel gains a **mass estimate** row (§23-2) and shows gates from the project.
- **Report tab (new, small):** print-friendly Markdown export of {project inputs, chosen design,
  KPI table, warnings, references} + the STL button — the design-review artifact.

## 23. Also recommended for V2 (gaps the request didn't mention)

1. **Correlation-validity guardrails everywhere.** Once inputs are user-defined, every
   correlation must declare its fitted range and warn outside it (Re bands, α range of
   Shah–London table, A/λ band, KCY pitch ratios). This is the single biggest honesty feature.
2. **Mass & material-cost estimate.** `(1−ε)·V_core·ρ_Cu + base + walls` → g and $ (route-dependent
   $/kg constant in `master_constants`). Nearly free to compute; AM quoting cares.
3. **Uncertainty banner.** Run each evaluate at k_solid = {250, 340, 400} and show R_jc as a band,
   not a point (three solver calls, ms each). Matches §15 Q7 discipline.
4. **Flow-envelope mini-plot.** R_jc & ΔP vs flow rate at the current geometry (v6 flow sweep
   already exists) — answers "what if the pump is weaker" instantly.
5. **Parity + fixtures discipline.** Extend `test_api_parity.py`: golden fixtures for pin/TPMS
   solvers, a literature-anchor test each (reproduce one datapoint from the source paper), and
   the V1 GB202 preset must reproduce today's 5 candidates bit-for-bit.
6. **Problem templates.** "GB202 GPU" (V1), "generic ASIC 300 W", "blank". Templates are just
   pre-filled projects.
7. **Deferred (explicit non-goals for V2):** pump-curve intersection solver, spreading-resistance
   model for coverage < 1, two-phase coolants, multi-jet arrays, auth/user accounts.

## 24. V2 roadmap (proposed)

| Phase | Deliverable | Acceptance |
|---|---|---|
| V2.1 | S4 coolants + S5 targets + extended `/api/evaluate` basis | GB202 preset reproduces V1 golden results exactly |
| V2.2 | Design tab wizard + projects API + gate re-scoring | New project changes gates/KPIs app-wide; V1 preset unchanged |
| V2.3 | S1 pin-fin solver + fixtures + lit-anchor test | Pin candidate leaves SCREENING_ONLY; parity green |
| V2.4 | S2 TPMS solver + numeric geometry table (from the STL mesher) | Gyroid/diamond/Schwarz-P → ANALYTICAL_LIT; SA/V matches meshed geometry ≤ 2% |
| V2.5 | S3 layouts (**distributed-jet compartments**, serpentine, U-flow) + layout-aware optimizer + rib-array editor | Sweep respects layout; ICE V1+2 geometry reproducible in viewer/STL; caveats shown |
| V2.6 | Report tab + mass/cost + uncertainty band + validity guardrails | Exported MD review-ready |

## 25. V2 decisions (resolved 2026-07-02)

> All questions below are **resolved** — the authoritative answers are in the
> "§25 resolutions" block at the end of this section. The inline notes are the original
> discussion; the resolutions block governs.

1. T_j,max default 90 °C or 85 °C for the GB202 preset? (Marketing vs engineering margin.)
	- ==Lets go for a max of 100 °C just to be safe==
		  
2. Should the derived R_jc gate subtract the full caloric rise or half (mean coolant temp)? §19A
   currently says half — confirm against how the v6 report defines R_jc reference temperature.
	- ==This I need your search to determine, please research on this and see which is better==
		  
3. Pin KCY vs Zukauskas as primary — confirm after pulling both papers' validity tables.
	   ==- I need you to research on this and help me choose on this as well==
	     
4. Renon & Jeanningros coefficients: sheet-TPMS only. Do we offer solid-network TPMS with the
   generic model, or hide solid variants from the solver path (viewer-only) in V2?
	   ==- From your research, would you think solid-network have a better result than sheet? if not, lets hide it. If it is, then yes, we must offer its stay, and see if the solver works for the solid-network, if it is not, I think we can hide it.==
	     
5. Projects folder: flat files fine, or do we want a tiny index.json for rename/delete UX?
	   ==- we definitely need index for it==
	     
6. Centre rib (§19E): is 0.5 mm a safe structural lower bound for the width slider (confirm with the print team), and should the face-credit toggle stay default-off until TD-10/11 CFD lands? Also confirm the (L − w_rib)/2 path correction against how Hieu's CFD measured the 7.5 mm half-path.
	- ==okay, on that center rib, we actually make it into a shape of a jet-impingement, you can inspect the full model within the main Hieu_coldplate project folder, here is the path C:\Vinnotek\2. Projects\01 Active Projects\Hieu - cold plate\04_Analysis_Outputs\ntop\Proto2 meshes\ICE V1+2==
	  ==-> The team's final mesh is the Heatsink wavy fins mesh_remeshed.stl== 
	  ==-> so I want to be able to create those type of middle ribs as well. This is the aim for geting better flow from the top down impingement jet layer in the middle to get it wet the surfaces better==

### §25 resolutions (2026-07-02 — code inspection + literature pass)

1. **T_j,max = 100 °C** (user decision, recorded). Consequence to be aware of: with 25 °C water
   at 450 W the derived budget is ≈ 0.166 K/W — more than 2× looser than the old 0.078 gate, so
   the thermal gate will almost never bind and the hydraulic gates + Pareto do the
   discriminating. Mitigation adopted: 100 °C is the hard ceiling; the KPI panel draws a soft
   design-target line at 90 °C so headroom stays visible.
2. **Caloric-rise question — settled by code inspection.** v6 evaluates fluid properties at
   T_in + ½·ΔT_cal (TD-06) and R_conv = 1/UA is mean-coolant-referenced ⇒ *half* is the
   consistent shortcut. S5 uses the exact inlet-referenced effectiveness form (§19A), which
   makes the half-vs-full debate moot: at the hero point (NTU ≈ 1.6) "half" is ~0.3 K
   optimistic, "full" ~0.9 K pessimistic, exact is free.
3. **Pin-fin correlation — KCY primary, Zukauskas cross-check (confirmed).** KCY: closed-form,
   heat-sink-specific (endwall + arrangement), single laminar Re^0.5·Pr^(1/3) form — right for
   the expected Re_d ≈ 100–500. Zukauskas: bank data spanning Pr 0.7–500 (includes water) but
   band-wise fits and a long-tube assumption (H/d ≫ 1 vs our ≈ 6). Both are air-heavy in
   pedigree ⇒ the acceptance fixture is a water micro-pin anchor (Koşar & Peles 2006 /
   Prasher et al. 2007), guardrail Re_d ∈ [40, 1000].
4. **Sheet vs solid TPMS — sheet wins for this regime; solid hidden from the wizard.**
   Comparative studies (sheet-vs-solid disturbance structures; 3D-printed sheet/solid TPMS
   porous structures; modified-gyroid optimisation) find sheet equal or better on heat transfer
   at matched ΔP in liquid cooling — solid variants win only in some low-velocity gas cases.
   Per the decision rule ("if not better, hide it"): no solid-network solver in V2; solid stays
   a viewer-only screening toggle.
5. **Projects index — agreed.** `projects/index.json` with id → name/file/created/modified/
   schema-version.
6. **Centre rib is actually a rib array (ICE V1+2, mesh-verified).**
   `Heatsink wavy fins mesh_remeshed.stl` (4.12 M triangles, 35.0 × 28.0 × 5.0 mm): 10
   transverse walls ≈ 0.25 mm thick at exactly 3.0 mm pitch (centres ±1.5, ±4.5 … ±13.5 mm)
   chop the wavy-fin field into 9 compartments ≈ 2.75 mm open each ⇒ half-path ≈ 1.4 mm.
   The centre plane holds *fins*, not a solid rib — the "jet-impingement shaped middle rib" is
   two walls framing a central 3 mm impingement channel, repeated across the plate. Spec
   updated: first-class layout `distributed_jet_compartments` (§19D), rib-array mode in the rib
   editor (§19E), roadmap V2.5. Solver implications: n_paths ≈ 18, path = pitch/2, thermal
   entry dominates the Nu (entry model is now load-bearing), slot/turning losses dominate ΔP —
   CFD anchor required before quoting numbers. **To confirm with Hieu:** which compartments are
   feed vs return (the LMM base/manifold mesh defines it), and slot widths.

## 26. Designs as candidates (V2.2 addendum, 2026-07-02)

The Design Studio flow is a pipeline, not just problem definition: **choose inputs (Studio) -> optimize (Optimizer tab: sweep -> optimum -> "load into sliders") -> fine-tune (left sliders) -> "Save current design as candidate" (named)**. A saved design is stored on the project (`project.designs[] = {name, design}`) and re-evaluated against the project basis, so it appears in the Candidates list with its name (a `saved` tag), selectable + further tunable + deletable. Built-in projects (GB202) can't be written, so the first save forks a `"<name> (custom)"` copy. Pin designs (drawn as a gyroid sub-type) map to `family=pin_fin` for evaluation (S1 solver) while the stored case keeps the gyroid+pin shape so the 3-D viewer still renders them.

## 27. V2.4 S2 progress — TPMS geometry (2026-07-02)

**Part 1 (done):** gyroid / diamond / Schwarz-P sheet geometry is now derived from the published minimal-surface area coefficients A0/a^2 (gyroid 3.0915, diamond 3.8385, schwarz_p 2.3451) in `engine/tpms_geometry.py` (webapp-native): SA/V = 2*(A0/a^2)/a, relative density rho* = (A0/a^2)*(t/a), void = 1 - rho*, D_h = 4*void/(SA/V). `evaluate_case` uses these for the three literature types (overriding the hand-typed SA/V / void / D_h that the spec flagged as inconsistent); other viewer shapes keep the generic hand values. This is exact for the minimal surface and is the numeric-geometry foundation the spec called for, without the offline mesher.

**Part 2 (pending):** the literature Nu/f power-law correlations (Renon & Jeanningros 2025, Chouhan et al. 2025) that would move these types from SCREENING_ONLY to ANALYTICAL_LIT. Deferred until the paper coefficients are sourced (the same fidelity discipline used for the pin solver, where KCY's un-closable form led to Zukauskas). Until then the heat-transfer model stays the generic-surface screening one; only the geometry is literature-based.


**Part 2 (done, 2026-07-02) — TPMS Nu/f correlation.** After a multi-source deep-research pass, the only peer-reviewed, fully-extractable TPMS correlation is Renon & Jeanningros (2025, IJHMT 239:126599): `Nu = 0.2644·Re^0.69·Pr^(1/3)·(μ/μ_w)^0.20`, Fanning `f = 1.850·Re^-0.17` (gyroid ~15% higher than diamond; the paper finds gyroid ≡ diamond thermally). Implemented in `engine/tpms_correlations.py` (webapp-native) with Re/Pr on the interstitial velocity + minimal-surface D_h. **Regime caveat:** the fit is Re 2961–18254 (turbulent) but this cold plate runs Re_Dh ≈ 200; every evaluation is therefore flagged EXTRAPOLATED. It is retained because (a) it is the only extractable peer-reviewed set and (b) extrapolated to Re≈200 it gives Nu≈19, order-of-magnitude consistent with independent in-regime experimental data (Re 50–300: gyroid Nu≈28, diamond≈24, primitive≈19). **Gyroid & Diamond now report ANALYTICAL_LIT** (was SCREENING_ONLY). **Schwarz-P stays SCREENING_ONLY** — no in-regime coefficient set was found and none was fabricated; it keeps the part-1 derived geometry + generic Nu. The paywalled 2026 meta-analysis (S2590123026004421) and Reynolds et al. 2023 (in-regime, 100<Re_H<2500) remain the upgrade path once their coefficients are obtainable. Tests: test_v2_tpms_corr.py (15 checks); parity 5/5.


**Part 2b (done, 2026-07-02) — jet-adaptive cell grading in the TPMS solver.** The `cell_grading` slider was previously viewer/STL-only. `tpms_correlations.evaluate_tpms` now integrates it: the footprint is split into concentric radial zones following the shader law `c(r) = cell*(1 + grade*clamp(r/R, 0, 1.5))` (R = 0.5*min(W,L)), each zone gets its own local cell -> SA/V, void, D_h, Re, Nu, sheet efficiency, combined as parallel conductances (UA = sum). At grade=0 it reduces EXACTLY to the uniform single-zone model (parity/tests unchanged). **Honest limitation:** the combination assumes UNIFORM base heat flux, so this grading law (dense centre, coarser larger-area edges) nets slightly LESS surface area -> R_conv rises modestly with grade. The jet-adaptive BENEFIT (matching cell density to a centre-peaked impingement flux) requires the jet flux profile and is therefore coupled to the jet-impingement LAYOUT model (V2.5); the result carries a warning saying so. Tests: grading now moves R_jc end-to-end (no longer viewer-only); parity 5/5.

## 28. V2.5 — layouts (S3) + jet-flux coupling (2026-07-02)

**Layout resolver** (`engine/layouts.py`, webapp-native): a named flow layout now resolves the five architecture knobs the solvers consume. `single_pass`, `center_feed_bidirectional`, `top_jet_slot_centre_rib_bidirectional`, plus the new `serpentine_n_pass` (path = n*L, +2.2 header-K per 180-deg bend, caveat that deep-laminar Nu is ~flat so it mostly buys DP), `u_flow_side_feed` (uniformity 0.90, header-K 2.5, maldistribution pending CFD), and `distributed_jet_compartments` (ICE Proto2: n jets -> 2n paths, short paths). `multi_jet_array` stays deferred. The layout is authoritative in `resolve_project` (GB202's center-feed at core_length 28 resolves to exactly its historical n=2 / path=14 / header=1.5, so the preset is byte-for-byte unchanged).

**Jet-flux coupling (closes the grading loop).** Each layout also emits a `jet_flux_peaking` scalar (0 = uniform base flux, 1 = central jet). The TPMS solver's R_conv is now the heat-weighted mean wall-to-fluid dT, `R_conv = sum(f_i^2 / UA_i)`, where the heat fraction f_i is centre-peaked under a jet layout. Combined with a corrected **centre-densifying** grading law (`c(r) = cell*(1 + grade*(clamp(r/R,0,1.5) - 0.5))` — finer than nominal at the centre, coarser at the edges; shader + STL + physics all updated to match), jet-adaptive grading now PAYS OFF: under a jet layout a uniform TPMS is penalised (hot centre) and grading the cells dense-under-the-jet lowers R_conv (verified: jet+uniform 0.0353 -> jet+graded 0.0325 K/W); without a jet, grading correctly hurts (don't grade a uniform-flux design). Reduces exactly to 1/UA at grade=0 & no jet -> parity 5/5 unchanged. Tests: test_v2_layouts.py (15 checks).

## 29. V2.6 — report, mass/cost, uncertainty band (2026-07-02)

**Mass / material** (spec §23): every /api/evaluate result now carries `mass_g` (Cu core solid + base slab from the open-volume fraction x 8960 kg/m3) and `material_cost_usd` (~$60/kg powder, MATERIAL only -- excludes AM machine time). Surfaced in the KPI panel + optimizer (mass objective) + report.

**Uncertainty band** (spec §15 Q7): with `"uncertainty": true`, the result adds `r_jc_band` -- R_jc re-evaluated at the Cu-AM conductivity extremes k = 250 (conservative) and 400 (optimistic) W/mK around the design's nominal k. The KPI panel shows R_jc as a band (e.g. 12.2-14.4 mK/W), the honest robustness picture rather than a single point. Additive -> golden parity untouched.

**Report tab**: a header 'Report' button opens a print-ready Markdown design review (report.ts + Report.tsx) -- problem, targets/gates, the selected design's full KPI table (incl. R_jc band + mass), the candidate comparison table, per-design warnings, and a provenance/caveats section citing the solver pedigree (Shah-London, Zukauskas, Renon & Jeanningros) and screening labels. Copy-to-clipboard + download .md. This is the design-review artifact. Validity guardrails were already surfaced via each result's warnings (extrapolation/screening notes) and are reproduced in the report. Tests: test_v2_report.py (7 checks); parity 5/5.

## 30. Post-V2.6 addenda (2026-07-02)

**Optimizer tier 1 — objectives.** The sweep gained flow_lpm as an operating
axis, direction-aware objectives, mass_g/cop per point, and the R_jc floor
(TIM+base) + gate drawn on the charts. Superseded in part by tier 2 below.

**Optimizer — family-aware sweep (fix).** The sweep previously sent fin
variables regardless of family, so TPMS/pin optimization was flat (one
distinct R_jc). `caseFromDesign()` (design.ts) is now shared by evaluate and
sweep; sweepable variables are family-scoped (fin: t/b/H/A/lambda; TPMS sheet:
unit_cell/wall/cell_grading; pin: diameter/pitch; all: flow). Invalid grid
combos (e.g. pin pitch <= diameter) are marked INVALID/infeasible instead of
crashing the sweep. Tests: test_v2_sweep.py.

**Optimizer tier 2 — the problem constrains the optimum.** The sweep base is
built by evalPayload, so the active project's coolant + targets (T_j_max ->
derived R_jc gate, limit_deltaP_Pa, limit_pump_W) ride on every grid point.
`feasible` = fits THIS problem; the starred optimum = best objective among
feasible points (fallback to best-overall, flagged, when nothing fits). The
response echoes the resolved budgets (`gates`); the panel states them, reports
the optimum as T_j margin in degC at TDP, and the Pareto draws the pump-budget
line (the answer = lowest point left of it). Objectives trimmed to R_jc /
pump / DeltaP: COP dropped (Q fixed -> inverse pump power), mass demoted to a
reported metric (as an objective it drives to the flimsiest geometry). The
doctrine (s8) is thereby implemented as: minimize R_jc subject to the
project's hydraulic budgets — the "balance knob" is the budget, not weights.

**STL export — manifold surface nets.** TPMS sheet exports had O(10^5)
non-manifold edges (thin sheet pinching through voxels: plain surface nets
places one vertex per mixed cell). The mesher now places one vertex per
connected inside-corner component per cell (max 4), stitches quads to the
vertex owning each crossing's inside corner, biases multi-component vertices
15% toward their own corners (kissing sheets can't coincide), and drops
disconnected micro-shells (< 32 tris, sub-voxel dust). Measured on the full
35x28 gyroid sheet (offline Node harness bundling the real exporter):
467,122 -> ~5k non-manifold edges (-99%), 35,585 -> ~900 shells, 0 holes,
0 flipped normals, ~10% smaller files; fin/pin exports byte-identical (they
were always clean analytic shells). Residual edges are isolated saddle
point-contacts (face-ambiguity class), auto-repaired by netfabb/slicers; a
full manifold-dual-contouring pass is the (unneeded so far) upgrade path.
The draft/standard/fine picker is always visible, disabled for fin/pin
(exact meshes need no resolution).

**UI quality-of-life.** (a) VS Code-style draggable splitters between
left/centre/right columns and above the bottom panel; sizes persist in
localStorage; double-click resets; CSS-variable driven so the responsive
collapse still wins. (b) Type scale lifted (base 15.5px, body 13-14px,
KPI hero 40px) and a neutral near-black theme (uppercase tracked chrome) for
readability. (c) LAN hosting + launcher .bat + STL export were documented in
README (earlier phases).

## 31. Implicit-body equations — nTop replication

The full engineer-facing recipe lives in **`NTOP_REPLICATION.md`** (kept as
the single source of truth; the About tab carries a condensed version).
Summary of what it pins down:

- Frame/units (mm; x transverse 35, y flow 28, z height; base z in [0, 0.7]).
- Fins: fin i solid where |x - i*p - A*sin(2*pi*y/lambda)| <= t/2, clipped to
  |x| <= W/2 - margin, z in [t_base, t_base+H]; sine phase (cosine files are
  the same body shifted lambda/4); n_max, edge-fin omission rule; centre-rib
  box across the flow at y=0.
- Pins: staggered/inline cylinder array (offset p/2 on odd rows), fully-inside
  rule, same z band.
- TPMS: the 8 level-set fields F(2*pi*p/c); sheet |F| <= iso, solid F <= iso,
  iso = clamp(pi*w/c, 0.06, 1.2) (= nominal wall w where |grad F|=1, +-30%
  local across a gyroid); grading law c(r) = c0*(1 + g*(clamp(r/R,0,1.5) -
  0.5)) with c >= 0.3, R = min(W,L)/2; box/cylinder clips.
- nTop route A (native walled-TPMS blocks, true-offset walls — preferred for
  print CAD) vs route B (custom implicit, exact parity, needed for the five
  exotic types); verification targets rho*, void, SA/V from the A0/a^2
  coefficients (gyroid c=2.5/w=0.12: rho*=0.148, SA/V=2473 m2/m3).

---

## V3 — "Explainability, Areas & Manufacturability" (ACCEPTED 2026-07-09)

> **Status: ACCEPTED 2026-07-09 — all §37 questions resolved; implementation
> per the §36 roadmap.**
> Three asks (2026-07-09): (1) rewrite the About tab so every explanation is
> understandable by a non-specialist, (2) add area readouts for every design,
> (3) add real manufacturing constraints for **SLM** (researched) and **LMM**
> (from the Incus email, Paul Peritsch 2026-07-07). Decisions: fin-only areas;
> M1 primary / M2 backup; both SLM routes (OEM = Nikon SLM Solutions);
> enforcement modes (§35F); DLP pixel-preview tab (§35D-7).

## 32. V3 scope & principles

| # | Feature | Touches | Physics change? |
|---|---|---|---|
| V3.1 | About tab rewrite — plain-language explanations | `About.tsx` only | none |
| V3.2 | Area readouts per design | engine (additive fields) + KPI panel + candidate table + report | none (exposes already-computed values) |
| V3.3 | Manufacturing constraints layer — LMM + SLM rulebooks | new `engine/manufacturing.py` + routes + sliders + KPI card + heatmap + optimizer | none to thermal/hydraulic solvers; adds a parallel manufacturability check |

Principles carried over: physics stays server-side and untouched (D8); all API
additions are **additive fields** so the 5 golden fixtures still pass
bit-for-bit; manufacturability stays an *annotation/verdict*, never a silent
mutation of the design (LMM-intent philosophy, §6B) — but V3 upgrades it from
one number (a floor) to a **two-tier rulebook** (absolute vs recommended).

## 33. V3.1 — About tab rewrite (plain language)

**Problem:** the current About is written engineer-to-engineer. Each section
leads with an equation; the "why should I care" is buried or implicit.

**Fix — every section gets the same 3-layer structure, top to bottom:**

1. **Plain words** (new, styled callout box first): 1–2 sentences, zero
   symbols, one everyday analogy.
2. **The math** (kept as-is — equations are not dumbed down or removed).
3. **What to do with it** (new closing line): the design decision this
   knowledge drives.

**Planned per-section "plain words" content** (draft copy, to be tuned):

| Section | Plain-words summary (draft) | Analogy |
|---|---|---|
| What this is | "A flight simulator for the cold plate: change the fins, instantly see how hot the chip runs — using the same trusted math as our formal reports." | flight simulator |
| The design problem | "A 450 W chip must stay cool with 25 °C water. We design the copper part between chip and water." | — |
| R_jc | "Heat must pass three doors in a row: the paste (TIM), the copper floor (base), and into the water (fins). We can only redesign the third door — and it's only ~30 % of the total resistance." | three doors in series |
| ΔT = Q·R_th | "Resistance × heat = how much hotter the chip gets. Same as Ohm's law: volts = amps × ohms. Lower resistance = cooler chip. Full stop." | electrical circuit |
| Geometry & fin field | "Thinner fins and gaps = more fins packed in = more contact with water. But the printer has a minimum feature size, and narrow gaps fight the pump." | comb teeth |
| Fin efficiency | "A tall thin fin is like a long corridor from a heated room: the far end barely gets warm. Past a point, extra fin height adds area that does almost nothing." | long corridor |
| Wavy fins | "Wiggly fins stir the water like a bent straw stirs a drink — the water can't settle into a lazy warm layer next to the wall. Best single lever we have." | stirring straw |
| Hydraulics | "Everything you win thermally is paid for in pressure: the pump must push water through those narrow gaps. ΔP is the bill." | the bill |
| Optimization doctrine | "Make the chip as cool as possible **without exceeding the pump's budget**. Thermal is the goal; pressure is the budget; manufacturability is the law." | budget + law |
| Two engines | "A quick estimator that compares all shapes fairly, and a deep validated model for the wavy-fin hero. Numbers are honest screening, not lab-measured truth." | — |
| KPI panel guide | keep tables, wrap in collapsible `<details>` so the page isn't a wall | — |
| Nomenclature / equations / refs | keep, collapsible | — |

**Also new in About:**
- **"This app in 60 seconds"** intro card at the very top: what the 3 columns
  are, what to drag, what number to watch (R_jc), what PASS/FAIL means.
- **"What happens if I…" slider cheat-sheet** (new small table): one row per
  headline slider (t, b, H, A, λ, flow) → effect on R_jc, on ΔP, and its limit
  (e.g. "b ↓ → R_jc ↓ but ΔP ↑↑ — floor set by the printer/cleaning").
- **"The readout strip under the sliders"** (new section, user request
  2026-07-09): a dedicated explainer for the derived numbers
  `pitch · fins · open % · χ`, same 4-column format as the KPI tables
  (what it is / formula / why it matters / what moves it). Draft copy:

  | Readout | What it is | Why it matters / what moves it |
  |---|---|---|
  | **pitch** = t + b | Center-to-center spacing of adjacent fins — one copper wall plus one water gap; the design's smallest repeating unit. | Sets how many fins fit: smaller pitch → more fins → more area, but both t and b move toward the printer's floor together. For LMM the *green* pitch must land on a whole number of 35 µm pixels (M2: 12 px = 0.420 mm) — pitch is what the pixel grid actually quantizes. Overpolymerization moves material from channel to fin but **preserves pitch**, which is why the compensation is written around it. |
  | **fins** (count) | How many fins fit across the transverse span: ⌊(W_trans − 2·margin) / pitch⌋. | Every fin adds two water-facing faces, so wetted area — and with it R_conv — scales almost directly with this number (hero: 166 fins ≈ 715 cm²). It is an *integer*: while dragging t or b the count jumps in steps, which is why the KPIs visibly "tick" instead of gliding — each tick is one whole fin (≈ 2·H·L_arc of area) appearing or vanishing. |
  | **open %** (open fraction) | Share of the fin-field cross-section that is water instead of copper: n_ch·b / (n_fin·t + n_ch·b). 50 % = equal metal and water. | A manufacturability + reliability number, not a performance target. Too low → channels can't be cleaned/depowdered, clog-prone, and the part is heavy; too high → few fins, little area. Gate band ≈ 0.35–0.75. Note t = b always gives ≈ 50 % regardless of how small both are — which is why the hero and M1/M2 all hover near 50 %. |
  | **χ** = 2π·A/λ | Wave-sharpness: the slope of the fin path at its steepest turn. Neither A (how far the wiggle swings) nor λ (how often it repeats) alone says how sharp the wiggle is — their ratio does. Mountain-road analogy: A = how far the switchbacks swing out, λ = distance between them, χ = how sharp the hairpins feel. As an angle: χ = 0 → straight; 0.5 → 27°; 1.0 → 45°; hero 1.38 → ≈ 54° (moving more sideways than forward at the steepest point). The 2π is just the calculus of a sine's slope. | The single strongest thermal lever, and it works twice. (1) A wiggly line is longer than a straight one — by ×√(1 + χ²/2); at χ = 1.38 that is ×1.40 = **40 % more fin surface in the same footprint**, free. (2) At Re ≈ 50 water flows like honey in smooth sheets, and a warm "blanket" layer sits stuck to the fin wall insulating it; each bend slings the water into corkscrew swirls (Dean vortices) that peel the blanket off and press fresh cool water on the metal — sharper turns, stronger swirls (the Nu ×= 1 + 0.40·χ^1.5 term). Price: the water travels the same 40 %-longer path → ΔP up; too sharp can also pinch the channel locally below the printable gap (`lmm.pinch`). Keep A/λ in the 0.05–0.30 band. |


>[!note] 
>
>Let me explain it from zero, because χ is genuinely the least obvious number on that strip.
>**What χ literally is: the steepness of the sharpest turn.**
>
>Each fin is a sine wave: it swings sideways by ±A (amplitude) and repeats every λ (wavelength). Now imagine walking along that fin. Twice per wave — where the sine crosses the centerline — you are cutting sideways at your steepest angle. χ is the slope at that steepest moment. The 2π is just what calculus gives when you take the slope of a sine wave; there's no deeper meaning to it.
>
You can convert χ to an angle you can picture:
>
>- χ = 0 → straight fin, you always walk straight ahead
>- χ = 0.5 → steepest moment ≈ 27° off the flow direction — a gentle weave
>- χ = 1.0 → 45° — at the steepest point you're going as much sideways as forward
>- **χ = 1.38 (the hero) → ≈ 54°** — at the steepest point you're moving _more sideways than forward_
>
**Why one number instead of A and λ separately?** Because neither alone tells you how sharp the wiggle is. A huge swing (big A) stretched over a very long wave (big λ) is a lazy drift — nearly straight. A tiny swing repeated every half millimeter is a violent zigzag. What matters is the _ratio_ — swing per unit length — and that's χ. Think of a mountain road: A is how far the switchbacks swing out, λ is the distance between them, χ is how sharp the hairpins feel.
>
**Why it helps, twice:**
>
>1. **More fin in the same box.** A wiggly line between two points is simply longer than a straight one — by the factor √(1 + χ²/2). At χ = 1.38 that's ×1.40: the same 28 mm footprint holds **40% more fin surface**, without changing t, b, or H.
>2. **It stirs water that refuses to stir itself.** At Re ≈ 50 the flow is deeply laminar — water slides in smooth parallel sheets like honey, and a warm "blanket" layer sits stuck against the fin wall, insulating it. Every bend slings the water sideways into corkscrew swirls (Dean vortices) that peel that warm blanket off and press fresh cool water against the metal. Sharper turns (higher χ) = stronger swirls. That's the `Nu ×= 1 + 0.40·χ^1.5·…` term.
>
**The price:** the water must travel that same 40%-longer path through narrow gaps and around bends, so ΔP goes up — and if adjacent fins ever fall out of phase, a sharp wave can locally pinch the channel below the printable gap (that's exactly the `lmm.pinch` rule Incus warned about).
>
So on the strip, read **χ 1.38** as: _"strongly waved — 54° hairpins, 40% bonus area, strong stirring."_

- **Manufacturing constraints section** (new; content = §35 rulebooks with
  sources, including the Incus email citation and SLM references).
- Area terms (§34) added to the nomenclature table.

Acceptance: review-read by a non-thermal colleague; no numeric content changes.

## 34. V3.2 — Area readouts per design

**Terminology (settled 2026-07-09, user decision):** the model's wetted area
assumes a fully flooded core: `A_wet = A_fin (both fin side faces) + A_base
(channel floor)` (`master_baseline_calculator.py` `_evaluate_fin_family`).
**Decision: the displayed area is the STRUCTURE surface only — fins, no
channel-floor base.** Per family: fin families → `A_fin` (both side faces;
tip faces excluded per the adiabatic-tip fin model); pin fins → pin lateral
area `N·π·d·H` (endwall floor excluded); TPMS → the lattice sheet surface
(which is the whole structure — no floor to exclude). For the thin-fin hero
the floor is ~1 % of A_wet anyway, so the fin-only number is also the honest
one. The full model `A_wet` (incl. floor) stays available in the Report for
traceability with the SA/V figures.

| Readout | Definition | Unit | Source |
|---|---|---|---|
| `A_die` | die footprint (24 × 31) | cm² | stack (constant 7.44 cm²) |
| `A_cooled` | cooled core footprint W × L | cm² | `stack.cooled_area_m2` (drives coverage) |
| `A_fin` | raw fin (structure-only) surface area — no channel floor | cm² | engine internal `A_fin` / `A_pins` / TPMS sheet area — expose |
| `A_fin,eff` | honest working fin area = A_fin · η_f · uniformity · access | cm² | derived (η_f directly, since floor is excluded) |
| **Amplification** | A_fin / A_die — "one die area becomes N areas of wet copper" | × | derived |
| `A_flow` | open flow cross-section (sets velocity) | mm² | `flow_area_m2` (already in result dict) |
| `A_wet` (report only) | full model wetted area incl. channel floor (basis of SA/V and UA) | cm² | `wetted_area_m2` (already in result dict) |

Hero example (for the About copy): A_fin ≈ 715 cm² from a 7.44 cm² die ≈
**~96× amplification**, but after the fin-efficiency haircut the *effective*
area is ~×14 — the same raw-vs-effective story the SA/V pair tells, now in
absolute, intuitive units.

**Where surfaced:**
1. **KPI panel Card 3** gains an "Areas" row group: A_fin, A_fin,eff (with
   amplification ×N badges), A_flow. Footprints stay implicit via coverage.
2. **Candidate table** gains three compact columns: `A_fin (cm²)`, `eff ×`
   (effective amplification), and `A_flow (mm²)`.
3. **Report tab**: full area block per §34 table (incl. A_wet for
   traceability).
4. **About**: nomenclature rows + a short "Reading areas" note (structure-only
   definition, raw vs effective, why amplification is the honest brag number).

**Engine/API:** additive `areas` object on every evaluate/solve result:
`{die_cm2, cooled_cm2, fin_cm2, fin_eff_cm2, flow_mm2, wetted_cm2,
amplification, amplification_eff}`. Exposing `A_fin` needs a ~5-line additive
change per family evaluator (values exist locally). Golden parity untouched
(new keys only).

## 35. V3.3 — Manufacturing constraints (LMM + SLM)

**Problem:** V1 §6B modelled manufacturability as **one number per route**
(min wall/gap 0.10 / 0.12 / 0.20 mm). Reality since then: Incus reviewed our
actual v6 STLs (email 2026-07-07) and rejected the 0.10 mm target — the true
LMM constraint set is richer (cleanability floor, pixel grid, overpoly,
shrinkage, aspect ratio, drainage). SLM likewise has published rules well
beyond a single floor. V3 replaces the single floor with a **per-route DfAM
rulebook**, checked live.

### 35A. LMM rulebook (Incus Hammer EVO35 — authoritative; revised 2026-07-30 to the official guidelines)

Source (since 2026-07-30): **`05_References/Incus_Design_Guidelines.pdf`**
(*Component Design for Lithography-based Metal Manufacturing of Cu-OF*,
July 2026 — the official rules; ALL dimensions are **green**-state px,
1 px = 35 µm, which **closes** the old green-vs-final open question #1) +
Paul Peritsch's emails 2026-07-07 (first STL review, distilled in
`03_Reports/.../cold_plate_v6_incus_manufacturability_review_20260708.md`)
and **2026-07-29** (px review of the rev5 wavy + ICE arrays: 2 px gap
cross-sections "will not be cleaned", 1–2 px fins too thin, "gaps should be
wider than fins"). Rulebook bounds convert green px → final mm via ÷1.197.

| Rule id | Constraint | Absolute | Recommended | Tier |
|---|---|---|---|---|
| `lmm.gap_min` | channel gap `b` (final), depth > 1 mm | ≥ 0.175 mm (6 px green — below it deep channels won't clean) | **≥ 0.234 mm** (8 px; guidelines band 6–8 px) | hard / soft |
| `lmm.gap_min` | channel gap `b` (final), depth ≤ 1 mm | ≥ 0.146 mm (5 px — cleaned, reliability drops) | **≥ 0.175 mm** (6 px) | hard / soft |
| `lmm.fin_min` | fin thickness `t` (final) | ≥ 0.088 mm (3 px green, printed successfully) | **≥ 0.117 mm** (4–5 px reliability band; tested at ~1 mm height) | hard / soft |
| `lmm.gap_ratio` | gap vs fin: `b ≥ t` ("gaps should be wider than fins", email 2026-07-29) | — | b ≥ t | soft |
| `lmm.fin_height` | fin height vs the ~1 mm tested envelope (taller may deform in cleaning) | — | advisory | ℹ |
| `lmm.aspect` | fin aspect ratio H/b | ≤ 40 (legacy) | **≤ ~30** ("taller fins need thicker fins") | soft |
| `lmm.gap_perp` | perpendicular passage across the wave, `tanθ = 2πA/λ` — **construction-dependent** (2026-08-05b): shear `b·cosθ`, offset `(t+b)·cosθ − t`. Both mesh-validated | ≥ 0.175 mm (6 px green) | — (rec tier stays on `gap_min`) | hard |
| `lmm.wall_perp` | fin across the wave: `t·cosθ` for a shear, constant `t` for an offset sweep (2026-08-05) | ≥ 0.088 mm (3 px) | ≥ 0.117 mm (4 px) | hard / soft |
| `lmm.wave_merge` | offset sweeps only: fins TOUCH once `(t+b)·cosθ ≤ t` — channel closed, not merely narrow (2026-08-05b) | slope < merge angle | — | hard |
| `lmm.build_envelope` | GREEN part fits the Evo35 platform 56 × 89.6 × 150 mm (2026-08-05, from Incus's `.cfgx`) | must fit | — | hard |
| `lmm.slice_px` | fin · gap · **pitch** in green px — what Incus counts on the raster; pitch is NOT the gap (2026-08-05) | — | quote all three | ℹ |
| `lmm.shrink_basis` | our x1.197/x1.23 vs Incus's profile `SCx121y122z125` (anisotropic); slice with SC **off** (meshes are pre-scaled) | — | open question for Paul | ℹ |
| `lmm.pixel_snap` | XY dims = n × 35 µm; Z = n × 25 µm (green) | — | snap all of t, b, p, A, λ, H | advisory + helper |
| `lmm.overpoly` | CAD pre-compensation: fin −2 px, channel +2 px (in CAD, not slicer) | — | applied in export recipe | advisory (export) |
| `lmm.shrink` | green = final × 1.197 (XY) / × 1.23 (Z) | — | applied in export recipe | advisory (export) |
| `lmm.pinch` | channel width constant along wavy path — no local pinch below `gap_min` | check min gap along path | — | hard |
| `lmm.big_part` | part ≫ proven 7.7 × 7.7 mm coupon → cleanability unproven | — | warn when core footprint > ~4× coupon area & b < 0.25 | warning |
| `lmm.drainage` | drainage holes + gravity drain path required | — | checklist item (not geometric) | checklist |

**Consequence — defaults change (breaking vs V1 §6B):** the LMM route floor
moves **0.10 → 0.15 mm absolute / 0.20 mm recommended**. The 0.10 mm hero
preset is kept for provenance but gets a permanent
**"not printable/cleanable per Incus 2026-07-07"** badge. Three new presets
are added as candidates (from the manufacturability review, §4–§6).
**Team decision 2026-07-09: M1 is the primary manufacturing target; M2 is the
backup** (accept ~1 K more junction rise only if M1's 0.15 mm gap fails the
cleanability coupon). **Revision 2026-07-30 — the 2026-07-29 email supersedes
this in practice:** Incus reviewed the rev5 wavy + ICE parts (M1-class
geometry, gap ≈ 5 px green) and stated such gaps "will not be cleaned", and
the official guidelines put channels deeper than 1 mm at 6–8 px green. The
manufacturability card therefore now shows M1 as **FAIL** (below the 6 px
deep-channel floor), M2 as **MARGINAL** (7 px, inside the band, under the
8 px recommendation) and M3 as **PASS** — the rulebook working as intended,
not a bug.

| Preset | t / b / H (mm) | N_fin | R_jc (mK/W) | ΔT @575 W | Verdict chip (rev 2026-07-30) |
|---|---|---:|---:|---:|---|
| `v6 LMM M1` (was primary) | 0.12 / 0.15 / 5.5 | 122 | 14.6 | 8.4 K | FAIL — gap ≈ 5 px, below the 6 px deep-channel floor (won't clean) |
| `v6 LMM M2 (backup)` | 0.15 / 0.20 / 5.5 | 94 | 16.2 | 9.3 K | MARGINAL — 7 px, inside the 6–8 px band, under the 8 px rec |
| `v6 LMM M3 (easy-clean)` | 0.15 / 0.25 / 5.0 | 83 | 17.9 | 10.3 K | PASS — ≈ 8.5 px, meets the recommendation |
| **`v6 LMM M4 (guideline)`** ✅ | 0.175 / 0.234 / 5.5 (px-exact 6/8) | — | 18.0 | 10.4 K | PASS — constrained optimum under the 07/2026 rules; default selection |

**M4 (added 2026-07-30)** is the solver's constrained optimum inside the
guideline-legal region: 6 px fins beat 4 px on fin efficiency at H 5.5 (η_f
0.28 vs 0.23 — fewer, better fins win), the gap sits exactly on the 8 px
deep-channel recommendation, and gap > fin holds with margin. Cost vs the
dead M1: ≈ +1.7 K at 575 W (R_jc is TIM+base dominated, so the sacrifice is
small); gates keep ≥ 4× margin. Its CAD export chain (green, overpoly
pre-compensated): fin 0.140 (4 px drawn), gap 0.350 (10 px drawn), pitch
0.490 (14 px), H 6.775, A 0.665, λ 3.010. **Default selected candidate
switches M1 → M4.**

**Default selected candidate switches from the 0.10 hero to M1** (hero stays
as a reference row).

**Green→CAD converter (new, LMM route only):** a small readout under the
sliders showing the current design's full export chain per the M2 recipe —
final → ×shrink → pixel-snapped green → ∓2 px overpoly → **CAD value** — for
t, b, p, H, A, λ. This is the nTop handoff artifact and makes the pixel rules
tangible instead of preachy.

### 35B. SLM rulebook (researched 2026-07-09 — vendor-guide + literature grade)

Two SLM flavours, because their limits differ by ~4×:

**Route `slm_ir` — standard IR-laser LPBF, Cu alloy (CuCrZr class):**

| Rule id | Constraint | Absolute | Recommended | Basis |
|---|---|---|---|---|
| `slm.wall_min` | fin/wall thickness | ≥ 0.3 mm (thin-wall studies reach 0.1–0.15 but not robust) | **≥ 0.4 mm**; EOS CuCrZr guidance for reliable walls up to 0.8 | thin-wall LPBF literature; vendor guides |
| `slm.gap_min` | channel gap / slot | ≥ 0.4–0.5 mm printable | **≥ 0.5 mm** for depowdering deep channels; HX practice suggests D_h 1.5–2.0 mm for *reliable* powder evacuation at our depth | vendor guides; Cu-HX practice |
| `slm.overhang` | down-facing surfaces ≥ 45° or supported | 45° rule | self-supporting horizontal channels ≤ ~8 mm dia; teardrop/diamond above | LPBF overhang literature |
| `slm.aspect` | free-standing thin-wall aspect ratio | — | ≤ ~10 (recoater interaction / distortion) | vendor guides |
| `slm.roughness` | as-built internal Ra ≈ 6–15 µm (worse on downskin) | — | warn when Ra is > ~5 % of gap `b` (couples to the solver's existing roughness correction) | AM-channel roughness studies |
| `slm.tolerance` | dimensional ± 0.1–0.2 mm | — | warn when t or b < 5× tolerance | vendor guides |
| `slm.depowder` | unfused **powder** (not liquid feedstock) must be shaken/blown out | — | open both channel ends; no blind pockets | process nature |

**Route `slm_green` — fine green-laser LPBF, pure Cu (TruPrint/AddiReen class):**

| Rule id | Constraint | Absolute | Recommended | Basis |
|---|---|---|---|---|
| `slm.wall_min` | wall thickness | ≥ 0.1 mm (demonstrated, research-grade; 0.08 claimed) | **≥ 0.15–0.20 mm** practical | green-laser pure-Cu studies |
| `slm.gap_min` | channel gap | ≥ 0.2 mm | **≥ 0.3 mm** (depowdering still governs; fine powder 5–25 µm helps) | same + fine-powder machines (25 µm spot / 10 µm layers) |
| others | overhang / aspect / roughness / tolerance as `slm_ir`, tightened | — | Ra lower (fine powder), tolerance ± 0.05–0.1 | same |

Material note carried to the k_solid band (§15 Q7): green-laser pure Cu
reaches 99.6–99.8 % density and ~76–100 % IACS — consistent with the existing
250/340/400 W/m·K band; the route selector will annotate which band edge is
realistic for the chosen route.

**Honesty tier:** unlike the LMM rulebook (supplier-stated, on our own
geometry), the SLM numbers are **vendor-guide + literature grade** — good for
screening and for keeping SLM designs honest, but a supplier DfM review is
required before committing an SLM print. The UI labels the two rulebooks
accordingly (`supplier-verified` vs `literature`).

**Target OEM (decision 2026-07-09): Nikon SLM Solutions.** Their machines
(SLM 280/500, NXG XII 600) are IR-fiber-laser LPBF → `slm_ir` is the rulebook
that maps to this supplier path and is annotated as such in the UI; `slm_green`
is kept as the alternate fine-feature pure-Cu path (Trumpf/AddiReen-class
machines). When Nikon SLM Solutions provides machine-specific design
guidelines or a DfM review, those numbers replace the literature values in
`slm_ir` (same upgrade path as the Incus coupon for LMM).

### 35C. Engine & API

- New `engine/manufacturing.py`: `RULES = {route: [Rule, ...]}` (data, not
  code — each Rule = id, description, tier, bound(s), basis/source string) +
  `check_manufacturability(design, route) → {verdict, checks[]}` where verdict
  ∈ PASS / MARGINAL (inside absolute, outside recommended) / FAIL, and each
  check reports its rule id, measured value, bound, and source.
- `POST /api/evaluate` result gains additive `manufacturability` object.
  Pure function of geometry — no thermal coupling; golden parity untouched.
- `GET /api/schema` serves the rulebooks so the UI never hard-codes them.
- Process-route enum becomes `{lmm, lmm_supplier_qualified (legacy), slm_ir,
  slm_green}`; per-route floors used by sliders/optimizer now come from the
  rulebook (absolute = hard clamp, recommended = soft band).

### 35D. UI

1. **Manufacturability card** (new, KPI panel, under Card 3): overall
   PASS / MARGINAL / FAIL chip + one line per failed/marginal rule with its
   source ("gap 0.10 < 0.15 mm — Incus cleanability floor, email 2026-07-07").
2. **Two-tier slider feasibility:** track shading amber between recommended
   and absolute bounds, red below absolute (extends the existing red-floor
   behaviour).
3. **Heatmap:** feasible-region shading gains the same two tiers (dark =
   violates absolute, light = violates recommended).
4. **Optimizer:** absolute bounds constrain the sweep as today; recommended
   bounds shown as a dashed contour; the ★ optimum reports its
   manufacturability verdict next to the T_j margin.
5. **Green→CAD converter** (LMM only, §35A).
6. **Candidate table**: M1/M2/M3 presets appear as candidates; verdict chip
   per row.
7. **DLP pixel-preview viewer tab** (new, LMM route — user request
   2026-07-09, modelled on DLP-slicer slice views): renders the design's
   cross-section at a chosen height **rasterized onto the printer's pixel
   grid**, exactly as the Hammer EVO35 would expose it — a black/white pixel
   mask like a slicer's layer preview.
   - **Pipeline per frame:** current design → green scale (×1.197 XY) →
     sample the same SDF the 3-D viewer uses at each 35 µm pixel centre at
     height z → binary mask; optional overpoly toggle offsets the SDF by
     ±1 px before thresholding to preview the as-printed (fin +2 px, channel
     −2 px) vs CAD-compensated outcome.
   - **Controls:** Z slider stepping in 25 µm green layers (with layer
     number readout), zoom/pan, overlay toggles: nominal CAD outline vs
     rasterized mask, overpoly on/off, and a **violation overlay** painting
     any channel run narrower than 6 px (and any fin thinner than 3 px) in
     red — this makes `lmm.pixel_snap` and `lmm.pinch` visible instead of
     abstract.
   - **Readouts:** min channel width (px) / min fin width (px) found in the
     current layer, % of pixels changed by overpoly, current layer count vs
     total (H green / 25 µm).
   - Implementation note: a 2-D canvas/WebGL fragment-shader raster of the
     existing SDF — no new geometry code, no server round-trip; the wavy-fin
     moiré look of a real slicer preview falls out naturally.

### 35E. What this supersedes

- §6B process-route floor table → replaced by the rulebooks (kept for history).
- §15 Q6 "LMM 0.10 defensible floor" → **overturned by supplier evidence**
  (Incus 2026-07-07): 0.10 mm is not printable/cleanable. The solver still
  *evaluates* below-floor geometry (for study reproduction); it just fails the
  manufacturability check loudly.
- §16 "supplier coupon status" open item → answered for LMM by the Incus
  review; the Option-2 coupon matrix (review §11) remains the empirical
  upgrade path and is referenced in the About copy.

### 35F. Design-tab integration — the design follows the constraint (added 2026-07-09)

The manufacturing constraint is not just a warning layer: it is part of the
**problem definition**. The Design tab (Step 1, T2 "design rules" block —
where the process route already lives) gains an **enforcement mode** stored on
the project (`{process_route, enforcement_mode}`), and everything downstream
obeys it:

| Mode | Sliders | Optimizer sweep | Presets offered | Use case |
|---|---|---|---|---|
| **Design-to-manufacture** (default) | hard-clamped at the **recommended** bounds | only rule-compliant region is searched; ★ optimum is compliant by construction | compliant only (LMM → M2/M3 band) | normal design work — you cannot draw an unprintable part |
| **Allow marginal** | clamped at the **absolute** bounds; the amber zone (absolute→recommended) is reachable and shows MARGINAL live | feasible = above absolute; recommended band drawn as dashed contour | + marginal presets (M1 lives here) | current project stance: chasing M1 while the Incus coupon is pending |
| **Explore / audit** | no clamps — verdict chips annotate only (V1 behaviour) | unconstrained; verdict reported per point | all, incl. the 0.10 hero | reproducing old studies, sensitivity work, honesty checks |

With M1 as the primary target, the **project default is "Allow marginal"** —
the app lets you sit on the 0.15 mm floor but never lets you forget it's
marginal.

**Supporting features:**

1. **"Make manufacturable" button** (Explore tab, next to the verdict chip):
   one click projects the current design onto the nearest rule-compliant
   point — `b → max(b, bound)`, `t → max(t, bound)`, `H` trimmed if
   AR > 30, then (LMM) pixel-snap all dims — and shows the before/after KPI
   delta (e.g. hero 0.10 → compliant: R_jc 12.9 → ~15–16 mK/W, ΔT +~1.5 K)
   with accept / revert. The cost of compliance is always explicit, never
   silent.
2. **Two stars in the optimizer:** ★ constrained optimum (respects the mode)
   and a ghost ☆ unconstrained optimum — the gap between them is the price
   of manufacturability, visible on every sweep.
3. **Wizard preview card** states the active constraint set in words:
   "LMM (Incus EVO35): gap ≥ 0.175 / rec 0.234 · fin ≥ 0.088 / rec 0.117 ·
   AR ≤ 30 · pixel 35/25 µm · official guidelines 07/2026" (values render
   from the rulebook, so they track revisions).
4. **Route × family guard:** the wizard warns when a family/route pairing has
   no verified rule set (e.g. TPMS on LMM inherits the same gap rules with a
   "coupon was gyroid 7.7 mm — size unproven" caveat).

## 36. V3 roadmap (proposed)

| Phase | Deliverable | Acceptance |
|---|---|---|
| V3.1 | About rewrite (plain-words layers, 60-second intro, cheat-sheet, collapsibles) | readable by non-specialist; no numeric changes |
| V3.2 | `areas` fields (engine additive) + KPI/candidate/report surfacing + About rows | golden parity 5/5; areas match hand-check (hero A_fin ≈ 715 cm², ~×96 / ~×14 eff) |
| V3.3a | `manufacturing.py` rulebooks + `/api/evaluate.manufacturability` + schema | unit tests per rule; hero → FAIL (lmm.gap_min), M1 → MARGINAL, M2 → PASS; parity 5/5 |
| V3.3b | UI: manufacturability card, two-tier sliders/heatmap, route selector, M1–M3 presets, **enforcement modes + "make manufacturable" + two-star optimizer (§35F)** | verdicts match engine; presets reproduce review §5 numbers; mode clamps propagate to sliders + sweep; make-manufacturable projects hero → compliant point with KPI delta shown |
| V3.3c | Green→CAD converter readout | reproduces the M2 recipe table (review §6) exactly |
| V3.3d | DLP pixel-preview viewer tab (§35D-7) | mask matches SDF at 35 µm/25 µm green grid; hero shows channel-closure in overpoly view; M1/M2 stay open; violation overlay flags < 6 px runs |

## 37. V3 open questions (answer before/at acceptance)

1. ~~Default candidate~~ **ANSWERED 2026-07-09: M1 is the primary target, M2
   backup** — default selected candidate = M1; hero kept as reference row.
   Rulebook bounds stay as Incus stated them (absolute 0.15 / recommended
   0.20), so M1 displays MARGINAL until the coupon test upgrades it.
2. ~~Green-vs-final basis~~ **ANSWERED 2026-07-09: OK as drafted** — check the
   conservative interpretation (final dims), show both in the converter.
3. ~~SLM flavours~~ **ANSWERED 2026-07-09: keep both.** Target OEM = **Nikon
   SLM Solutions** (IR-laser machines → `slm_ir` is the supplier-mapped
   rulebook; `slm_green` retained as the fine-feature pure-Cu alternate).
4. ~~Area columns~~ **ANSWERED 2026-07-09: include `A_flow` too** → columns
   `A_fin`, `eff ×`, `A_flow`. Also: areas are **fin/structure-only** (no
   channel-floor base) per the same-day decision in §34.
5. ~~Pixel-snap helper~~ **ANSWERED 2026-07-09: definitely wanted, plus a
   dedicated DLP pixel-preview viewer tab** (slicer-style layer mask view) —
   specced as §35D-7 / roadmap V3.3d. Snap stays advisory readout + the
   preview makes violations visible; a "snap now" button can be added there
   later if wanted.

**All §37 questions are now answered — V3 draft is ready for final
acceptance.**

---

### V3 changelog (accepted + built 2026-07-09)

All §36 phases implemented and verified the same day:

- **Engine:** new `engine/manufacturing.py` — rulebooks LMM / SLM_IR /
  SLM_GREEN, `check_case()` verdicts, `lmm_recipe()` green→CAD chain,
  `/api/schema.manufacturing`; `fin_area_m2` exposed by every family
  evaluator (fin faces / pin laterals / TPMS sheet).
- **Server:** every result carries additive `areas` + `manufacturability`
  blocks; M1/M2/M3 ride along as preset candidates (M1 = default selection,
  hero kept as reference); sweep annotates every point with its mfg verdict
  and returns `optimum` (★ compliant per enforcement mode) +
  `optimum_unconstrained` (☆ gates-only).
- **Frontend:** `manufacturing.ts` mirror (instant slider verdicts,
  mode-aware floors, make-manufacturable projection, green→CAD);
  DesignControls (two-tier red/amber/green band strips, verdict chip,
  ⚒ fix button, AR readout, `GreenCad` converter); KpiPanel (areas strip +
  Manufacturability card); CandidateTable (A_fin / eff × / A_flow / mfg
  columns); Report (areas + mfg findings); Optimizer (two stars +
  price-of-manufacturability note; heatmap mfg-tier dimming); DesignStudio
  (enforcement-mode selector, §35F); `PixelPreview.tsx` DLP layer-mask tab
  (§35D-7: 35/25 µm grid, Z layer slider, overpoly + violation overlays,
  min-run readouts); About fully rewritten per §33 (plain-words layers,
  60-second intro, readout-strip explainer incl. the χ hairpin framing,
  manufacturing-constraints section, slider cheat-sheet, collapsibles).
- **Post-ship UI tweaks (2026-07-09, user requests):** pixel-preview zoom moved
  from a dropdown to **scroll-wheel zoom toward the cursor** (10 %–1600 %,
  native non-passive listener) + **drag-to-pan** (wheel no longer scrolls);
  toolbar shows live zoom % + a fit button. Readability pass: **pixel-grid
  overlay** above 600 % zoom (one cell = one 35 µm printer pixel), **hover
  measurement** (the feature under the cursor reports its true width in px +
  mm green — no manual counting; slanted-row chords labelled as such), and
  fin-family min-width stats/violations switched from per-row run scans to
  the **analytic perpendicular widths** (t ± comp, b ∓ comp) — removes the
  false "min fin 1 px" stair-step artifacts of rasterized wavy fins
  (TPMS/pin keep the run heuristic; no constant width exists there).
- **Unit change (2026-07-09, user request):** all V3 surface-area readouts
  (A_fin, A_eff, A_wet, die/cooled) display and serialize in **mm²** instead of
  cm² (API fields renamed `*_cm2` → `*_mm2`; thousands separators in the UI;
  §34's cm² examples read ×100). A_flow was always mm².
- **Tests / verification:** new `test_v3_manufacturing.py` (35 checks:
  hero FAIL / M1 MARGINAL / M2+M3 PASS fixtures, area hand-checks
  (~715 cm², ×96/×14), the exact review-§6 M2 green→CAD table, sweep
  enforcement semantics, route normalization, schema); `test_v2_projects.py`
  updated for the +3 presets. Full suite green: parity 5/5 golden-exact,
  all V2 suites, V3 35/35; frontend type-check + production build clean;
  HTTP smoke verified (catalog = 8 candidates w/ areas + verdicts, schema
  routes, two-star sweep, static frontend).

---

## V4 — "Verify" (nTop round-trip verification) (DRAFT 2026-07-17)

## 38. V4 concept, scope & principles

**What it is.** A new **Verify tab**: drop the file Hieu exports from nTop
(the geometry that actually goes to Incus) onto the app and get a verdict on
whether it matches the design the solvers scored — against the implicit
field (geometry), against the solver's geometric inputs (KPI trust), and
against the DLP pixel grid (print outcome). `NTOP_REPLICATION.md` §3.6
already defines verification *targets* measured by hand in nTop; V4 turns
that section into software, in the reverse direction.

**Key decisions (brainstorm log, 2026-07-17):**

1. **Mesh route (binary STL) chosen** as the interchange format — it is the
   artifact the printer receives, parses trivially in a worker, and needs no
   third-party kernel.
2. **nTop `.implicit` import rejected.** It is a serialized computational
   graph, not closed-form math: evaluating it requires nTop's licensed C++
   SDK (browser-impossible, breaks the stdlib-only server), full node-
   vocabulary coverage (a kernel project), and even then two implicit
   representations of the same shape only agree on the **zero level set** —
   field values away from the surface are incomparable by construction. So
   any implicit-vs-implicit check reduces to comparing surfaces, which the
   mesh and raster checks already do. The 3MF *implicit extension* (open
   node-graph spec) is a **watch, don't build** item.
3. **Point-map CSV is the implicit-grade check** (V4.4): the app generates
   probe points, nTop's own kernel evaluates its implicit body at them
   (Point Map → CSV export), the app compares zero-crossings. Field-level
   verification with no mesh tolerance in the loop and no SDK.

**Principles (all phases):**

- **Client-side only.** Parse/measure/render in a Web Worker + the existing
  TS field evaluator (`stl.ts` meshes from it today). Zero new endpoints,
  `server.py` stays stdlib-only, golden parity untouched.
- **Physics never runs in the browser** (house rule §4). Verification
  measures *geometry*; when measured geometry should be re-scored, the app
  calls the existing `/api/evaluate` with measured parameters.
- **Explanation-first UI is a P0 requirement, not polish** (user request
  2026-07-17): every number ships with its meaning, method, bound and
  source, per §39. A screen of bare µm statistics is a spec violation.
- **Verdicts reuse the house vocabulary**: PASS / MARGINAL / FAIL chips with
  per-check rows, same shape as the V3 manufacturability card.

## 39. Explanation-first UI contract (P0, applies to every V4 phase)

The tab must be readable by someone who has never seen a deviation map.
Concretely:

1. **Teaching empty state.** Before any file is dropped, the tab shows a
   60-second plain-words explainer (About-tab voice): what verification
   does, the three checks and what each catches, and exactly what to export
   from nTop (frame, units, stage — linking the `NTOP_REPLICATION.md` §6
   contract). Not a blank dropzone.
2. **Guided steps, not a dashboard.** ① drop file → ② confirm what it is
   (stage, units, alignment — with the app's best guess pre-selected and
   explained) → ③ read the verdict. Each step states in one sentence why it
   exists.
3. **Verdict-first, numbers second.** The result opens with a chip + one
   English sentence: *"PASS — 99.2 % of the imported surface lies within
   ±15 µm (half a printer pixel) of the design; worst spot 22 µm, on the
   inlet-side fin tips."* The histogram, map and tables sit below for those
   who want them.
4. **Every number carries an ⓘ** with four fixed fields: *what it is · how
   it was measured · the bound it's judged against + source (Incus email
   2026-07-07 / EVO35 grid / nTop meshing tolerance) · what to do if it
   fails.* Same pattern as the V3 manufacturability rows.
5. **The stage selector explains itself** with a mini-diagram of the
   green→CAD chain (final → ×1.197/×1.230 green → ∓2 px overpoly → CAD) and
   plain captions ("pick *CAD-for-print* if this file already has the
   thin-fin compensation baked in"). **Auto-detect hints**: if the imported
   bounding box is ≈19.7 % oversize the app suggests the green stage; if
   fins measure ≈2 px thin, the CAD stage — with the suggestion worded, not
   silently applied. A wrong-stage comparison is the #1 foreseeable false
   alarm (a ~60–70 µm uniform fin "error" that is actually intentional
   compensation) and the UI's job is to make it impossible to hit silently.
6. **Legends in words and both units.** Deviation colors labelled in µm
   *and* printer pixels ("red = surface sits more than 1 pixel (29 µm) off
   the design"). Histogram gate lines annotated with their meaning, plus
   the **noise floor**: the user-entered nTop meshing tolerance is drawn on
   the histogram so meshing chatter isn't read as rebuild error.
7. **Errors that teach.** Unit mismatch → "this body is ~1000× smaller than
   the design — STL has no units; it was probably exported in metres.
   Scale ×1000?" Axis flip → show the contract axes and offer the swap.
   Non-watertight → say which checks still work (deviation) and which are
   disabled (volume, porosity) and why.
8. **Deltas carry consequences.** Measured-vs-nominal rows (§41) get a
   qualitative note in words ("fin area 4 % low → quoted R_jc is slightly
   optimistic — re-score to quantify"), never a bare percentage.
9. **About tab gains a "Verifying an nTop export" section** mirroring the
   explainer, so the method is documented where the other physics
   explanations live.

## 40. V4.1 — Import & geometry conformance (deviation vs the implicit field)

**Importer.** Binary STL (ASCII detected and refused with guidance —
exports should be binary), parsed in a Web Worker into transferable
Float32 buffers; 50–200 MB TPMS files never block the main thread. Display
copy may be decimated for frame rate; **measurements always run on the full
mesh** (decimation is a display concern only, stated in the UI).

**Stage selector** (per §39-5). The reference field is transformed to match
the declared stage before any comparison:

| stage | reference transform | typical use |
|---|---|---|
| final part | none | design review, CFD export |
| green (scaled) | ×1.197 XY / ×1.230 Z (`LMM_PROC`) | as-printed geometry |
| CAD-for-print | green + pixel-snap + fin −2 px / gap +2 px | the file actually sent to Incus |

**Alignment guard.** Bounding box compared to the contract frame
(`NTOP_REPLICATION.md` §0); auto-suggest axis swaps/flips and centre-offset;
manual nudge as fallback. No silent registration — the applied transform is
always shown.

**Deviation.** Evaluate the TS implicit field at every imported vertex →
signed distance per vertex (near the surface the field is distance-like;
exact enough at these magnitudes). Render as a per-vertex heatmap on the
imported mesh (raymarched view swaps to mesh view), with histogram, p50 /
p95 / max, and % inside each gate. One-sided by design in V4.1 — vertex
sampling cannot see *missing* geometry (a dropped fin has no vertices to
flag); that class is caught by V4.3's raster diff and two-sided pass, and
the UI says so ("this check confirms the surfaces that exist are in the
right place; layer-by-layer comparison below catches anything missing").

**Gates** (judged on |deviation|, after stage transform; 1 px_final =
35 µm / 1.197 ≈ 29.2 µm):

| verdict | rule |
|---|---|
| PASS | p95 ≤ ½ px (14.6 µm) **and** max ≤ 1 px (29.2 µm) |
| MARGINAL | p95 ≤ 1 px |
| FAIL | otherwise |

Rationale (shown in the ⓘ): below the printer's own quantization a
deviation cannot change a single exposed pixel, so ±½ px is "identical as
far as the machine is concerned". The user enters nTop's meshing tolerance
at import; it annotates the histogram as the expected noise floor.

## 41. V4.2 — Solver-input audit (measured vs nominal — "are the KPIs valid for this file?")

A mesh can't verify the correlations, but it can verify the geometric
quantities they consume — where a bad rebuild silently poisons the KPIs.
All measured in the worker, full mesh, stage-corrected back to final
dimensions:

| measured | method | compared against |
|---|---|---|
| watertight? | directed-edge pairing | gate for volume/porosity rows |
| volume | signed tetra sum | nominal solid volume |
| surface area → A_fin | triangle sum, base faces excluded | `areas.fin_mm2` |
| A_flow(z), wetted perimeter → D_h | per-slice cross-sections | solver's A_flow / D_h |
| porosity over core band | slice solid-fraction integral | `void_fraction` (TPMS: §3.6 ρ* check) |
| min wall / min channel | per-slice run scan (same method as PixelPreview) | active DfAM rulebook |

**Outputs:**

1. **Measured-vs-nominal table** in the Verify tab (KPI-panel styling):
   nominal · measured · Δ% · plain-words consequence note (§39-8).
2. **The file gets its own manufacturability verdict**: measured min
   wall/channel run through the same rulebook logic (`manufacturing.ts`) —
   the *export* can FAIL while the nominal design PASSes (or vice versa),
   and that is precisely the point.
3. **"Re-score with measured geometry" button** → `/api/evaluate` with the
   measured parameter overrides → side-by-side KPI delta (nominal vs
   as-exported). Physics stays in the validated solver.
4. **Trust badge** summarising the audit in one line ("geometry matches
   solver inputs within 2 % — KPIs valid for this file").

## 42. V4.3 — Raster conformance (pixel XOR diff — "what the printer sees")

Extends the PixelPreview tab with a **"compare imported" mode** (the tab
already owns the grid math, zoom/pan, hover measurement and violation
overlays):

- Worker slices the imported mesh at the 25 µm green layer pitch
  (≈20.3 µm final), rasterizes each slice onto the 35 µm pixel grid —
  even/odd fill on the slice contours, same grid registration as the
  expected raster.
- **XOR diff** vs the app's expected mask for the declared stage: mismatch
  pixels drawn hot; per-layer mismatch count + a **worst-layer finder**
  (jump-to button). Verdict sentence per §39: *"3 118 of 1.9 M pixels
  differ (0.16 %), all single-pixel edge flicker — no feature-level
  disagreement"* vs *"layer 214: a full fin row is missing."*
- Catches exactly the class V4.1 can't: missing/extra features,
  wrong-sign overpoly, un-applied shrink, off-by-one pixel snapping —
  a file can pass §40's µm gates and still flip a whole pixel row on a
  boundary-sitting fin edge, and vice versa quantization hides sub-pixel
  error; the About copy states this two-check logic in words.
- **Two-sided deviation** lands here too (BVH over the imported mesh,
  `three-mesh-bvh`): sample points on the *design* surface, measure
  distance to the mesh → upgrades V4.1's verdict to a true two-sided
  Hausdorff-style check; one summary row feeds back into the §40 gate
  table.

## 43. V4.4 — Point-map field check (CSV) — the implicit-grade verification

For verifying the *implicit math itself* with no mesh in the loop:

1. Verify tab generates a **sampling recipe CSV** in the contract frame:
   a few section planes (default: the PixelPreview default layer, one
   x-normal and one y-normal mid-plane) at 50 µm pitch, plus jittered
   probes concentrated near the predicted surface. MB-scale, not GB.
2. Hieu imports the points in nTop, evaluates the implicit body on them
   (**Point Map → CSV export**), drops the result back on the tab.
3. The app compares **sign masks and zero-crossing locations along the
   sampling lines** against the TS field — never raw field values (only
   the zero level set is comparable across implicit representations,
   §38-2). Same stats/verdict UI as §40, with the meshing-tolerance row
   absent — this check has no meshing noise floor.

Small by construction: recipe generation + CSV parse in the worker + the
§40 verdict components. Independent of V4.1–V4.3.

## 44. V4 roadmap (proposed)

| Phase | Deliverable | Acceptance |
|---|---|---|
| V4.0 | `NTOP_REPLICATION.md` §6 export contract (frame, units, stage, format, meshing tolerance) + Verify tab teaching empty state (§39-1/2) | contract reviewed by Hieu; empty state readable by a non-specialist |
| V4.1 | STL import, stage selector + alignment guard, one-sided deviation map, gates, ⓘ layer (§39-3…7) | app's own exported STL (fine) re-imported → PASS with deviation ≤ meshing tolerance; same STL scaled ×1.197 vs final stage → wrong-stage hint fires; hand-deformed fixture → FAIL with correct worst-spot |
| V4.2 | measured-vs-nominal audit + file-level DfAM verdict + re-score button + trust badge | re-imported app STL reproduces `areas` within meshing error; a 0.10 mm-gap STL FAILs the file verdict while its nominal M2 design PASSes; re-score round-trips through `/api/evaluate` |
| V4.3 | PixelPreview compare mode (slice + XOR + worst-layer) + two-sided BVH pass | re-imported app STL → 0 feature-level mismatches; deleted-fin fixture → flagged at the correct layers by XOR **and** by the two-sided pass, invisible to V4.1 one-sided (documented) |
| V4.4 | point-map recipe generation + CSV import + zero-crossing diff | round-trip against the TS field itself → exact PASS; nTop-sampled gyroid (Hieu) agrees within grid pitch |

All phases: client-side only, no API changes, `test_api_parity.py` 5/5
after each merge; UI copy reviewed against §39 as an acceptance item, not a
follow-up.

**Status: all rows V4.0–V4.4 shipped 2026-07-17** (see the V4 changelog
below). The engine acceptance suite is persisted in the repo as
`frontend/test/verify-engine.test.cjs` — run with `npm run test:verify`
(node only; compiles the pure verify modules to `.verify-build/`, no
browser or server needed).

## 45. V4 open questions (answer before/at acceptance)

1. **Which stage(s) does Hieu actually export today** — final only, or the
   CAD-for-print stage too? (Decides the stage-selector default and which
   auto-detect hints matter most.)
2. **Typical export sizes** — if TPMS exports run ≫200 MB, V4.1 adds an
   import-time decimation toggle (display only; measurements stay
   full-mesh). Below that, skip the toggle.
3. **Gate values** — confirm ½ px / 1 px (14.6 / 29.2 µm) as the
   PASS/MARGINAL split, or tie MARGINAL to the Incus coupon outcome.
4. **Report integration** — does the verification verdict (and
   measured-vs-nominal table) go into the exported report as a "Geometry
   verification" section? (Proposed: yes, when a file has been verified in
   the session.)
5. **three-mesh-bvh dependency** (V4.3 only) — accept the (small, MIT)
   runtime dependency, or hand-roll a minimal BVH like the surface-nets
   mesher? Proposed: accept it.
   **ANSWERED at build time: hand-rolled** (~150-line AABB BVH in
   `verify/bvh.ts`) — the app stays dependency-free.
6. **TPMS wall→iso calibration** (NEW, found by V4's audit — see changelog):
   the V2 mapping `iso = wπ/c` draws TPMS walls ≈ w/|∇F̂| — roughly 30 %
   thinner than nominal — so the drawn/exported lattice runs ~0.90 void
   where the physics assumes 0.852 (analytic ρ*). Decide: calibrate the
   mapping per TPMS type (multiply iso by the type's mean surface
   |∇F̂|), or keep the drawn geometry and re-base the physics inputs.
   Until then every TPMS verification will honestly show the ~5 %
   void-fraction drift in the audit table — that is the tool working,
   not a V4 bug.

---

### V4 changelog (V4.0–V4.4 ALL BUILT 2026-07-17)

User direction at build time: proceed with P1+P2+P3, plus a full UI
redesign — "less clustered", scroll-driven like an art-portfolio site
(refs: noth.in, to-portfolio.com), interactive cursor, design delegated.

- **Verify engine** (`frontend/src/verify/`, all client-side, zero new
  endpoints, stdlib server untouched): binary-STL parser; bit-exact vertex
  dedup + directed-edge watertight check; TS mirror of the full part
  implicit field (`field.ts` — all families, gradient-normalized signed
  distance); stage transforms + CAD-stage reference adjustment + worded
  unit/stage/rotation hints (`stages.ts`); z-bucketed mesh slicing with
  **nonzero-winding** scanline rasterization (correct across the STL
  export's deliberate 0.05 mm shell overlaps, where even-odd fill breaks);
  hand-rolled triangle BVH; per-layer XOR conformance profile; Web Worker
  orchestration with progress + on-demand layer masks.
- **Buried-vertex rule:** vertices > 1.25 px inside the reference are
  classified internal faces of overlapping-shell unions, excluded from the
  deviation gates and counted visibly; undersize at that depth is caught by
  the two-sided pass + layer XOR instead (the app's own fin STL buries
  ~half its vertices by design — EMBED).
- **Verify tab** (spec §39 contract enforced): teaching empty state,
  stage cards with captions, verdict-first banner sentence, four-field ⓘ
  on every number, histogram with gate lines + meshing-tolerance noise
  band, deviation-coloured 3-D mesh view (points fallback > 2 M tris),
  measured-vs-nominal audit table with trust badge, file-level DfAM
  verdict on measured minimums, ⟳ re-score via `/api/evaluate`, layer
  mismatch strip with jump-to-worst into the pixel view.
- **PixelPreview compare mode** (V4.3): magenta XOR overlay of the
  verified STL's slice vs the expected exposure (stage-aware reference),
  per-layer mismatch stats, hover explains diff pixels; overpoly disabled
  while comparing (the diff must be against the design as drawn).
- **UI V4 shell:** one long page — 100 vh hero (big type, live status
  chips, candidate strip) → scroll runway that dollies the raymarch camera
  from a far cinematic pose into the standard iso view (`IntroRig`) →
  pinned studio: full-bleed viewer stage with glass drawers (candidates +
  sliders left, KPIs right, comparison/optimizer as a collapsed bottom
  drawer — the big declutter), segmented 3-D/Pixel/Verify switcher with a
  verdict dot, custom dot+ring cursor ("drag" label over 3-D canvases;
  fine pointers only, reduced-motion users keep native cursor + no intro).
- **Findings from the engine acceptance tests** (node round-trip suite —
  re-import the app's own STL, green-scaled copy, deleted-fin fixture,
  fine gyroid):
  1. **V3.3d PixelPreview modulo bug, fixed**: the JS positive-mod
     `(x % p + 1.5p + p/2) % p − p/2` reduces to `mod(x,p) − p/2` — every
     fin/pin was drawn **half a pitch off** its true position (aggregate
     widths/solidity unaffected, so it shipped unnoticed; V4's absolute
     position cross-check caught it). Correct form keeps `+p/2` inside the
     mod; now shared in `verify/raster.ts` and used by both PixelPreview
     and the worker.
  2. **V2 TPMS wall→iso calibration gap** → logged as §45-6 above.
  - Acceptance results: self round-trip PASS with p95 = max = 0.0 µm
    (buried EMBED ring correctly excluded); volume matches analytic
    2 905 mm³ exactly; straight-fin layer XOR **0 px**; wavy-fin XOR is
    pure sub-pixel chord flicker (6.6 %, bounded, explained in-UI);
    green-scaled copy fires the green-stage hint; deleted-fin fixture is
    invisible to the one-sided check (documented) and caught by the
    two-sided pass (0.86 % uncovered, max 0.15 mm) and the XOR
    (3 832 px ≈ the fin's footprint).
- **Gates:** golden parity 5/5 + all V2/V3 suites green; `tsc` clean;
  production build clean (worker chunk split out); HTTP smoke OK
  (health, catalog, UI, worker asset).

**V4.4 built (same day):** the point-map field check (`verify/pointmap.ts` +
`PointMapCheck.tsx`, a collapsible section of the Verify tab, independent of
the STL import). Generates a probe-point CSV (three section planes — z
mid-band / y = L/4 / x = 0 — at 0.1/0.05/0.025 mm pitch, written in the
MODEL frame per the declared stage); nTop samples its implicit body at the
points (Point Map → CSV with values); the app re-bins returned points onto
the grid from their coordinates (row order irrelevant), auto-detects the
sign convention, and compares **zero-crossing positions** along both grid
directions of every plane — sub-pitch accuracy by interpolating the sampled
values, zero meshing noise. Same ½/1-px gates + histogram as the mesh
check; unmatched walls (a crossing in only one field) or sign disagreement
force MARGINAL/FAIL regardless of µm stats. Note: crossing offsets are
measured along the scan axis, so slanted walls read conservatively (offset
/ cos θ). Acceptance (suite row E): self round-trip → exact PASS (p95 =
0.000 µm over 149 003 crossings, 0 unmatched, 100 % sign agreement);
fin t + 0.06 mm → FAIL detected (p95 74 µm, median oversize); inverted
sign convention → auto-flipped, PASS.

**Post-ship fixes from live use (2026-07-17, Hieu's real 357 MB nTop
export):**

1. `.stage` class collision — the shell's full-bleed viewer container class
   matched the V2 `badge stage` KPI badges, inflating them into giant
   fixed-position accent discs over the KPI panel. Renamed `.viewer-stage`.
2. Gradient-normalized deviation clamped (|∇f| ≥ 0.5): field ridges (gap
   centrelines) cancel the central differences and an unclamped quotient
   exploded to "worst 423 mm". Values ≥ 1 mm now display as mm.
3. Stage HUD / gizmo bleed: HUD + section bar + orientation gizmo hidden
   when a pane covers the stage (which also dims); in 3-D mode they inset
   past open drawers and the gizmo relocates left of the KPI drawer.
4. **Fins-only mode** ("file has no base slab") — Hieu's workflow exports
   the core and the base as separate STLs, and the base STL is the full
   mechanical body (45.6 × 36.8 × 3.1 mm with mounting flanges, different
   frame) that the implicit model does not describe. The toggle compares
   against the reference minus its base (fins at z = 0), auto-suggested
   when the file height equals the fin height alone; pixel compare/layer
   scan re-align accordingly. The definitive pre-print check still wants a
   single core+base export in the contract frame (noted in the ⓘ).
5. Envelope-mismatch hints made axis-specific (file vs the ACTIVE
   project's core dims), since the reference footprint comes from the
   project, not the file.
6. Pixel view: "layer shows design | imported STL" source switch — the
   imported file's own slices render on the DLP grid with violations,
   min-width readouts and hover measurement running on the STL's pixels.
7. Deviation viewer: worker now ships the full indexed mesh; heavy files
   (> 2 M tris) start as an instant point cloud with an explicit "render
   full mesh" opt-in (normals built on demand).

---

## V5 — "Design-Intent Flow & Thermal Viewer" (ACCEPTED 2026-07-23, rev 2 — solver-backed)

> **Status: ACCEPTED 2026-07-23 (user), same day as draft — build started at
> V5.1 per the §53 roadmap.** §54 defaults adopted as proposed unless noted;
> Q1 (feed/return compartment assignment) remains open with Hieu — S6
> assumes alternating and labels it.
>
> **Rev 2 (same day) supersedes rev 1.** User direction: the intent
> visualization must carry legitimate solved physics, not just annotated
> assumptions — "the intent must be accurate with the physics we are
> dealing with." Rev 2 adds two reduced-order solvers behind the visual
> layers — **S6 flow network** (engine) and **F1 depth-integrated field**
> (browser) — with a reconciliation contract binding them to the validated
> 1-D solvers. Rev 1's pure-annotation framing is kept only as the T0 tier.

## 46. V5 concept, scope & principles

**What it is.** A visualization layer that shows **how the design makes the
coolant move and the heat leave** — backed by three fidelity tiers, each
labelled, each anchored to the tier below it:

| Tier | What it is | Where it runs | Status label |
|---|---|---|---|
| **T0 — intent** | the route the layout defines: ports, splits, turns, jet-aim glyphs, 2-D schematic | frontend | DESIGN INTENT |
| **T1 — network (S6)** | per-channel / per-compartment flow split + ΔP decomposition, **computed** from the same laminar fRe + minor-loss K correlations the KPI solvers use | **engine (server)** | ANALYTICAL |
| **T2 — field (F1)** | plan-view **solved** pressure / velocity / temperature fields driving lanes, streamlines, particles and the thermal tint | browser worker | REDUCED-ORDER, reconciled |

**Workflow it serves** (unchanged from rev 1):

```
design for best intent (this app) ──▶ CFD confirms the intent (Ansys, TD-10/11) ──▶ print
   T1/T2 make the intent PREDICTIVE        §52's checklist is exactly what CFD checks
```

**What it is NOT.** Still not CFD: no Navier–Stokes, no turbulence, no jet
stagnation detail, no recirculation prediction. The reduced-order class
chosen — **flow-network modelling + depth-integrated Darcy/Hele-Shaw** — is
established engineering practice for precisely this regime (deeply laminar,
Re ≈ 100–200, thin channels) and is cheap enough to re-solve on every
slider release. Browser LBM / NS remains **rejected**: transient,
resolution-hungry, and it would imply a fidelity the app cannot verify. The
reduced-order tier captures distribution and continuity — what the viz
needs — without overclaiming; separation/recirculation stay CFD's job.

**Key decisions (brainstorm log, rev 2):**

| # | Decision | Rationale |
|---|---|---|
| V5-D1 | **Solved, not assumed**: every animated quantity comes from S6/F1 or a named solver output | user direction 2026-07-23; honesty by provenance |
| V5-D2 | The layout remains the routing authority; S6/F1 discretize it | `layouts.py` defines the graph topology and boundary conditions |
| V5-D3 | S6 lives in the **engine** (server-side) | it is physics at the same correlation grade as the KPI solvers → D8 applies; ships with fixtures |
| V5-D4 | F1 lives in a **browser worker** but is reconciliation-bound (§49) | interactivity (re-solve on release); KPIs never read from it; every run must close against server numbers |
| V5-D5 | S6's computed uniformity may feed the KPI solve as an **opt-in flag** | upgrades the assumed `flow_uniformity` scalar (pending TD-10 since V2) to a computed one; default off until an Ansys cross-check (§54 Q2) |
| V5-D6 | The viz doubles as the CFD handoff: claims become **predictions** | §52 checklist upgrades from "we assume" to "we predict" |
| V5-D7 | **Overlay layers on the 3-D viewer, not a separate tab** (decided 2026-07-23): a `Geometry · Flow · Thermal · ΔP` chip group on the stage HUD (+ particles toggle); color modes mutually exclusive, lanes/particles composite over the active tint; follow-a-parcel is a temporary camera mode (Esc exits); schematic + reconciliation chips are drawer/HUD cards | flow/thermal are renderings *of the same body* — same camera, same section cuts — and the §9 drag-loop (slider → geometry → flow → gauges) only reads in-place; the segmented 3-D/Pixel/Verify switcher stays reserved for *representations*; an off chip costs zero GPU |

**Principles:** the §39 explanation-first contract applies to every mode; a
permanent tier badge ("network-solved" / "reduced-order field — reconciled
✓" / "intent annotation") wherever a V5 layer is on; golden parity 5/5
untouched (S6 is additive, F1 is browser-only).

## 47. S6 — Flow-network solver (engine, the backbone)

The manifold → slots → compartments → channels system as a hydraulic
network, built from the active layout + geometry:

- **Nodes**: inlet plenum, feed-slot segments, compartment volumes,
  return-slot segments, outlet plenum — per layout (center-feed = the
  2-path degenerate case; serpentine = a series chain with bend nodes;
  distributed-jet = the full compartment graph).
- **Edges**: channel groups (the parallel bundle of fin channels in a
  compartment/pass) with laminar resistance from the same fRe slot model
  the KPI solver uses (ΔP ∝ v — linear), plus minor-loss K edges (turns,
  slot entries, headers; ΔP ∝ v² — mildly nonlinear → fixed-point
  iteration, converges in a few passes at these Re).
- **Solve**: Kirchhoff on the graph (tens-to-hundreds of nodes;
  hand-rolled Gaussian elimination, pure stdlib — same dependency
  discipline as the V4 BVH). Milliseconds.
- **Outputs** (additive `flow_network` block on evaluate results):
  per-compartment / per-pass flow fractions; **computed uniformity** (the
  flow-weighted statistic that the assumed `flow_uniformity` scalar
  approximates); per-segment ΔP decomposition (friction vs minor losses);
  per-channel velocity table.
- **KPI coupling (opt-in, V5-D5)**: `"use_computed_uniformity": true`
  replaces the layout's assumed scalar with S6's value in the KPI solve —
  flagged in warnings; default off until cross-checked against the first
  Ansys run.
- **Fixtures**: symmetric center-feed → exactly 50/50 and uniformity 1.0
  (regression anchor); serpentine total ΔP = the closed-form path sum;
  the 9-compartment distributed-jet case reproduces a hand-solved
  network; parity 5/5 untouched.

## 48. F1 — Depth-integrated field solver (browser worker)

The 2-D plan-view field the visual layers render. Model class:
**anisotropic Darcy / Hele-Shaw** — a legitimate asymptotic model for
laminar flow in thin gaps — solved on the core footprint:

- **Grid**: the core planform at 128–256 cells on the long axis (~50 k
  cells), rebuilt from the same TS geometry mirror the viewer already
  uses.
- **Conductance per cell**, from the same correlations as the physics:
  - **fin field**: anisotropic — along-channel conductance from the
    laminar slot model (∝ b³ per unit width, the fRe math), zero
    transverse (fins block); the wavy path enters via the √(1 + χ²/2)
    length factor;
  - **open header / manifold / turnaround zones**: plain gap-flow
    conductance;
  - **TPMS**: isotropic permeability derived from the family's f(Re)
    correlation at the local cell size (grading-aware);
  - **jet layouts**: feed/return slots = source/sink strips per
    compartment with strengths taken from **S6's computed split** — F1
    inherits T1, never the bare assumption.
- **Solve** `∇·(K∇p) = 0` (SOR / red-black Gauss–Seidel in the worker;
  WebGL Jacobi only if profiling demands), then `v = −K·∇p`.
- **Thermal transport**: steady upwind advection–diffusion for the
  depth-mixed fluid temperature, wall heat source from the same h
  correlation per cell; solid temperatures composited from the cosh
  profile in z (2.5-D: solved in-plane × analytical in-height).
- **Perf budget**: solve on slider release (debounced alongside the
  physics call), target < 100 ms at the default grid; progressive
  refinement while idle; never blocks the frame loop (worker).

## 49. The reconciliation contract (what "legit-checked" means)

F1 is visualization-grade physics; the validated solvers are the anchor.
**Every** F1 solve must close against them, and the closure is displayed:

| Check | Bound | On failure |
|---|---|---|
| F1 integrated inlet→outlet ΔP vs the solver's ΔP | within tolerance (proposed 15 %, §54 Q4) | ⚠ badge: "field diverges from solver — numbers shown are the solver's; field is shape-only" |
| F1 mixed outlet T vs T_in + ΔT_cal | exact (energy-conservation check) | assertion — a miss is an F1 bug, surfaced loudly |
| F1 per-compartment splits vs S6 | within a few % | ⚠ badge + both values shown |

KPIs, gates, the optimizer and the report **never** read F1 values — D8
preserved: correctness lives server-side. The chips make the anchoring
visible instead of implicit: the same discipline as `test_api_parity.py`,
applied per interaction.

## 50. Visual layers (tiers composited)

**Presentation (per V5-D7):** every layer lives *inside* the 3-D viewer,
switched by a stage-HUD chip group — `Geometry · Flow · Thermal · ΔP` plus
a particles toggle. Color modes are mutually exclusive; lanes and particles
composite over whichever tint is active (warm particles over tinted fins is
the reference view). No new switcher segment — 3-D / Pixel / Verify stays
as-is; V5 never leaves the 3-D scene.

1. **Flow lanes / streamlines** — traced on F1's solved v-field. Fin lanes
   still follow the sine centerline, but their *speed* is the local solved
   velocity — maldistribution becomes visible (starved outer channels
   visibly run slower). Fallback chain while F1 converges: S6 per-channel
   speeds → T0 route only. Time-scale chip states the slow-motion factor
   (~×50, §54 Q5) — real transit is ~30 ms.
2. **Particles + follow-a-parcel** — advected on the F1 field (replaces
   rev 1's heuristic drift-and-slide; the SDF still keeps particles out of
   solid and provides `gl_FragDepth` compositing). Particle color =
   accumulated temperature from the F1 thermal field. Click a particle →
   the camera rides it inlet → outlet while it warms: the 30-second
   design-review demo.
3. **Thermal tint** — fluid = F1 T-field (fallback: the 1-D caloric ramp
   when F1 is off); fins = cosh profile in z anchored to the local fluid
   T; base = solved base-side T; legend in real °C with the T_j chip vs
   the 100 °C gate / 90 °C soft line. Resolves §15 Q3 at higher fidelity
   than originally deferred.
4. **Pressure mode** — the solved p(x, y) directly, plus S6's friction-vs-
   minor-loss decomposition as a stackup-style bar: *where the 50 kPa
   budget is spent*. Endpoint pinned to the solver ΔP per §49.
5. **T0 layer stays** — port/turn/jet-aim glyphs + the 2-D layout
   schematic card, now annotated with S6's **computed** fractions instead
   of assumed ones. Jet impingement detail remains an *aim annotation*
   (stagnation structure is CFD's job; stated in the ⓘ).
6. **Dead-zone candidates** — cells with solved |v| below a threshold,
   shaded on request, labelled "low-flow candidates (reduced-order) —
   confirm in CFD". A prediction to check, never a verdict.
7. **Hover probe** — local solved v, p, T_fluid, T_solid(z), path %,
   local gap.

## 51. Where each piece runs (architecture note)

| Piece | Home | Why |
|---|---|---|
| S6 network | `engine/flow_network.py` + additive API block | physics → server (D8); fixtures + goldens |
| F1 field | `frontend/src/flowfield/` worker | interactivity; reconciliation-bound; KPI-free |
| T0 glyphs / schematic / lane rendering | viewer shader + a schematic component | pure presentation |
| Reconciliation chips | frontend, comparing F1 vs the live evaluate result | the visible anchor |

## 52. CFD confirmation checklist (report integration — predictions, not assumptions)

With S6/F1 behind it, the Report's **"Flow & thermal intent"** section
states predictions, each with an id, the predicting tier, and the CFD
probe that confirms it:

| id | Prediction | Value (live) | Tier | CFD confirms by |
|---|---|---|---|---|
| FC-1 | per-compartment flow split | S6 table | T1 | mass flow per compartment |
| FC-2 | uniformity | computed (S6) vs assumed, both shown | T1 | velocity histogram across channels |
| FC-3 | ΔP total + friction/minor split | S6 / solver | T1 | pressure taps |
| FC-4 | outlet temperature | T_in + ΔT_cal | 1-D | outlet probe |
| FC-5 | low-flow zones | F1 map excerpt | T2 | recirculation / stagnation check |
| FC-6 | jet aimed at the rib crown | geometric | T0 | stagnation-line location |
| FC-7 | impingement-shaped rib crown softens the central turn → gentler flow-down, better fin wetting (hypothesis, no sim — user 2026-07-23) | geometric intent | T0 | wall-shear / wetting coverage + header-loss vs a sharp rib |

This is the TD-10 / TD-11 work order, produced by the design itself — and
because splits/uniformity are now *predicted*, an Ansys run genuinely
tests the model rather than merely filling in an assumption.
**Deferred (V6 watch item):** importing Ansys results back against the FC
ids for an intent-vs-CFD overlay — the flow twin of the V4 Verify tab.
The id scheme exists now so the claims are machine-checkable later.

## 53. V5 roadmap (rev 2, proposed)

| Phase | Deliverable | Acceptance |
|---|---|---|
| V5.1 | **S6 network solver** in the engine + additive `flow_network` block + fixtures | symmetric center-feed → exact 50/50; serpentine ΔP = closed-form path sum; 9-compartment case = hand solve; parity 5/5 |
| V5.2 | T0 layer: glyphs, lanes at S6 speeds, schematic card with computed fractions | routes match the `layouts.py` resolution for every layout; lane speeds = the S6 table |
| V5.3 | **F1 pressure solve** + streamlines + reconciliation chips | ΔP closure within tolerance on all 8 catalog candidates; a deliberately-starved demo case shows visible maldistribution |
| V5.4 | F1 thermal + tint + probe + dead-zone layer (§15 Q3 closed) | outlet-T closure exact; tint endpoints = solver numbers whenever F1 is off |
| V5.5 | Particles + follow-a-parcel + `gl_FragDepth` compositing | particles never enter solid (SDF test in the sim step); 60 fps alongside the raymarcher |
| V5.6 | Pressure mode + Report checklist (FC ids) | report reproduces live S6/F1 values; every FC row carries tier + probe text |

## 54. V5 open questions (answer before/at acceptance)

1. **Feed/return compartment assignment** for
   `distributed_jet_compartments` (§25-6, still open with Hieu) — S6's
   graph needs it; until answered, alternating is assumed and labelled.
   **Mostly resolved by mesh extraction (2026-07-23):** slicing
   `ICE rev 3 scaled - Remeshed.stl` (the current INCUS part, which —
   unlike the V1+2 fin-only mesh — contains the full distribution layer)
   verified the topology: fins −3.5…+3.4 green, manifold +3.6…+5.5;
   **10 transverse feed ducts** (≈1.17 × 1.48 mm final) with top windows
   at 2.79 mm pitch, **interdigitated return gaps** (≈1.15 × 1.9 mm)
   venting at BOTH part sides into the housing plenum, fin-field
   compartment walls at **1.40 mm final pitch** (2× finer than V1+2's
   3.0 mm). The return manifold is therefore *inside* the part and its
   finite conductance is modelled by S6. Remaining ask for Hieu is one
   word — are the top windows the pump-inlet side or the outlet side —
   which by network symmetry changes no S6 number, only the V5.2 arrow
   directions.
   **RESOLVED 2026-07-23 (user):** the top windows are the **pump inlet**
   — ducts feed downward, the interdigitated gaps return to the side
   exits. Also recorded for the plain wavy-fin part (V1+2 hero /
   `Wavy 28x28`): it uses top-down bi-directional centre-feed where the
   middle rib is **impingement-jet-shaped on purpose** — the crown
   softens the abrupt downward turn so the flow spreads and wets the fin
   surface better. Stated as a design hypothesis, no simulation yet —
   captured as checklist claim FC-7 (§52) for CFD to confirm.
   **Rib shape mesh-verified (2026-07-23, `Wavy 28x28 Scaled`):** the rib
   is a **wedge splitter**, not a slab — measured width tapers
   continuously from ≈0.60 mm green (≈0.50 mm final) at the base to a
   ≈0.10 mm green (≈0.08 mm final) crest just below the fin tips:
   included angle ≈5°, knife-edge pointing into the jet. Model
   implications: (a) the v6 1.0 mm flat-slab rib overstates this part's
   wetted-area penalty (measured mean width ≈0.25 mm final); (b) the
   §19E crown options need a "wedge/tapered" entry; (c) the viewer/SDF
   draws a rectangular rib — a V5.2+ geometry item. FC-7 stands as the
   CFD check of what the wedge actually buys.
2. **Computed uniformity → KPI default** — proposal: always *shown*, feeds
   the KPI solve opt-in only, flipped to default after the first Ansys
   cross-check confirms S6 within ~10 %.
3. **F1 grid + perf budget** — 256 cells long-axis / < 100 ms target OK?
   WebGL solver only if profiling demands it.
4. **ΔP reconciliation tolerance** — 15 % proposed (Darcy carries no
   inertial core losses; the residual gap between F1 and the 1-D solver is
   itself informative and displayed, not hidden).
5. **Animation time-scale default** (~×50 slow-motion). Schematic-card
   placement is resolved with V5-D7 (2026-07-23): collapsible card under
   the layout selector; reconciliation chips sit beside the HUD mode
   chips.
6. **S6 validation anchor** — beyond fixtures, adopt one literature anchor
   for manifold maldistribution (e.g. a published Z-type/U-type manifold
   dataset), per the S1/S2 discipline? Proposed: yes, one.

---

### V5 changelog

**V5.1 BUILT 2026-07-23 (same day as acceptance).**

- **Engine:** new `engine/flow_network.py` — the S6 solver per §47: generic
  node/edge network with laminar channel-bundle edges (identical Shah–London
  fRe + roughness math as `_evaluate_fin_family`, expressed as R(q)),
  quadratic minor-loss edges, fixed-point outer loop, hand-rolled Gaussian
  elimination (stdlib-only, zero deps). Graph builders for single-pass,
  center-feed / top-jet (2-branch), serpentine (per-pass width/n — finer
  than the screening solver, divergence flagged), U-flow (feed/return
  header ladder, U/Z port option, assumed header width stated) and
  distributed-jet (ICE rev 3 mesh-measured geometry: 10 ducts → 20 crossing
  paths, interdigitated return gaps venting both sides). Uniformity metric
  U = (Σq)²/(N·Σq²).
- **Server:** every fin-family evaluate carries an additive `flow_network`
  block (splits, computed vs assumed uniformity, ΔP + friction/minor
  decomposition, per-path v/Re, assumptions, §49 reconciliation row vs the
  solver ΔP at 15 % tolerance). `use_computed_uniformity: true` (opt-in,
  §V5-D5) re-bases the KPI solve on the computed value with a warning.
  Non-fin families carry no block (honest: their ΔP models are not
  channel-resolved). `layouts.py` n_jets clamp widened 8 → 16 for the
  rev-3 part.
- **First predictions:** single-pass and center-feed reconcile with the
  lumped solver EXACTLY (ratio 1.0 — same math, finer topology, solved
  50/50 split); ICE rev 3 distributed-jet computes **uniformity ≈ 0.87**
  from return-gap end effects — the first non-assumed maldistribution
  number in the project (pending the §54 Q6 literature anchor + CFD).
- **§54 Q1 largely closed by mesh extraction** (see the Q1 note): ICE rev 3
  distribution layer sliced and measured; only the pump-side port
  assignment (arrows, not numbers) remains with Hieu.
- **Tests:** `test_v5_flow_network.py` (25 checks: exact reconciliation,
  solved symmetric splits, serpentine hand path-sum, U-flow maldistribution
  with header sensitivity and U≠Z, distributed-jet mirror symmetry and ΔP
  decomposition, opt-in coupling semantics, additive discipline). Full
  suite green: parity 5/5 golden-exact + all V2/V3 suites.

**V5.2 BUILT 2026-07-23 (same day) — the T0 visual layer.**

- **Flow-intent lanes in the raymarcher** (`SdfViewer.tsx`): a translucent
  fluid sheet at 0.58·H with dashes advected along the per-layout path
  field `s(p)` in GLSL — single-pass/U-flow straight-through, center-feed
  radiating outward from the rib, serpentine alternating per pass band,
  distributed-jet radiating from the feed-duct lines (period 2·pitch).
  Masked to the open channel by the same SDF (`coreField`), clipped by the
  section cuts, so lanes weave between the wavy fins automatically. Dash
  speed = the **mean S6 per-path velocity** at ×50 slow-motion (§54 Q5).
  ICE dash registration to the exact duct positions is nominal (period-
  aligned, not mesh-registered) — refined when F1 lands (V5.3).
- **Routing glyphs** (`FlowGlyphs`): cone-arrow annotations per layout —
  ICE draws feed arrows DOWN at the duct lines, returns UP between them
  and side-exit arrows out both faces (the §54 Q1 resolved directions);
  center-feed draws the jet down onto the rib crown + outward split.
- **HUD**: `≈ Flow` toggle in the viewer controls; when on, chips state
  the contract — "design intent — confirm by CFD", the time-scale + real
  velocity ("×50 slow-mo · 1 s ≈ 20 ms real · v X m/s"), the §49
  reconciliation ✓/⚠, and the computed uniformity U.
- **Flow-route schematic card** (`FlowSchematic.tsx`): plan-view SVG with
  CSS marching-dash routing per layout; ICE shows the feed windows
  (labelled "pump in, from top"), side-venting returns and **per-duct
  computed fractions** from S6; footer states U computed vs assumed, the
  ΔP friction + minor split, and the reconciliation verdict. Mounted live
  in the left drawer (V5-D7) and as a topology-only preview under the
  Design Studio layout selector (§54 Q5).
- **Plumbing**: `flowviz.ts` (layout→shader-code map, SLOWMO const),
  `FlowNetworkBlock` types, `flow_network` carried on `BaselineResult`.
- **Gates**: `tsc` + production build clean; server untouched — parity
  5/5 + V5 suite re-run green.

**V5.3 BUILT 2026-07-23 (same day) — the F1 field solver (§48).**

- **Solver core** (`frontend/src/flowfield/field.ts`, pure TS —
  node-testable like `verify/*`): depth-integrated anisotropic
  Darcy/Hele-Shaw on the fin-band planform. Fin channels give
  `K_y = b·H·Dh²/(fRe·rough·2μ·arc·pitch)` per unit width — the same
  Shah–London chain as the solvers — and block x entirely; headers/turn
  plena open x locally. Per-layout grids and boundary conditions:
  single-pass (edge in/out), center-feed (rib source, both-end sinks),
  serpentine (band walls + full-width turn plena at alternating ends),
  U-flow (feed/return header rows, U/Z port), distributed-jet (feed rows
  at the duct lines, sink rows at the returns — ICE rev 3 registration).
- **Numerics**: alternating line relaxation — exact Thomas solves per
  column (channels) and per x-coupled row (headers/turns, ADI-style) —
  plus a **global level correction** each sweep (the Neumann-source /
  sparse-sink "constant mode" is projected out by shifting to close the
  mass balance; convergence judged on the pre-shift imbalance). Uniform
  cases converge in 2 sweeps; every fixture closes mass to ≤1e-12.
- **Streamlines with time-of-flight**: RK2 traces from source-nudged
  seeds, each vertex stamped with real transit time; packed transferable
  arrays. Rendered by `FlowFieldLayer.tsx` as faint polylines + **comet
  particles that ride the SOLVED field** — comets race in favoured
  channels and crawl in starved ones, so maldistribution is directly
  visible. Runs in a worker (`useFlowField`, 250 ms debounce, solve only
  while the Flow layer is on).
- **Reconciliation (§49)**: F1 resolves friction only, so the anchor is
  **S6's friction component**, never the total. HUD chip: ✓ within 15 % /
  ⚠ diverges, with grid, sweeps, mass error, and both ΔP values in the ⓘ;
  plus F1's own field uniformity. KPIs never read from F1.
- **Acceptance** (`frontend/test/flowfield.test.cjs`, 17 checks, in
  `npm run test:verify`): single-pass ΔP == the analytic slot formula to
  1e-6 (7 915.7 Pa reproduced exactly); wavy/straight ΔP ratio == arc
  factor to 1e-3; center-feed == 0.250× (L/2 at Q/2); U-flow U < 1 with
  header-width sensitivity; ICE distributed-jet crossings ~300× cheaper
  than a full pass, mass exact; serpentine 8.7× single-pass (≈9
  expected; turn plena account for the gap). `tsc` + build clean; verify
  suite + parity 5/5 + V5 API tests all green.
- **Still open for V5.3 scope**: TPMS isotropic permeability (F1 is
  fin-families-only, same as S6); mesh-registered ICE duct positions
  (period-nominal). Deferred to the V5.4+ passes.

**V5.4 BUILT 2026-07-23 (same day) — thermal-intent tint (§15 Q3 CLOSED).**

- **F1 thermal transport** (`field.ts`): steady upwind advection of the
  depth-mixed fluid temperature on the solved flow, uniform base flux
  over *live* cells only (sink cells get no share — it would sit past the
  measurement plane; dead cells get none so the balance closes). Ordered
  Gauss–Seidel; **outlet closure is exact energy conservation** — every
  fixture reproduces T_in + Q/(ṁ·cp) to 1e-6 (27.4442 °C at the GB202
  point), including under U-flow maldistribution, where starved channels
  correctly run ~0.5 K hotter than the mixed outlet. Dead zones display
  capped-hot and are counted (`deadFraction`).
- **Thermal color mode** (HUD chip group `Geo · Thermal · ΔP` per V5-D7):
  fluid = F1 solved T texture when available, else the 1-D caloric ramp
  along `s`; fins = the cosh conduction profile in z with **mH inverted
  from the solver's η_f** (`mhFromEta`); base slab ≈ fin roots; colormap
  top anchored to solver numbers (T_in, ΔT_cal, Q·R_conv). Legend chip
  shows the fluid range, root offset and live T_j vs the target. F1's
  fields upload as 8-bit textures with physical scales; low-flow cells
  shade dark magenta (FC-5 candidates) with a % chip.
- **Hover probe** (§50-7): ray→sheet intersection; reads T / v / p from
  the F1 arrays at the cursor (1-D estimates when F1 is off).
- Fixtures: +9 checks in `flowfield.test.cjs` (26 total) — outlet closure
  on four layouts, hot-streak inequality, cap bounds, tGrid-null contract.

**V5.5 BUILT 2026-07-23 (same day) — compositing, channel snap, parcel ride.**

- **`gl_FragDepth`**: the raymarcher now writes true hit depth
  (`glslVersion: GLSL3`, forward view-projection uniform) — scene objects
  composite correctly. Comets depth-test against it: **fins occlude
  them, section cuts reveal them**. Glyph arrows stay depth-free
  (annotations).
- **Channel snapping**: streamline vertices snap to the nearest wavy
  channel centerline, weighted by how channel-aligned the local motion is
  — comets weave *inside* the sinusoidal channels while turn/header zones
  keep their solved course. (The F1 field is homogenized; the snap is
  presentation, stated as such.)
- **Follow-a-parcel** (`▶ ride`): the camera rides the longest solved
  streamline inlet → outlet at ×50 slow-motion, looking ahead along the
  path; Esc exits, OrbitControls suspended while riding.

**V5.6 BUILT 2026-07-23 (same day) — ΔP-budget mode + the FC checklist.**

- **ΔP color mode**: the fluid sheet colored by remaining pressure —
  red (unspent, inlet) → blue (spent, outlet). Uses the **F1 solved
  p-field** when available (friction-only, stated); otherwise the 1-D
  budget profile with the S6 minor-loss share spent at entries (spread
  across bends for serpentine). Metal recedes to dim steel; legend chip
  states total ΔP + minor share. The hydraulic twin of the resistance
  stackup, per §50-4.
- **Report §3b — "Flow & thermal intent: CFD confirmation checklist"**
  (spec §52): generated whenever the design carries an S6 block. Rows
  FC-1 (per-path split, min/max), FC-2 (uniformity computed vs assumed),
  FC-3 (ΔP friction + minor), FC-4 (outlet T), FC-5 (low-flow zones →
  F1 layer), FC-6 (jet aim, jet layouts), FC-7 (wedge rib crown
  hypothesis with the mesh-verified 0.50 → 0.08 mm taper) — each with
  tier and the CFD probe that confirms it, plus the §49 reconciliation
  line. This is the TD-10/11 work order, generated from the live design.
- **Gates (all three phases)**: `tsc` + production build clean;
  `npm run test:verify` green (engine + 26 F1 checks); parity 5/5 +
  V5 API suite green. **V5 roadmap §53 rows V5.1–V5.6: ALL BUILT.**
  Remaining V5-adjacent items: TPMS F1 permeability, mesh-registered ICE
  duct positions, S6 literature maldistribution anchor (§54 Q6), and the
  V6 watch item (Ansys-import overlay against the FC ids).

**V5 post-ship — the live-use iteration round (2026-07-23/24, with the
user in the loop on every physics call).** The particle/ride system was
rebuilt from live feedback into its final form; each decision below is a
recorded engineering judgement, not styling.

- **Stage blackout, fixed + lesson**: an explicit `glslVersion: GLSL3`
  drops three.js's `gl_FragColor`/`varying` compatibility defines — the
  raymarch shader silently failed and the model vanished. Correct pattern
  (kept, commented in-shader): default compat path + `gl_FragDepthEXT`,
  which three maps to native `gl_FragDepth` on WebGL2.
- **Per-gap particle streams**: one stream per PHYSICAL fin gap following
  its exact sine centerline, timed by the F1 per-column solved velocity
  (per-gap maldistribution is visible); **seven depth layers** (0.10–0.88
  H) fill the channel; heads are 0.07 mm near-round droplets whose
  6-ghost fading wakes carry the motion; ×150 slow-motion (was ×50).
- **The flow story, physics-settled with the user** (each step was
  proposed, challenged, and corrected live):
  1. *Dive* at the mid-rib from the manifold (legs at ~jet speed — the
     standing-column look at channel speed was wrong);
  2. *Gradual exponential settling* from the top entry — slot-entrance
     redistribution decays ~e^(−x/H); drawn at settle = 0.45·H
     (deliberately shorter than the ~1·H physics estimate for intent
     readability, noted in-code; CFD measures the real length);
  3. *Level run* — parcels hold their height (laminar flow, no bulk
     sinking; the flooded channel's bottom layer skims the floor = the
     wetted A_base, defended as expert fact);
  4. *Straight, pressure-driven exits* at the fin endings (faces
     PARALLEL to the mid rib) into the sunken collector trough — the
     45° pocket faces in `lattce_lmm_rev3.step` are AM chamfers/trough
     walls, NOT flow directors; a trough-hook exit variant was built
     from an annotated screenshot and **reverted by user preference**
     (don't re-add).
- **V5.7 — thermal rides the parcels** (user idea): parcels are colored
  by the local F1 fluid temperature in EVERY mode, visibly warming
  blue → red along the journey (ΔP mode swaps to remaining pressure);
  the Thermal tint became the SOLID story only (cosh fin profile +
  base; the mid-plane fluid wash is hidden in thermal mode). The
  **unfinned rib strip draws hot** (user-validated: flow passes
  over/around it, so it is area-starved over the die's hottest zone —
  ×3 wall offset at its base, jet-cooled crown; tempered by Cu
  spreading + stagnation h; magnitude labelled screening → FC-6/7).
- **V5.8 — the parcel ride, final form**: rides a real parcel on a
  chosen depth layer (bottom/middle/top dropdown, both cameras);
  `◐ solo` (default on) hides all other parcels and draws the ridden
  path as a thin through-metal streamline; `👁 pov` = first-person
  (eye ON the path 0.06·T behind the warming head). **Chase = rigid
  rail dolly**: yaw-locked translation along the ride line's straight
  chord, look-target riding the rail at the parcel's station and
  tracking only its smoothed depth — the parcel stays mid-frame while
  the weave can't rotate the camera (two failure modes found live:
  per-segment direction stepping and head-fixation wobble; both cameras
  now anchor exclusively to time-lagged interpolated path points).
  Routing glyph arrows hide while riding.
- **ⓘ FlowExplainer overlay** (user request): collapsible in-app
  explainer in the About voice — the T0/S6/F1 tiers, each mode's
  physics, the chips, the rib strip, and what only CFD confirms.
- Docs synced 2026-07-24: About tab gains the V5 section, README the V5
  status, this changelog written.

---

## 2026-07-30 — Incus guideline revision, M4, ⇄ CAD tab, ⌖ neck scan, standalone exe (ALL BUILT)

One-day batch triggered by two INCUS inputs: the **official design
guidelines** (`05_References/Incus_Design_Guidelines.pdf`, July 2026 —
all rules in GREEN px, closing the green-vs-final open question) and
**Paul Peritsch's 2026-07-29 px review** of the rev5 wavy + ICE arrays
(2 px gap cross-sections "will not be cleaned", 1–2 px fins, "gaps
should be wider than fins"). Plus the team-distribution ask (standalone
exe). Everything below shipped and gated the same day.

**1. LMM rulebook re-anchored (§35A revised in place).**
`engine/manufacturing.py` + the `manufacturing.ts` mirror now derive the
LMM bounds from green px (UNROUNDED `px·0.035/1.197`, so a px-exact
design sits ON its bound instead of a rounding hair below): fin abs 3 px
/ rec 4 px; deep-channel (> 1 mm green) gap abs 6 px / rec 8 px, shallow
(≤ 1 mm) 5/6 px — the gap bound is depth-aware in `check_case`. Two new
checks: **`gap_ratio`** (b ≥ t, MARGINAL when violated — the 2026-07-29
email rule) and **`fin_height`** advisory (fin rules tested at ~1 mm
green height; ours are ~6.8 mm). `/api/schema` `lmm_process` gains the
px-rule block so the UI reads, never re-states. Consequence (intended,
honest): **M1 FAIL / M2 MARGINAL / M3 PASS**; the 0.10 hero's fin is
now printable-marginal (3.4 px) but its gap still FAILs.

**2. M4 — the new manufacturing target (default selection).** The
constrained optimum computed through the validated solver on px-snapped
candidates inside the legal region: **6 px fin / 8 px gap green
(t 0.1754 / b 0.2339 final, H 5.5, A 0.55, λ 2.5)**. 6 px fins beat 4 px
(η_f 0.28 vs 0.23 at this slenderness — fewer, better fins win) and M4
beats M3 thermally (catalog 17.14 vs 17.76 mK/W) while fully PASSing.
Cost vs the dead M1 ≈ +1.7 K @ 575 W (TIM+base dominated). Ships as
candidate `v6_lmm_M4_guideline` (px-exact values computed from the
process constants); frontend `DEFAULT_ID` switches M1 → M4. Key
principle recorded: **overpoly compensation is dimension-preserving,
not dimension-improving** — pitch is conserved, so no ∓2 px edit can
rescue a 9 px-pitch design (M1, or 0.10/0.17): the only 9 px split not
outright FAIL needs a 1 px CAD fin, which does not slice.

**3. ⇄ CAD tab (fourth stage view) + GreenCad px columns.** New
`CompensationTab.tsx` next to 3-D / ▦ Pixel / ✓ Verify: the full chain
per dimension — final → ×1.197/×1.23 green → 35/25 µm snap → **CAD
draw** (∓2 px, in mm AND px) → **prints back as** px — for the selected
candidate or live sliders, with guideline guardrails (≤ 1 px CAD fin =
"will not slice" FAIL, 2 px = slicing-edge warning, printed px vs the
3/6/8 floors, gap > fin) and a **⧉ copy-for-nTop** plain-text handoff
block. Chain math extracted to `manufacturing.lmmCompensation()`; the
GreenCad fold-out under the sliders is now a compact view of the same
function (mm + px + the same warnings). LMM fin families only; the tab
is greyed out otherwise.

**4. ▦ Pixel — guideline tints + ⌖ neck scan + ⌖ scan all layers.**
Violation painting gains the recommended tier (channel < abs red, abs–rec
dim red; fin < abs orange, abs–rec dulled) with depth-aware channel
thresholds; footer gains rec values and a `✗ fins wider than gaps` flag.
**⌖ neck scan**: Incus reviews the slicer BITMAP, so nominal (analytic)
widths cannot see their "cross section only 2 px" findings — local
passages necked by off-grid rounding + stair-step phasing. The scan runs
a morphological opening on the void (two 3-4 chamfer distance
transforms ≈ Euclidean; disc = the 6 px floor): every channel pixel a
6 px disc cannot reach paints bright pink, < 3 px blobs dropped as
stair-corner clips; footer reports flagged px + worst passage width with
a zoom-to-worst button; runs on the design's own raster AND the imported
STL slice, composing with the overpoly what-if. **⌖ scan all layers**
(imported STL only): sequential worker-mask sweep over the whole stack
(state-machine on arriving masks — worker API untouched; render paused
while scanning; cancelable with live progress), then auto-snaps to the
worst layer + narrowest passage at 1000 % zoom. Footer keeps the stack
verdict ("worst layer N · neck ≈ X px" or all-clean). This is the
automated version of the review INCUS does by hand: Verify → Pixel →
scan → green = safe to send.

**5. Standalone exe for the team.** `build_exe.bat` →
`standalone\ColdPlateViewer.exe` (~9 MB PyInstaller onefile; zip beside
it): the whole app (server + engine snapshot + built UI) runs on any
Windows PC with no Python/Node/LAN dependency. `server.py` is
frozen-aware (`FROZEN`): assets from `sys._MEIPASS`, saved projects in
`projects\` beside the exe; auto-opens the browser; a second launch
detects the running instance via `/api/health` and reopens the tab.
Build gotchas recorded in the bat: PyInstaller venv must live at a SHORT
path (Windows 260-char limit), engine modules load at runtime via
`sys.path` so their stdlib deps need `--hidden-import`. **Rebuild + re-send
the zip after every `sync_engine.py` or UI change** — the exe carries
frozen copies. `standalone/` is git-ignored.

**Docs + acceptance.** §35A tables/consequences revised in place (dated),
About tab rulebook + references updated (guidelines PDF + 2026-07-29
email are primary sources), README rewritten accordingly.
`test_v3_manufacturing.py` re-baselined: M1 FAIL / M2 MARGINAL / M4 PASS
plus new checks (gap_ratio fires, deep-channel message, tall-fin advisory,
px-derived bounds, M2 < M4 < M3 ordering). Gates all green: parity 5/5
golden-exact, every V2/V3/V5 suite, `npm run test:verify` (engine + 26
F1), tsc + production build clean; exe smoke-tested (byte-identical
`/api/catalog` vs source engine, project save/delete beside the exe).

### 2026-07-31 — the wave-slope pinch (`gap_perp`): the actual root cause of the Incus rejections

Discovered live via the ⌖ neck scan (exact-EDT) on a compensated M4
preview: with everything nominally clean (printed 8 px gaps, 4–6 px fins,
compensation verified), the scan still flooded — because between in-phase
wavy fins the **perpendicular passage at the wave's steepest section is
(t+b)·cosθ − t with tanθ = 2πA/λ**, and the hero wave (A 0.55 / λ 2.5)
has θ = 54°. Hand-math vs Paul's 2026-07-29 findings: rev5 predicted
1.3 px vs his measured "~2 px"; M4 predicted 2.2 px vs the neck scan's
2.8 px. **The nominal widths were never the whole problem — the wave
inherited from the validated v6 hero cannot be cleaned at any t/b.**

- **New hard rule `lmm.gap_perp`** (engine + TS mirror, LMM wavy only):
  perpendicular passage vs the abs floor (6 px deep-channel) — FAIL below;
  message carries the slope angle + the max-A budget at the current λ. The
  8 px rec tier stays on nominal `gap_min` (no wave can reach the rec
  perpendicular — at zero slope perp = b exactly). ⚒ make-manufacturable
  now also clamps A to the slope budget (snapped DOWN to the px grid).
- **Verdict cascade (honest):** every hero-wave preset now FAILs —
  M2/M3/M4 join M1 and the 0.10 hero as history rows.
- **Joint (t, b, A) sweep** under the slope constraint (A* at the floor
  per (t, b), since bigger A always helps χ): PASS-tier optimum = **M4's
  dims with the tamed wave** → **M4b (px-exact 6/8 px, A 8 px ⇒ 30°,
  ≈ 21.5 mK/W, 12.4 K @ 575 W)** — new default selection; best
  allow-marginal corner = **M2b (5/7 px, A 5 px ⇒ 20°, ≈ 20.7 mK/W)**,
  thermally ahead of M4b via pitch but gap 7 px < 8 px rec and thinner
  margins everywhere. Straight fins remain the only way to an 8 px
  perpendicular (M4-dims straight ≈ 23.1).
- **Slope budgets at λ 2.5:** M4 dims A ≤ 0.239 (θ ≤ 31°); M2 dims
  A ≤ 0.157 (θ ≤ 21.6°). A and λ trade 1:1 through tanθ = 2πA/λ.
- Note for the nTop handoff: A and λ carry NO overpoly compensation
  (overpoly moves both fin walls equally — the centerline wave is
  unchanged); they only px-snap. Compensation fixes widths, never slope.
- Tests re-baselined again (M2/M3/M4 FAIL via gap_perp with slope cited,
  M4b PASS, M2b MARGINAL, M2b < M4b thermally); parity 5/5 + all suites
  green.

**Prototype 1 lineage anchor (`proto1_reference`, same day — CORRECTED
within hours; the correction supersedes the first reading).** First pass
measured `SW01_0.25_new base.stl` assuming final-scale dims and concluded
"M4b −14 % vs Proto 1" — **wrong**: the mesh files are **green-scaled**
(×1.197). Proof: the sinter-welding part `SW01.02_0.25mm_no base.stl`
(the one **Incus printed successfully**, fins-only + separate 40.6 mm
base bonded during sinter — the guidelines §6 route, and the origin of
the fins-only Proto2 workflow) measures pitch 0.600 green = **0.501 mm
final — the documented 0.25/0.25 exactly** — with fins drawn at
green-nominal ∓~0.7 px/side, i.e. a hand-rolled overpoly compensation.
Corrected final geometry (mesh-measured): **t 0.25 / b 0.25 / pitch
0.50, wave A 0.72 / λ 2.58 → 60° slope, H ≈ 5.0** (SW01 "new base" is a
wider-pitch sibling: b 0.335, A 0.76 / λ 3.13, 57°). Scored on the GB202
die-coverage basis at 2.65 L/min (the Proto 1 rig condition that
validated the v1 solver):

| design | R_jc | ΔT @575 W | perp @ max slope | verdict |
|---|---:|---:|---:|---|
| Proto 1 SW01.02 (0.25/0.25, 60°) | **16.97** | 9.8 K | ≈ 0 px | FAIL |
| SW01 new-base sibling | 20.82 | 12.0 K | 2.4 px | FAIL |
| M2b | 20.89 | 12.0 K | 6.3 px | MARGINAL |
| **M4b** | 21.58 | 12.4 K | 6.1 px | **PASS** |

The honest claim is therefore **not** "M4b beats Proto 1 on paper" — it
doesn't. It is: **M4b is the best design that survives the current
rulebook**, while Proto 1's thermal edge rides on ~2 px passages
(raster of the actual green file at 35 µm: median local width 2.7 px,
p5 2.0 px, 55 % of the void unreachable by a 6 px disc) — the same
pixel class Incus's 2026-07-29 review rejects. **The open question this
raises (for Paul):** Incus successfully printed those ~2 px passages on
the OPEN-TOP fins-only part — does the sinter-weld route (channels
fully accessible until the base is bonded) relax the enclosed-channel
6 px cleaning floor? If Hieu confirms the Incus-printed SW01.02 was the
part on the rig (flow + thermal data ⇒ channels demonstrably open),
that is an empirical case for a fins-only tier in the rulebook — and
the thermal prize for reopening the steep-wave corner is ≈ 4.6 mK/W
(≈ 2.6 K @ 575 W). Until confirmed, the rules stand and M4b remains
the target. Caveats unchanged: rig ±35 % R_jc instrumentation; model
blind to surface finish/manifold topology.

## 2026-08-03 — Optimizer: click ANY swept point → sliders (BUILT)

§8 always said "click a point → load it", but only the ★ optimum had a
button. Now every swept point is a click target that loads its (x, y)
pair into the sliders through the same `patchDesign` path:

- **Heatmap** — every cell (including dimmed gate-fail / mfg-FAIL cells,
  so a failing corner can be inspected on the sliders); the hover tooltip
  gains a "click → load into sliders" hint line.
- **Pareto** — both the blue front points and the grey grid dots. The
  visible marks are 1.6–2.6 px, so invisible ~4.5–6 px hit circles are
  drawn on top (front targets drawn last → they win where the cloud
  overlaps). Grid/front points also gain tooltips (x/y values in
  engineering units + R_jc + pump) they never had.
- Chart captions now end in "click a cell/point → sliders" for
  discoverability. `OptimizerPanel` exposes one `loadPoint(x, y)`;
  `Heatmap`/`Pareto` take an optional `onPick` prop.
- Unchanged: "load optimum → sliders", "★ add top 5 → candidates", and
  the ◆ candidate diamonds (full saved designs, hover-only — selecting
  them belongs to the left list / Comparison tab).

## 2026-08-03 — design saves no longer commit the live problem draft (BUILT)

Found live on AD102: saving a slider design while the Design Studio held
an unsaved draft (die enlarged past the core) silently committed that
draft to the project store — every non-pinned row then read
FAIL:coverage, and it looked like the design's fault. Root cause:
`saveAsCandidate` / `addCandidates` / `removeSavedDesign` wrote
`{ ...activeProject, designs }`, and `activeProject` carries any dirty
draft applied from the studio.

- **`saveDesignsOnly`** — designs writes now merge into the last
  **store-confirmed** project (`storedProject`, tracked through
  boot/load/save). A candidate save can never alter the stored problem;
  the live draft (and its dirty flag) stays untouched in the UI apart
  from the refreshed designs list. Saving the problem itself remains the
  Design Studio's explicit save.
- **Re-save updates in place** — re-saving a selected saved candidate
  now defaults the name prompt to the entry's ORIGINAL name (reverse
  lookup `saved_<slug>` → name), so accepting the prompt overwrites that
  entry. Previously it defaulted to the internal `saved_…` id and minted
  a duplicate, leaving the stored copy stale — "my tuned sliders never
  reached the saved design".
- Built-in projects keep the fork-on-first-save behavior
  (`forkBuiltinWith`) — the "(custom)" fork intentionally carries the
  full live draft, because that fork IS the save.
- Coverage note, restated while diagnosing: `FAIL:coverage` is
  `(core_W × core_L) < (die_W × die_L)` — a property of the project's
  stack, identical for every non-pinned candidate; only pinned rows
  (Prototype 1) carry their own envelope and can differ.

## 2026-08-03 — Report §4: M1-forward only, px checks in the comparison table (BUILT)

User decision: the Report's candidate comparison drops the default catalog
rows (v6 hero, straight fin, supplier floor, LPBF fallback, gyroid
screening — physics references, not build candidates) and compares only
the **Incus M-presets + the project's saved designs** (falls back to the
full list if a catalog somehow has neither). Performance and
manufacturability now share the ONE table:

- New columns `fin t (px)` · `gap b (px)` · `perp (px)` · `Mfg`, each px
  cell rendered **have/reference** in GREEN px (final mm × 1.197 ÷ 0.035,
  guidelines 07/2026): fin t vs the **4 px** recommendation, gap b vs the
  **8 px** deep-channel recommendation (6 px floor), perpendicular
  wave-slope passage vs its **6 px floor** (hard rule — no rec tier, at
  zero slope perp = gap). ⚠ = MARGINAL, ✗ = below floor, e.g. M1 reads
  `b 5.1/8 ✗ · perp 1.3/6 ✗` and M4b `8.0/8 · 6.1/6`.
- Values come from the API's per-candidate `manufacturability.checks`
  (rule → mm value/bounds), converted via the TS mirror's `LMM_PROC`;
  non-LMM routes render `—`. Pinned rows are labeled `(pinned)`
  (`pinned` added to the TS `BaselineResult`).
- **SA column (same day, user request):** `SA fin/eff (mm²)` — the V3.2
  fin-only structure area and its effective value (η_f × uniformity ×
  access derated), from the per-candidate `areas` block. Raw SA flatters
  thin-fin designs (low η_f), so both are shown; completes the requested
  SA · R_jc · ΔP performance set in the one comparison table.

**Pinned reference row (same day, user request):** a candidate case may
now carry **`pinned_stack` + `pinned_operating`** — a FIXED reference is
scored on its own as-sent envelope and operating point in every project;
switching projects must never rescale a part that physically exists.
`proto1_reference` pins its mesh-measured envelope (fin field 23.4 ×
22.6 mm, H 5.0, 1.87 mm sinter base, rig flow 2.65 L/min; die/TIM held
at the GB202 basis it was introduced under), the viewer draws that same
envelope (`geomFromCase` honors the pin), live evaluate carries it, and
the row shows a `pinned` flag. **Part-level comparison against the same
die: as-built Proto 1 = 29.2 mK/W vs M4b 20.1 — M4b ≈ −31 %.** (The
16.97 figure above is the Proto 1 *recipe* transplanted onto the
die-coverage core — a recipe comparison; the catalog row is the physical
part.) Suite checks: pinned flag present, M4b beats the as-built part,
and pinned-row R_jc identical across projects to 1e-12.

## 2026-08-05 — anchored to Incus's own slicer config; the shear correction to `gap_perp` (BUILT)

**Trigger.** Paul Peritsch sliced the Proto 2 mesh
(`wavy 28x28mm scaled 6pix fin 16pix gap 0.34mm amp.stl`, sent 2026-08-04)
and reported: *"the fins are now 6 px and the gaps are 10 px … this version
actually looks quite feasible, and I think we have a good chance of success
with this one"* — plus a direct question: *"I do not understand the reference
in your last email … could you please clarify which mesh you intended to
send?"* He also shipped his **Chitubox machine configs**
(`Chitubox_Evo35_config.cfgx`, `Chitubox_Pro25_confic.cfgx`,
`Installation manual.txt`, archived in `01_Inputs_and_References/`) and the
instruction **"for these parts please always use the HammerEvo35"**.

### What the mesh actually is (ray-probed, not assumed)

The STL was measured directly (pure-Python ray probe, 206 246 triangles,
X-scanlines at mid-height plus centreline tracking over the full field):

| quantity | green | final (÷1.197 / ÷1.23) |
|---|---:|---:|
| envelope | 33.516 × 33.516 × 6.775 mm | 28 × 28 × 5.508 mm |
| fin `t` | 0.2100 mm = **6.00 px** | 0.1754 mm |
| gap `b` | 0.3500 mm = **10.00 px** | 0.2924 mm |
| pitch | 0.5600 mm = **16.00 px** | 0.4678 mm |
| wave `A` | 0.3417 mm | 0.2855 mm |
| wavelength `λ` | 3.0115 mm = 86 px | 2.5159 mm |
| max slope | tanθ = 0.7145 → **θ = 35.5°** | — |

55 fins + a central rib, **prismatic in Z** (identical section at 2 % and
98 % height — fins-only, no base: the SW01.02 sinter-weld route), and
**dead uniform**: horizontal fin 5.92–6.09 px and gap 9.91–10.08 px across
*all* fins, amplitude identical at fin #1, #27 and #53.

**The mesh matches Paul's slice exactly (6 px / 10 px). The file NAME is
what was wrong: "16 px gap" is the PITCH.** ("0.34 mm amp" is the *green*
amplitude, and is right.) That is the whole answer to his question — no
slicer discrepancy, no scaling error, a naming error.

### Rule changes

- **`gap_perp` CORRECTED — the shear form.** Both nTop and this app's own
  rasterizer ([`verify/raster.ts`](frontend/src/verify/raster.ts)) build the
  fin field by **shearing** a straight array, `x → x − A·sin(2πy/λ)`. Under a
  shear the horizontal widths are invariant and the perpendicular ones scale
  by cosθ:

  > `gap_perp = b·cosθ`  ·  `fin_perp = t·cosθ`  ·  `tanθ = 2πA/λ`

  The 2026-07-31 rule used `(t+b)·cosθ − t`, which is the perpendicular gap
  of an **offset** sweep (a constant-thickness band swept along the curve) —
  not what we build. The measurement settles it: perpendicular passage
  **measured 8.11 px** on the shipped mesh vs **8.14 px** predicted by
  `b·cosθ` and 7.03 px by the old form; fin `t·cosθ` predicts 4.89 px and
  measures 4.89 px.
- **NEW `wall_perp`** — the slope thins the **fin** as well as the channel
  (`t·cosθ`), graded against the same 3 px abs / 4 px rec fin bounds. At 54°
  a 6 px fin is only 3.5 px across. The app previously checked the nominal
  `t` only.
- **The `A` budget widens accordingly:** the largest wave that holds both
  floors is `cosθ ≥ max(gap_abs/b, wall_abs/t)`, so at M4b's dims
  A ≤ 0.351 mm (was 0.241). ⚒ make-manufacturable clamps to the new budget.
- **Verdict cascade is unchanged** — M1/M2/M3/M4 and the hero still FAIL,
  M4b PASS, M2b MARGINAL, Proto 1 FAIL. Only the *numbers* move, and they
  now match a measured mesh.

**Honest caveat, recorded in the rule's own message.** The closed form
assumes a **uniform, in-phase** wave. Legacy meshes grade the amplitude
across the field, so adjacent fins converge and the passage pinches far
below `b·cosθ` — rev6 measures **1.43 px** horizontal gaps where its
nominal is 13.9 px, and Prototype 1 rasters to a median 2.7 px / p5 2.0 px
against a closed-form 4.2 px. **For imported or graded meshes the ⌖ neck
scan is authoritative, not this rule.** (This also revises the 2026-07-31
claim that the slope cosine alone explained the rev5 rejections: the
dominant mechanism there was wave-amplitude grading, and the fix that made
Proto 2 printable was making the wave uniform and in phase.)

### Anchored to the supplier's config

- **`LMM_MACHINES`** — Evo35 and Pro25 read straight out of the `.cfgx`
  files, with **pixel size DERIVED** (`platform ÷ resolution`) so it can
  never drift from Paul's own file: Evo35 `56.0/1600 = 35.000 µm`
  (1600 × 2560, platform 56 × 89.6 × 150.02); Pro25 `200.0/8000 = 25 µm`
  (8000 × 8128, 200 × 203.2 × 140). Layer 25 µm confirmed on every Evo35
  profile. **Both constants were already correct** — they are now sourced
  rather than asserted, and `LMM_MACHINE = EVO35` records Paul's
  "always use the HammerEvo35".
- **NEW `build_envelope`** — the submitted mesh is *green*, so it is the
  ×1.197 footprint that has to fit the platform. FAIL if it does not; the
  app had no such check. Proto 2 green 33.5 × 33.5 → PASS; a 60 × 80 core
  (71.8 × 95.8 green) now FAILs instead of passing silently.
- **NEW `slice_px`** (INFO) — the three numbers Incus counts in GIMP on the
  sliced PNG: **fin · gap · PITCH** in green px, with the rule stated in the
  message: *pitch is NOT the gap*. This is the rule that would have caught
  the mis-named mesh. The Report §4 caption carries the same warning.
- **NEW `shrink_basis`** (INFO) — **open question for Paul.** Incus's own
  profiles carry `SCx121y122z125` (x 1.21 / y 1.22 / z 1.25 — **anisotropic
  in XY**) against this app's isotropic x1.197 / x1.23. If theirs governs our
  Cu-OF, a 28 × 28 part lands **−0.30 mm in X and −0.53 mm in Y**. The
  rulebook **keeps 1.197/1.23** (that is what the shipped mesh was scaled by
  — changing it would silently move every number in the app and de-snap the
  px-exact presets) and reports the delta instead. The check also states the
  process rule: **slice our meshes with shrink compensation OFF** — they are
  already green-scaled, and Paul's `noSC` profile is the correct one (his
  6 px reading proves he used it; an SC profile would have shown 7.3 px).

### New pinned reference row: `proto2_as_sent`

Prototype 2 exactly as sent, from the mesh measurement above — pinned to its
own 28 × 28 fins-only envelope like `proto1_reference`, scored on the
project's operating point. **Verdict PASS on every rule** (fin 6 px, gap
10 px, `b/t` 1.67, perp 8.1 px ≥ 6 px floor and ≥ the 8 px rec, fin-perp
4.9 px, envelope fits) — consistent with Paul's "quite feasible". At
**30.6 mK/W** on its own smaller core it is not a thermal competitor to M4b
(20.1 on the 35 × 28 core); it is the manufacturability proof point, and the
first design in the catalog whose px numbers were confirmed by the supplier's
own slicer.

**Tests:** 9 new checks in `test_v3_manufacturing.py` — derived pixel sizes,
platform, anisotropic SC carried, Proto 2 present/pinned/PASS, `slice_px`
reproducing Paul's 6/10/16, `gap_perp`/`wall_perp` matching the measured
8.11/4.89 px to ±0.05 px, and an oversize part FAILing `build_envelope`.
All Python suites green (golden parity 5/5); frontend verify 26/26 + build
clean.

## 2026-08-05b — the wave pinch is CONSTRUCTION-dependent; Incus report 502/1 closes three open questions (BUILT)

Same day, hours after the shear correction above. Hieu supplied (a) the actual
Prototype 1 mesh Incus printed, (b) its true design dims, and (c) **Incus
Innovation Study 502/1, "Vinnotek Heatsink – cleanability and sinterbonding"
(Paul Peritsch, 14.01.2026)** — the build report for Prototype 1. Together they
correct this morning's section and settle three standing questions.

### Both pinch laws are real — it depends how the fin field is BUILT

The 2026-08-05 section claimed `(t+b)·cosθ − t` "is not what nTop builds". That
is wrong: it is not what nTop built for **Proto 2**, but it is exactly what it
built for **Prototype 1**. Ray-probing decides it, per part, with no ambiguity —
bin the scanlines by local slope and see which quantity stays constant:

| construction | invariant | `gap_perp` | `fin_perp` | seen in |
|---|---|---|---|---|
| **shear** `x → x − A·sin(2πy/λ)` | horizontal widths | `b·cosθ` | `t·cosθ` | Proto 2; this app's own `raster.ts` |
| **offset** (constant-thickness band swept along the curve) | perpendicular thickness | `(t+b)·cosθ − t` | `t` | Prototype 1, rev5-era models |

Prototype 1, `fin_x·cosθ` across slope bins: **7.93 / 7.76 / 7.77 / 7.76 / 7.70 px**
(0–50°) while `fin_x` itself swings 8.03 → 10.33 px. Constant to 3% — an offset
sweep, conclusively. Proto 2 is the mirror image (`fin_x` constant to 0.43%,
`fin_x·cosθ` scattered 7.4%) — a shear.

**Why it matters:** on Prototype 1's dims the offset law gives **2.05 px at 55°**
— Paul's *"cross section only 2 px"* — where the shear law would say 3.6 px. The
offset sweep also has a failure mode the shear cannot reach: once
`(t+b)·cosθ ≤ t` the neighbouring fins **touch and the channel closes outright**.
Measured on the Prototype 1 green mesh: **9–12 fully solid bands spaced λ/2 ≈
1.9 mm, ~20% of the flow length**. Its `A/pitch` is **0.94**, against Proto 2's
0.61 — the amplitude is nearly a whole pitch, so neighbours cannot help but
collide.

- `GeometryCase.wave_construction` ∈ {`shear` (default), `offset`} — a pure
  manufacturability descriptor; the thermal/hydraulic path never reads it, so
  golden parity is untouched (5/5).
- `lmm.gap_perp` grades the case's own law and reports what the other would say.
  `lmm.wall_perp` reports `t·cosθ` for a shear and constant `t` for an offset.
- **NEW `lmm.wave_merge`** (offset only): FAIL once the slope passes the angle
  at which the fins merge.

### Prototype 1 was recorded wrong — corrected against the report

Report 502/1 §1 lists **"Heatsink design 1 — 0.25 mm — printed and sintered as
one"** and **"Heatsink design 2 — 0.16 mm — sinterbonding of base and top"**.
`proto1_reference` is **design 2**, and its dims are **fin 0.25 / channel 0.16**
(⊥ pitch 0.41) — not the 0.25/0.25 we had recorded.

The green mesh confirms the guidelines' overpoly compensation was applied and
the pitch preserved exactly:

| | design (final) | green nominal | measured green |
|---|---:|---:|---:|
| fin `t` ⊥ | 0.25 | 8.55 px | **7.80 px** (−0.75) |
| gap `b` ⊥ | 0.16 | 5.47 px | **6.22 px** (+0.75) |
| ⊥ pitch | 0.41 | 14.02 px | **14.02 px** ✓ |

Envelope also confirmed: green 28.002 × 27.010 × 6.207 → final 23.393 × 22.564
× 5.046 mm, fins-only and prismatic in Z. Wave re-measured by lattice-phase fit
(immune to single-fin tracking errors): **A 0.471 / λ 3.20 final**, replacing the
recorded 0.719 / 2.581. *Caveat:* the waveform is **not a sine** — the directly
measured steepest section is 55.6° against 42.7° from `2πA/λ` — so the closed
form under-reads this part, and the ⌖ neck scan remains authoritative.
Row verdict is unchanged (**FAIL**) but now for the right reasons: `gap_min`
5.5 px < 6 px floor, `gap_perp` **1.7 px**. R_jc moves 29.20 → 29.45 mK/W, so
**M4b still beats the as-built Prototype 1** and that headline is unaffected.

### Three questions closed by the report

1. **Shrink basis — CONFIRMED, not an open question.** §3.1.1: *"Both designs
   were printed using the standard shrinkage compensation factors for copper:
   x/y = 1.197, z = 1.23."* Guidelines §1 says the same. The generic Chitubox
   `SCx121y122z125` profile is **not** the Cu-OF basis; `lmm.shrink_basis`
   now says so instead of raising it as a question.
2. **Overpolymerisation — stays on the guidelines (team call, Hieu).** Report
   502/1 mentions ~half a pixel and a −15 µm contour offset applied by Incus at
   slicing for *that* build; guidelines §3 (July 2026) says **25–35 µm per side,
   compensated in the CAD: fin −2 px, channel +2 px**. We design to the
   guidelines — the conservative choice, since over-compensating widens channels.
   `LMM_OVERPOLY_PX = 1`, `LMM_OVERPOLY_IN = "cad"`, both asserted in the suite.
3. **Does sinter-bonding relax the cleaning floor? — NO.** This was the open
   question posed by the Prototype 1 row. §2/§3.1.1 answer it directly: the
   0.16 mm part, *printed and cleaned separately*, still showed **"residual
   feedstock ... after 20 minutes"** of heated ultrasonic plus manual air, and
   *"the small channels may still not be completely free"*. Incus's own
   recommendation: **"increasing the minimum channel to 0.25 mm ... is expected
   to significantly improve cleanability."**

### The rulebook is now empirically anchored at both ends

Two supplier-cleaned parts bracket our 6 px floor / 8 px recommendation exactly:

| part | channel (final) | green px | Incus result |
|---|---:|---:|---|
| design 1 | 0.25 mm | **8.55 px** | *"appeared to be well cleaned"* ✓ |
| design 2 | 0.16 mm | **5.47 px** | *"not all channels could be fully cleaned"* ✗ |

5.5 px fails, 8.5 px passes — the 6–8 px band is not a guess, it is measured on
our own geometry. **Proto 2's 10 px gap sits above both.**

Also recorded from the report: printed on the **Hammer Lab35** (35 µm, same
pixel as the Evo35 the Proto 2 parts go on), 55 vol% Cu (−22 µm) in Binder CP82,
H₂ sinter to **~95% relative density** (supports the k ≈ 340 W/mK basis), all
parts sintered without deformation, and sinter bonding judged *"a feasible and
robust method"* — the Proto 2 fins-only workflow is on solid ground.

**Tests:** 11 further checks (construction flag changes the verdict on identical
dims, Proto 1 dims/law/1.7 px, offset holds `wall_perp = t`, `wave_merge`
present, overpoly stays on the guidelines, shrink confirmed). All Python suites
green, golden parity 5/5.
