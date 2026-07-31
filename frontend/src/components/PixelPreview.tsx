import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../format'
import { LMM_PROC, LMM_PX_RULES } from '../manufacturing'
import { geomFromCase } from '../viewerGeom'
import { PXF, LYF, gridDims, makeSolidAt } from '../verify/raster'
import { dilate1px, scanChannelNecks } from '../verify/necks'
import { stageRefGeom } from '../verify/stages'
import type { VerifyApi } from '../verify/useVerify'
import type { Basis, DesignState } from '../types'

// V3.3d — DLP pixel preview (spec §35D-7): the current design's cross-section
// rasterized onto the Hammer EVO35 exposure grid, exactly as a slicer layer
// mask. Sampling happens in FINAL (sintered) space at one printer pixel /
// layer mapped back through the shrink factors. Display polarity (2026-07-30):
// default = ⬛ ink view, black = material on white, matching Incus's guideline
// figures + review screenshots; toggle off for the raw exposure mask
// (white = exposed). Same mask, same measurements — colors only.
//
//   overpoly view: fins grow +1 px per side, channels lose 2 px — what an
//   UNcompensated print delivers. The CAD pre-compensation (fin −2 px,
//   channel +2 px) exists precisely to cancel this.
//   violations (Incus_Design_Guidelines.pdf, July 2026 — green px):
//     channel < 6 px red, 6–8 px dim red (deep-channel band, > 1 mm; the
//     shallow ≤ 1 mm band relaxes to 5 px), fin < 3 px orange, 3–4 px dim
//     orange (4–5 px recommended). Plus the 2026-07-29 email rule: gaps
//     must be WIDER than fins — flagged in the footer readout.
//
// V4.3 — compare-imported mode: when a file has been verified in the Verify
// tab, its slice at this layer is rasterized on the SAME grid (in the worker)
// and every pixel where the file disagrees with the design is painted magenta.
// The shared raster lives in verify/raster.ts so both sides use one geometry.
//
// ⌖ neck scan: shared implementation in verify/necks.ts (also used by the
// worker's whole-stack sweep) — any channel pixel a CH_MIN_PX-diameter disc
// cannot reach is a neck that will not be cleaned; works on the design's own
// raster AND the imported STL's.
const GRID_MIN_ZOOM = 6  // css px per printer pixel before grid lines appear

interface Stats {
  minChannelPx: number | null; minFinPx: number | null; solidPct: number; mismatch: number | null
  neckPx: number | null; neckWorst: number | null; neckWorstIdx: number | null
}
interface Hover { kind: 'fin' | 'channel' | 'base' | 'margin' | 'diff'; runPx: number; perpPx: number | null }

export function PixelPreview({
  design, basis, verify, initialLayer,
}: {
  design: DesignState
  basis: Basis
  verify?: VerifyApi | null
  initialLayer?: number | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [overpoly, setOverpoly] = useState(false)
  const [violations, setViolations] = useState(true)
  // ⬛ ink view (2026-07-30, default ON): black = material on white, the
  // polarity Incus's guideline figures and Paul's review screenshots use —
  // so this tab compares 1:1 against their slicer images. Off = raw DLP
  // exposure-mask polarity (white = exposed). Display only; the mask,
  // violation logic and readouts are identical in both.
  const [ink, setInk] = useState(true)
  const [compare, setCompare] = useState(initialLayer != null)
  // V4.3 — which geometry the layer image shows: the design's expected
  // exposure, or the imported STL's own slice rasterized on the same grid
  const [source, setSource] = useState<'design' | 'imported'>('design')
  // zoom = CSS px per printer pixel; null = fit-to-width. Wheel zooms toward
  // the cursor; drag pans (the wheel no longer scrolls).
  const [zoom, setZoom] = useState<number | null>(null)
  const zoomRef = useRef<number | null>(zoom)
  zoomRef.current = zoom
  const anchorRef = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)
  const [layer, setLayer] = useState<number | null>(initialLayer ?? null)
  const [stats, setStats] = useState<Stats>({ minChannelPx: null, minFinPx: null, solidPct: 0, mismatch: null, neckPx: null, neckWorst: null, neckWorstIdx: null })
  // ⌖ jump-to-worst-neck: zoom in, center the narrowest passage AND mark it
  // with a pulsing ring (li = the layer the mark belongs to — it hides when
  // the user scrolls to a different layer so it never points at stale data)
  const [focus, setFocus] = useState<{ i: number; j: number; li: number; n: number } | null>(null)
  // ⌖ stack scan (2026-07-30): the whole-stack sweep runs INSIDE the verify
  // worker (slice + rasterize + neck-scan per layer, only progress numbers
  // cross the thread) — see verify/worker.ts scanStack. The first version
  // round-tripped one mask per layer through React and took minutes; this
  // one is bounded by raw slicing speed. `stack` mirrors the worker state.
  const stack = verify?.stack ?? null
  const snappedTokenRef = useRef(0)
  // hover pixel-counter: the run under the cursor, so nobody has to count squares
  const [hover, setHover] = useState<Hover | null>(null)
  const maskRef = useRef<{ mask: Uint8Array; diff: Uint8Array | null; nx: number; ny: number; inBase: boolean; finPx: number | null; chPx: number | null } | null>(null)

  const g = useMemo(() => geomFromCase(design, basis), [design, basis])
  const dims = useMemo(() => (g ? gridDims(g) : null), [g])

  // Incus channel bounds are depth-dependent (guidelines §4): the fin zone's
  // green height (layers above the base × 25 µm) picks the band.
  const chDeep = dims == null
    || (dims.nLayers - dims.baseLayers) * LMM_PROC.layerMm > LMM_PX_RULES.deepChannelMmGreen
  const CH_MIN_PX = chDeep ? LMM_PX_RULES.chAbsPxDeep : LMM_PX_RULES.chAbsPxShallow
  const CH_REC_PX = chDeep ? LMM_PX_RULES.chRecPxDeep : LMM_PX_RULES.chRecPxShallow
  const FIN_MIN_PX = LMM_PX_RULES.finAbsPx
  const FIN_REC_PX = LMM_PX_RULES.finRecPx

  const hasImport = verify?.session.status === 'done' && verify.session.result != null
  const compareOn = compare && hasImport && verify != null
  const showImported = source === 'imported' && hasImport && verify != null
  // fins-only import: the worker's grid has no base layers — design layer li
  // maps to file layer li − baseLayers, and base layers have no file content
  const noBase = (hasImport && verify?.session.noBase) ?? false

  useEffect(() => { setLayer(initialLayer ?? null); if (initialLayer != null) setCompare(true) }, [initialLayer])
  // reset view when the DESIGN changes (skip mount, so a jump-to-layer from the
  // Verify tab isn't clobbered by this reset)
  const prevDesignRef = useRef(design.design_id)
  useEffect(() => {
    if (prevDesignRef.current === design.design_id) return
    prevDesignRef.current = design.design_id
    setLayer(null); setZoom(null)
    verify?.cancelStackScan()
  }, [design.design_id, verify])

  // when the worker's sweep completes, snap once to the worst layer + neck
  useEffect(() => {
    if (!stack || !stack.done || !dims || !verify) return
    if (snappedTokenRef.current === stack.token) return
    snappedTokenRef.current = stack.token
    if (stack.best) {
      const li2 = stack.best.fi + (noBase ? dims.baseLayers : 0)
      setLayer(li2)
      setZoom(10)
      const bi = stack.best.idx
      setFocus((prev) => ({ i: bi % dims.nx, j: Math.floor(bi / dims.nx), li: li2, n: (prev?.n ?? 0) + 1 }))
      verify.requestMask(stack.best.fi)   // fetch the winner's mask for display
    }
  }, [stack, dims, noBase, verify])

  const startScan = () => {
    if (!verify || !hasImport) return
    setSource('imported')
    // overpoly ticked → the sweep judges the PRINTED part (1 px/side grown)
    verify.scanStack(CH_MIN_PX, overpoly && !compareOn ? LMM_PROC.overpolyPx : 0)
  }

  // --- wheel = zoom toward the cursor (native listener: React's onWheel is
  // passive, so preventDefault would be ignored and the page would scroll) ---
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !dims) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const eff = zoomRef.current ?? Math.max(wrap.clientWidth, 1) / dims.nx
      const nz = Math.min(16, Math.max(0.1, eff * (e.deltaY < 0 ? 1.25 : 0.8)))
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      anchorRef.current = {
        fx: (wrap.scrollLeft + mx) / (dims.nx * eff),
        fy: (wrap.scrollTop + my) / (dims.ny * eff),
        mx, my,
      }
      setZoom(nz)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [dims])

  // keep the point under the cursor stationary after the zoom re-render
  useEffect(() => {
    const wrap = wrapRef.current
    const a = anchorRef.current
    if (!wrap || !dims || !a || zoom == null) return
    wrap.scrollLeft = a.fx * dims.nx * zoom - a.mx
    wrap.scrollTop = a.fy * dims.ny * zoom - a.my
    anchorRef.current = null
  }, [zoom, dims])

  // center the jump-to-neck target once the zoom has been applied
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !dims || !focus || zoom == null) return
    wrap.scrollLeft = (focus.i + 0.5) * zoom - wrap.clientWidth / 2
    wrap.scrollTop = (focus.j + 0.5) * zoom - wrap.clientHeight / 2
  }, [focus, zoom, dims])

  // --- drag = pan ---
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let drag: { x: number; y: number; sl: number; st: number } | null = null
    const down = (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 1) return
      drag = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }
      wrap.classList.add('panning')
      e.preventDefault()
    }
    const move = (e: MouseEvent) => {
      if (!drag) return
      wrap.scrollLeft = drag.sl - (e.clientX - drag.x)
      wrap.scrollTop = drag.st - (e.clientY - drag.y)
    }
    const up = () => { drag = null; wrap.classList.remove('panning') }
    wrap.addEventListener('mousedown', down)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      wrap.removeEventListener('mousedown', down)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const li = dims == null ? 0 : (layer ?? Math.min(dims.nLayers - 1, dims.baseLayers + Math.floor((dims.nLayers - dims.baseLayers) / 2)))

  // request the imported mask for the current layer when comparing or when
  // the layer image itself shows the imported STL
  const liFile = noBase && dims ? li - dims.baseLayers : li
  useEffect(() => {
    if ((!compareOn && !showImported) || !verify) return
    if (liFile < 0) return // fins-only file: nothing exists below the base top
    if (verify.mask && verify.mask.layer === liFile) return // already have it — don't re-slice
    verify.requestMask(liFile)
  }, [compareOn, showImported, li, liFile, verify])
  const importedMask = (compareOn || showImported) && liFile >= 0
    && verify?.mask && verify.mask.layer === liFile ? verify.mask : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !g || !dims) return
    const { nx, ny } = dims
    const zF = (li + 0.5) * LYF
    const inBase = zF < g.baseThickness

    canvas.width = nx
    canvas.height = ny
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(nx, ny)
    const data = img.data

    // overpoly widens each solid feature by 1 green px per side. On the
    // design it's the analytic comp shift; on the imported STL it's a 1-px
    // dilation of the file's own raster (below). Locked only while the diff
    // is on — a comparison must show both sides exactly as they are.
    const comp = overpoly && !compareOn && !showImported ? 2 * LMM_PROC.overpolyPx * PXF : 0
    const halfW = g.coreWidth / 2
    const halfL = g.coreLength / 2
    const solidAt = makeSolidAt(g, zF, comp)

    // pass 1 — the DISPLAYED mask: the imported STL's slice when that source
    // is selected (falling back to the design while the worker is slicing),
    // otherwise the design's expected exposure
    const importedReady = importedMask != null && importedMask.nx === nx && importedMask.ny === ny
    const displayImported = showImported && importedReady
    let mask: Uint8Array
    let solidCount = 0
    if (displayImported) {
      mask = importedMask!.imported
      // overpoly what-if on the real file: grow its features 1 px per side —
      // "the real channels will be even smaller" (Peritsch 2026-07-29)
      if (overpoly && !compareOn) mask = dilate1px(mask, nx, ny)
      for (let i = 0; i < mask.length; i++) solidCount += mask[i]
    } else {
      mask = new Uint8Array(nx * ny)
      for (let j = 0; j < ny; j++) {
        const y = -halfL + (j + 0.5) * PXF
        for (let i = 0; i < nx; i++) {
          const x = -halfW + (i + 0.5) * PXF
          const s = solidAt(x, y) ? 1 : 0
          mask[j * nx + i] = s
          solidCount += s
        }
      }
    }

    // V4.3 — diff vs the imported file's slice (worker raster, same grid).
    // Expected side uses the STAGE-ADJUSTED reference (a CAD-stage file is
    // legitimately −2 px on fins; that must not read as mismatch).
    let diff: Uint8Array | null = null
    let mismatch: number | null = null
    if (compareOn && importedReady) {
      const stage = verify?.session.stage ?? 'final'
      let ref = stageRefGeom(g, stage).geom
      let zRef = zF
      if (noBase) {
        // fins-only file: its grid starts at the base top — evaluate the
        // base-less reference at the file's own height
        ref = { ...ref, baseThickness: 0 }
        zRef = zF - g.baseThickness
      }
      let expected: Uint8Array
      if (ref !== g || displayImported) {
        // recompute the design side analytically (the displayed mask may BE
        // the imported one, and cad-stage references differ from the sliders)
        expected = new Uint8Array(nx * ny)
        const refSolid = makeSolidAt(ref, zRef, 0)
        for (let j = 0; j < ny; j++) {
          const y = -halfL + (j + 0.5) * PXF
          for (let i = 0; i < nx; i++) {
            expected[j * nx + i] = refSolid(-halfW + (i + 0.5) * PXF, y) ? 1 : 0
          }
        }
      } else {
        expected = mask
      }
      diff = new Uint8Array(nx * ny)
      mismatch = 0
      for (let i = 0; i < diff.length; i++) {
        if (importedMask!.imported[i] !== expected[i]) { diff[i] = 1; mismatch++ }
      }
    }

    // pass 2 — violation tint + min feature sizes.
    // Fin families have constant TRUE (perpendicular) widths by construction, so
    // they are judged ANALYTICALLY: fin = t ± comp, channel = b ∓ comp. A per-row
    // run scan would measure the horizontal CHORD across a slanted wavy fin —
    // stair-step rasterization makes 1-px chord artifacts that are not real
    // features. TPMS/pin have no constant width, so they keep the run heuristic.
    // Analytic widths only apply to the DESIGN's mask — the imported STL has
    // no constant-width guarantee, so it keeps the run heuristic (like TPMS).
    const analyticW = g.family !== 'gyroid_tpms' && !displayImported
    const finPx = analyticW ? (g.finThickness + comp) / PXF : null
    const chPx = analyticW ? (g.gap - comp) / PXF : null
    const finBadA = finPx != null && finPx < FIN_MIN_PX
    const finWarnA = finPx != null && finPx < FIN_REC_PX
    const chBadA = chPx != null && chPx < CH_MIN_PX
    const chWarnA = chPx != null && chPx < CH_REC_PX
    let minCh: number | null = analyticW && !inBase ? Math.round((chPx as number) * 10) / 10 : null
    let minFin: number | null = analyticW && !inBase ? Math.round((finPx as number) * 10) / 10 : null
    const paint = (idx: number, r: number, gr: number, b: number) => {
      const o = idx * 4
      data[o] = r; data[o + 1] = gr; data[o + 2] = b; data[o + 3] = 255
    }
    for (let j = 0; j < ny; j++) {
      let i = 0
      while (i < nx) {
        const v = mask[j * nx + i]
        let end = i
        while (end < nx && mask[j * nx + end] === v) end++
        const run = end - i
        const interior = i > 0 && end < nx
        if (!inBase && interior && !analyticW) {
          if (v === 0) { if (minCh == null || run < minCh) minCh = run }
          else if (v === 1) { if (minFin == null || run < minFin) minFin = run }
        }
        const chBad = violations && !inBase && interior && v === 0
          && (analyticW ? chBadA : run < CH_MIN_PX)
        const chWarn = violations && !inBase && interior && v === 0
          && (analyticW ? chWarnA : run < CH_REC_PX)
        const finBad = violations && !inBase && interior && v === 1
          && (analyticW ? finBadA : run < FIN_MIN_PX)
        const finWarn = violations && !inBase && interior && v === 1
          && (analyticW ? finWarnA : run < FIN_REC_PX)
        for (let p = i; p < end; p++) {
          const idx = j * nx + p
          if (chBad) paint(idx, 248, 81, 73)          // channel below the abs floor — red
          else if (finBad) {                          // fin below the abs floor — orange
            if (ink) paint(idx, 196, 138, 40); else paint(idx, 217, 164, 65)
          } else if (chWarn) {                        // channel inside the band but < rec — dim red
            if (ink) paint(idx, 231, 146, 138); else paint(idx, 96, 42, 38)
          } else if (finWarn) {                       // fin printable but < rec — dulled material
            if (ink) paint(idx, 96, 86, 58); else paint(idx, 178, 168, 150)
          } else if (v === 1) {                       // material (ink: black, exposure: white)
            if (ink) paint(idx, 30, 32, 36); else paint(idx, 235, 235, 238)
          } else {                                    // gap / void
            if (ink) paint(idx, 246, 246, 248); else paint(idx, 12, 14, 18)
          }
        }
        i = end
      }
    }
    // ⌖ neck scan — the local passages Incus's bitmap review flags ("only
    // 2 px in some areas"): channel pixels a CH_MIN_PX disc cannot reach.
    // Runs on whichever mask is displayed (design raster or imported STL).
    let neck: ReturnType<typeof scanChannelNecks> | null = null
    if (violations && !inBase) {
      neck = scanChannelNecks(mask, nx, ny, CH_MIN_PX)
      for (let idx = 0; idx < neck.flags.length; idx++) {
        if (neck.flags[idx]) paint(idx, 255, 64, 96)   // neck — bright red-pink
      }
    }
    // diff overlay on top — magenta where the imported file disagrees
    if (diff) {
      for (let idx = 0; idx < diff.length; idx++) {
        if (diff[idx]) paint(idx, 232, 62, 200)
      }
    }
    ctx.putImageData(img, 0, 0)
    maskRef.current = { mask, diff, nx, ny, inBase, finPx, chPx }
    setStats({
      minChannelPx: minCh, minFinPx: minFin, solidPct: (solidCount / (nx * ny)) * 100, mismatch,
      neckPx: neck ? neck.count : null,
      neckWorst: neck && neck.count > 0 ? neck.worstPx : null,
      neckWorstIdx: neck && neck.count > 0 ? neck.worstIdx : null,
    })
  }, [g, dims, li, overpoly, violations, ink, importedMask, compareOn, showImported, noBase, verify, CH_MIN_PX])

  // hover = count the pixels for the user: which feature is under the cursor
  // and how many printer pixels wide its run is in this row.
  const onHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const m = maskRef.current
    if (!canvas || !m) return
    const scale = canvas.clientWidth / m.nx
    const i = Math.floor(e.nativeEvent.offsetX / scale)
    const j = Math.floor(e.nativeEvent.offsetY / scale)
    if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) { setHover(null); return }
    if (m.diff && m.diff[j * m.nx + i]) { setHover({ kind: 'diff', runPx: 0, perpPx: null }); return }
    if (m.inBase) { setHover({ kind: 'base', runPx: 0, perpPx: null }); return }
    const v = m.mask[j * m.nx + i]
    let a = i; while (a > 0 && m.mask[j * m.nx + a - 1] === v) a--
    let b = i; while (b < m.nx - 1 && m.mask[j * m.nx + b + 1] === v) b++
    const runPx = b - a + 1
    const edge = a === 0 || b === m.nx - 1
    setHover({
      kind: v === 1 ? 'fin' : edge ? 'margin' : 'channel',
      runPx,
      perpPx: v === 1 ? maskRef.current!.finPx : maskRef.current!.chPx,
    })
  }

  if (!g || !dims) return <div className="muted" style={{ padding: 14 }}>No geometry.</div>

  const { nLayers, baseLayers } = dims
  const zF = (li + 0.5) * LYF
  const chOk = stats.minChannelPx == null || stats.minChannelPx >= CH_MIN_PX
  const chRec = stats.minChannelPx == null || stats.minChannelPx >= CH_REC_PX
  const finOk = stats.minFinPx == null || stats.minFinPx >= FIN_MIN_PX
  const finRec = stats.minFinPx == null || stats.minFinPx >= FIN_REC_PX
  // Incus 2026-07-29: gaps must be wider than fins (judged on the nominal px)
  const ratioBad = stats.minFinPx != null && stats.minChannelPx != null
    && stats.minFinPx > stats.minChannelPx
  const mismatchPct = stats.mismatch != null ? (stats.mismatch / (dims.nx * dims.ny)) * 100 : null

  return (
    <div className="pxv">
      <div className="pxv-bar">
        <span className="pxv-title">▦ DLP layer preview <span className="muted">EVO35 · 35 µm px · 25 µm layer (green)</span></span>
        {hasImport && (
          <span className="pxv-t pxv-src" title="which geometry the layer image shows — the design's expected exposure, or the verified STL's own slice on the same grid">
            layer shows
            <button className={source === 'design' ? 'sel' : ''} onClick={() => setSource('design')}>design</button>
            <button className={source === 'imported' ? 'sel' : ''} onClick={() => setSource('imported')}>imported STL</button>
          </span>
        )}
        <label className="pxv-t" title={compareOn
          ? 'overpoly is locked while the diff is on — a comparison must show both sides exactly as they are'
          : showImported
            ? 'what-if on the imported file: every feature grows ~1 px per side (uncompensated print) — the neck scan then judges the PRINTED part'
            : 'what-if on the design: fins +2 px, channels −2 px — what an uncompensated print delivers'}>
          <input type="checkbox" checked={overpoly && !compareOn} disabled={compareOn}
            onChange={(e) => setOverpoly(e.target.checked)} />
          overpoly (uncompensated print)</label>
        <label className="pxv-t"><input type="checkbox" checked={violations} onChange={(e) => setViolations(e.target.checked)} />
          violations</label>
        <label className="pxv-t"
          title="black = material on white, the polarity of Incus's guideline figures and review screenshots — untick for the raw DLP exposure-mask view (white = exposed). Display only; measurements are identical.">
          <input type="checkbox" checked={ink} onChange={(e) => setInk(e.target.checked)} />
          ⬛ ink (Incus)</label>
        {hasImport && (
          <span className="pxv-t">
            {stack?.running
              ? <>
                  ⌖ scanning {stack.total > 0 ? `${Math.min(stack.fi + 1, stack.total)}/${stack.total}` : '…'}
                  {stack.best && <> · worst ≈ {stack.best.worstPx} px</>}
                  <button className="pxv-fit" onClick={() => verify?.cancelStackScan()}>cancel</button>
                </>
              : <button className="pxv-fit" onClick={startScan}
                  title="slice the imported STL on EVERY layer, neck-scan each (all inside the worker), then jump to the worst layer and its narrowest passage — the automated Incus review">
                  ⌖ scan all layers
                </button>}
          </span>
        )}
        {hasImport && (
          <label className="pxv-t" title="paint every pixel where the verified STL disagrees with the design's expected exposure">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            <span style={{ color: 'rgb(232,62,200)' }}>■</span> diff
          </label>
        )}
        <span className="pxv-t" title="scroll wheel = zoom toward the cursor · drag = pan">
          zoom <b className="pxv-zoom">{zoom == null ? 'fit' : `${Math.round(zoom * 100)}%`}</b>
          <button className="pxv-fit" onClick={() => setZoom(null)} disabled={zoom == null}>fit</button>
        </span>
      </div>

      <div className="pxv-canvas-wrap" ref={wrapRef}>
        <div className="pxv-stage" style={zoom == null ? { width: '100%' } : { width: dims.nx * zoom }}>
          <canvas ref={canvasRef} className="pxv-canvas" style={{ width: '100%' }}
            onMouseMove={onHover} onMouseLeave={() => setHover(null)} />
          {zoom != null && zoom >= GRID_MIN_ZOOM && (
            <div className="pxv-grid" style={{ backgroundSize: `${zoom}px ${zoom}px` }} />
          )}
          {focus != null && zoom != null && focus.li === li && (
            <div className="pxv-mark"
              title="⌖ the narrowest passage — the pixel 'show' / the stack scan landed on"
              style={{ left: (focus.i + 0.5) * zoom, top: (focus.j + 0.5) * zoom }} />
          )}
        </div>
      </div>

      <div className="pxv-bar pxv-foot">
        <input type="range" min={0} max={nLayers - 1} step={1} value={li}
          onChange={(e) => setLayer(Number(e.target.value))} title="build layer (25 µm green)" />
        <span className="pxv-stat">layer <b>{li + 1}</b>/{nLayers} · z {fmt(zF, 2)} mm{li < baseLayers ? ' · base slab' : ''}</span>
        {li < baseLayers && (
          <span className="pxv-stat muted"
            title="base-slab layers are fully exposed — design and imported STL look identical here, and violation/neck tints only apply to the fin zone">
            base slab: fully solid — slide the layer above {baseLayers} to see fins, violations & necks
          </span>
        )}
        <span className="pxv-stat" style={{ color: chOk ? (chRec ? undefined : 'var(--warn, #d9a441)') : 'var(--fail)' }}>
          channel <b>{stats.minChannelPx ?? '—'} px</b>{stats.minChannelPx != null ? ` (${fmt(stats.minChannelPx * LMM_PROC.pixelMm, 3)} mm green, need ≥ ${CH_MIN_PX}, rec ${CH_REC_PX})` : ''}
        </span>
        <span className="pxv-stat" style={{ color: finOk ? (finRec ? undefined : 'var(--warn, #d9a441)') : 'var(--fail)' }}>
          fin <b>{stats.minFinPx ?? '—'} px</b>{stats.minFinPx != null ? ` (need ≥ ${FIN_MIN_PX}, rec ${FIN_REC_PX}–5)` : ''}
        </span>
        {ratioBad && (
          <span className="pxv-stat" style={{ color: 'var(--fail)' }} title="Incus (2026-07-29): gaps should be wider than fins — overpolymerisation narrows the printed channel further">
            ✗ fins wider than gaps
          </span>
        )}
        {overpoly && !compareOn && !showImported && (
          <span className="pxv-stat" style={{ color: 'var(--warn, #d9a441)' }}
            title="this view = printing the NOMINAL geometry with no CAD compensation. Draw the ⇄ CAD values instead (fin −2 px, gap +2 px) and the print comes out as the unticked view — red here means 'don't skip the compensation', not 'the design is wrong'">
            ⚠ uncompensated what-if — the ⇄ CAD compensation cancels this
          </span>
        )}
        {stack?.done && (stack.best
          ? <span className="pxv-stat" style={{ color: 'rgb(255,64,96)' }}
              title="the layer with the narrowest channel passage across the whole imported stack — view jumped to it">
              ⌖ stack: worst layer <b>{stack.best.fi + (noBase ? baseLayers : 0) + 1}</b> · neck ≈ <b>{stack.best.worstPx} px</b> ({stack.best.count.toLocaleString()} px flagged)
            </span>
          : <span className="pxv-stat" style={{ color: 'var(--pass)' }}>
              ✓ stack scan: no necks &lt; {CH_MIN_PX} px in any of {stack.total} layers
            </span>)}
        {stats.neckPx != null && (stats.neckPx > 0
          ? <span className="pxv-stat" style={{ color: 'rgb(255,64,96)' }}
              title="local passages a 6-px disc cannot get through — the 'cross section only 2 px' areas Incus flags; off-grid rounding + stair-step phasing neck the drawn channel below its nominal width">
              ⌖ necks: <b>{stats.neckPx.toLocaleString()} px</b> below {CH_MIN_PX} px (worst ≈ {stats.neckWorst} px)
              <button className="pxv-fit" style={{ marginLeft: 6 }}
                onClick={() => {
                  if (stats.neckWorstIdx == null || !dims) return
                  setZoom(10)
                  setFocus({ i: stats.neckWorstIdx % dims.nx,
                    j: Math.floor(stats.neckWorstIdx / dims.nx), li, n: (focus?.n ?? 0) + 1 })
                }}>show</button>
            </span>
          : <span className="pxv-stat" style={{ color: 'var(--pass)' }}
              title="every channel passage on this layer admits a 6-px disc — no local necks">
              ✓ no necks &lt; {CH_MIN_PX} px
            </span>)}
        <span className="pxv-stat muted">{fmt(stats.solidPct, 0)}% exposed</span>
        {showImported && (
          <span className="pxv-stat" style={{ color: 'var(--accent)' }}>
            {noBase && liFile < 0 ? 'file has no base slab — nothing below the base top (showing the design)'
              : importedMask ? '⬒ showing the imported STL' : 'slicing STL layer…'}
          </span>
        )}
        {compareOn && (
          <span className="pxv-stat" style={{ color: stats.mismatch ? 'rgb(232,62,200)' : 'var(--pass)' }}>
            {noBase && liFile < 0 ? 'diff: file has no base slab — nothing to compare on base layers'
              : stats.mismatch == null ? 'diff: slicing…'
              : stats.mismatch === 0 ? '✓ file matches this layer pixel-for-pixel — no magenta is the good outcome'
              : <>file differs in <b>{stats.mismatch.toLocaleString()}</b> px ({fmt(mismatchPct!, 3)} %)</>}
          </span>
        )}
        <span className="pxv-stat pxv-hover">
          {hover == null ? 'hover a feature to measure it'
            : hover.kind === 'diff' ? <b style={{ color: 'rgb(232,62,200)' }}>imported file disagrees here</b>
            : hover.kind === 'base' ? 'base slab — fully exposed'
            : hover.kind === 'margin' ? 'side margin'
            : <>▸ <b>{hover.kind}</b>{hover.perpPx != null
                ? <>: true width <b>{fmt(hover.perpPx, 1)} px</b> ({fmt(hover.perpPx * LMM_PROC.pixelMm, 3)} mm green){hover.runPx !== Math.round(hover.perpPx) ? ` · ${hover.runPx} px across this row (slanted cut)` : ''}</>
                : <>: <b>{hover.runPx} px</b> across this row ({fmt(hover.runPx * LMM_PROC.pixelMm, 3)} mm green)</>}</>}
        </span>
      </div>
      <div className="pxv-note muted">
        {ink
          ? <><b>Ink view</b>: black = material, white = gap — the same polarity as Incus's guideline
            figures and Paul's review screenshots, so this image compares 1:1 with theirs. </>
          : <><b>Exposure view</b>: white = exposed (what the projector shines), dark = void. </>}
        Final-space raster at one printer pixel (35 µm ÷ 1.197 shrink). Overpoly ON shows an
        <b> uncompensated</b> print: fins +2 px, channels −2 px (≈ 25–35 µm per side) — the CAD
        pre-compensation (fin −2 px, channel +2 px) exists to cancel exactly this.
        Bounds per <b>Incus Design Guidelines (July 2026, green px)</b>: red = channel &lt; {CH_MIN_PX} px
        ({chDeep ? 'won’t be cleaned at this depth — channels > 1 mm deep need 6–8 px' : 'below the ≤ 1 mm shallow floor'}),
        dim red = inside the band but under the {CH_REC_PX} px recommendation; orange = fin &lt; {FIN_MIN_PX} px
        (below the printable minimum), dulled fin = under the {FIN_REC_PX}–5 px reliability band. Incus also
        asks that <b>gaps be wider than fins</b> (2026-07-29) — the footer flags it.
        <b style={{ color: 'rgb(255,64,96)' }}> Bright pink</b> = the ⌖ <b>neck scan</b>: local channel
        passages a {CH_MIN_PX} px disc cannot get through — Incus reviews this same bitmap and these
        are exactly their "cross section only 2 px" findings (off-grid rounding + stair-step phasing
        neck a channel below its nominal width; overpoly then closes it). "show" jumps to the worst
        one on this layer; with an imported STL, <b>⌖ scan all layers</b> sweeps the whole stack and
        snaps straight to the worst layer + passage. Zoom past {GRID_MIN_ZOOM * 100}%
        for the pixel grid; hover any feature to read its width without counting.
        {compareOn && <> <b style={{ color: 'rgb(232,62,200)' }}>Magenta</b> = the verified STL and the
          design disagree on this pixel — single-pixel flicker along slanted edges is quantization;
          full rows or shapes are real geometry differences.</>}
        {showImported && <> Layer image = the <b>imported STL</b> sliced and rasterized on the same
          grid — what the printer would expose if it printed the file as-is. Min-width readouts and
          violation tints run on the STL's pixels (run-scan; no analytic widths for a mesh). With
          overpoly ON, the file's features are grown 1 px per side first — readouts, necks and the
          stack scan then judge the <b>printed</b> part, not the drawn one.</>}
      </div>
    </div>
  )
}
