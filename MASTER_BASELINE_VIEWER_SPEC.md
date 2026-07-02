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

> **Status: V1 SHIPPED · V2 ACCEPTED (2026-07-02).** §1–§17 describe V1, now built and
> running (viewer, live tuning, optimizer, STL export, LAN serving). §18–§25 are the
> **official V2 plan** — accepted 2026-07-02 with all open questions resolved (§25);
> implementation follows the V2 roadmap (§24). Change control: edits to accepted sections
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
