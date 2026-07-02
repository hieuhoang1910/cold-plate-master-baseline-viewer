# Cold Plate — Master Baseline Viewer

Internal engineering tool to view GPU cold-plate / heat-sink designs as live
implicit-body (SDF) 3D geometry next to their KPIs, with a multi-objective
(Pareto) optimizer. Physics comes from the **validated** Cold Plate solvers —
the browser never runs a second physics model.

- **Full design spec:** [`MASTER_BASELINE_VIEWER_SPEC.md`](MASTER_BASELINE_VIEWER_SPEC.md)
- **Status:** complete — 3D SDF viewer (fin + TPMS/lattice families), live tuning, optimizer (R_jc heatmap + Pareto), and an About tab with nomenclature + cited references.

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
| POST | `/api/evaluate` | master `evaluate_case()` for arbitrary parameters (all families) |
| POST | `/api/solve` | v6 `solve()` for the wavy hero drill-down |
| POST | `/api/sweep` | 2-variable grid sweep (heatmap + Pareto data) |

## Test (acceptance gate)

```bash
python test_api_parity.py    # exit 0 = API reproduces the 5 golden results
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
