# Rebuilding the viewer's implicit bodies in nTop

Audience: the design team replicating webapp geometry in nTop for CAD/CFD/print
prep. Everything below is the **exact math the app renders and exports** — the
raymarch shader (`frontend/src/components/SdfViewer.tsx`) and the STL exporter
(`frontend/src/stl.ts`) implement the same equations; this file is their
paper form. Where nTop has a better-native way (walled TPMS, patterns), the
recommended route is given plus the (small, quantified) difference vs the app.

## 0. Frame, units, shared assembly

Everything is **millimetres**, right-handed:

| axis | meaning | GB202 default |
|---|---|---|
| x | transverse — fins are counted across this (`core_width`) | 35 mm span |
| y | flow path (`core_length`) | 28 mm span |
| z | height, z = 0 at the cold-plate bottom face | — |

Origin: core centre in x/y, bottom face at z = 0.
GB202 defaults: `core_width W = 35`, `core_length L = 28`, fin/core height
`H = 5.5`, base `t_base = 0.7` (die 24 × 31 under the centre).
*Axis note (contract rule 6): physically the 28 mm is the flow direction; the
solver's `core_width` = the 35 mm transverse span. The viewer renders x =
transverse, y = flow, exactly as above.*

Assembly, every family:

```
part = base ∪ core-structure
base = box  x ∈ [−W/2, W/2] · y ∈ [−L/2, L/2] · z ∈ [0, t_base]
core-structure lives in the band z ∈ [t_base, t_base + H]
```

In nTop this is a plain **Boolean Union** of exact bodies. (The webapp's STL
sinks fin/lattice shells 0.05 mm into the base — an export-only overlap so
slicers auto-union; do **not** replicate that in nTop.)

## 1. Wavy / straight fins

Fin *i* (i = …−2, −1, 0, 1, 2…, one fin centred at x = 0) is a rectangle of
thickness `t` swept along the flow with a sinusoidal transverse displacement:

```
centreline:  x_i(y) = i·p + A·sin(2π·y / λ)          p = t + b  (pitch)
solid:       |x − x_i(y)| ≤ t/2
             |x| ≤ W/2 − margin                       (fin-field clip)
             t_base ≤ z ≤ t_base + H
straight fins: A = 0
```

Equivalent single implicit (what the shader marches):

```
d(x,y) = | mod(x − A·sin(2π·y/λ) + p/2, p) − p/2 | − t/2     (solid where d ≤ 0)
```

- **Phase convention:** the app uses **sine**, zero-crossing (fin at its centre
  position) at mid-path y = 0. If your nTop file is built on a **cosine** (per
  “…corrected sine equation and replaced it with a cosine equation.ntop”),
  they are the same body shifted a quarter wave:
  `A·sin(2πy/λ) ≡ A·cos(2π(y − λ/4)/λ)`. To match the app **exactly**, use
  sine with y = 0 at mid-path — the phase matters at the y = ±L/2 ends and for
  where crests meet the manifolds.
- **Fin count / edge rule:** candidates enumerate i from −n_max to +n_max with
  `n_max = ⌊(W/2 − margin + t/2 + A) / p⌋`. The STL exporter **omits any fin
  the clip would cut partially** (watertightness rule) — so a fin whose wave
  crest crosses `|x| = W/2 − margin` anywhere is dropped whole. In nTop,
  pattern one fin body (sweep a t-wide rectangle along the guide curve
  `x = A·sin(2πy/λ)`) with **Linear Pattern**, spacing p, then trim/inspect the
  outermost fins the same way.
- **Centre rib** (present when the layout gives ≥ 2 parallel paths;
  GB202 = yes, width `w_rib = 1.0`): a solid wall **across the flow** at
  mid-path — box `|y| ≤ w_rib/2`, full x width, same z band as the fins.
- GB202 hero values: t = b = 0.10, margin = 0.9, A = 0.55, λ = 2.5, H = 5.5.

## 2. Pin fins

Cylinder array, height = fin band:

```
radius r = d_pin/2,  pitch p_pin (both directions)
row m (y = m·p_pin):  centres x = n·p_pin − offset(m)
   staggered: offset(m) = p_pin/2 on odd rows, 0 on even
   inline:    offset(m) = 0
keep only pins FULLY inside the boundary:
   rectangular: |x_c| ≤ W/2 − r  and  |y_c| ≤ L/2 − r
   cylinder:    √(x_c² + y_c²) ≤ R − r,  R = min(W, L)/2
z ∈ [t_base, t_base + H]
```

Edge-clipped partial pins are **omitted, not trimmed** (same watertightness
rule; slivers are unprintable anyway). nTop: one cylinder + Rectangular
Pattern (staggered = two interleaved patterns offset p/2), Boolean Intersect
test against the inset boundary, union with base.
Defaults: d = 0.8, p = 1.4, staggered.

## 3. TPMS lattices (the implicit-field family)

### 3.1 The field

Let `c` be the unit-cell size (mm) and define scaled coordinates

```
x̂ = 2π·x/c,   ŷ = 2π·y/c,   ẑ = 2π·z/c        (k = 2π/c)
```

The app's eight level-set fields F̂ (nodal approximations, Gandy et al.):

| type | F̂(x̂, ŷ, ẑ) |
|---|---|
| gyroid | `cos x̂·sin ŷ + cos ŷ·sin ẑ + cos ẑ·sin x̂` |
| diamond (Schwarz D) | `sin x̂·sin ŷ·sin ẑ + sin x̂·cos ŷ·cos ẑ + cos x̂·sin ŷ·cos ẑ + cos x̂·cos ŷ·sin ẑ` |
| schwarz_p | `cos x̂ + cos ŷ + cos ẑ` |
| lidinoid | `sin 2x̂·cos ŷ·sin ẑ + sin 2ŷ·cos ẑ·sin x̂ + sin 2ẑ·cos x̂·sin ŷ − cos 2x̂·cos 2ŷ − cos 2ŷ·cos 2ẑ − cos 2ẑ·cos 2x̂ + 0.3` |
| split_p | `1.1·(sin 2x̂·sin ẑ·cos ŷ + sin 2ŷ·sin x̂·cos ẑ + sin 2ẑ·sin ŷ·cos x̂) − 0.2·(cos 2x̂·cos 2ŷ + cos 2ŷ·cos 2ẑ + cos 2ẑ·cos 2x̂) − 0.4·(cos 2x̂ + cos 2ŷ + cos 2ẑ)` |
| iwp (Schoen I-WP) | `2·(cos x̂·cos ŷ + cos ŷ·cos ẑ + cos ẑ·cos x̂) − (cos 2x̂ + cos 2ŷ + cos 2ẑ)` |
| neovius | `3·(cos x̂ + cos ŷ + cos ẑ) + 4·cos x̂·cos ŷ·cos ẑ` |
| fischer_koch (S) | `cos 2x̂·sin ŷ·cos ẑ + cos 2ŷ·sin ẑ·cos x̂ + cos 2ẑ·sin x̂·cos ŷ` |

### 3.2 Sheet vs solid, and the wall-thickness mapping

```
iso = clamp(π·w / c, 0.06, 1.2)          w = wall thickness parameter (mm)

sheet  (default):  solid where |F̂| ≤ iso
solid / network:   solid where  F̂ ≤ iso
```

Why `iso = π·w/c` **is** the wall thickness: near F̂ = 0 the field changes at
rate |∇F̂|·k per mm, so the slab |F̂| ≤ iso is locally
`2·iso / (k·|∇F̂|) = w / |∇F̂|` thick. Where |∇F̂| = 1 that is exactly `w`;
across a gyroid |∇F̂| ranges ≈ 0.7–1.5, so the app's sheet is `w` **nominal**
with ≈ ±30 % local variation. (The shader also multiplies the SDF by
`(c/2π)·0.5` — a raymarch step-safety factor; it does **not** move the
surface. Ignore it in nTop.)

### 3.3 Jet-adaptive cell grading

The cell size is graded radially about the core centre axis
(r = √(x² + y²), R = min(W, L)/2):

```
c(r) = c₀ · (1 + g·(clamp(r/R, 0, 1.5) − 0.5)),   clamped to c(r) ≥ 0.3 mm
```

g = `cell_grading` slider (0–1). g = 0 → uniform c₀. g > 0 → **finer than
nominal at the centre** (c = c₀·(1 − g/2) at r = 0), nominal at r = R/2,
coarser outboard (up to c₀·(1 + g) at r ≥ 1.5R). This law is used
consistently by the shader, the STL exporter, and the physics (heat-weighted
radial-zone model, spec §28) — grade only pays off under a jet-style layout.

### 3.4 Clip volume and assembly

```
rectangular layout: |x| ≤ W/2, |y| ≤ L/2, t_base ≤ z ≤ t_base + H
cylinder layout:    √(x²+y²) ≤ R = min(W,L)/2, same z band
part = base slab ∪ lattice
```

### 3.5 The two nTop routes

**Route A — native blocks (recommended for gyroid / diamond / Schwarz P).**
Use nTop's built-in TPMS lattice (walled/sheet) with: cell size = `c` (or a
**ramp field** implementing §3.3 for graded designs), wall thickness = `w`,
then Boolean Intersect with the clip volume and Union with the base.
Difference vs the app: nTop walls are a **true offset** (uniform w
everywhere), the app's are the iso-contour approximation (w ± ~30 % local).
Same nominal design; expect small mass/SA differences — nTop's is the *better*
geometry, so prefer it for anything that gets printed.

**Route B — exact parity (all 8 types, incl. lidinoid/split-P/IWP/neovius/
Fischer-Koch).** Custom implicit block with §3.1's equation, e.g. gyroid:

```
f(x,y,z) = abs( cos(2*pi*x/c)*sin(2*pi*y/c)
              + cos(2*pi*y/c)*sin(2*pi*z/c)
              + cos(2*pi*z/c)*sin(2*pi*x/c) ) - pi*w/c      (body: f ≤ 0)
```

For graded designs substitute `c → c(r)` from §3.3 inside the expression.

### 3.6 Verification targets (measure in nTop, compare)

From the minimal-surface area coefficients the app's physics uses
(`engine/tpms_geometry.py`; A₀/a²: gyroid 3.0915, diamond 3.8385,
schwarz_p 2.3451):

```
relative density  ρ* = (A₀/a²)·(w/c)          void = 1 − ρ*
sheet area / volume  SA/V = 2·(A₀/a²)/c        (both faces, c in metres)
```

Worked check — gyroid, c = 2.5 mm, w = 0.12 mm (GB202 defaults):
**ρ\* = 0.148, void = 0.852, SA/V = 2473 m²/m³.** An nTop-measured surface
area / volume within a few % of these (route A slightly different per §3.5)
confirms the rebuild. Slight deviations at the clip faces are expected (the
formulas are bulk values).

## 4. What the app's STL gives you meanwhile

- **Fins / pins:** exact analytic shells (true dimensions, no voxels), one
  shell per body, overlapping 0.05 mm by design — netfabb/slicers union them.
- **TPMS:** manifold surface nets over the same field (draft / standard /
  fine = coarser/finer voxels; fine ≈ 2 voxels per wall — use **fine for
  print**, draft to eyeball). Watertight, outward-oriented; a residual
  ~0.05 % of edges are saddle point-contacts that any mesh checker
  auto-repairs. Sheet lattices are inherently dense: expect 50–200 MB.
- Rebuilding natively in nTop (routes A/B) is still the right path for
  production CAD — this section just says the STL is usable for fit checks
  and quick CFD meshes in the interim.

## 5. Slider ↔ symbol ↔ nTop quick map

| app slider | symbol here | nTop input |
|---|---|---|
| fin thickness t | t | fin rectangle width / pattern body |
| channel gap b | b | pitch p = t + b in the Linear Pattern |
| fin height H | H | extrude height of the fin band |
| wave amplitude A / wavelength λ | A, λ | guide-curve `x = A·sin(2πy/λ)` |
| unit cell c | c₀ | TPMS cell size (or ramp field, §3.3) |
| wall thickness w | w | TPMS wall thickness |
| cell grading | g | ramp-field slope per §3.3 |
| pin Ø / pitch / pattern | d, p, stagger | cylinder + rectangular pattern(s) |
| TPMS type | F̂ row in §3.1 | native block (A) or custom implicit (B) |
| layout rectangular/cylinder | clip | Boolean Intersect volume |

## 6. Export contract — files the Verify tab can check (V4, spec §38–45)

The webapp's **Verify tab** (spec V4) imports an nTop export and verifies it
against the same implicit field documented above — geometry deviation,
solver-input audit, and DLP pixel raster. For the comparison to be
meaningful, export exactly like this:

1. **Format: binary STL, millimetres.** STL carries no units — export in mm
   or note the scale (the tab can rescale, but say so). ASCII STL is
   refused. 3MF may be accepted later; `.implicit` is deliberately **not**
   supported (licensed SDK required, and implicit fields are only
   comparable on the zero level set — see spec §38).
2. **Frame: the §0 contract frame.** x = transverse (35 mm span),
   y = flow (28 mm), z = height with the bottom face at z = 0, origin at
   the core centre in x/y. The tab detects and offers to fix axis
   swaps/offsets, but exporting in-frame avoids a registration step.
3. **Declare the stage.** Know which geometry the file is — the tab asks:
   - **final part** (design dimensions),
   - **green** (×1.197 XY / ×1.230 Z), or
   - **CAD-for-print** (green + pixel snap + fin −2 px / gap +2 px
     overpoly compensation).
   Comparing the wrong stage against the design shows a uniform ~1–2 %
   "error" that is really the shrink/compensation — the tab warns when a
   file looks like a different stage than declared.
3b. **Core-only exports are supported.** If the export contains only the
   fin/lattice core (the Proto2 workflow keeps the base as a separate
   mechanical part), tick **"file has no base slab"** — the tab detects
   this automatically when the body's height equals the fin height alone.
   The reference then drops its base and fins land at z = 0 like the
   floored file. Note the separate base STL (the full body with mounting
   flanges, in its own frame) is a conventional CAD part outside this
   implicit model — it cannot be verified here. For the **definitive
   pre-print check**, export core + base as ONE body in the §0 frame once
   per release: only then are the base raster and the fin-root junction
   verified.
3c. **The reference footprint comes from the ACTIVE PROJECT**, not from
   the file: core_width × core_length (◆ chip in the top bar) plus the
   selected candidate's base/fin heights. Verifying a 28×28 part while a
   35×28 project is active FAILs honestly — select or create the project
   the part was designed for first.
4. **Record the meshing tolerance** used in nTop's mesh-from-implicit
   block and enter it at import: it is the verification noise floor.
   Recommended ≤ 10 µm (≈ ⅓ of a final-mapped pixel) — coarser tolerances
   eat the entire PASS band (±14.6 µm, spec §40) with meshing error alone.
5. **No repair/offset passes** between meshing and export (no smoothing,
   thickening, or re-mesh) — the file should be the geometry you intend to
   print, not a display copy.
6. **Point-map check (mesh-free, spec §43 — BUILT).** The strongest
   confirmation of a §3 rebuild, with no meshing tolerance in the loop:
   1. In the Verify tab, open **"Point-map field check"** with the same
      candidate/stage/settings selected and **⬇ generate the recipe CSV**
      (three section planes, default 0.05 mm pitch; written in the model's
      frame for the declared stage).
   2. In nTop: **Import Point Map from CSV** → evaluate/sample your
      implicit body at the points → **export the sampled map as CSV** —
      the field value must ride along as the 4th column.
   3. Drop the exported CSV back on the section. Points are re-binned from
      their coordinates (row order doesn't matter) and either sign
      convention (negative- or positive-inside) is auto-detected. The app
      compares zero-crossing positions field-vs-field: same ½ / 1 px gates
      as the mesh check; walls present in only one field force
      MARGINAL/FAIL regardless of the µm statistics.
