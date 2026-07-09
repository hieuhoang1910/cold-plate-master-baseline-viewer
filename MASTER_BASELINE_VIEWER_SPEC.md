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
date_updated: 2026-07-02
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

### 35A. LMM rulebook (Incus Hammer EVO35 — authoritative, from Paul Peritsch email 2026-07-07)

Source: Incus DfAM review, distilled in
`03_Reports/.../cold_plate_v6_incus_manufacturability_review_20260708.md`.
All Incus dimensions are **green (as-printed)** unless noted; final part is
smaller by the sinter shrink. Basis ambiguity (green vs final) is Incus open
question #1 — the rulebook stores both and checks the conservative one.

| Rule id | Constraint | Absolute | Recommended | Tier |
|---|---|---|---|---|
| `lmm.gap_min` | channel gap `b` (final) | ≥ 0.15 mm (Incus stated cleanability limit) | **≥ 0.20 mm** (M2; green 7 px inside their 6–8 px deep-channel band) | hard / soft |
| `lmm.fin_min` | fin thickness `t` (final) | ≥ 0.105 mm (3 px green, printed successfully) | **≥ 0.14 mm** (4–5 px green band) | hard / soft |
| `lmm.aspect` | fin aspect ratio H/b | ≤ 40 (legacy) | **≤ ~30** ("taller fins need thicker fins") | soft |
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
cleanability coupon). Note the honest verdict display: M1's gap sits exactly
on Incus's stated cleanability floor and its green gap ≈ 5 px is below their
6–8 px deep-channel band, so the manufacturability card will show M1 as
**MARGINAL** (inside absolute, outside recommended) — that is the rulebook
working as intended, not a bug. The Incus Option-2 coupon matrix is what
confirms or kills M1.

| Preset | t / b / H (mm) | N_fin | R_jc (mK/W) | ΔT @575 W | Verdict chip |
|---|---|---:|---:|---:|---|
| **`v6 LMM M1 (primary)`** ✅ | 0.12 / 0.15 / 5.5 | 122 | 14.6 | 8.4 K | MARGINAL — at Incus floor, coupon to confirm |
| `v6 LMM M2 (backup)` | 0.15 / 0.20 / 5.5 | 94 | 16.2 | 9.3 K | PASS — printable + cleanable |
| `v6 LMM M3 (easy-clean)` | 0.15 / 0.25 / 5.0 | 83 | 17.9 | 10.3 K | PASS — safest |

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
   "LMM (Incus EVO35): gap ≥ 0.15 / rec 0.20 · fin ≥ 0.105 / rec 0.14 ·
   AR ≤ 30 · pixel 35/25 µm · supplier-verified 2026-07-07".
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
