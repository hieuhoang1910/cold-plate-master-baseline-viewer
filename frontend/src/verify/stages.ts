import type { ViewerGeom } from '../viewerGeom'
import { LMM_PROC, greenChain } from '../manufacturing'
import type { Stage } from './types'

// V4 — stage handling (spec §40): the imported file is one of three stages of
// the green→CAD chain. Meshes are mapped BACK to the final frame (so one
// reference field serves all stages); for 'cad' the reference geometry itself
// is adjusted, because the compensation is baked into the exported shape.

/** Per-axis scale mapping file coordinates → final frame. */
export function stageScale(stage: Stage): [number, number, number] {
  if (stage === 'final') return [1, 1, 1]
  return [1 / LMM_PROC.shrinkXY, 1 / LMM_PROC.shrinkXY, 1 / LMM_PROC.shrinkZ]
}

/**
 * Reference geometry for the declared stage, in final frame.
 * - final / green: the design as-is (green meshes are descaled back to final).
 * - cad (fin families): t/b/A/λ/H carry the pixel snap + overpoly compensation
 *   that the export bakes in — the reference must match or every fin flags a
 *   false ~2 px "error".
 * - cad (TPMS / pins): no compensation rules are defined (lmmRecipe is
 *   fin-only) — compared as green, with a UI note.
 */
export function stageRefGeom(g: ViewerGeom, stage: Stage): { geom: ViewerGeom; note: string | null } {
  if (stage !== 'cad') return { geom: g, note: null }
  const isFin = g.family !== 'gyroid_tpms'
  if (!isFin) {
    return {
      geom: g,
      note: 'CAD-for-print compensation is defined for fin families only — this lattice is compared at the green stage (pixel snap / overpoly not modelled).',
    }
  }
  const sXY = LMM_PROC.shrinkXY, sZ = LMM_PROC.shrinkZ
  const t = greenChain('t', g.finThickness, 'xy', -2 * LMM_PROC.overpolyPx).cad / sXY
  const b = greenChain('b', g.gap, 'xy', +2 * LMM_PROC.overpolyPx).cad / sXY
  const H = greenChain('H', g.finHeight, 'z').cad / sZ
  const A = g.waveAmp > 0 ? greenChain('A', g.waveAmp, 'xy').cad / sXY : g.waveAmp
  const lam = g.waveAmp > 0 ? greenChain('λ', g.waveLen, 'xy').cad / sXY : g.waveLen
  return {
    geom: { ...g, finThickness: t, gap: b, finHeight: H, waveAmp: A, waveLen: lam },
    note: `reference adjusted for CAD stage: fin ${t.toFixed(3)} mm (−2 px), gap ${b.toFixed(3)} mm (+2 px), dims pixel-snapped`,
  }
}

export interface ScaleHint {
  suggestedScale: number | null
  suggestedStage: Stage | null
  rotate90: boolean
  hints: string[]
}

/**
 * Unit / stage / orientation hints from the raw bbox vs the expected final
 * envelope W×L×(base+H). Suggestions are worded, never silently applied
 * (spec §39-5) — except the centre/floor translation, which is reported.
 */
export function detectHints(
  raw: [number, number, number, number, number, number],
  g: ViewerGeom,
  stage: Stage,
  scale: number,
): ScaleHint {
  const dx = (raw[3] - raw[0]) * scale
  const dy = (raw[4] - raw[1]) * scale
  const dz = (raw[5] - raw[2]) * scale
  const W = g.coreWidth, L = g.coreLength, Hz = g.baseThickness + g.finHeight
  const hints: string[] = []
  let suggestedScale: number | null = null
  let suggestedStage: Stage | null = null

  const near = (a: number, b: number, tol: number): boolean => b > 0 && Math.abs(a / b - 1) < tol

  // orientation: envelope matches better with x/y swapped?
  const straight = Math.abs(dx - W) + Math.abs(dy - L)
  const swapped = Math.abs(dx - L) + Math.abs(dy - W)
  const rotate90 = W !== L && swapped < straight * 0.5

  const ex = rotate90 ? L : W
  const ey = rotate90 ? W : L
  if (rotate90) hints.push('the footprint matches the design rotated 90° about z — rotation applied (reported, not silent)')

  // unit guesses
  if (near(dx, ex / 1000, 0.02)) {
    suggestedScale = 1000
    hints.push('this body is ~1000× smaller than the design — STL carries no units; it was probably exported in metres. Suggested scale: ×1000.')
  } else if (near(dx, ex * 25.4, 0.02)) {
    suggestedScale = 1 / 25.4
    hints.push('this body is ~25.4× larger than the design — likely exported in inches. Suggested scale: ÷25.4.')
  }

  // stage guesses (only meaningful if units look right)
  const s = LMM_PROC.shrinkXY, sz = LMM_PROC.shrinkZ
  if (stage === 'final' && near(dx, ex * s, 0.01) && near(dy, ey * s, 0.01) && near(dz, Hz * sz, 0.02)) {
    suggestedStage = 'green'
    hints.push(`the body is ≈${((s - 1) * 100).toFixed(1)} % oversize in XY and ≈${((sz - 1) * 100).toFixed(1)} % in Z — this looks like a GREEN-stage export compared against the final design. Switch the stage selector to “green”.`)
  }
  if (stage !== 'final' && near(dx, ex, 0.01) && near(dy, ey, 0.01) && near(dz, Hz, 0.02)) {
    suggestedStage = 'final'
    hints.push('the body matches the FINAL envelope exactly — it does not look scaled. Switch the stage selector to “final part”.')
  }

  // height matches the fin band alone → the export skipped the base slab
  // (very common for nTop core-only rebuilds)
  const finOnly = near(dz, g.finHeight, 0.025) && !near(dz, Hz, 0.02)
  if (finOnly) {
    hints.push(
      `the body is ${dz.toFixed(2)} mm tall — that equals the design's FIN HEIGHT alone `
      + `(${g.finHeight.toFixed(2)} mm); the ${g.baseThickness.toFixed(2)} mm base slab looks absent from the export. `
      + `Tick “file has no base slab” to compare the core only.`)
  }

  // no unit/stage transform explains the size → spell out which axis differs
  // and why (the reference is the ACTIVE PROJECT's core + the selected
  // candidate's heights — not necessarily what the file was modelled on)
  if (suggestedScale == null && suggestedStage == null
    && (!near(dx, ex, 0.05) || !near(dy, ey, 0.05))) {
    const parts: string[] = []
    if (!near(dx, ex, 0.05)) parts.push(`width ${dx.toFixed(1)} vs the project's core_width ${ex.toFixed(1)} mm`)
    if (!near(dy, ey, 0.05)) parts.push(`length ${dy.toFixed(1)} vs core_length ${ey.toFixed(1)} mm`)
    hints.push(
      `footprint mismatch: ${parts.join(' · ')}. The reference envelope comes from the ACTIVE PROJECT's `
      + `core dimensions (◆ chip in the top bar), not from the file — if this part was modelled on a `
      + `${dx.toFixed(0)} × ${dy.toFixed(0)} core, switch to (or create in the Design Studio) a project with that `
      + `core size and select the matching candidate, then re-verify. Checks against the wrong footprint FAIL honestly.`)
  } else if (suggestedScale == null && suggestedStage == null && !finOnly && !near(dz, Hz, 0.08)) {
    hints.push(
      `height mismatch: the body is ${dz.toFixed(2)} mm tall vs the design's ${Hz.toFixed(2)} mm `
      + `(${g.baseThickness.toFixed(2)} base + ${g.finHeight.toFixed(2)} fins) — check the fin height and whether the `
      + `export includes the base slab.`)
  }

  return { suggestedScale, suggestedStage, rotate90, hints }
}
