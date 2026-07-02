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

export function About({ onClose }: { onClose: () => void }) {
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <h2>About — Cold Plate Master Baseline Viewer</h2>
          <button className="about-close" onClick={onClose}>✕</button>
        </div>

        <div className="about-body">
          <section>
            <h3>What this is</h3>
            <p>
              An internal engineering tool to <b>view, tune, and optimize</b> the additively-manufactured
              (printed-copper, LMM) GPU cold-plate for an RTX 5090-class GB202 die. Every number comes from the
              project's <b>validated Python solvers</b> — the browser never runs a second physics model, so what you
              see here matches the audit reports. It runs entirely on your machine (local Python API); there is no
              cloud service, no AI, and no cost to run it.
            </p>
          </section>

          <section>
            <h3>The design problem</h3>
            <ul>
              <li><b>Heat source:</b> GB202 die, 24 × 31 mm, dissipating <b>450 W nominal / 575 W margin</b>.</li>
              <li><b>Coolant:</b> water, 2.65 L/min, 25 °C inlet.</li>
              <li><b>Cooler:</b> printed copper (k ≈ 340 W/m·K), die-coverage active core physically <b>28 mm wide × 35 mm long</b>, 5.5 mm tall, on a 0.7 mm base. Center-feed bidirectional flow (2 paths), fins parallel to the 28 mm side.</li>
              <li><b>Gates:</b> R_jc ≤ 0.078 K/W · ΔP ≤ 50 kPa · pump ≤ 5 W · coverage ≥ 1.</li>
            </ul>
            <p className="note">
              Axis note: physically 28 mm is the flow direction and 35 mm is transverse (it sets the fin count).
              In the solver variables this is core_width = 35 (transverse) × core_length = 28 (flow).
            </p>
          </section>

          <section>
            <h3>The metric that matters: R_jc</h3>
            <p>
              The die temperature is driven by the full <b>junction-to-coolant thermal resistance</b>, a series stack:
            </p>
            <Eq>R_jc = R_conv + R_base + R_TIM</Eq>
            <ul>
              <li><b>R_TIM</b> = R″<sub>TIM</sub> / A_die — thermal interface material over the die.</li>
              <li><b>R_base</b> = t_base / (k_solid · A_funnel) — 1-D conduction through the base (A_funnel = min(die, cooled)).</li>
              <li><b>R_conv</b> = 1 / UA — convection into the coolant (the part the fin geometry controls).</li>
            </ul>
            <p>
              A key insight the tool surfaces: <b>TIM + base are ~70% of R_jc and are essentially fixed</b> — convection
              is only ~30%. So there is a hard floor you cannot out-fin; squeezing the fins has bounded payoff.
            </p>
          </section>

          <section>
            <h3>Temperature rise — the thermal Ohm's law</h3>
            <p>
              Heat flow behaves exactly like an electrical circuit. For a <b>fixed</b> heat load Q, the die's rise above
              the coolant is:
            </p>
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
              Because Q is fixed by the chip, <b>ΔT is a penalty to minimize, not maximize</b>. Higher R_th forces a
              bigger ΔT to push the same watts through → a <b>hotter</b> die. Lower R_th → lower ΔT → cooler die. The
              flip side, Q = ΔT / R_th, says the same thing: at a fixed temperature budget, a lower R_th lets you
              dissipate more watts. Either way, <b>smaller R_th / ΔT = better cooler</b>.
            </p>
            <p className="note">The panel shows ΔT @450 W = R_jc · 450 and ΔT @575 W = R_jc · 575 — the junction rise above coolant at nominal and margin loads.</p>
          </section>

          <section>
            <h3>Geometry &amp; the fin field</h3>
            <Eq>pitch = t + b &nbsp;&nbsp;·&nbsp;&nbsp; fin_count = ⌊(core_width − 2·margin) / pitch⌋</Eq>
            <p>
              <b>Pitch</b> is the center-to-center spacing of adjacent fins (one wall + one channel). Smaller pitch →
              more fins → more surface area → lower R_conv, but higher ΔP and features closer to the manufacturing
              floor. The hero (t = b = 0.10 mm, pitch 0.20 mm) packs ~166 fins across the 35 mm span.
            </p>
            <Eq>D_h = 2bH / (b + H) &nbsp;·&nbsp; Re = ρ·v·D_h / μ</Eq>
          </section>

          <section>
            <h3>Heat transfer &amp; fin efficiency</h3>
            <Eq>UA = h · A_wet · η_o · (flow uniformity) · (surface access)</Eq>
            <Eq>h = Nu · k_fluid / D_h &nbsp;·&nbsp; Nu = Shah-London (rect. duct)</Eq>
            <p className="note">Nu and fRe from Shah &amp; London (1978) [11] / Shah (1975) [12].</p>
            <p>Thin, tall fins conduct heat poorly along their length, so not all their area is useful:</p>
            <Eq>m = √(2h / (k_solid · t)) &nbsp;·&nbsp; η_f = tanh(mH) / (mH) &nbsp;·&nbsp; η_o = 1 − (A_fin/A_wet)(1 − η_f)</Eq>
            <p className="note">Extended-surface / fin-efficiency theory: Bergman, Incropera et al. (2017) [13].</p>
            <p>
              This is why <b>raw SA/V and effective SA/V differ</b>: effective = raw × η_o × uniformity × access. Push
              fins thinner/taller and raw SA/V keeps climbing, but η_f collapses, so <b>effective SA/V plateaus</b> —
              the real sweet spot sits just before that roll-off, at a manufacturable pitch.
            </p>
          </section>

          <section>
            <h3>Wavy fins</h3>
            <p>The sinusoidal planform lengthens the channel and stirs the flow (Dean vortices):</p>
            <Eq>χ = 2π·A / λ &nbsp;·&nbsp; arc length factor = √(1 + χ²/2) &nbsp;·&nbsp; Nu ×= 1 + 0.40·χ^1.5·tanh(Re/300)</Eq>
            <p>Per the v6 sweep, the wave (A/λ) is the strongest single R_th lever, then the gap b; t=b is a shallow optimum and fin height H is weak. Wavy-channel enhancement &amp; Dean vortices: Sui et al. (2010) [14]; AM wavy-fin cold plates: Zaki et al. (2026) [15].</p>
          </section>

          <section>
            <h3>Hydraulics</h3>
            <Eq>ΔP = fRe · (2μ·v·L_arc / D_h²) + ½·ρ·v²·K_header &nbsp;·&nbsp; W_pump = V̇ · ΔP</Eq>
            <p>Friction (Shah-London fRe with a roughness correction) plus a lumped manifold minor-loss term. Pump power is the ideal hydraulic cost — a design that wins thermally is useless if it costs too much pressure.</p>
          </section>

          <section>
            <h3>The optimization doctrine</h3>
            <Eq>minimize R_jc &nbsp; subject to &nbsp; ΔP, pump, coverage, open-volume, manufacturability, validation gates</Eq>
            <p>Not "maximize surface area" or "maximize open volume" — those pull against each other. Track raw &amp; effective SA/V as <i>diagnostics</i>, but decide on R_jc. The <b>Optimizer</b> tab sweeps two variables into an R_jc heatmap (green = lower) and a Pareto front (R_jc vs pump power) so you can pick the knee, then load it back into the sliders. The <b>manufacturing floor</b> (LMM 0.10 mm wall/gap) is the dominant constraint and clamps the sliders.</p>
          </section>

          <section>
            <h3>Two engines, and how to trust them</h3>
            <ul>
              <li><b>Master engine</b> (family-neutral): compares wavy / straight / pin / gyroid on equal terms — used for the candidate list and sweeps.</li>
              <li><b>v6 solver</b> (validated depth): the wavy-fin hero with jet impingement, center rib, thermal entry, NTU/effectiveness. Jet-impingement basis: Zuckerman &amp; Lior (2006) [8], Martin (1977) [9].</li>
            </ul>
            <p className="note">
              These are <b>screening</b> results — a design direction, not frozen CAD. The gyroid row is flagged
              SCREENING_ONLY (placeholder until nTop-measured area + CFD). TPMS AM heat-sink performance:
              Chouhan et al. (2025) [1], Renon &amp; Jeanningros (2025) [2]; the viewer's level-set equations:
              Gandy et al. (1999–2001) [5–7]. No external performance claim until supplier coupon, CFD/CHT on
              the manifold + center rib + local die temperature, and test close the loop.
            </p>
          </section>

          <section>
            <h3>Reading the KPI panel — every number explained</h3>
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
                    open volume…). SCREENING_ONLY marks families (gyroid/TPMS) whose model is a placeholder until
                    nTop-measured area + CFD exist.</td>
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
                    remain to depowder the LMM print, and it correlates with cloggability and weight. There is a
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
                  <td>SA/V raw (m²/m³)</td>
                  <td>Total wetted surface per unit of active-core volume — the "brochure" area density.</td>
                  <td>Mostly a <b>diagnostic, not a goal</b>. It only counts area, not whether that area is hot enough
                    to matter. Chasing raw SA/V alone is how designs end up with impressive area and mediocre R_jc.</td>
                </tr>
                <tr>
                  <td>SA/V eff (m²/m³)</td>
                  <td>Raw SA/V derated by what actually works: × η_o (fin efficiency) × flow uniformity × surface
                    access. Here 13386 → 2035, an 85% haircut.</td>
                  <td>The honest area number. The gap between raw and effective is the fin-efficiency story below —
                    when thinner/taller fins raise raw SA/V but effective SA/V stalls, you've hit the plateau and
                    further fin-packing is free of benefit but not free of ΔP.</td>
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
                  <td>Junction rise above coolant = R_jc × Q at nominal (450 W) and margin (575 W) load: 5.79 K and
                    7.40 K.</td>
                  <td>R_jc translated into what a thermal engineer feels. With ~25 °C water the junction sits near
                    31–33 °C — enormous headroom against silicon limits, which is the point: the budget is spent on
                    the loop, radiator, and hot-spot non-uniformity that this lumped model does not see.</td>
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
                  <td>process_route — the manufacturing process assumed: Lithography-based Metal Manufacturing
                    (printed copper).</td>
                  <td>The route sets the design floor the sliders enforce (≈0.10 mm minimum wall/gap for LMM) and the
                    conductivity band (k ≈ 340 W/m·K printed vs ~400 wrought). Change the route and the same geometry
                    gets different limits and different physics.</td>
                </tr>
              </tbody>
            </table>
            <p className="note">
              If a ⚠ warnings box appears under the cards, it lists solver caveats for this exact design point (e.g.
              correlation used outside its fitted range, entry-length effects, screening placeholders) — read them
              before quoting numbers.
            </p>
          </section>

          <section>
            <h3>Nomenclature — symbols &amp; units</h3>
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
                <tr><td>A_wet</td><td>Wetted (heat-transfer) area used for UA</td><td>m²</td></tr>
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

          <section>
            <h3>References</h3>
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
          </section>

          <p className="about-foot">
            Local, validated, and screening-grade by design. Full spec: <code>MASTER_BASELINE_VIEWER_SPEC.md</code>.
          </p>
        </div>
      </div>
    </div>
  )
}
