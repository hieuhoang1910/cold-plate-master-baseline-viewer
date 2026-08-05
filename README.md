# Cold Plate — Master Baseline Viewer

Internal engineering tool to view, tune, and optimize GPU cold-plate /
heat-sink designs as live implicit-body (SDF) 3D geometry next to their KPIs.
Physics comes from the **validated** Cold Plate solvers — the browser never
runs a second physics model.

Project lead: **Hieu Hoang** — Vinnotek.

## 📦 Download (team)

**[⬇ ColdPlateViewer.zip — latest build](https://github.com/hieuhoang1910/cold-plate-master-baseline-viewer/releases/latest/download/ColdPlateViewer.zip)**
— unzip, double-click `ColdPlateViewer.exe`; it starts locally and opens the
viewer in your browser (no install, no Python/Node). Saved projects live in a
`projects\` folder created next to the exe. The link always serves the newest
build — the [release](https://github.com/hieuhoang1910/cold-plate-master-baseline-viewer/releases/tag/standalone-latest)
is rolling and its asset is replaced on every ship (see the commit history on
`main` for what changed). Windows SmartScreen may warn on first run (unsigned
exe): More info → Run anyway.

- **Full design spec:** [`MASTER_BASELINE_VIEWER_SPEC.md`](MASTER_BASELINE_VIEWER_SPEC.md) (V2 = §18+; V3 = §32–37; V4 = §38–45; V5 = §46–54)
- **Rebuilding the geometry in nTop:** [`NTOP_REPLICATION.md`](NTOP_REPLICATION.md) — the exact implicit-body equations (fins, pins, all 8 TPMS types, wall/iso mapping, cell-grading law) plus the recommended nTop workflow and verification targets.
- **References:** [`REFERENCES.md`](REFERENCES.md) (mirrored in the About tab)
- **Team doctrine (2026-08-05, standing):** **performance ⊥ manufacturability.**
  Performance numbers (SA/V, R_jc, ΔP, areas…) are exact geometry from the
  design dims as entered — no shrink, no overpoly, no mfg derating, ever. The
  manufacturing layer (green px, ×1.197/×1.23, ⇄ CAD) is a separate gate
  applied afterwards; the manufacturable geometry is then **re-scored as plain
  geometry** and compared to the unconstrained optimum (the optimizer's ★ vs ☆
  delta). Magics/nTop print files are green — convert them only when
  reconciling meshes, never inside performance math. Stated on the Surface &
  thermal card ("exact from design dims · no shrink ⓘ"); spec §2026-08-05d.
- **Status (2026-08-05c):** the Magics-size basis question settled — the
  Materialise Magics part dimensions (28.002 × 27.010 × 6.207 mm) are the
  **green** state: the mesh's perpendicular pitch 0.4907 ÷ 1.197 =
  **0.4100 = t 0.25 + b 0.16 exactly**, so the sintered fin field is
  23.39 × 22.56 × 5.05 mm and **`proto1_reference` is the only Prototype 1
  anchor** (a short-lived `proto1_own_block` row carrying the Magics numbers
  as final mm was removed the same day; the suite guards the removal and the
  pitch proof). The design **sliders** now take **typed exact values** (click
  the number; finer than the drag step) and got wider ranges + 1 µm steps on
  widths.
- **Status (2026-08-05b):** **Incus Innovation Study 502/1** (the Prototype 1
  build report) is now in the rulebook and closes three questions: the shrink
  basis is **confirmed** at x/y 1.197 / z 1.23 ("standard factors for copper" —
  the generic Chitubox `SCx121y122z125` profile is *not* the Cu-OF basis);
  overpolymerisation **stays on the guidelines** (25–35 µm/side, compensated in
  CAD); and **sinter-bonding does NOT relax the cleaning floor** — the 0.16 mm
  part, cleaned separately, still held residual feedstock. The rulebook is now
  bracketed by two supplier-cleaned parts: **0.25 mm (8.55 px) "well cleaned"**
  vs **0.16 mm (5.47 px) "not fully cleaned"** — our 6 px floor / 8 px
  recommendation sits exactly between them. `gap_perp` is now
  **construction-aware** (shear vs offset sweep — both occur in our nTop
  models), with a new `wave_merge` rule for offset sweeps whose fins touch.
  `proto1_reference` corrected to the report's design 2: **fin 0.25 / channel
  0.16**, offset sweep, A 0.471 / λ 3.20 — still FAIL, now supplier-confirmed.
- **Status (2026-08-05):** the LMM rulebook is now anchored to **Incus's own
  Chitubox machine configs** (`Chitubox_Evo35_config.cfgx` / `_Pro25_`, sent
  by Paul Peritsch and archived in `01_Inputs_and_References/`): pixel size is
  **derived** from platform ÷ resolution (Evo35 56.0 mm ÷ 1600 px = 35.000 µm
  exactly — the constant was already right, it is now *sourced*), plus new
  **`build_envelope`** (the green mesh must fit the 56 × 89.6 × 150 mm
  platform), **`slice_px`** (fin · gap · **pitch** in green px — *pitch is not
  the gap*), **`wall_perp`** (the wave thins the fin too) and a
  **`shrink_basis`** advisory (Incus's profile reads `SCx121y122z125`,
  anisotropic, vs our x1.197/x1.23 — open question). `gap_perp` corrected to
  the **shear** form `b·cosθ`, validated against the ray-probed mesh Incus
  sliced (8.11 measured / 8.14 predicted). New pinned row **`proto2_as_sent`**
  = Prototype 2 exactly as shipped (6 px fin / 10 px gap / 16 px pitch green,
  **PASS**) — the first design whose px numbers the supplier's own slicer
  confirmed. Details in the spec's `2026-08-05` section.
- **Status (2026-07-30):** all of the below **plus the Incus-guidelines
  revision**: LMM rulebook re-anchored to the official
  `Incus_Design_Guidelines.pdf` (green-px basis; the hero-wave presets now
  honestly FAIL — the wave-slope pinch was the real root cause — and the new
  **wave-safe M4b preset is the default**), a **⇄ CAD tab** (full
  final → green → overpoly-compensated CAD chain + copy-for-nTop), the ▦
  Pixel **⌖ neck scan** + **scan-all-layers** (finds the "2 px areas" INCUS
  flags and snaps to the worst one), and the **standalone exe** for the team
  (`build_exe.bat` → `standalone\ColdPlateViewer.zip`). Details in the spec's
  2026-07-30 changelog.
- **Status:** V4 complete (V4.0–V4.4) — everything from V2 (projects & Design
  Studio: coolant, T_j target → derived R_jc gate, ΔP/pump budgets, layouts;
  fin + TPMS + pin-fin solvers (Shah–London / Renon & Jeanningros /
  Zukauskas); live 3D tuning, constrained optimizer, saved designs as
  candidates, report export, mass/cost + R_jc uncertainty band, STL export,
  LAN hosting) and V3 (two-tier LMM/SLM DfAM rulebooks with live
  PASS / MARGINAL / FAIL verdicts, per-design area readouts, Incus-compliant
  M1/M2/M3 presets (M1 = default), enforcement modes, green→CAD export chain,
  DLP pixel-preview tab, plain-language About), V4 (the **Verify tab** and a
  full UI redesign) **plus V5**: the solver-backed **flow & thermal intent
  viewer** — see below.

**Flow & thermal intent (V5).** The viewer shows how the design *wants* the
water to move and the heat to leave — solved, never simulated, and never a
substitute for CFD (the workflow is: design for best intent here → Ansys
confirms → print). Underneath: **S6**, a server-side flow-network solver
(the manifold → slots → compartments → channels system as a hydraulic
circuit built from the same Shah–London fRe + minor-loss correlations as the
KPI solvers — it *computes* per-path splits and the flow uniformity that was
previously an assumed scalar, and reconciles its ΔP against the KPI solver
on every evaluate), and **F1**, a browser-worker depth-integrated
Darcy/Hele-Shaw field solve (solved p/v fields + upwind thermal transport
whose outlet closes the energy balance exactly; 26-check node suite in
`npm run test:verify`). On top: `≈ Flow` runs a particle stream through
**every fin gap** on seven depth layers at each gap's own solved speed —
dive at the mid-rib, gradual settling, level run, straight pressure-driven
exit — with parcels **warming blue → red** as they collect heat; `Thermal`
tints the metal itself (cosh fin profile, hot rib strip); `ΔP` paints where
the pressure budget is spent; `▶ ride` follows one parcel (steadicam chase
or first-person POV, any depth layer, solo + path streamline); the `ⓘ`
overlay explains every layer's physics in plain words. The Report gains the
**FC-1…FC-7 CFD confirmation checklist** — machine-checkable claims (splits,
uniformity, ΔP decomposition, outlet T, low-flow zones, jet aim, the
wedge-rib hypothesis) that the eventual Ansys run either confirms or
corrects. ICE rev 3's distribution topology (10 feed ducts, interdigitated
side-venting returns, 1.40 mm compartment pitch) was mesh-extracted from the
actual INCUS part during the build, resolving spec §54 Q1.

The Report's candidate comparison (§4) covers **M1 and forward only** — the
Incus M-presets plus the project's saved designs; the default catalog rows
(v6 hero, straight fin, supplier floor, LPBF fallback, gyroid screening) are
physics references and stay out. Performance (SA fin/effective, R_jc, ΔP,
pump) and manufacturability share one table: each Incus pixel check appears
as **have/reference** in green px
(e.g. gap `5.1/8 ✗` = the design's 5.1 px vs Paul's 8 px deep-channel
recommendation) for fin t (rec 4 px), gap b (rec 8 px, floor 6) and the
perpendicular wave-slope passage (6 px floor), plus the per-route verdict.

**Verify (V4).** Drop the binary STL Hieu exports from nTop onto the ✓ Verify
tab and the app checks it against the same implicit geometry the solvers
scored — entirely in the browser (a Web Worker; no new endpoints, no pip):
**shape** (every vertex measured against the design surface; PASS = 95 % of
the surface within ±15 µm — half an EVO35 pixel — and nothing beyond a full
pixel), **solver inputs** (fin area, flow area, D_h, porosity, min fin/gap
measured on the actual mesh vs what the KPIs assumed, with a file-level DfAM
verdict and a ⟳ re-score through the validated solver), and **printer pixels**
(every 25 µm layer rasterized on the DLP grid and XOR-diffed against the
expected exposure — the pixel view gains a magenta "compare imported"
overlay with a jump-to-worst-layer). A stage selector (final / green /
CAD-for-print) compares against the right stage of the green→CAD chain —
wrong stage, wrong units, 90° rotations and wrong-project footprints are
detected and explained in words, never silently fixed; a **fins-only mode**
("file has no base slab", auto-suggested) handles core-only exports like the
Proto2 workflow, where the base is a separate mechanical part. The pixel view
can show the **imported STL's own layers** on the DLP grid, not just the
diff. Every number carries an ⓘ with what it is, how it was measured, the
bound + source, and what to do if it fails. **V4.4 — point-map field check
(mesh-free):** the Verify tab also generates a probe-point CSV; sample your
nTop implicit body on it (Point Map → CSV with values) and drop it back —
the app compares zero-crossing positions field-vs-field with no meshing
tolerance in the loop, the strongest confirmation that the implicit math of
a rebuild is right (self round-trip verifies exact: p95 = 0.0 µm over 149 k
crossings).
*Verification findings during the build:* the V3.3d pixel preview drew
fins/pins half a pitch off their true position (a JS modulo bug — aggregate
widths were right, so it went unnoticed; fixed), and the V2 TPMS wall→iso
mapping draws lattice walls ~30 % thinner than nominal (drawn void ≈ 0.90 vs
the analytic 0.852 the physics uses) — logged as spec §45-6 for calibration;
the audit table shows this drift honestly on TPMS verifications until then.

**UI (V4).** One long page in the spirit of scroll-driven studio sites: a
100 vh hero (big type over the live implicit body, project status chips,
clickable candidate strip) → scrolling dollies the camera from a far
cinematic view into the working studio → a pinned workspace where the 3-D
viewer is the full-bleed stage and everything else is a quiet glass overlay:
candidates + sliders in a collapsible left drawer, KPIs right, the
comparison/optimizer as a bottom drawer **collapsed by default**, and a
3-D / ▦ Pixel / ✓ Verify switcher up top. Custom dot+ring cursor (grows on
interactive elements, says "drag" over the 3-D view); reduced-motion users
get no intro animation and keep the native cursor.

**Optimizer.** The Optimizer tab sweeps two family-appropriate variables
(fin t/b/H/A/λ · TPMS cell/wall/grading · pin Ø/pitch · flow) into an
objective heatmap + Pareto front. The sweep carries the active project's
coolant and budgets, so the ★ optimum is the **constrained** optimum — best
R_jc (or pump/ΔP) *among points that fit the T_j gate + ΔP + pump budgets* —
reported with its T_j margin in °C; the Pareto chart draws the pump-budget
line. Set the budgets in the Design Studio (◆ chip in the header) and the
optimizer re-runs against them. "★ add top 5 → candidates" turns the best
sweep points into named, tunable candidates. **Any swept point is clickable**
— a heatmap cell or a Pareto point (front or grid dot) loads its (x, y)
values straight into the sliders, so you can try any corner of the
landscape, not just the ★ optimum. Since V3 every sweep point also
carries a manufacturability verdict: the heatmap dims non-compliant tiers and
the optimizer shows **two stars** — ★ the best point that also passes the
active manufacturing rulebook, ☆ the gates-only optimum — so the price of
manufacturability is visible on every sweep.

**Manufacturability (V3).** `engine/manufacturing.py` carries per-route DfAM
rulebooks — **LMM** (Incus Hammer EVO35, supplier-verified from their
2026-07-07 DfAM review of our actual STLs), **SLM_IR** (Nikon SLM Solutions
class, literature grade) and **SLM_GREEN** (fine green-laser pure Cu) — each
with two tiers: an *absolute* bound (printable at all) and a *recommended*
band. Every evaluate result gains a PASS / MARGINAL / FAIL verdict with the
violated rule and its source; sliders shade the amber/red zones live. The
project's **enforcement mode** decides how strict the app is:
*design-to-manufacture* (sliders and sweep clamped to the recommended band),
*allow marginal* (clamped at absolute — the current stance while the Incus M1
coupon is pending), or *explore/audit* (no clamps, verdicts annotate only).
The LMM rulebook is anchored to the **official Incus design guidelines**
(`05_References/Incus_Design_Guidelines.pdf`, July 2026 — all rules in
GREEN px, 1 px = 35 µm, closing the old green-vs-final question) plus Paul
Peritsch's px reviews (2026-07-07 and 2026-07-29): fins 3 px absolute /
4–5 px recommended; channels deeper than 1 mm 6 px absolute / 8 px
recommended (≤ 1 mm relaxes to 5 px); a **gap ≥ fin** rule ("gaps should be
wider than fins", 2026-07-29); and a tall-fin advisory (fin rules tested at
~1 mm height). Under these bounds the presets read honestly: **M1
(0.12/0.15, ≈ 5 px gap) FAILS** — Incus confirmed on our rev5/ICE parts that
such gaps won't clean; the historical 0.10 hero stays as a reference row.
**2026-07-31 — the wave-slope pinch (`gap_perp`), now construction-aware
(2026-08-05b):** the perpendicular passage at the wave's steepest section
depends on **how the fin field is built**, and both forms occur in our own
nTop models — decided per part by ray-probing (bin scanlines by slope, see
which quantity is invariant):

| construction | `gap_perp` | `fin_perp` | our parts |
|---|---|---|---|
| **shear** `x → x − A·sin(2πy/λ)` | `b·cosθ` | `t·cosθ` | Proto 2; the app's own rasterizer |
| **offset** (constant-thickness band swept along the curve) | `(t+b)·cosθ − t` | `t` | Prototype 1, rev5-era |

Proto 2 measures 8.11 px against 8.14 predicted by the shear law; Prototype 1's
offset law gives **2.05 px at 55°** — Paul's *"cross section only 2 px"* — where
the shear law would have said 3.6 px. An offset sweep can also **close the
channel outright** once `(t+b)·cosθ ≤ t` (new `wave_merge` rule): Prototype 1
measures solid bands every λ/2, ~20% of its flow length, because its `A/pitch`
is 0.94 against Proto 2's 0.61.
The hero wave (A 0.55/λ 2.5, **54°**) still pinches a compliant 8 px gap to
4.7 px and a 6 px fin to 3.5 px. Nominal widths were never the whole story:
**every hero-wave preset (M1–M4) honestly FAILs**; compensation fixes
widths, never slope. *Caveat carried in the rule's own message:* the closed
form assumes a **uniform, in-phase** wave — meshes whose amplitude is graded
across the field pinch far worse (rev6 measures 1.43 px gaps against a
13.9 px nominal), and for those the **⌖ neck scan is authoritative**.
The wave-safe presets from the joint (t, b, A) sweep:
**M4b (px-exact 6/8 px, A 8 px ⇒ 30°, ≈ 21.5 mK/W — PASS-tier optimum,
default selection)** and M2b (5/7 px, A 5 px ⇒ 20°, ≈ 20.7 mK/W — best
allow-marginal corner). ⚒ make-manufacturable now clamps A to the slope
budget as well. A **⚒ make-manufacturable**
button projects any design onto the nearest compliant point and shows the KPI
delta before you accept. For LMM export, a **green→CAD converter** prints the
full recipe chain (final → ×shrink → pixel-snapped green → ∓2 px overpoly →
CAD value) and the **▦ pixel-preview tab** rasterizes any layer onto the
printer's 35/25 µm DLP grid — zoom/pan, overpoly and violation overlays, and
min fin/channel width readouts in pixels.

**STL export.** The **⬇ STL** button in the viewer's bottom bar downloads the
current model as a binary STL in millimetres (base + fins/pins/lattice, viewer
axes). Fin and pin-fin families are meshed analytically — watertight,
exact-dimension shells at tiny file sizes (straight fins ~50 KB, wavy fins a
few MB). TPMS lattices are meshed from the implicit field with **manifold
surface nets** (one vertex per sheet side per cell, so thin walls don't pinch
into non-manifold edges; sub-voxel debris shells are dropped). Use the
resolution picker: **draft** to eyeball, **fine** (≈2 voxels per wall) for
print prep; sheet lattices are inherently triangle-dense — expect 50–200 MB,
normal for lattice STLs. A residual ~0.05 % of edges are saddle point-contacts
that netfabb/slicers auto-repair. Joined shells overlap by 0.05 mm on purpose
so slicers/CAD union them cleanly; the picker is greyed out for fin/pin
(exact meshes need no resolution).

## Quick start

**Sharing with the team — the standalone exe (no installs, no host PC).**
`build_exe.bat` packs the whole app (server + validated engine snapshot +
built UI) into a single `standalone\ColdPlateViewer.exe` (~9 MB) with
PyInstaller. Send `standalone\ColdPlateViewer.zip` to anyone: they
double-click the exe and the viewer opens in their browser — no Python, no
Node, no LAN dependency on this machine. Saved projects land in a
`projects\` folder next to their exe (per-user, not shared). Frozen-mode
path wiring lives at the top of `server.py` (`FROZEN`); assets load from
the bundle, writes go beside the exe. **Rebuild after every
`sync_engine.py` refresh or UI change** (the exe carries its own frozen
copy of both) and re-send the zip; `test_api_parity.py` +
byte-identical-`/api/catalog` is the acceptance gate.

**Easiest — double-click the launcher (Windows).** In the `07_WebApp` folder,
double-click **`Start Cold Plate Viewer.bat`**. It frees the port if a previous
run is stuck, starts the server, and opens **http://127.0.0.1:8000** in your
browser. Close the black window to stop the app.
*(Needs Python 3.10+. The very first run also needs Node.js once, to build the UI.)*

**Or run it manually (one command).** The UI is pre-built into `frontend/dist`,
so a single Python process serves the whole app:

1. Open a terminal in the `07_WebApp/` folder.
2. Run:

   ```bash
   python server.py
   ```

3. Open **http://127.0.0.1:8000** in your browser.
4. Press `Ctrl+C` in the terminal to stop.

**Sharing with colleagues on the same LAN/WiFi.** The server listens on all
network interfaces, so anyone on the same network can open the app at
`http://<this-PC's-LAN-IP>:8000` — the exact URL is printed when the server
starts (e.g. `http://192.168.1.140:8000`). The launcher `.bat` adds a Windows
Firewall rule for port 8000 automatically when run as administrator; otherwise
allow access (including **Private networks**) when Windows prompts on first
run. If others still can't connect, check that your WiFi network is set to
*Private* (not *Public*) in Windows network settings, or that "AP/client
isolation" is disabled on the router.

**If it won't start / "address already in use":** an old server is still holding
port 8000. Close it, then run `python server.py` again. On Windows (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

> Fresh clone with no `frontend/dist` yet? Build the UI once first:
> `cd frontend && npm install && npm run build`, then `cd .. && python server.py`.

For live-reload development (editing the UI), use the two-terminal setup under
[Running the app](#running-the-app).

## Layout

```text
07_WebApp/
├─ README.md                        this file
├─ MASTER_BASELINE_VIEWER_SPEC.md   design spec (review/iterate here)
├─ REFERENCES.md                    cited sources (mirrored in the About tab)
├─ server.py                        stdlib HTTP API + serves the built UI
├─ test_api_parity.py              acceptance test: reproduces the 5 golden results
├─ sync_engine.py                  refresh engine/ from the source project
├─ engine/                         vendored snapshot of the validated solvers
│  ├─ cold_plate_v6/               v6 solver package (depth: wavy hero)
│  ├─ master_baseline_calculator.py  master engine (breadth: all families)
│  ├─ manufacturing.py             V3 DfAM rulebooks (LMM/SLM) + verdicts + green→CAD recipe
│  ├─ coolants.py / targets.py / projects.py / layouts.py / pin_fin.py / tpms_*.py
│  │                               webapp-native physics modules (V2)
│  └─ data/                        master params + candidates + baseline cases
└─ frontend/                       Vite + React + react-three-fiber UI
   ├─ src/                         App (V4 shell: hero → scroll → studio), SdfViewer
   │  │                            (SDF shader + intro rig), DesignControls, KpiPanel,
   │  │                            OptimizerPanel, PixelPreview (+ STL compare),
   │  │                            VerifyTab / DeviationViewer / PointMapCheck,
   │  │                            Hero, Cursor, GreenCad, About, …
   │  └─ verify/                   V4 engine (all client-side, runs in a Web Worker):
   │                               STL parse, vertex dedup + watertight check, implicit
   │                               field mirror, stage transforms + hints, slicing +
   │                               nonzero-winding raster, BVH, point-map field check
   └─ test/verify-engine.test.cjs  V4 engine acceptance suite (node, no browser):
                                   `npm run test:verify`
```

## Running the app

**Prerequisites:** Python 3.10+ and Node.js 18+ (LTS). The Python API uses only
the standard library — no `pip install`. On Windows, if you *just* installed
Node, open a **fresh terminal** so it's on your PATH (check with `node -v`).

All commands below are run from the `07_WebApp/` directory.

### Development (two terminals, hot reload)

The Vite dev server proxies `/api` to the Python API, so both sit behind one
origin (no CORS setup needed).

```bash
# terminal 1 — solver API
python server.py                 # -> http://127.0.0.1:8000

# terminal 2 — frontend
cd frontend
npm install                      # first run only (installs dependencies)
npm run dev                      # -> http://localhost:5173
```

Then open **http://localhost:5173** in your browser. Press `Ctrl+C` in each
terminal to stop.

### Production (one process, single origin)

Build the UI once, then let the Python app serve both the UI and the API:

```bash
cd frontend && npm run build     # build UI -> frontend/dist/
cd ..        && python server.py # serves UI + API on http://127.0.0.1:8000
```

`server.py` serves `frontend/dist/` (with SPA fallback) alongside `/api/*`, so a
single process runs the whole app — ready to host on any Python-capable host.

### Troubleshooting

- **"API error" / no data in the UI** — the API isn't running; start `python server.py` (terminal 1).
- **`npm` / `node` not found (Windows)** — open a *new* terminal after installing Node; PATH doesn't refresh in an already-open shell.
- **Port already in use** — an old dev server is still running; close it, or Vite will fall back to the next free port (5174, 5175, …). Kill a stray server on a port with, e.g. (PowerShell): `Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

### API endpoints (see spec §12)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness probe |
| GET | `/api/catalog` | parameter registry + candidates + gate limits (GB202 default view) |
| GET | `/api/schema` | **V2** wizard schema: coolant presets, target defaults/bounds, family pedigree, layouts |
| GET | `/api/projects` | **V2.2** list projects (built-in GB202 + saved) |
| GET | `/api/projects/<id>` | **V2.2** one project (built-in or saved) |
| POST | `/api/catalog` | **V2.2** catalog rescored against a project (`{project}`) |
| POST | `/api/projects` | **V2.2** save a user project (`{project}`) |
| DELETE | `/api/projects/<id>` | **V2.2** delete a saved project |
| POST | `/api/evaluate` | master `evaluate_case()` for arbitrary parameters (all families) |
| POST | `/api/solve` | v6 `solve()` for the wavy hero drill-down |
| POST | `/api/sweep` | 2-variable grid sweep (heatmap + Pareto data) |

**V3 additions ride on the existing routes** (no new endpoints, all additive
so the golden fixtures stay bit-identical): `/api/schema` gains a
`manufacturing` block (the full rulebooks, so the UI never hard-codes them);
every `/api/evaluate` result (and every catalog candidate) gains `areas`
(`{die_cm2, fin_cm2, fin_eff_cm2, flow_mm2, amplification, …}`) and
`manufacturability` (`{verdict, checks[]}` with rule id, measured value,
bound, and source per check); `/api/sweep` points each carry their
manufacturability verdict plus the two-star (compliant vs gates-only)
optimum.

**V2.2 projects (Design Studio).** A *project* scopes the app to a problem
(die + envelope, operating point, coolant, target junction temp → R_jc gate,
architecture, families). The built-in **GB202 GPU** preset reproduces the V1
catalog view exactly (gate pinned to the historical 0.078 K/W). User projects
persist under `07_WebApp/projects/` (server-local, LAN-shared, git-ignored).
Physics is `engine/projects.py` (webapp-native), reusing `coolants` + `targets`.
Saving a slider design as a candidate writes **only the designs list** to the
stored project — unsaved Design Studio draft edits never ride along (the
problem itself is saved explicitly in the studio) — and re-saving a saved
candidate under its default name updates that entry in place.

**V2.1 `/api/evaluate` extras (additive, optional).** Add `"coolant"` (a preset
name like `"water"`/`"pg50"`, or `{name, rho_kg_m3?, ...}` for custom) to swap
fluid properties at the inlet temperature, and/or `"targets"`
(`{T_j_max_C, R_jc_gate_K_W?, limit_deltaP_Pa?, limit_pump_W?}`) to derive the
R_jc gate from a max junction temperature (spec §19A). When present the response
gains `coolant` and `targets` blocks (the latter carries the exact junction
temperature). With neither key the output is unchanged — the water preset is
anchored to the master defaults so the GB202 golden results are reproduced
bit-for-bit. Physics lives in `engine/coolants.py` (S4) and `engine/targets.py`
(S5) — **webapp-native** modules authored here in `engine/`, not synced from the
parent project, so the webapp stays fully self-contained.

## Test (acceptance gate)

```bash
python test_api_parity.py            # exit 0 = API reproduces the 5 golden results (anti-drift gate)
python test_v2_targets_coolants.py   # V2.1 coolants + targets + wiring
python test_v2_projects.py           # V2.2 projects / Design Studio / rescoring
python test_v2_pin_fin.py            # S1 pin-fin solver (Zukauskas + Gaddis-Gnielinski)
python test_v2_tpms.py               # S2 TPMS minimal-surface geometry
python test_v2_tpms_corr.py          # S2 TPMS Nu/f correlations (Renon & Jeanningros)
python test_v2_layouts.py            # S3 layouts + jet-flux coupling
python test_v2_report.py             # V2.6 report / mass / uncertainty band
python test_v2_sweep.py              # optimizer: family-aware + budget-constrained sweep
python test_v3_manufacturing.py      # V3 rulebooks, verdicts, areas, presets, green→CAD recipe
```

The V4 verify engine has its own node-based acceptance suite (no browser, no
server): from `frontend/`, run **`npm run test:verify`** — it re-imports the
app's own STL (expects an exact PASS with the EMBED ring classified as
buried), checks green-stage detection, proves the deleted-fin fixture is
caught by the reverse pass + layer XOR (and documented as invisible to the
one-sided check), validates TPMS raster tracking, and round-trips the V4.4
point-map check (exact PASS; a +0.06 mm fin perturbation must be detected;
inverted sign conventions must be auto-handled).

All V2/V3 features are **additive**: with no V2/V3 keys in a request,
responses are bit-identical to V1 — `test_api_parity.py` enforces this after
every change.

## The `engine/` snapshot

The repo ships **only the webapp**, not the 20 GB parent project, so it carries a
copy of the validated solvers under `engine/` to stay self-contained and
hostable. `engine/` is a *snapshot* of:

- `02_Code/cold_plate_v6/` (import-chain modules only)
- `06_MASTER_BASELINE/python/master_baseline_calculator.py`
- `06_MASTER_BASELINE/master_design_parameters.json`, `outputs/master_baseline_results.json`, `python/baseline_cases.json`

**Source of truth stays in the parent project.** To refresh after the physics
changes there, run `python sync_engine.py` (inside the Vinnotek folder), then
re-run `test_api_parity.py` — parity against the golden results is the anti-drift
gate.
