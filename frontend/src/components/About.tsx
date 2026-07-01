function Eq({ children }: { children: React.ReactNode }) {
  return <div className="eq">{children}</div>
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
            <p>Thin, tall fins conduct heat poorly along their length, so not all their area is useful:</p>
            <Eq>m = √(2h / (k_solid · t)) &nbsp;·&nbsp; η_f = tanh(mH) / (mH) &nbsp;·&nbsp; η_o = 1 − (A_fin/A_wet)(1 − η_f)</Eq>
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
            <p>Per the v6 sweep, the wave (A/λ) is the strongest single R_th lever, then the gap b; t=b is a shallow optimum and fin height H is weak.</p>
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
              <li><b>v6 solver</b> (validated depth): the wavy-fin hero with jet impingement, center rib, thermal entry, NTU/effectiveness.</li>
            </ul>
            <p className="note">
              These are <b>screening</b> results — a design direction, not frozen CAD. The gyroid row is flagged
              SCREENING_ONLY (placeholder until nTop-measured area + CFD). No external performance claim until supplier
              coupon, CFD/CHT on the manifold + center rib + local die temperature, and test close the loop.
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

          <p className="about-foot">
            Local, validated, and screening-grade by design. Full spec: <code>MASTER_BASELINE_VIEWER_SPEC.md</code>.
          </p>
        </div>
      </div>
    </div>
  )
}
