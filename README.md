# Cold Plate — Master Baseline Viewer

Internal engineering tool to view GPU cold-plate / heat-sink designs as live
implicit-body (SDF) 3D geometry next to their KPIs, with a multi-objective
(Pareto) optimizer. Physics comes from the **validated** Cold Plate solvers —
the browser never runs a second physics model.

- **Full design spec:** [`MASTER_BASELINE_VIEWER_SPEC.md`](MASTER_BASELINE_VIEWER_SPEC.md)
- **Status:** Phase 1 (Python API) + Phase 2 (React frontend: candidate table + KPI panel) done. Phase 3 = the 3D implicit-body viewer.

## Layout

```
07_WebApp/
├─ MASTER_BASELINE_VIEWER_SPEC.md   design spec (review/iterate here)
├─ server.py                        stdlib HTTP API (Phase 1)
├─ test_api_parity.py              acceptance test: reproduces the 5 golden results
├─ sync_engine.py                  refresh engine/ from the source project
├─ engine/                         vendored snapshot of the validated solvers
│  ├─ cold_plate_v6/               v6 solver package (depth: wavy hero)
│  ├─ master_baseline_calculator.py  master engine (breadth: all families)
│  └─ data/                        master params + candidates + baseline cases
└─ frontend/                       (Phase 2+) Vite + React + react-three-fiber
```

## Run the API (Phase 1)

Standard-library Python only — no `pip install` needed.

```bash
python server.py
# serves http://127.0.0.1:8000
```

Endpoints (see spec §12):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness probe |
| GET | `/api/catalog` | master parameter registry + 5 scored candidates + gate limits |
| POST | `/api/evaluate` | master `evaluate_case()` for arbitrary parameters (all families) |
| POST | `/api/solve` | v6 `solve()` for the wavy hero drill-down |
| POST | `/api/sweep` | 2-variable grid sweep (heatmap + Pareto data) |

## Run the frontend (Phase 2)

Needs Node.js (LTS). Two processes during development — the API and the Vite dev
server (which proxies `/api` to the API, so there are no CORS issues):

```bash
# terminal 1 — the API
python server.py

# terminal 2 — the frontend
cd frontend
npm install        # first time only
npm run dev        # http://localhost:5173
```

Open http://localhost:5173. Build a production bundle with `npm run build` (output
in `frontend/dist/`; a later phase serves it from the Python app for single-origin
deploy).

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
