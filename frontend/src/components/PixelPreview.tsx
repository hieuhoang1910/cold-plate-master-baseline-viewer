import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../format'
import { LMM_PROC } from '../manufacturing'
import { geomFromCase } from '../viewerGeom'
import type { Basis, DesignState } from '../types'

// V3.3d — DLP pixel preview (spec §35D-7): the current design's cross-section
// rasterized onto the Hammer EVO35 exposure grid, exactly as a slicer layer
// mask. Sampling happens in FINAL (sintered) space at one printer pixel /
// layer mapped back through the shrink factors (equivalent to rasterizing the
// green part on the physical 35 µm / 25 µm grid). White = exposed (solid).
//
//   overpoly view: fins grow +1 px per side, channels lose 2 px — what an
//   UNcompensated print delivers. The CAD pre-compensation (fin −2 px,
//   channel +2 px) exists precisely to cancel this.
//   violations:    channel runs < 6 px red (Incus deep-channel band),
//                  fin runs < 3 px orange (min printed fin).

const CH_MIN_PX = 6   // Incus deep-channel recommendation (green px)
const FIN_MIN_PX = 3  // Incus minimum printed fin (green px)
const GRID_MIN_ZOOM = 6  // css px per printer pixel before grid lines appear

interface Stats { minChannelPx: number | null; minFinPx: number | null; solidPct: number }
interface Hover { kind: 'fin' | 'channel' | 'base' | 'margin'; runPx: number; perpPx: number | null }

export function PixelPreview({ design, basis }: { design: DesignState; basis: Basis }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [overpoly, setOverpoly] = useState(false)
  const [violations, setViolations] = useState(true)
  // zoom = CSS px per printer pixel; null = fit-to-width. Wheel zooms toward
  // the cursor; drag pans (the wheel no longer scrolls).
  const [zoom, setZoom] = useState<number | null>(null)
  const zoomRef = useRef<number | null>(zoom)
  zoomRef.current = zoom
  const anchorRef = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)
  const [layer, setLayer] = useState<number | null>(null) // null = mid fin band
  const [stats, setStats] = useState<Stats>({ minChannelPx: null, minFinPx: null, solidPct: 0 })
  // hover pixel-counter: the run under the cursor, so nobody has to count squares
  const [hover, setHover] = useState<Hover | null>(null)
  const maskRef = useRef<{ mask: Uint8Array; nx: number; ny: number; inBase: boolean; finPx: number | null; chPx: number | null } | null>(null)

  const g = useMemo(() => geomFromCase(design, basis), [design, basis])

  // final-space sample pitch = one green pixel / layer through the shrink
  const pxF = LMM_PROC.pixelMm / LMM_PROC.shrinkXY      // ≈ 0.02924 mm
  const lyF = LMM_PROC.layerMm / LMM_PROC.shrinkZ       // ≈ 0.02033 mm

  const dims = useMemo(() => {
    if (!g) return null
    const nx = Math.round(g.coreWidth / pxF)            // transverse (fin count axis)
    const ny = Math.round(g.coreLength / pxF)           // flow path
    const nLayers = Math.max(1, Math.round((g.baseThickness + g.finHeight) / lyF))
    const baseLayers = Math.round(g.baseThickness / lyF)
    return { nx, ny, nLayers, baseLayers }
  }, [g, pxF, lyF])

  useEffect(() => { setLayer(null); setZoom(null) }, [design.design_id])

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !g || !dims) return
    const { nx, ny, nLayers, baseLayers } = dims
    const li = layer ?? Math.min(nLayers - 1, baseLayers + Math.floor((nLayers - baseLayers) / 2))
    const zF = (li + 0.5) * lyF
    const inBase = zF < g.baseThickness

    canvas.width = nx
    canvas.height = ny
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(nx, ny)
    const data = img.data

    // overpoly widens each solid feature by 1 green px per side (in final mm)
    const comp = overpoly ? 2 * LMM_PROC.overpolyPx * pxF : 0
    const halfW = g.coreWidth / 2
    const halfL = g.coreLength / 2
    const fieldHalf = halfW - g.sideMargin
    const pitch = g.finThickness + g.gap
    const tEff = g.finThickness + comp
    const wallEff = g.wallThickness + comp
    const pinREff = g.pinDiameter / 2 + comp / 2
    const TWO_PI = Math.PI * 2

    const solidAt = (x: number, y: number): boolean => {
      if (inBase) return true                                // base slab layer
      if (g.family !== 'gyroid_tpms') {
        // wavy / straight fin field (+ centre rib box)
        if (g.ribWidth > 0 && Math.abs(y) <= g.ribWidth / 2) return true
        if (Math.abs(x) > fieldHalf) return false
        const xw = x - g.waveAmp * Math.sin(TWO_PI * y / g.waveLen)
        const m = ((xw % pitch) + pitch * 1.5 + pitch / 2) % pitch - pitch / 2
        return Math.abs(m) <= tEff / 2
      }
      if (g.isPin) {
        const pp = Math.max(g.pinPitch, 0.1)
        const rowY = Math.floor(y / pp + 0.5)
        const xoff = g.pinStagger ? (((rowY % 2) + 2) % 2) * 0.5 * pp : 0
        const qx = ((x + xoff) % pp + pp * 1.5 + pp / 2) % pp - pp / 2
        const qy = (y % pp + pp * 1.5 + pp / 2) % pp - pp / 2
        return Math.hypot(qx, qy) <= pinREff
      }
      // TPMS sheet/solid with jet-adaptive radial grading (matches the shader law)
      const R = 0.5 * Math.min(g.coreWidth, g.coreLength)
      const rr = Math.hypot(x, y)
      const cLocal = Math.max(g.unitCell * (1 + g.grading * (Math.min(Math.max(rr / Math.max(R, 1e-3), 0), 1.5) - 0.5)), 0.3)
      const k = TWO_PI / cLocal
      const xk = k * x, yk = k * y, zk = k * zF
      let F: number
      switch (g.tpmsType) {
        case 'diamond':
          F = Math.sin(xk) * Math.sin(yk) * Math.sin(zk) + Math.sin(xk) * Math.cos(yk) * Math.cos(zk)
            + Math.cos(xk) * Math.sin(yk) * Math.cos(zk) + Math.cos(xk) * Math.cos(yk) * Math.sin(zk)
          break
        case 'schwarz_p':
          F = Math.cos(xk) + Math.cos(yk) + Math.cos(zk)
          break
        default: // gyroid (exotic types preview as gyroid, like TPMS_IDX fallback)
          F = Math.cos(xk) * Math.sin(yk) + Math.cos(yk) * Math.sin(zk) + Math.cos(zk) * Math.sin(xk)
      }
      const iso = Math.min(Math.max(wallEff * Math.PI / cLocal, 0.06), 1.2)
      return g.solid ? F <= iso : Math.abs(F) <= iso
    }

    // pass 1 — rasterize
    const mask = new Uint8Array(nx * ny)
    let solidCount = 0
    for (let j = 0; j < ny; j++) {
      const y = -halfL + (j + 0.5) * pxF
      for (let i = 0; i < nx; i++) {
        const x = -halfW + (i + 0.5) * pxF
        const s = solidAt(x, y) ? 1 : 0
        mask[j * nx + i] = s
        solidCount += s
      }
    }

    // pass 2 — violation tint + min feature sizes.
    // Fin families have constant TRUE (perpendicular) widths by construction, so
    // they are judged ANALYTICALLY: fin = t ± comp, channel = b ∓ comp. A per-row
    // run scan would measure the horizontal CHORD across a slanted wavy fin —
    // stair-step rasterization makes 1-px chord artifacts that are not real
    // features. TPMS/pin have no constant width, so they keep the run heuristic.
    const isFinFamily = g.family !== 'gyroid_tpms'
    const finPx = isFinFamily ? (g.finThickness + comp) / pxF : null
    const chPx = isFinFamily ? (g.gap - comp) / pxF : null
    const finBadA = finPx != null && finPx < FIN_MIN_PX
    const chBadA = chPx != null && chPx < CH_MIN_PX
    let minCh: number | null = isFinFamily && !inBase ? Math.round((chPx as number) * 10) / 10 : null
    let minFin: number | null = isFinFamily && !inBase ? Math.round((finPx as number) * 10) / 10 : null
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
        if (!inBase && interior && !isFinFamily) {
          if (v === 0) { if (minCh == null || run < minCh) minCh = run }
          else if (v === 1) { if (minFin == null || run < minFin) minFin = run }
        }
        const chBad = violations && !inBase && interior && v === 0
          && (isFinFamily ? chBadA : run < CH_MIN_PX)
        const finBad = violations && !inBase && interior && v === 1
          && (isFinFamily ? finBadA : run < FIN_MIN_PX)
        for (let p = i; p < end; p++) {
          const idx = j * nx + p
          if (chBad) paint(idx, 248, 81, 73)          // channel too narrow — red
          else if (finBad) paint(idx, 217, 164, 65)   // fin too thin — orange
          else if (v === 1) paint(idx, 235, 235, 238) // exposed / solid
          else paint(idx, 12, 14, 18)                 // void
        }
        i = end
      }
    }
    ctx.putImageData(img, 0, 0)
    maskRef.current = { mask, nx, ny, inBase, finPx, chPx }
    setStats({ minChannelPx: minCh, minFinPx: minFin, solidPct: (solidCount / (nx * ny)) * 100 })
  }, [g, dims, layer, overpoly, violations, lyF, pxF])

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
  const li = layer ?? Math.min(nLayers - 1, baseLayers + Math.floor((nLayers - baseLayers) / 2))
  const zF = (li + 0.5) * lyF
  const chOk = stats.minChannelPx == null || stats.minChannelPx >= CH_MIN_PX
  const finOk = stats.minFinPx == null || stats.minFinPx >= FIN_MIN_PX

  return (
    <div className="pxv">
      <div className="pxv-bar">
        <span className="pxv-title">▦ DLP layer preview <span className="muted">EVO35 · 35 µm px · 25 µm layer (green)</span></span>
        <label className="pxv-t"><input type="checkbox" checked={overpoly} onChange={(e) => setOverpoly(e.target.checked)} />
          overpoly (uncompensated print)</label>
        <label className="pxv-t"><input type="checkbox" checked={violations} onChange={(e) => setViolations(e.target.checked)} />
          violations</label>
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
        </div>
      </div>

      <div className="pxv-bar pxv-foot">
        <input type="range" min={0} max={nLayers - 1} step={1} value={li}
          onChange={(e) => setLayer(Number(e.target.value))} title="build layer (25 µm green)" />
        <span className="pxv-stat">layer <b>{li + 1}</b>/{nLayers} · z {fmt(zF, 2)} mm{li < baseLayers ? ' · base slab' : ''}</span>
        <span className="pxv-stat" style={{ color: chOk ? undefined : 'var(--fail)' }}>
          channel <b>{stats.minChannelPx ?? '—'} px</b>{stats.minChannelPx != null ? ` (${fmt(stats.minChannelPx * LMM_PROC.pixelMm, 3)} mm green, need ≥ ${CH_MIN_PX})` : ''}
        </span>
        <span className="pxv-stat" style={{ color: finOk ? undefined : 'var(--warn, #d9a441)' }}>
          fin <b>{stats.minFinPx ?? '—'} px</b>{stats.minFinPx != null ? ` (need ≥ ${FIN_MIN_PX})` : ''}
        </span>
        <span className="pxv-stat muted">{fmt(stats.solidPct, 0)}% exposed</span>
        <span className="pxv-stat pxv-hover">
          {hover == null ? 'hover a feature to measure it'
            : hover.kind === 'base' ? 'base slab — fully exposed'
            : hover.kind === 'margin' ? 'side margin'
            : <>▸ <b>{hover.kind}</b>{hover.perpPx != null
                ? <>: true width <b>{fmt(hover.perpPx, 1)} px</b> ({fmt(hover.perpPx * LMM_PROC.pixelMm, 3)} mm green){hover.runPx !== Math.round(hover.perpPx) ? ` · ${hover.runPx} px across this row (slanted cut)` : ''}</>
                : <>: <b>{hover.runPx} px</b> across this row ({fmt(hover.runPx * LMM_PROC.pixelMm, 3)} mm green)</>}</>}
        </span>
      </div>
      <div className="pxv-note muted">
        Final-space raster at one printer pixel (35 µm ÷ 1.197 shrink). Overpoly ON shows an
        <b> uncompensated</b> print: fins +2 px, channels −2 px — the CAD pre-compensation
        (fin −2 px, channel +2 px) exists to cancel exactly this. Red = channel &lt; 6 px (below the
        cleanability band), orange = fin &lt; 3 px (below the printable minimum). Zoom past {GRID_MIN_ZOOM * 100}%
        for the pixel grid; hover any feature to read its width without counting.
      </div>
    </div>
  )
}
