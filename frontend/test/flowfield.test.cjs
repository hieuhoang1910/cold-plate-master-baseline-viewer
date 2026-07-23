// V5.3 — F1 field-solver acceptance (node, no browser). Run via npm run test:verify.
const path = require('path')
const { finConductance, solveField } = require('../.verify-build/flowfield/field.js')

let fails = 0, passes = 0
const check = (cond, msg) => {
  if (cond) { passes++; console.log(`  [PASS] ${msg}`) }
  else { fails++; console.log(`  [FAIL] ${msg}`) }
}
const approx = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-12)

// M1-class geometry, water, GB202 flow.
const BASE = {
  coreWidth: 35, coreLength: 28, finHeight: 5.5,
  finThickness: 0.12, gap: 0.15, sideMargin: 0.9,
  waveAmp: 0, waveLen: 2.5,
  layout: 'single_pass', nSeg: 2,
  mu: 0.00089, rho: 997, flowM3s: 2.65 / 60000,
  meanRe: 150, relRoughness: 0.03,
}

console.log('F1 single-pass — dP closure vs the analytic slot formula')
const sp = solveField({ ...BASE })
const K = finConductance(BASE)
const Wf = (BASE.coreWidth - 2 * BASE.sideMargin) * 1e-3
// discrete path: source row centre -> sink row centre = (ny - 1) faces
const Lp = (sp.ny - 1) * sp.dy * 1e-3
const dpHand = (BASE.flowM3s / Wf) * Lp / K
check(approx(sp.deltaP, dpHand, 1e-6), `dP ${sp.deltaP.toFixed(1)} Pa == hand ${dpHand.toFixed(1)} Pa`)
check(sp.massErr < 1e-6, `mass conserved (err ${(sp.massErr * 100).toExponential(1)}%)`)
check(sp.uniformity > 0.9999, `uniform inflow -> uniformity ~1 (${sp.uniformity.toFixed(5)})`)
check(sp.lineOffsets.length > 20, `streamlines traced (${sp.lineOffsets.length - 1})`)
check(sp.iters < 400, `converged in ${sp.iters} sweeps`)

console.log('F1 wavy — arc factor carries through')
const wv = solveField({ ...BASE, waveAmp: 0.55, waveLen: 2.5 })
const arc = Math.sqrt(1 + 0.5 * (2 * Math.PI * 0.55 / 2.5) ** 2)
check(approx(wv.deltaP / sp.deltaP, arc, 1e-3),
  `dP_wavy/dP_straight = ${(wv.deltaP / sp.deltaP).toFixed(4)} == arc ${arc.toFixed(4)}`)

console.log('F1 center-feed — half path at half flow per side')
const cf = solveField({ ...BASE, layout: 'center_feed_bidirectional' })
check(approx(cf.deltaP / sp.deltaP, 0.25, 0.05),
  `dP ratio ${(cf.deltaP / sp.deltaP).toFixed(3)} ~ 0.25 (L/2 at Q/2)`)
check(cf.massErr < 1e-6, `mass conserved (err ${(cf.massErr * 100).toExponential(1)}%)`)

console.log('F1 u-flow — real maldistribution, header sensitivity')
const un = solveField({ ...BASE, layout: 'u_flow_side_feed', headerWidthMm: 1.0 })
const uw = solveField({ ...BASE, layout: 'u_flow_side_feed', headerWidthMm: 6.0 })
check(un.uniformity < 0.999, `narrow header -> U ${un.uniformity.toFixed(4)} < 1`)
check(uw.uniformity > un.uniformity,
  `wide header improves U (${uw.uniformity.toFixed(4)} > ${un.uniformity.toFixed(4)})`)
check(un.massErr < 1e-6, `mass conserved (err ${(un.massErr * 100).toExponential(1)}%)`)

console.log('F1 distributed-jet — ICE rev 3 (10 ducts on 28x28)')
const dj = solveField({ ...BASE, coreWidth: 28, layout: 'distributed_jet_compartments', nSeg: 10 })
check(dj.deltaP > 0 && Number.isFinite(dj.deltaP), `crossing dP ${dj.deltaP.toFixed(1)} Pa`)
check(dj.massErr < 1e-6, `mass conserved (err ${(dj.massErr * 100).toExponential(1)}%)`)
check(dj.lineOffsets.length > 20, `streamlines traced (${dj.lineOffsets.length - 1})`)
// exact closure needs the discrete feed/sink row spacing; assert scale instead:
check(dj.deltaP < sp.deltaP / 5,
  `short crossings are far cheaper than a full pass (${dj.deltaP.toFixed(0)} << ${sp.deltaP.toFixed(0)} Pa)`)

console.log('F1 thermal (V5.4) — outlet closure is exact energy conservation')
const THERM = { heatW: 450, cp: 4181, TIn: 25 }
const dTcal = THERM.heatW / (BASE.rho * BASE.flowM3s * THERM.cp)
for (const [name, extra] of [
  ['single-pass', {}],
  ['center-feed', { layout: 'center_feed_bidirectional' }],
  ['distributed-jet', { coreWidth: 28, layout: 'distributed_jet_compartments', nSeg: 10 }],
]) {
  const r = solveField({ ...BASE, ...extra, ...THERM })
  check(r.tGrid != null && approx(r.outletT, THERM.TIn + dTcal, 1e-6),
    `${name}: outlet T ${r.outletT.toFixed(4)} °C == T_in + dT_cal ${(THERM.TIn + dTcal).toFixed(4)} °C`)
  check(r.tMax >= r.outletT - 1e-9 && r.tMax < THERM.TIn + 3 * dTcal + 1e-9,
    `${name}: hottest live cell ${r.tMax.toFixed(2)} °C within [outlet, cap]`)
}
const uT = solveField({ ...BASE, layout: 'u_flow_side_feed', headerWidthMm: 1.0, ...THERM })
check(approx(uT.outletT, THERM.TIn + dTcal, 1e-6),
  `u-flow: outlet closure holds under maldistribution (${uT.outletT.toFixed(4)} °C)`)
check(uT.tMax > THERM.TIn + dTcal,
  `u-flow: starved channels run hotter than the mixed outlet (${uT.tMax.toFixed(2)} °C)`)
const noT = solveField({ ...BASE })
check(noT.tGrid === null && noT.pGrid.length === noT.nx * noT.ny && noT.vGrid.length === noT.nx * noT.ny,
  'no heat inputs -> tGrid null; p/v grids always present')

console.log('F1 serpentine — passes multiply the friction path')
const se = solveField({ ...BASE, layout: 'serpentine_n_pass', nSeg: 3 })
// 3 passes at 1/3 width: q per pass x3, path x3 -> ~9x the single-pass friction
check(se.deltaP > 6 * sp.deltaP && se.deltaP < 12 * sp.deltaP,
  `3-pass dP ${(se.deltaP / sp.deltaP).toFixed(1)}x single-pass (expect ~9x)`)
check(se.massErr < 1e-4, `mass conserved (err ${(se.massErr * 100).toExponential(1)}%)`)

console.log('-'.repeat(60))
if (fails === 0) { console.log(`OK: ${passes} F1 checks passed.`); process.exit(0) }
console.log(`FAILED: ${fails} failed, ${passes} passed.`)
process.exit(1)
