function Eq({ children }: { children: React.ReactNode }) {
  return <div className="eq">{children}</div>
}

function Doi({ id }: { id: string }) {
  return (
    <a className="doi" href={`https://doi.org/${id}`} target="_blank" rel="noreferrer">
      doi:{id}
    </a>
  )
}

// V3.1 — every section follows the same 3 layers (spec §33):
//   1. <Plain>   plain words + one everyday analogy, zero symbols
//   2. the math  (unchanged — equations are not dumbed down)
//   3. <DoIt>    the design decision this knowledge drives
function Plain({ children }: { children: React.ReactNode }) {
  return <p className="plain">{children}</p>
}
function DoIt({ children }: { children: React.ReactNode }) {
  return <p className="doit"><b>What to do with it:</b> {children}</p>
}

export function About({ onClose }: { onClose: () => void }) {
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <h2>About — Cold Plate Master Baseline Viewer <em className="hero-byline">· Hieu Hoang — Vinnotek</em></h2>
          <button className="about-close" onClick={onClose}>✕</button>
        </div>

        <div className="about-body">
          <section>
            <h3>This app in 60 seconds</h3>
            <Plain>
              <b>Left column:</b> pick a candidate design, then drag the sliders to reshape it.{' '}
              <b>Middle:</b> watch the 3-D part change live (the ▦ Pixel tab shows how the printer
              would expose each layer). <b>Right:</b> the physics verdict updates as you drag.
              The one number to watch is <b>R_jc</b> — smaller means a cooler chip. PASS/FAIL
              badges compare against the project's budgets; the <b>manufacturability</b> chip
              (✓ / △ / ✗) says whether Incus (or an SLM supplier) can actually print and clean
              what you just drew. If it's not ✓, the <b>⚒ make manufacturable</b> button fixes
              the design for you and shows what that costs.
            </Plain>
          </section>

          <section>
            <h3>What this is</h3>
            <Plain>
              A <b>flight simulator for the cold plate</b>: change the fins, instantly see how hot
              the chip runs — using the exact same trusted math as our formal reports, never a
              browser copy of it.
            </Plain>
            <p>
              An internal engineering tool to <b>view, tune, and optimize</b> the additively-manufactured
              (printed-copper) GPU cold-plate for an RTX 5090-class GB202 die. Every number comes from the
              project's <b>validated Python solvers</b> — the browser never runs a second physics model, so what you
              see here matches the audit reports. It runs entirely on your machine (local Python API); there is no
              cloud service, no AI, and no cost to run it.
            </p>
          </section>

          <section>
            <h3>The design problem</h3>
            <Plain>
              A 450-watt chip must stay cool using 25 °C water. We design the piece of copper that
              sits between the chip and the water — and it must survive the printer, not just the physics.
            </Plain>
            <ul>
              <li><b>Heat source:</b> GB202 die, 24 × 31 mm, dissipating <b>450 W nominal / 575 W margin</b>.</li>
              <li><b>Coolant:</b> water, 2.65 L/min, 25 °C inlet.</li>
              <li><b>Cooler:</b> printed copper (k ≈ 340 W/m·K), die-coverage active core physically <b>28 mm wide × 35 mm long</b>, 5.5 mm tall, on a 0.7 mm base. Center-feed bidirectional flow (2 paths), fins parallel to the 28 mm side.</li>
              <li><b>Gates:</b> R_jc ≤ 0.078 K/W · ΔP ≤ 50 kPa · pump ≤ 5 W · coverage ≥ 1.</li>
              <li><b>Manufacturing target (updated 2026-07-31):</b> LMM route, design <b>M4b</b> (t 0.175 / b 0.234, px-exact 6/8 px, wave tamed to A 0.234 / λ 2.5 ⇒ 30° slope) — the constrained optimum that holds every guideline rule <i>including</i> the wave-slope pinch. The July-2026 guidelines put deep channels at 6–8 px green, and the 2026-07-29 px review revealed the deeper issue: the hero wave (A 0.55, 54° slope) pinches the <i>perpendicular</i> passage to ~2 px at the steep sections, so <b>M1–M4 with that wave all read FAIL</b> regardless of nominal widths. <b>M2b</b> (5/7 px, A 0.146) is the aggressive allow-marginal corner — thermally ~1 mK/W better, thinner margins everywhere. The 0.10 hero stays as an unprintable reference row.</li>
            </ul>
            <p className="note">
              Axis note: physically 28 mm is the flow direction and 35 mm is transverse (it sets the fin count).
              In the solver variables this is core_width = 35 (transverse) × core_length = 28 (flow).
            </p>
          </section>

          <section>
            <h3>The metric that matters: R_jc</h3>
            <Plain>
              Heat must pass <b>three doors in a row</b>: the thermal paste (TIM), the copper floor
              (base), and the fins into the water (convection). We can only redesign the third door —
              and it is only ~30 % of the total resistance. The first two doors are fixed by material
              and assembly, which puts a hard floor under everything this tool can do.
            </Plain>
            <Eq>R_jc = R_conv + R_base + R_TIM</Eq>
            <ul>
              <li><b>R_TIM</b> = R″<sub>TIM</sub> / A_die — thermal interface material over the die.</li>
              <li><b>R_base</b> = t_base / (k_solid · A_funnel) — 1-D conduction through the base (A_funnel = min(die, cooled)).</li>
              <li><b>R_conv</b> = 1 / UA — convection into the coolant (the part the fin geometry controls).</li>
            </ul>
            <DoIt>don't chase the last milli-kelvin of fin performance — past a point, the real wins
              are a thinner base or a better TIM, not more fins. Spend the freedom on manufacturability.</DoIt>
          </section>

          <section>
            <h3>Temperature rise — the thermal Ohm's law</h3>
            <Plain>
              Resistance × heat = how much hotter the chip gets. It is literally Ohm's law with the
              names changed: volts = amps × ohms. Lower resistance → cooler chip. Full stop.
            </Plain>
            <Eq>ΔT = Q × R_th</Eq>
            <table className="about-tbl">
              <thead><tr><th>Thermal</th><th>Electrical</th></tr></thead>
              <tbody>
                <tr><td>ΔT — temperature rise (K)</td><td>Voltage (V)</td></tr>
                <tr><td>Q — heat flow (W)</td><td>Current (I)</td></tr>
                <tr><td>R_th — resistance (K/W)</td><td>Resistance (Ω)</td></tr>
              </tbody>
            </table>
            <p>
              Because Q is fixed by the chip, <b>ΔT is a penalty to minimize</b>. Higher R_th forces a
              bigger ΔT to push the same watts through → a hotter die. The flip side, Q = ΔT / R_th,
              says the same thing: at a fixed temperature budget, a lower R_th lets you dissipate more watts.
            </p>
            <p className="note">The panel shows ΔT @450 W = R_jc · 450 and ΔT @575 W = R_jc · 575 — the junction rise above coolant at nominal and margin loads.</p>
          </section>

          <section>
            <h3>Geometry &amp; the fin field</h3>
            <Plain>
              The fin field is a <b>comb</b>: thinner teeth and narrower gaps pack more teeth in,
              giving more copper touching water. But the printer has a minimum tooth and gap size,
              and narrow gaps fight the pump — this three-way tension is the whole design problem.
            </Plain>
            <Eq>pitch = t + b &nbsp;&nbsp;·&nbsp;&nbsp; fin_count = ⌊(core_width − 2·margin) / pitch⌋</Eq>
            <Eq>D_h = 2bH / (b + H) &nbsp;·&nbsp; Re = ρ·v·D_h / μ</Eq>
            <DoIt>drag t or b and watch the fin count tick — every tick is one whole fin appearing
              or vanishing, which is why the KPIs step instead of glide.</DoIt>
          </section>

          <section>
            <h3>The readout strip under the sliders</h3>
            <Plain>
              The little strip — <b>pitch · fins · open % · χ · AR</b> — is the design's vital signs,
              recomputed on every drag. Here is what each one is telling you.
            </Plain>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Readout</th><th>What it is</th><th>Why it matters / what moves it</th></tr></thead>
              <tbody>
                <tr>
                  <td><b>pitch</b> = t + b</td>
                  <td>Center-to-center spacing of adjacent fins — one copper wall plus one water gap;
                    the design's smallest repeating unit.</td>
                  <td>Sets how many fins fit. For LMM the <i>green</i> pitch must land on a whole number
                    of 35 µm pixels (M2: 12 px = 0.420 mm) — pitch is what the pixel grid actually
                    quantizes. Overpolymerization moves material from channel to fin but <b>preserves
                    pitch</b>, which is why the CAD compensation is written around it.</td>
                </tr>
                <tr>
                  <td><b>fins</b></td>
                  <td>How many fins fit across the transverse span: ⌊(W − 2·margin) / pitch⌋.</td>
                  <td>Every fin adds two water-facing faces, so area — and with it R_conv — scales almost
                    directly with this count. It is an <i>integer</i>: each tick while dragging is one
                    whole fin (≈ 2·H·L_arc of area) appearing or vanishing.</td>
                </tr>
                <tr>
                  <td><b>open %</b></td>
                  <td>Share of the fin-field cross-section that is water instead of copper:
                    n_ch·b / (n_fin·t + n_ch·b). 50 % = equal metal and water.</td>
                  <td>A manufacturability + reliability number, not a performance target. Too low →
                    channels can't be cleaned, clog-prone, heavy; too high → few fins, little area.
                    Gate band ≈ 0.35–0.75. Note t = b always gives ≈ 50 % no matter how small both
                    get — which is why the hero and M1/M2 all hover near 50 %.</td>
                </tr>
                <tr>
                  <td><b>χ</b> = 2π·A/λ</td>
                  <td>Wave-sharpness: the slope of the fin path at its steepest turn. Neither A (how far
                    the wiggle swings) nor λ (how often it repeats) alone says how sharp the wiggle is —
                    their ratio does. Mountain-road analogy: A = how far the switchbacks swing out,
                    λ = distance between them, χ = how sharp the hairpins feel. As an angle:
                    χ = 0 → straight · 0.5 → 27° · 1.0 → 45° · <b>1.38 (hero) → ≈ 54°</b> — moving more
                    sideways than forward at the steepest point. The 2π is just the calculus of a
                    sine's slope.</td>
                  <td>The single strongest thermal lever, and it works twice. (1) A wiggly line is
                    longer than a straight one — by ×√(1 + χ²/2); at χ = 1.38 that is ×1.40 = <b>40 %
                    more fin surface in the same footprint</b>, free. (2) At Re ≈ 50 water flows like
                    honey in smooth sheets, and a warm "blanket" layer sits stuck to the fin wall
                    insulating it; each bend slings the water into corkscrew swirls (Dean vortices)
                    that peel the blanket off and press fresh cool water on the metal — sharper turns,
                    stronger swirls. Price: ΔP up, and too sharp risks a local channel pinch below the
                    printable gap. Keep A/λ in the 0.05–0.30 band.</td>
                </tr>
                <tr>
                  <td><b>AR</b> = H/b</td>
                  <td>Fin aspect ratio — how slender each fin is (height over the gap next to it).</td>
                  <td>Tall skinny fins deform during printing and handling. Incus's warning translates
                    to AR ≲ 30 (the readout turns amber beyond it). The old 0.10 mm design ran AR 55–65;
                    M1/M2 sit near 27–37.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3>Heat transfer &amp; fin efficiency</h3>
            <Plain>
              A tall thin fin is like a <b>long corridor from a heated room</b>: the far end barely
              gets warm. Past a point, extra fin height adds area that arrives at nearly water
              temperature and does almost nothing.
            </Plain>
            <Eq>UA = h · A_wet · η_o · (flow uniformity) · (surface access)</Eq>
            <Eq>h = Nu · k_fluid / D_h &nbsp;·&nbsp; Nu = Shah-London (rect. duct)</Eq>
            <p className="note">Nu and fRe from Shah &amp; London (1978) [11] / Shah (1975) [12].</p>
            <Eq>m = √(2h / (k_solid · t)) &nbsp;·&nbsp; η_f = tanh(mH) / (mH) &nbsp;·&nbsp; η_o = 1 − (A_fin/A_wet)(1 − η_f)</Eq>
            <p className="note">Extended-surface / fin-efficiency theory: Bergman, Incropera et al. (2017) [13].</p>
            <p>
              This is why <b>raw and effective area differ</b>: push fins thinner/taller and raw area
              keeps climbing, but η_f collapses, so <b>effective area plateaus</b> — the real sweet
              spot sits just before that roll-off, at a manufacturable pitch.
            </p>
            <DoIt>when the effective SA/V (or A_eff) stops moving while raw keeps climbing, stop —
              you are buying pressure drop and print risk with no thermal return.</DoIt>
          </section>

          <section>
            <h3>Reading the areas strip (A_FIN · A_EFF · A_FLOW)</h3>
            <Plain>
              The whole point of fins is to <b>fold a huge surface into a tiny box</b> — like a bath
              towel folded into a drawer. The areas strip on the Surface &amp; thermal card measures
              exactly that folding trick, and then tells you honestly how much of it actually works.
            </Plain>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Row</th><th>What it is</th><th>How to read it</th></tr></thead>
              <tbody>
                <tr>
                  <td><b>A_FIN</b> (mm²)</td>
                  <td>All the copper surface that touches water — the fin faces only, no channel
                    floor. The core is fully flooded, so every fin face counts.</td>
                  <td>The "unfolded towel": how much surface the design packs into the 28 × 35 mm
                    core. More fins / taller fins / wavier fins → bigger number.</td>
                </tr>
                <tr>
                  <td><b>×N die</b> (blue badge)</td>
                  <td><b>Amplification</b> = A_FIN ÷ the die's own footprint. Example: "×67" means
                    that if you unfolded all the fin surface and laid it flat, it would cover
                    <b> 67 chips</b>.</td>
                  <td>The brag number. A bare copper plate with no fins would be ×1 — the die can
                    only be touched by its own area of water. Fins multiply that contact area
                    tens of times; this badge says by how much.</td>
                </tr>
                <tr>
                  <td><b>A_EFF</b> (mm²)</td>
                  <td>The <i>working</i> area: A_FIN × fin efficiency (η_f) × flow uniformity ×
                    surface access.</td>
                  <td>The honest number. Remember the long-corridor effect: thin tall fins barely
                    conduct heat to their tips, so most of that unfolded towel is barely warmer than
                    the water — contributing almost nothing.</td>
                </tr>
                <tr>
                  <td><b>×N die</b> (green badge)</td>
                  <td>Effective amplification = A_EFF ÷ die footprint.</td>
                  <td>The gap between the blue and green badges IS the fin-efficiency story. In your
                    strip: ×67 raw but only <b>×12.6 effective</b> — about 80 % of the packed surface
                    is "asleep". That is normal for 0.1-mm-class fins, not a defect; but when
                    thinner/taller fins raise the blue number without moving the green one, you're
                    buying pressure drop and print risk for nothing.</td>
                </tr>
                <tr>
                  <td><b>A_FLOW</b> (mm²)</td>
                  <td>The total open cross-section the water squeezes through — all channel gaps ×
                    fin height added up.</td>
                  <td>Not a heat-transfer area — a plumbing one. Velocity = flow rate ÷ A_FLOW, so a
                    small A_FLOW means fast water and a big pressure bill; opening the gaps
                    (M1 → M2 → M3) grows it and is why ΔP falls as gaps widen.</td>
                </tr>
              </tbody>
            </table>
            <p className="note">
              Worked example — M1 (t 0.12 / b 0.15): the 744 mm² die becomes ~52,500 mm² of fin
              surface (blue <b>×71</b>), of which ~10,000 mm² works after the η_f haircut (green <b>×13.5</b>).
              The numbers in your strip change live as you drag the sliders — watch the green badge,
              not the blue one. Definition note (decided 2026-07-09): areas are <b>structure-only</b> —
              fin side faces / pin laterals / TPMS sheet; fin tip faces excluded (adiabatic-tip model,
              ~1 %). The model's full wetted area A_wet (incl. channel floor, the basis of SA/V and UA)
              is shown in the Report for traceability.
            </p>
            <DoIt>compare designs by <b>A_EFF and the green ×N badge</b>, not by A_FIN — raw area is
              the brochure number, effective area is the honest one.</DoIt>
          </section>

          <section>
            <h3>Wavy fins</h3>
            <Plain>
              Wiggly fins stir the water like a <b>bent straw stirs a drink</b> — the water can't
              settle into a lazy warm layer against the wall. Best single lever we have (see χ in the
              readout-strip section for the full story).
            </Plain>
            <Eq>χ = 2π·A / λ &nbsp;·&nbsp; arc length factor = √(1 + χ²/2) &nbsp;·&nbsp; Nu ×= 1 + 0.40·χ^1.5·tanh(Re/300)</Eq>
            <p>Per the v6 sweep, the wave (A/λ) is the strongest single R_th lever, then the gap b; t=b is a shallow optimum and fin height H is weak. Wavy-channel enhancement &amp; Dean vortices: Sui et al. (2010) [14]; AM wavy-fin cold plates: Zaki et al. (2026) [15].</p>
            <DoIt>keep the wave when opening the channels for manufacturability — it is orthogonal to
              the print rules as long as adjacent fins stay in phase (constant gap).</DoIt>
          </section>

          <section>
            <h3>Hydraulics</h3>
            <Plain>
              Everything you win thermally is <b>paid for in pressure</b>: the pump must push water
              through those narrow gaps. ΔP is the bill; pump power is the same bill in watts.
            </Plain>
            <Eq>ΔP = fRe · (2μ·v·L_arc / D_h²) + ½·ρ·v²·K_header &nbsp;·&nbsp; W_pump = V̇ · ΔP</Eq>
            <p>Friction (Shah-London fRe with a roughness correction) plus a lumped manifold minor-loss term. A design that wins thermally is useless if it costs too much pressure.</p>
          </section>

          <section>
            <h3>Flow &amp; thermal visualization (V5) — watching the design intent</h3>
            <Plain>
              The viewer can <b>show the water doing its job</b>: toggle <b>≈ Flow</b> and particle
              streams run through <b>every fin gap</b> — diving in at the mid-rib, settling into
              their depth, weaving the sine channels and exiting straight at the fin endings —
              each parcel <b>warming blue → red</b> as it collects heat. Nothing is a simulation:
              lane speeds come from the S6 network solve, parcel temperatures from the F1 field
              solve, and the route is the layout's stated intent — the same claims the Report
              hands to CFD as the FC-1…FC-7 checklist.
            </Plain>
            <Eq>parcels: F1 T(x, y), outlet closes to T_in + Q/(ṁ·c_p) exactly &nbsp;·&nbsp; ×150 slow-motion &nbsp;·&nbsp; 7 depth layers</Eq>
            <p>
              Color modes: <b>Thermal</b> tints the metal itself — the cosh fin-conduction profile
              (mH inverted from η_f), with the unfinned <b>rib strip drawn hot</b> (area-starved over
              the die's hottest zone; a screening estimate CFD will quantify). <b>ΔP</b> paints
              where the pressure budget is spent, red (unspent) → blue (spent). <b>▶ ride</b>
              follows one parcel — steadicam chase or first-person <b>👁 pov</b>, on the depth
              layer of your choice, with <b>◐ solo</b> isolating it and its thin path streamline.
              The <b>ⓘ</b> button beside the ride controls opens the full explainer; the chips
              state the reconciliation (S6 vs solver ΔP, F1 vs S6 friction) live.
            </p>
            <DoIt>read a layout's routing from Top view with ≈ Flow on; ride the bottom layer to
              feel the dive; treat every picture as design intent for the Ansys run to confirm —
              never as CFD.</DoIt>
          </section>

          <section>
            <h3>Manufacturing constraints — LMM &amp; SLM</h3>
            <Plain>
              The physics wants channels as narrow as possible; the printer and the cleaning bath
              want them as wide as possible. The <b>rulebook</b> settles the argument: every design is
              checked live against its process route's limits, in two tiers — an <b>absolute</b> bound
              (below it the part can't be printed or cleaned → ✗ FAIL) and a <b>recommended</b> bound
              (between them is buildable but risky → △ MARGINAL).
            </Plain>

            <h4 className="kpi-h">LMM — Incus Hammer EVO35 (supplier-verified, official guidelines July 2026)</h4>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Rule</th><th>Absolute</th><th>Recommended</th><th>Why</th></tr></thead>
              <tbody>
                <tr><td>Channel gap b (final)</td><td>≥ 0.175 mm (6 px)</td><td>≥ 0.234 mm (8 px)</td>
                  <td>Open channels deeper than 1 mm need 6–8 px green — below 6 px they will not be
                    cleaned (Incus flagged our 2 px areas exactly so, 2026-07-29). Channels ≤ 1 mm
                    deep have been cleaned down to 5 px, with falling reliability.</td></tr>
                <tr><td>Fin thickness t (final)</td><td>≥ 0.088 mm (3 px)</td><td>≥ 0.117 mm (4–5 px)</td>
                  <td>3 px green has printed successfully; 4–5 px is their reliability band — tested
                    at ~1 mm fin height, taller fins may deform during cleaning.</td></tr>
                <tr><td>Gap vs fin</td><td>—</td><td>b ≥ t</td>
                  <td>"Gaps should be wider than fins" (2026-07-29) — overpolymerisation narrows the
                    printed channel ~1 px per side, so the drawn gap must dominate the pitch.</td></tr>
                <tr><td>Wave slope (perp. passage)</td><td>≥ 6 px at max slope</td><td>—</td>
                  <td>Between in-phase wavy fins the true passage at the steepest section is
                    (t+b)·cosθ − t with tanθ = 2πA/λ. The hero wave (A 0.55/λ 2.5, 54°) pinches
                    it to ~2 px — exactly Incus's "cross section only 2 px" findings — no matter
                    how wide the nominal gap is. M4b/M2b carry the largest wave the floor allows
                    (30°/20°); compensation cannot fix slope, only widths.</td></tr>
                <tr><td>Aspect ratio H/b</td><td>—</td><td>≤ ~30</td>
                  <td>"Taller fins need thicker fins" — deformation during processing.</td></tr>
                <tr><td>Pixel grid</td><td colSpan={2}>35 µm XY / 25 µm Z (green)</td>
                  <td>Every dimension should land on whole pixels/layers — the green→CAD converter
                    under the sliders does this arithmetic for you.</td></tr>
                <tr><td>Process chain</td><td colSpan={2}>×1.197 XY / ×1.23 Z shrink · overpoly ∓2 px</td>
                  <td>The print is drawn oversized (sinter shrink) and features grow ~1 px/side during
                    exposure — fins are drawn 2 px thinner and channels 2 px wider in CAD to cancel it.
                    The ▦ Pixel tab shows exactly this effect.</td></tr>
                <tr><td>Cleanability at size</td><td colSpan={2}>warning</td>
                  <td>Incus's proven-clean coupon is 7.7 × 7.7 mm; our core is ~17× larger — "big part,
                    small channels" traps feedstock. The Option-2 coupon matrix is the confirmation path.</td></tr>
              </tbody>
            </table>
            <p className="note">
              Source: <code>Incus_Design_Guidelines.pdf</code> (July 2026, official) — all guideline
              dimensions are <b>green</b>-state px (1 px = 35 µm), converted here to final dims via
              ÷1.197 (this closes the old green-vs-final open question); plus Paul Peritsch's emails
              2026-07-07 (STL review) and 2026-07-29 (px feedback on the rev5 wavy + ICE parts: 2 px
              gaps "will not be cleaned", 1–2 px fins too thin).
            </p>

            <h4 className="kpi-h">SLM — laser powder bed fusion (literature grade)</h4>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Route</th><th>Wall</th><th>Gap</th><th>Notes</th></tr></thead>
              <tbody>
                <tr><td><b>SLM IR</b> — Nikon SLM Solutions, CuCrZr class (target OEM)</td>
                  <td>≥ 0.30 / rec 0.40 mm</td><td>≥ 0.40 / rec 0.50 mm</td>
                  <td>45° overhang rule; self-supporting horizontal channels to ~8 mm Ø; as-built
                    internal Ra 6–15 µm; tolerance ±0.1–0.2 mm; unfused powder must be shaken/blown out
                    (open both channel ends, no blind pockets).</td></tr>
                <tr><td><b>SLM green</b> — pure Cu fine-feature (TruPrint/AddiReen class)</td>
                  <td>≥ 0.10 / rec 0.18 mm</td><td>≥ 0.20 / rec 0.30 mm</td>
                  <td>25 µm spot, 10–25 µm layers; 99.6–99.8 % density, ~76–100 % IACS — consistent
                    with the k = 250/340/400 W/m·K band.</td></tr>
              </tbody>
            </table>
            <p className="note">
              Unlike the LMM rulebook (supplier-stated on our own geometry), SLM numbers are
              vendor-guide + literature grade (researched 2026-07-09) — good for screening, but a
              supplier DfM review is required before committing an SLM print.
            </p>

            <h4 className="kpi-h">How hard the rules bind — enforcement modes (Design Studio)</h4>
            <ul>
              <li><b>Design-to-manufacture:</b> sliders and optimizer clamped at the recommended bounds — you cannot draw an unprintable part.</li>
              <li><b>Allow marginal (project default):</b> clamped at the absolute floor; the amber zone is reachable but always shows △. M2 (0.20 mm gap ≈ 7 px) lives here — inside the 6–8 px band but under the 8 px recommendation.</li>
              <li><b>Explore / audit:</b> no clamps — verdicts annotate only (for reproducing old studies like the 0.10 hero, or M1 now that its 0.15 mm gap sits below the 6 px deep-channel floor).</li>
            </ul>
            <DoIt>the July-2026 guidelines + the 2026-07-29 px review moved the goalposts: M1's
              0.15 mm gap (≈ 5 px green) is now <b>below</b> the deep-channel floor — Incus says it
              will not be cleaned. Design in <b>Allow marginal</b> from M2 upward, or flip to
              <b>Design-to-manufacture</b> to stay at the 8 px recommendation (M3 territory). The
              optimizer's ☆ vs ★ gap always shows what manufacturability is costing.</DoIt>

            <h4 className="kpi-h">Final vs green — one wall, three names (and the CAD → sliders → Pixel loop)</h4>
            <Plain>
              The app speaks two unit systems, and every surface labels which one it's using.
              <b> Final (sintered) mm</b> is where the design state lives: sliders, KPIs, candidate
              dims — the part after sintering shrink. <b>Green</b> is the as-printed state — final
              × 1.197 (XY) / × 1.23 (Z) — and it's what INCUS sees: the CAD-draw column, the
              ▦ Pixel tab and Paul's slicer all speak green, where 1 px = 35 µm. So one and the
              same fin wall has three names: <b>0.088 mm final = 0.105 mm green = 3 px</b>. When
              two views seem to disagree, check the units first — they're always exactly ×1.197
              apart, never actually different.
            </Plain>
            <ul>
              <li><b>"CAD draw — model this" means literally that.</b> The ⇄ CAD tab's draw column
                is what you model in nTop: sinter scale <i>and</i> the ∓2 px overpoly edit are both
                already in it. Export and send that file to Incus <b>as-is</b> — do not scale it
                again. (If your nTop workflow scales at the end, model the <i>final</i> column
                instead and let your ×1.197/×1.23 step produce the green — one road or the other,
                never both.)</li>
              <li><b>⇥ load CAD into sliders is exact, not snapped.</b> It stores the full-precision
                value (CAD ÷ shrink, e.g. 0.105 ÷ 1.197 = 0.0877193…); the "0.088" on the slider is
                display rounding only. Proof at a glance: the slider's "· 3.0 px" readout lands on a
                whole pixel, and the green→CAD fold-out's GREEN column equals SNAP with no amber
                off-grid flag. The ▦ Pixel view of the loaded state is therefore <b>pixel-for-pixel
                the bitmap Paul's slicer will produce from your file</b> — unticked = his review
                screenshot; overpoly ticked = the printed part, growing back to the nominal design.</li>
              <li><b>Don't drag the loaded sliders.</b> Manual slider moves quantize to the 0.005 mm
                step grid, which is <i>not</i> the pixel grid — one nudge and you're previewing a
                slightly different design than the file. Look, verify in ▦ Pixel, then reset to the
                candidate. While the drawing is loaded, the KPI panel is scoring the skinny-finned
                <i>drawing</i>, not the printed part — ignore it until you reset.</li>
            </ul>
          </section>

          <section>
            <h3>The optimization doctrine</h3>
            <Plain>
              Make the chip as cool as possible <b>without exceeding the pump's budget</b> — and now,
              without drawing anything the printer can't make. Thermal is the goal; pressure is the
              budget; manufacturability is the law.
            </Plain>
            <Eq>minimize R_jc &nbsp; subject to &nbsp; T_j gate · ΔP budget · pump budget · coverage · manufacturability</Eq>
            <p>Not "maximize surface area" or "balance three numbers by feel" — the expert formulation is asymmetric:
              <b> thermal is the objective, hydraulics are constraints</b>. Your pump/loop grants the plate a fixed
              ΔP / pump budget (set in the Design Studio); the best design <i>spends</i> that budget rather than
              minimizing it. The <b>Optimizer</b> tab sweeps two family-appropriate variables with the active
              project's coolant, budgets <i>and manufacturing rulebook</i> riding on every grid point — ★ is the
              best point that fits all of it, ☆ is what the physics alone would pick, and the distance between
              them is the price of manufacturability, stated in mK/W and kelvin. Every swept point is
              clickable: a heatmap cell or a Pareto point loads its values into the sliders, so you can
              hand-tune from <i>any</i> corner of the landscape, not just the optimum.</p>
          </section>

          <section>
            <h3>Two engines, and how to trust them</h3>
            <Plain>
              A quick estimator compares all shapes fairly; a deep validated model handles the wavy-fin
              hero. Both are honest <b>screening</b> tools — a design direction, not lab-measured truth.
            </Plain>
            <ul>
              <li><b>Master engine</b> (family-neutral): compares wavy / straight / pin / gyroid on equal terms — used for the candidate list and sweeps.</li>
              <li><b>v6 solver</b> (validated depth): the wavy-fin hero with jet impingement, center rib, thermal entry, NTU/effectiveness. Jet-impingement basis: Zuckerman &amp; Lior (2006) [8], Martin (1977) [9].</li>
            </ul>
            <p className="note">
              Trust tiers: fins = textbook-validated Shah–London; pins = Zukauskas/Gaddis–Gnielinski
              (tube-bank physics on micro pins); gyroid &amp; diamond = ANALYTICAL_LIT via Renon &amp;
              Jeanningros (2025) [2] but <b>EXTRAPOLATED</b> (their fit is turbulent Re 3000–18000, this
              plate runs Re ≈ 200); Schwarz-P and the exotic TPMS types stay SCREENING_ONLY. TPMS AM
              heat-sink performance: Chouhan et al. (2025) [1]; level-set equations: Gandy et al.
              (1999–2001) [5–7]. No external performance claim until supplier coupon, CFD/CHT, and test
              close the loop.
            </p>
          </section>

          <section>
            <h3>What happens if I…&nbsp; (slider cheat-sheet)</h3>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Slider ↑</th><th>R_jc</th><th>ΔP</th><th>The catch</th></tr></thead>
              <tbody>
                <tr><td>fin thickness t ↑</td><td>≈ flat, then ↑</td><td>↑ (fewer channels)</td>
                  <td>Thicker fins conduct better (η_f ↑) but fewer fit. t = b is a shallow optimum;
                    the floor is the printer's, not physics'.</td></tr>
                <tr><td>channel gap b ↑</td><td>↑ (worse)</td><td>↓↓ (strong)</td>
                  <td>The manufacturability lever. Opening 0.10 → 0.20 mm costs only ≈ +1.9 K at 575 W
                    because TIM+base dominate — this is why M1/M2 are nearly free.</td></tr>
                <tr><td>fin height H ↑</td><td>↓ slightly, plateaus</td><td>↓ (more flow area)</td>
                  <td>Weak lever: extra height arrives at low η_f. Aspect-ratio limit (H/b ≲ 30) bites first.</td></tr>
                <tr><td>wave amplitude A ↑</td><td>↓↓ (strongest)</td><td>↑</td>
                  <td>More χ = longer arc + stronger stirring. Watch the A/λ ≤ 0.30 band and pinch risk.</td></tr>
                <tr><td>wavelength λ ↑</td><td>↑ (wave weakens)</td><td>↓</td>
                  <td>χ falls as 1/λ — long lazy waves are nearly straight fins.</td></tr>
                <tr><td>flow rate ↑</td><td>↓ (better)</td><td>↑↑ and pump ↑↑</td>
                  <td>Helps everything thermally but spends the hydraulic budget quadratically.</td></tr>
              </tbody>
            </table>
          </section>

          <details className="fold">
            <summary>Reading the KPI panel — every number explained</summary>
            <section>
            <p className="note">
              This mirrors the right-hand panel top to bottom. Green limit bars show how much of a gate's budget the
              design uses; they turn red past the gate.
            </p>

            <h4 className="kpi-h">Card 1 — Junction-to-coolant</h4>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Item</th><th>What it is</th><th>Why it matters</th></tr></thead>
              <tbody>
                <tr>
                  <td>R_jc (big number, mK/W)</td>
                  <td>Total junction-to-coolant thermal resistance: R_jc = R_conv + R_base + R_TIM. Shown in mK/W
                    (thousandths of K/W), so 12.86 mK/W = 0.01286 K/W.</td>
                  <td><b>The one decision metric.</b> Every trade in this tool cashes out here: die temperature rise =
                    R_jc × heat load. Everything else on the panel explains <i>why</i> R_jc is what it is.</td>
                </tr>
                <tr>
                  <td>PASS / FAIL / SCREENING badge</td>
                  <td>The solver's gate verdict (kpi_status). FAIL lists which gate tripped (R_jc, ΔP, pump, coverage,
                    open volume…). SCREENING_ONLY marks models without an in-regime correlation (Schwarz-P + exotic
                    TPMS types); gyroid/diamond carry an EXTRAPOLATED warning instead.</td>
                  <td>A design that fails any gate is out regardless of a pretty R_jc. Screening rows can be compared
                    with each other but should not be quoted externally.</td>
                </tr>
                <tr>
                  <td>R_jc vs gate bar</td>
                  <td>R_jc as a fraction of the 0.078 K/W (78 mK/W) gate.</td>
                  <td>Shows headroom at a glance — the hero sits near 16% of budget, i.e. the gate is comfortably met
                    and R_jc is not the binding constraint.</td>
                </tr>
                <tr>
                  <td>base / TIM / conv stack bar</td>
                  <td>The three series resistances, each in mK/W with its share of R_jc: <b>base</b> = conduction
                    through the 0.7 mm copper floor, <b>TIM</b> = the interface material between die and cold plate,
                    <b>conv</b> = fins-to-water convection (1/UA).</td>
                  <td><b>The most important diagnostic on the panel.</b> Only conv responds to fin geometry — base and
                    TIM are fixed by material and assembly. With conv at ~26%, even a <i>perfect</i> fin field could
                    cut R_jc by barely a quarter; real gains past that come from a thinner base or a better TIM, not
                    from more fins.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="kpi-h">Card 2 — Hydraulics</h4>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Item</th><th>What it is</th><th>Why it matters</th></tr></thead>
              <tbody>
                <tr>
                  <td>Pressure drop (kPa / 50k)</td>
                  <td>Total ΔP the coolant loses crossing the plate: channel friction (Shah–London fRe over the wavy
                    arc length) + manifold/header minor losses. Gate: 50 kPa (50,000 Pa).</td>
                  <td>The pump must supply this at 2.65 L/min. Blow the budget and the loop delivers less flow than
                    the model assumes — every thermal number above quietly degrades. Narrow gaps buy heat transfer at
                    the direct cost of ΔP (∝ 1/D_h² in laminar flow).</td>
                </tr>
                <tr>
                  <td>Pump power (W / 5)</td>
                  <td>Ideal hydraulic power W_pump = V̇ × ΔP. Gate: 5 W. (Real pump electrical draw is higher by its
                    efficiency.)</td>
                  <td>The system-level cost of a thermal win, and the second axis of the optimizer's Pareto front.
                    Two designs with equal R_jc are not equal if one needs 10× the pumping.</td>
                </tr>
                <tr>
                  <td>Velocity (m/s)</td>
                  <td>Mean water velocity in the channels = flow ÷ total open flow area.</td>
                  <td>Sanity/limits check: too low → weak convection and silt-prone channels; too high → erosion and
                    ΔP. Sub-m/s laminar values like 0.24 m/s are typical for micro-fin plates.</td>
                </tr>
                <tr>
                  <td>Re (Reynolds number)</td>
                  <td>ρ·v·D_h/μ — the flow-regime number. Laminar below ~2300; here Re ≈ 50 is deeply laminar.</td>
                  <td>Tells you which physics applies. The solver's Nu/fRe correlations are laminar duct theory —
                    valid at this Re. It also means no turbulence to help mixing, which is exactly why the wavy fins
                    (Dean vortices) earn their keep.</td>
                </tr>
                <tr>
                  <td>D_h (mm)</td>
                  <td>Hydraulic diameter of one channel = 2bH/(b+H) — the effective "pipe size" of the b × H
                    rectangular gap.</td>
                  <td>The master length scale: h = Nu·k/D_h, so halving D_h roughly doubles the convective
                    coefficient — while friction rises as 1/D_h². Most thermal-vs-pressure tension on this panel is
                    D_h in disguise.</td>
                </tr>
                <tr>
                  <td>Open frac</td>
                  <td>Open (water-filled) volume ÷ active core volume. 50.2% means half the core is copper, half is
                    coolant.</td>
                  <td>Manufacturing + reliability proxy rather than a performance target: enough open volume must
                    remain to depowder/clean the print, and it correlates with cloggability and weight. There is a
                    minimum-open-volume gate; beyond passing it, don't maximize it — it trades directly against fin
                    area.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="kpi-h">Card 3 — Surface &amp; thermal</h4>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Item</th><th>What it is</th><th>Why it matters</th></tr></thead>
              <tbody>
                <tr>
                  <td>A_fin / A_eff / A_flow strip</td>
                  <td>Structure-only surface area (mm²) with its ×N die amplification; the honest working area after
                    the η_f · uniformity · access derate; and the open flow cross-section (mm²).</td>
                  <td>The absolute-units version of the SA/V story below — see "Reading the areas" above. Compare
                    designs by A_eff, not raw A_fin.</td>
                </tr>
                <tr>
                  <td>SA/V raw (m²/m³)</td>
                  <td>Total wetted surface per unit of active-core volume — the "brochure" area density.</td>
                  <td>Mostly a <b>diagnostic, not a goal</b>. It only counts area, not whether that area is hot enough
                    to matter. Chasing raw SA/V alone is how designs end up with impressive area and mediocre R_jc.</td>
                </tr>
                <tr>
                  <td>SA/V eff (m²/m³)</td>
                  <td>Raw SA/V derated by what actually works: × η_o (fin efficiency) × flow uniformity × surface
                    access. Here 13386 → 2035, an 85% haircut.</td>
                  <td>The honest area number. When thinner/taller fins raise raw SA/V but effective SA/V stalls,
                    you've hit the plateau and further fin-packing is free of benefit but not free of ΔP.</td>
                </tr>
                <tr>
                  <td>η_f (fin efficiency)</td>
                  <td>tanh(mH)/(mH) with m = √(2h/(k·t)) — how close the fin runs to base temperature over its height.
                    η_f = 0.144 means the average fin surface works at ~14% of its potential.</td>
                  <td>Looks alarming; is expected. 0.1 mm-thin, ~5 mm-tall fins in water simply cannot conduct enough
                    heat up their length. This single number explains why "just make the fins taller/thinner" stopped
                    paying — the extra area arrives at nearly coolant temperature.</td>
                </tr>
                <tr>
                  <td>η_o (overall surface efficiency)</td>
                  <td>Area-weighted efficiency of the whole wetted surface: fins at η_f plus the exposed base floor at
                    ~1.0. Always between η_f and 1.</td>
                  <td>This is the factor UA actually uses. Barely above η_f here because fins dominate the wetted
                    area.</td>
                </tr>
                <tr>
                  <td>UA (W/K)</td>
                  <td>Overall convective conductance: h × A_wet × η_o × uniformity × access. R_conv = 1/UA.</td>
                  <td>The single number the whole fin field boils down to. 296 W/K → R_conv = 3.38 mK/W, the blue
                    segment in card 1. Raise UA and only the conv slice shrinks — the TIM+base floor stays.</td>
                </tr>
                <tr>
                  <td>Coverage</td>
                  <td>Cooled footprint ÷ die footprint. Gate: ≥ 1. Here 1.317 — the 28 × 35 mm core overhangs the
                    24 × 31 mm die on all sides.</td>
                  <td>Below 1, die corners must push heat sideways before finding water — a spreading resistance the
                    1-D stack model does not capture, so its numbers turn optimistic. Above ~1.3 extra coverage adds
                    little; it exists to guarantee the model's assumptions hold.</td>
                </tr>
                <tr>
                  <td>ΔT @450 W / ΔT @575 W</td>
                  <td>Junction rise above coolant = R_jc × Q at nominal (450 W) and margin (575 W) load.</td>
                  <td>R_jc translated into what a thermal engineer feels. With ~25 °C water the junction sits near
                    31–35 °C — enormous headroom against silicon limits; the budget is spent on the loop, radiator,
                    and hot-spot non-uniformity that this lumped model does not see.</td>
                </tr>
                <tr>
                  <td>"analytical" badge</td>
                  <td>validation_stage — where the numbers come from. "analytical" = closed-form correlation model
                    (Shah–London, fin theory), not yet anchored by a test on this exact part.</td>
                  <td>Sets how much to trust the absolute values: analytical results rank designs reliably but carry
                    ±20–30% absolute uncertainty until prototype data closes the loop.</td>
                </tr>
                <tr>
                  <td>"LMM" badge</td>
                  <td>process_route — the manufacturing process assumed. Routes: LMM (Incus lithography metal
                    manufacturing) · SLM IR (Nikon SLM Solutions) · SLM green (pure-Cu fine-feature).</td>
                  <td>The route selects the DfAM rulebook that the sliders, verdict card and optimizer enforce, and
                    the realistic conductivity band. Change the route and the same geometry gets different limits.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="kpi-h">Card 4 — Manufacturability (new in V3)</h4>
            <table className="about-tbl kpi-tbl">
              <thead><tr><th>Item</th><th>What it is</th><th>Why it matters</th></tr></thead>
              <tbody>
                <tr>
                  <td>PASS / MARGINAL / FAIL chip</td>
                  <td>The route rulebook's verdict on the current geometry: FAIL = below an absolute bound (not
                    printable/cleanable), MARGINAL = between absolute and recommended, PASS = inside the
                    recommended band.</td>
                  <td>A thermally beautiful FAIL design is a paper design — the 0.10 mm hero's 5.5 K "advantage"
                    over M3 never existed because the part could not be made. Since the July-2026 guidelines,
                    M1's 0.15 mm gap (≈ 5 px green) reads FAIL too — below the 6 px deep-channel floor.</td>
                </tr>
                <tr>
                  <td>Rule list</td>
                  <td>Every non-passing rule with its measured value, bound and source (e.g. "b = 0.150 &lt; 0.175 mm —
                    6 px deep-channel floor, Incus guidelines July 2026").</td>
                  <td>No verdict is a magic judgement — each line cites where the number comes from and what to
                    change. ℹ lines are advisory (pixel snap, drainage checklist, big-part cleanability).</td>
                </tr>
              </tbody>
            </table>
            <p className="note">
              If a ⚠ warnings box appears under the cards, it lists solver caveats for this exact design point (e.g.
              correlation used outside its fitted range, entry-length effects, screening placeholders) — read them
              before quoting numbers.
            </p>
            </section>
          </details>

          <details className="fold">
            <summary>Nomenclature — symbols &amp; units</summary>
            <section>
            <p className="note">Matches the v6 master report conventions. Resistances are stored in K/W; the UI shows them in mK/W (×1000).</p>
            <table className="about-tbl nomen">
              <thead><tr><th>Symbol</th><th>Meaning</th><th>Unit</th></tr></thead>
              <tbody>
                <tr className="grp"><td colSpan={3}>Geometry</td></tr>
                <tr><td>W_trans (core_width)</td><td>Solver transverse core width — perpendicular to the fins; sets fin count</td><td>mm</td></tr>
                <tr><td>L_flow (core_length)</td><td>Solver core length — along the wavy water path; sets hydraulic path length</td><td>mm</td></tr>
                <tr><td>W_phys × L_phys</td><td>Physical CAD package footprint (28 × 35)</td><td>mm</td></tr>
                <tr><td>t</td><td>Fin thickness</td><td>mm</td></tr>
                <tr><td>b</td><td>Channel gap</td><td>mm</td></tr>
                <tr><td>p</td><td>Pitch = t + b (fin center-to-center spacing)</td><td>mm</td></tr>
                <tr><td>H</td><td>Fin height</td><td>mm</td></tr>
                <tr><td>A</td><td>Wave amplitude (centerline-to-peak)</td><td>mm</td></tr>
                <tr><td>λ</td><td>Wavelength along the flow path</td><td>mm</td></tr>
                <tr><td>χ</td><td>Wave curvature parameter = 2π·A / λ</td><td>–</td></tr>
                <tr><td>N_fin / N_ch</td><td>Fin count / channel count (N_ch = N_fin + 1)</td><td>–</td></tr>
                <tr><td>margin</td><td>Side margin retained each side of the fin field</td><td>mm</td></tr>
                <tr><td>D_h</td><td>Hydraulic diameter = 2bH / (b + H)</td><td>mm</td></tr>
                <tr><td>L_arc</td><td>Wavy-path arc length per half path = L_path · √(1 + χ²/2)</td><td>mm</td></tr>
                <tr><td>A_wet</td><td>Wetted (heat-transfer) area used for UA — fins + channel floor</td><td>m²</td></tr>
                <tr><td>A_fin</td><td>Structure-only surface area: fin faces / pin laterals / TPMS sheet (V3)</td><td>mm²</td></tr>
                <tr><td>A_eff</td><td>Working area = A_fin · η_f · uniformity · access (V3)</td><td>mm²</td></tr>
                <tr><td>A_flow</td><td>Open flow cross-section (sets velocity) (V3)</td><td>mm²</td></tr>
                <tr><td>amplification</td><td>A_fin ÷ die area — "one die area becomes N of wet copper" (V3)</td><td>×</td></tr>
                <tr><td>coverage</td><td>Cooled footprint ÷ die area (≥ 1 = fully covers the die)</td><td>–</td></tr>
                <tr><td>SA/V (raw, eff)</td><td>Wetted area per active-core volume; effective = raw · η_o · uniformity · access</td><td>m²/m³</td></tr>

                <tr className="grp"><td colSpan={3}>Flow &amp; heat transfer</td></tr>
                <tr><td>Q</td><td>Heat load (450 nominal / 575 margin)</td><td>W</td></tr>
                <tr><td>V̇</td><td>Total volumetric coolant flow</td><td>L/min</td></tr>
                <tr><td>ṁ</td><td>Mass flow = ρ · V̇</td><td>kg/s</td></tr>
                <tr><td>v</td><td>Channel velocity</td><td>m/s</td></tr>
                <tr><td>α</td><td>Duct aspect ratio = min(b, H) / max(b, H)</td><td>–</td></tr>
                <tr><td>Re</td><td>Reynolds number = ρ·v·D_h / μ</td><td>–</td></tr>
                <tr><td>Nu</td><td>Nusselt number (Shah-London × wavy × jet)</td><td>–</td></tr>
                <tr><td>fRe</td><td>Friction-factor × Reynolds (Shah-London)</td><td>–</td></tr>
                <tr><td>h</td><td>Convective coefficient = Nu · k_fluid / D_h</td><td>W/m²·K</td></tr>
                <tr><td>η_f / η_o</td><td>Fin efficiency / overall surface efficiency</td><td>–</td></tr>
                <tr><td>UA</td><td>Overall thermal conductance</td><td>W/K</td></tr>
                <tr><td>ΔT</td><td>Junction-to-coolant temperature rise = R_jc · Q</td><td>K</td></tr>
                <tr><td>caloric ΔT</td><td>Coolant bulk temperature rise = Q / (ṁ · cp)</td><td>K</td></tr>

                <tr className="grp"><td colSpan={3}>Resistances &amp; hydraulics</td></tr>
                <tr><td>R_conv</td><td>Convective fin/fluid resistance = 1 / UA</td><td>K/W</td></tr>
                <tr><td>R_base</td><td>Base conduction = t_base / (k_solid · A_funnel)</td><td>K/W</td></tr>
                <tr><td>R_TIM</td><td>Interface material = R″_TIM / A_die</td><td>K/W</td></tr>
                <tr><td>R_jc</td><td>Junction-to-coolant stack = R_conv + R_base + R_TIM</td><td>K/W</td></tr>
                <tr><td>ΔP</td><td>Total model pressure drop (friction + header)</td><td>Pa</td></tr>
                <tr><td>K_header</td><td>Lumped inlet/outlet manifold minor-loss coefficient</td><td>–</td></tr>
                <tr><td>W_pump</td><td>Ideal hydraulic pump power = V̇ · ΔP</td><td>W</td></tr>

                <tr className="grp"><td colSpan={3}>Manufacturing (V3)</td></tr>
                <tr><td>absolute / recommended</td><td>Two-tier DfAM bounds: below absolute = FAIL, between = MARGINAL</td><td>mm</td></tr>
                <tr><td>green / final</td><td>As-printed dimension / after-sinter dimension (green = final × shrink)</td><td>mm</td></tr>
                <tr><td>px / layer</td><td>EVO35 exposure pixel 35 µm (XY) / build layer 25 µm (Z), green state</td><td>µm</td></tr>
                <tr><td>overpoly</td><td>Overpolymerization ≈ 1 px feature growth per side; CAD comp = fin −2 px, channel +2 px</td><td>px</td></tr>
                <tr><td>AR</td><td>Fin aspect ratio H/b (pins: H/d) — deformation slenderness</td><td>–</td></tr>

                <tr className="grp"><td colSpan={3}>Operating, material &amp; fluid</td></tr>
                <tr><td>t_base</td><td>Base thickness (post-machining)</td><td>mm</td></tr>
                <tr><td>k_solid</td><td>Printed-copper conductivity (band 250 / 340 / 400)</td><td>W/m·K</td></tr>
                <tr><td>k_fluid</td><td>Coolant thermal conductivity</td><td>W/m·K</td></tr>
                <tr><td>ρ, μ, cp</td><td>Coolant density, dynamic viscosity, specific heat</td><td>kg/m³, Pa·s, J/kg·K</td></tr>
                <tr><td>R″_TIM</td><td>TIM areal resistance over the die</td><td>K·cm²/W</td></tr>
                <tr><td>A_die / A_funnel</td><td>Die footprint / conduction funnel area = min(die, cooled)</td><td>m²</td></tr>
              </tbody>
            </table>
            </section>
          </details>

          <details className="fold">
            <summary>Implicit geometry — the exact equations (rebuild in nTop)</summary>
            <section>
            <p className="note">
              The viewer raymarches these equations and the STL exporter meshes the same field — this is the
              authoritative geometry definition. Units mm; x = transverse (35 mm span, fin count), y = flow (28 mm),
              z = height with the base slab at z ∈ [0, t_base]; structures occupy z ∈ [t_base, t_base + H]. The full
              step-by-step nTop recipe (patterns, clips, verification targets) is in <code>NTOP_REPLICATION.md</code>.
            </p>
            <p><b>Wavy / straight fins</b> — fin i (one fin centred at x = 0), sine phase with y = 0 at mid-path
              (a cosine build is the same body shifted λ/4):</p>
            <Eq>|x − i·p − A·sin(2π·y/λ)| ≤ t/2 &nbsp;·&nbsp; p = t + b &nbsp;·&nbsp; |x| ≤ W/2 − margin &nbsp;·&nbsp; straight: A = 0</Eq>
            <p className="note">Centre rib (2-path layouts): box |y| ≤ w_rib/2 across the full width, same z band.
              Fins the clip would cut partially are omitted whole (watertight-shell rule).</p>
            <p><b>Pin fins</b> — cylinders Ø d at pitch p in both directions; staggered = odd rows shifted p/2 in x;
              only pins fully inside the boundary are kept (|x_c| ≤ W/2 − d/2 etc.).</p>
            <p><b>TPMS lattices</b> — with scaled coordinates x̂ = 2πx/c (k = 2π/c):</p>
            <Eq>gyroid: F = cos x̂·sin ŷ + cos ŷ·sin ẑ + cos ẑ·sin x̂ &nbsp;·&nbsp; diamond: F = sx̂·sŷ·sẑ + sx̂·cŷ·cẑ + cx̂·sŷ·cẑ + cx̂·cŷ·sẑ &nbsp;·&nbsp; schwarz-P: F = cos x̂ + cos ŷ + cos ẑ</Eq>
            <Eq>sheet: |F| ≤ iso &nbsp;·&nbsp; solid: F ≤ iso &nbsp;·&nbsp; iso = clamp(π·w/c, 0.06, 1.2)</Eq>
            <p>
              The iso threshold <b>is</b> the wall: the slab |F| ≤ iso is 2·iso/(k·|∇F|) = w/|∇F| thick, i.e. exactly
              w where |∇F| = 1 (±~30% locally across a gyroid, |∇F| ≈ 0.7–1.5). nTop's native walled-TPMS blocks make
              a true-offset (uniform-w) wall instead — same nominal design, slightly better geometry; prefer them for
              print CAD and use a custom implicit only for exact parity or the exotic types (lidinoid, split-P, I-WP,
              neovius, Fischer-Koch S — equations in <code>NTOP_REPLICATION.md</code>).
            </p>
            <p><b>Jet-adaptive cell grading</b> — the cell size varies radially (r from the core centre axis,
              R = min(W, L)/2; finer than nominal under the jet, coarser outboard, crossover at r = R/2):</p>
            <Eq>c(r) = c₀ · (1 + g·(clamp(r/R, 0, 1.5) − 0.5)) &nbsp;·&nbsp; c ≥ 0.3 mm &nbsp;·&nbsp; g = cell_grading (0–1)</Eq>
            <p className="note">
              Verification targets for a rebuild (gyroid, c = 2.5, w = 0.12): relative density ρ* = (A₀/a²)·(w/c) =
              0.148 → void 0.852 · sheet SA/V = 2·(A₀/a²)/c = 2473 m²/m³ (A₀/a²: gyroid 3.0915, diamond 3.8385,
              schwarz-P 2.3451). Measure area/volume on the nTop body and compare.
            </p>
            <p><b>DLP pixel preview (▦ tab)</b> — the same field sampled at one printer pixel in final space
              (35 µm ÷ 1.197 XY, 25 µm ÷ 1.23 Z). Overpoly ON offsets every feature boundary by +1 px per side —
              an <i>uncompensated</i> print; the CAD pre-compensation (fin −2 px, channel +2 px) cancels it.</p>
            </section>
          </details>

          <details className="fold">
            <summary>References</summary>
            <section>
            <p className="note">
              Compiled and DOI-checked via a multi-source research pass (verified against Crossref).
              Recent 2025–26 entries may still receive final volume/page assignments.
            </p>

            <div className="ref-h">TPMS lattice heat sinks (metal additive manufacturing)</div>
            <ol className="refs">
              <li>Chouhan, G., Namdeo, A.K., Guner, A., Essa, K. &amp; Bidare, P. (2025). Heat transfer performance of compact TPMS lattice heat sinks via metal additive manufacturing. <i>Progress in Additive Manufacturing</i> 11(1), 593–610. <Doi id="10.1007/s40964-025-01366-0" /></li>
              <li>Renon, C. &amp; Jeanningros, X. (2025). A numerical investigation of heat transfer and pressure-drop correlations in Gyroid and Diamond TPMS-based heat-exchanger channels. <i>Int. J. Heat and Mass Transfer</i> 239, 126599. <Doi id="10.1016/j.ijheatmasstransfer.2024.126599" /></li>
              <li>Smet, V., Gallego-Bordallo, J., Meyers, S., Beevers, E., Blommaert, M. &amp; Van Hooreweder, B. (2025). Homogenized heat-transfer performance of gyroid heat exchangers by LPBF in pure copper, aluminium A205 and reaction-bonded SiC. <i>Applied Thermal Engineering</i> 279, 127655. <Doi id="10.1016/j.applthermaleng.2025.127655" /></li>
              <li>Saghir, M.Z., Hajialibabaei, M. &amp; Al-Ketan, O. (2025). Optimization of the TPMS heat exchanger toward cooling the heat sink. <i>Processes</i> 13(6), 1786. <Doi id="10.3390/pr13061786" /></li>
            </ol>

            <div className="ref-h">TPMS mathematical definitions (the level-set equations used in the viewer)</div>
            <ol className="refs" start={5}>
              <li>Gandy, P.J.F., Bardhan, S., Mackay, A.L. &amp; Klinowski, J. (2001). Nodal surface approximations to the P, G, D and I-WP triply periodic minimal surfaces. <i>Chemical Physics Letters</i> 336, 187–195. <Doi id="10.1016/S0009-2614(00)01418-4" /></li>
              <li>Gandy, P.J.F. &amp; Klinowski, J. (2000). Exact computation of the triply periodic G (Gyroid) minimal surface. <i>Chemical Physics Letters</i> 321, 363–371. <Doi id="10.1016/S0009-2614(00)00373-0" /></li>
              <li>Gandy, P.J.F., Cvijović, D., Mackay, A.L. &amp; Klinowski, J. (1999). Exact computation of the triply periodic D (Diamond) minimal surface. <i>Chemical Physics Letters</i> 314, 543–551. <Doi id="10.1016/S0009-2614(99)01000-3" /></li>
            </ol>

            <div className="ref-h">Jet impingement</div>
            <ol className="refs" start={8}>
              <li>Zuckerman, N. &amp; Lior, N. (2006). Jet impingement heat transfer: physics, correlations, and numerical modeling. <i>Advances in Heat Transfer</i> 39, 565–631. <Doi id="10.1016/S0065-2717(06)39006-5" /></li>
              <li>Martin, H. (1977). Heat and mass transfer between impinging gas jets and solid surfaces. <i>Advances in Heat Transfer</i> 13, 1–60. <Doi id="10.1016/S0065-2717(08)70221-1" /></li>
              <li>Uddin, N., Kee, P.T.W. &amp; Weigand, B. (2024). Heat transfer by jet impingement: a review of correlations and high-fidelity simulations. <i>Applied Thermal Engineering</i> 257, 124258. <Doi id="10.1016/j.applthermaleng.2024.124258" /></li>
            </ol>

            <div className="ref-h">Duct convection &amp; extended-surface (fin) theory — the solver's correlations</div>
            <ol className="refs" start={11}>
              <li>Shah, R.K. &amp; London, A.L. (1978). <i>Laminar Flow Forced Convection in Ducts</i> (Supplement 1 to Advances in Heat Transfer). Academic Press. ISBN 978-0-12-020051-1. <span className="muted">Source of the Nu &amp; fRe rectangular-duct correlations.</span></li>
              <li>Shah, R.K. (1975). Laminar flow friction and forced-convection heat transfer in ducts of arbitrary geometry. <i>Int. J. Heat and Mass Transfer</i> 18(7–8), 849–862. <Doi id="10.1016/0017-9310(75)90176-3" /></li>
              <li>Bergman, T.L., Lavine, A.S., Incropera, F.P. &amp; DeWitt, D.P. (2017). <i>Fundamentals of Heat and Mass Transfer</i>, 8th ed. Wiley. ISBN 978-1-118-98917-3. <span className="muted">Fin efficiency (Ch. 3), internal-flow convection (Ch. 8).</span></li>
            </ol>

            <div className="ref-h">Wavy channels &amp; additively-manufactured cold plates</div>
            <ol className="refs" start={14}>
              <li>Sui, Y., Teo, C.J., Lee, P.S., Chew, Y.T. &amp; Shu, C. (2010). Fluid flow and heat transfer in wavy microchannels. <i>Int. J. Heat and Mass Transfer</i> 53(13–14), 2760–2772. <Doi id="10.1016/j.ijheatmasstransfer.2010.02.022" /></li>
              <li>Zaki, O.M., Park, W.Y., Pinkus, I., King, W.P. &amp; Miljkovic, N. (2026). Metal additively-manufactured wavy-fin cold-plate architecture for improved thermal-hydraulic performance. <i>Int. J. Heat and Mass Transfer</i> 256, 128138. <Doi id="10.1016/j.ijheatmasstransfer.2025.128138" /></li>
            </ol>

            <div className="ref-h">Manufacturing constraints (V3)</div>
            <ol className="refs" start={16}>
              <li>Incus GmbH. <i>Component Design for Lithography-based Metal Manufacturing of Cu-OF</i> (Incus_Design_Guidelines.pdf), July 2026 — official DLP design rules, all dims green-state px. <span className="muted">Primary source of the LMM rulebook since 2026-07-30: shrink ×1.197/×1.23, 35/25 µm grids, overpoly ≈1 px/side (∓2 px CAD comp), fins 3 px abs / 4–5 px rec, deep channels 6–8 px, sinter bonding for enclosed cavities.</span></li>
              <li>Peritsch, P. (Incus GmbH). Email "AW: [EXTERN] Re: [Incus – Vinnotek] 3d printing quotation", 2026-07-07 — DfAM review of our three v6 STLs. <span className="muted">Distilled in <code>cold_plate_v6_incus_manufacturability_review_20260708.md</code>; first supplier-verified LMM rulebook.</span></li>
              <li>Peritsch, P. (Incus GmbH). Email, 2026-07-29 — px review of the rev5 wavy + ICE fin arrays: 2 px gap cross-sections "will not be cleaned", 1–2 px fins too thin; "increase the ratio fins to gaps — gaps should be wider than fins". <span className="muted">Source of the gap_ratio rule.</span></li>
              <li>LPBF thin-wall &amp; channel design limits: vendor design guides (EOS CuCrZr, MakerVerse L-PBF guide) + thin-wall fabrication-limit studies (e.g. Int. J. Adv. Manuf. Technol. 2020, <Doi id="10.1007/s00170-020-05827-4" />). <span className="muted">Basis of the SLM_IR rulebook (literature grade; Nikon SLM Solutions DfM review pending).</span></li>
              <li>Green-laser pure-Cu LPBF capability: Physical and geometrical properties of pure-Cu green-laser samples, <i>Materials</i> 14(13), 3642 (2021), <Doi id="10.3390/ma14133642" />; high-precision LPBF processing of pure copper, <i>Additive Manufacturing</i> (2021), <a className="doi" href="https://www.sciencedirect.com/science/article/abs/pii/S2214860421005704" target="_blank" rel="noopener noreferrer">sciencedirect: S2214860421005704</a>. <span className="muted">Basis of the SLM_GREEN rulebook.</span></li>
            </ol>
            </section>
          </details>

          <p className="about-foot">
            Local, validated, and screening-grade by design. Full spec: <code>MASTER_BASELINE_VIEWER_SPEC.md</code> (V3 accepted 2026-07-09).
          </p>
        </div>
      </div>
    </div>
  )
}
