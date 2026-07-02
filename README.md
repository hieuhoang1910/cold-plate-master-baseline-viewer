# Cold Plate — Master Baseline Viewer

Internal engineering tool to view GPU cold-plate / heat-sink designs as live
implicit-body (SDF) 3D geometry next to their KPIs, with a multi-objective
(Pareto) optimizer. Physics comes from the **validated** Cold Plate solvers —
the browser never runs a second physics model.

- **Full design spec:** [`MASTER_BASELINE_VIEWER_SPEC.md`](MASTER_BASELINE_VIEWER_SPEC.md)
- **Status:** complete — 3D SDF viewer (fin + TPMS/lattice families), live tuning, optimizer (R_jc heatmap + Pareto), STL export, and an About tab with nomenclature + cited references.

**STL export.** The **⬇ STL** button in the viewer's bottom bar downloads the
current model as a binary STL in millimetres (base + fins/pins/lattice, viewer
axes). Fin and pin-fin families are meshed analytically — watertight,
exact-dimension shells at tiny file sizes (straight fins ~50 KB, wavy fins a
few MB). TPMS lattices are meshed from the implicit field (surface nets) with
a draft/standard/fine resolution picker; **sheet** lattices with thin walls are
inherently triangle-dense — expect large files (tens to hundreds of MB), which
is normal for lattice STLs. Joined shells overlap by 0.05 mm on purpose so
slicers/CAD union them cleanly.

## Quick start

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
│  └─ data/                        master params + candidates + baseline cases
└─ frontend/                       Vite + React + react-three-fiber UI
   └─ src/                         App, SdfViewer (SDF shader), DesignControls,
                                   KpiPanel, OptimizerPanel, About, …
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
| GET | `/api/catalog` | parameter registry + candidates + gate limits |
| GET | `/api/schema` | **V2** wizard schema: coolant presets, target defaults/bounds, family pedigree, layouts |
| POST | `/api/evaluate` | master `evaluate_case()` for arbitrary parameters (all families) |
| POST | `/api/solve` | v6 `solve()` for the wavy hero drill-down |
| POST | `/api/sweep` | 2-variable grid sweep (heatmap + Pareto data) |

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
python test_api_parity.py            # exit 0 = API reproduces the 5 golden results
python test_v2_targets_coolants.py   # exit 0 = V2.1 coolants + targets + wiring
```

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
