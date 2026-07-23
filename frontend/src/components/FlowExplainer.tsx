import type React from 'react'

// V5 — "How the flow & thermal layers work": the expandable in-app explainer
// (user request 2026-07-23). Same 3-layer voice as the About tab (§33): plain
// words first, then the math, then what to do with it. Every claim states its
// tier — intent (T0), network-solved (S6), or field-solved (F1) — and what it
// is NOT (CFD).

const S = ({ title, children, open = false }: {
  title: string; children: React.ReactNode; open?: boolean
}) => (
  <details className="fx-sec" open={open}>
    <summary>{title}</summary>
    <div className="fx-body">{children}</div>
  </details>
)

export function FlowExplainer({ onClose }: { onClose: () => void }) {
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card fx-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <h2>How the flow &amp; thermal layers work</h2>
          <button className="about-close" onClick={onClose}>✕</button>
        </div>
        <div className="fx-scroll">

          <p className="fx-intro">
            Everything animated in the viewer is either the <b>layout&apos;s stated routing</b>,
            a <b>network-solved number</b>, or a <b>field-solved map</b> — never a guess and
            never CFD. The workflow: design for best intent here → Ansys confirms the
            intent (the Report&apos;s FC checklist is exactly what CFD checks) → print.
          </p>

          <S title="Three tiers of truth — T0 · S6 · F1" open>
            <p><b>T0 — intent (drawn):</b> the routing the layout defines. Port and jet
            arrows, the schematic card, and the vertical legs of the particle paths
            (water descending from the manifold at the feeds, rising at the returns)
            are statements of design intent, not solutions.</p>
            <p><b>S6 — network-solved (server):</b> the manifold → slots → compartments →
            channels system solved as a hydraulic circuit, using the <i>same</i> laminar
            fRe + minor-loss correlations as the KPI solver. It computes the per-path
            flow split, the uniformity U, and the ΔP friction/minor decomposition.
            For symmetric layouts it reproduces the KPI solver&apos;s ΔP <i>exactly</i>.</p>
            <p><b>F1 — field-solved (browser):</b> a depth-integrated Darcy/Hele-Shaw
            pressure solve on the fin-band planform (channels conduct along the flow,
            fins block across; headers and turn plena open sideways), plus an upwind
            thermal transport pass. It yields the p, v and T maps the tints and
            particles use. Friction only — minor losses stay lumped in S6.</p>
            <p className="fx-note">KPIs, gates, the optimizer and the report <b>never</b> read
            from S6/F1 visuals — correctness always comes from the validated server
            solvers, and the ✓/⚠ chips show the reconciliation live.</p>
          </S>

          <S title="≈ Flow — lanes, streamlines, comet trails">
            <p><b>Plain words:</b> the dashes on the translucent water sheet move along the
            layout&apos;s route at the real channel velocity, slowed ×50 so your eye can
            follow (1 s on screen ≈ 20 ms real). The comet streaks with fading trails
            ride the F1-<i>solved</i> field: they race through favoured channels and crawl
            through starved ones — maldistribution made visible.</p>
            <p><b>The math:</b> dash speed = the S6 mean per-path velocity; comet timing =
            true time-of-flight integrated along each solved streamline. Streamlines
            snap to the wavy channel centerlines where the motion is channel-aligned
            (presentation only — the F1 grid is homogenized at ~0.35 mm cells).</p>
            <p><b>What to do:</b> look from <b>Top</b> or Iso — the routing reads at a glance.
            Watch for streaks bunching or crawling: that is computed starvation, and it
            becomes FC-5 in the report for CFD to confirm. <b>▶ ride</b> follows one
            parcel inlet → outlet.</p>
          </S>

          <S title="Thermal — where the heat goes">
            <p><b>Plain words:</b> the water enters cold and warms as it collects heat; the
            copper is hottest at the fin roots and coolest at the tips. The tint draws
            exactly that story with the solver&apos;s own numbers.</p>
            <p><b>The math:</b> the metal tint is the FINS&apos; own story — the conduction
            profile cosh(m(H−z))/cosh(mH) with mH inverted from the solver&apos;s η_f;
            the root sits Q·R_conv above the local fluid, the base slab ≈ the roots.
            The FLUID story rides on the parcels: with ≈ Flow on, each parcel is
            colored by the local F1-solved temperature and visibly warms blue → red
            along its journey (outlet closes the energy balance to T_in + Q/(ṁ·c_p)
            exactly). In ΔP mode the parcels carry remaining pressure instead.</p>
            <p><b>The rib strip:</b> the unfinned mid strip is drawn hotter on purpose —
            flow passes over and around it, so it is area-starved directly over the
            die&apos;s hottest zone. Copper spreading and the jet&apos;s stagnation cooling
            temper it (warm strip, not a crisis), and the drawn magnitude is a
            screening estimate — the CFD run quantifies it (FC-6/FC-7).</p>
            <p><b>Honesty:</b> this is the 1-D model drawn in place — screening, not
            conjugate CFD. Near-stagnant cells shade <span className="fx-magenta">dark
            magenta</span>: low-flow <i>candidates</i>, counted in the chip, confirmed only
            by CFD.</p>
          </S>

          <S title="ΔP — where the pressure budget is spent">
            <p><b>Plain words:</b> the pump pays a pressure budget to push water through;
            this mode colors the sheet by how much is left — red at the inlet (unspent)
            fading to blue at the outlet (spent). The hydraulic twin of the resistance
            stackup.</p>
            <p><b>The math:</b> with F1 on you see its solved friction pressure field;
            otherwise a 1-D profile where the S6 minor-loss share drops at entries and
            turns and friction accrues along the path. The endpoint anchors to the
            solver&apos;s ΔP; the S6 friction/minor split is on the schematic card.</p>
          </S>

          <S title="The chips — the honesty layer">
            <p><b>design intent — confirm by CFD</b>: permanent badge; nothing here is a
            simulation claim. <b>✓ reconciled</b>: S6&apos;s network ΔP vs the KPI solver&apos;s
            (±15%). <b>✓ F1 field</b>: F1&apos;s friction ΔP vs S6&apos;s friction component, plus
            grid size, sweeps and mass error in the tooltip. <b>U</b>: flow uniformity,
            (Σq)²/(N·Σq²) — 1.0 is perfectly even; the ICE layout computes ≈0.87 from
            its return-gap end effects. <b>% low-flow</b>: F1 cells with ~no through-flow.</p>
          </S>

          <S title="What this is NOT — and what confirms it">
            <p>No Navier–Stokes, no turbulence, no jet-stagnation detail, no recirculation
            prediction — those are Ansys&apos;s job. The Report&apos;s <b>§3b FC checklist</b>
            (FC-1 split · FC-2 uniformity · FC-3 ΔP decomposition · FC-4 outlet T ·
            FC-5 low-flow zones · FC-6 jet aim · FC-7 the wedge rib-crown hypothesis)
            states every claim with the CFD probe that tests it. When the CFD run
            lands, it either confirms the intent or teaches us where the reduced-order
            story breaks — both outcomes are the tool working.</p>
          </S>

        </div>
      </div>
    </div>
  )
}
