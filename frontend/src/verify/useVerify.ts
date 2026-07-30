import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ViewerGeom } from '../viewerGeom'
import type { LayerProfile, Stage, StackScanBest, VerifyProgress, VerifyResult, WorkerOutMsg } from './types'

// V4 — main-thread side of the verify engine: owns the worker, exposes state.
// One verify session at a time; re-running replaces it. The worker keeps the
// parsed mesh so PixelPreview can request per-layer masks on demand.

export interface VerifySession {
  status: 'idle' | 'running' | 'done' | 'error'
  fileName: string | null
  stage: Stage
  scale: number
  meshTol: number
  /** core-only export — reference compared without its base slab */
  noBase: boolean
  progress: VerifyProgress | null
  result: VerifyResult | null
  layers: LayerProfile | null
  error: string | null
}

const IDLE: VerifySession = {
  status: 'idle', fileName: null, stage: 'final', scale: 1, meshTol: 0.01, noBase: false,
  progress: null, result: null, layers: null, error: null,
}

/** ⌖ stack-scan state (whole-stack worst-neck sweep, runs in the worker) */
export interface StackScanState {
  running: boolean
  fi: number
  total: number
  best: StackScanBest | null
  done: boolean
  cancelled: boolean
  /** increments on each completion so consumers can react exactly once */
  token: number
}

export interface VerifyApi {
  session: VerifySession
  /** kick off a run (stage/scale/meshTol/noBase taken from the args) */
  run: (file: { name: string; buffer: ArrayBuffer }, geom: ViewerGeom, stage: Stage, scale: number, meshTol: number, noBase: boolean) => void
  /** request the imported mask for one layer (resolves via onMask callback) */
  requestMask: (layer: number) => void
  /** latest on-demand mask (layer keyed) */
  mask: { layer: number; imported: Uint8Array; nx: number; ny: number } | null
  /** ⌖ sweep every file layer in the worker; progress + winner land in `stack`.
   *  dilatePx > 0 = overpoly what-if (judge the printed part, not the file) */
  scanStack: (chMinPx: number, dilatePx?: number) => void
  cancelStackScan: () => void
  stack: StackScanState | null
  reset: () => void
}

export function useVerify(): VerifyApi {
  const workerRef = useRef<Worker | null>(null)
  const bufferRef = useRef<ArrayBuffer | null>(null)
  const [session, setSession] = useState<VerifySession>(IDLE)
  const [mask, setMask] = useState<VerifyApi['mask']>(null)
  const [stack, setStack] = useState<StackScanState | null>(null)

  useEffect(() => () => { workerRef.current?.terminate() }, [])

  const spawn = useCallback((): Worker => {
    workerRef.current?.terminate()
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const m = e.data
      if (m.type === 'progress') {
        setSession((s) => ({ ...s, progress: { phase: m.phase, pct: m.pct } }))
      } else if (m.type === 'result') {
        setSession((s) => ({ ...s, status: 'done', result: m.result, progress: null }))
      } else if (m.type === 'layers') {
        setSession((s) => ({ ...s, layers: m.profile, progress: null }))
      } else if (m.type === 'maskResult') {
        setMask({ layer: m.layer, imported: m.imported, nx: m.nx, ny: m.ny })
      } else if (m.type === 'scanProgress') {
        setStack((s) => ({ running: true, fi: m.fi, total: m.total, best: m.best,
          done: false, cancelled: false, token: s?.token ?? 0 }))
      } else if (m.type === 'scanDone') {
        setStack((s) => ({ running: false, fi: Math.max(0, m.total - 1), total: m.total,
          best: m.best, done: !m.cancelled, cancelled: m.cancelled, token: (s?.token ?? 0) + 1 }))
      } else if (m.type === 'error') {
        setSession((s) => ({ ...s, status: 'error', error: m.message, progress: null }))
      }
    }
    w.onerror = (ev) => {
      setSession((s) => ({ ...s, status: 'error', error: ev.message || 'worker crashed', progress: null }))
    }
    workerRef.current = w
    return w
  }, [])

  const run = useCallback<VerifyApi['run']>((file, geom, stage, scale, meshTol, noBase) => {
    // keep a copy so stage/scale re-runs don't need the file re-dropped
    // (the worker takes ownership of the transferred buffer)
    if (file.buffer !== bufferRef.current) bufferRef.current = file.buffer
    const buffer = bufferRef.current.slice(0)
    const w = spawn()
    setMask(null)
    setStack(null)
    setSession({
      status: 'running', fileName: file.name, stage, scale, meshTol, noBase,
      progress: { phase: 'starting', pct: 0 }, result: null, layers: null, error: null,
    })
    w.postMessage({
      type: 'run', buffer, name: file.name, geom, stage, scale, meshTol, noBase,
      twoSided: true, layerProfile: true,
    }, [buffer])
  }, [spawn])

  const requestMask = useCallback((layer: number) => {
    workerRef.current?.postMessage({ type: 'mask', layer })
  }, [])

  const scanStack = useCallback((chMinPx: number, dilatePx = 0) => {
    if (!workerRef.current) return
    setStack((s) => ({ running: true, fi: 0, total: 0, best: null,
      done: false, cancelled: false, token: s?.token ?? 0 }))
    workerRef.current.postMessage({ type: 'scanstack', chMinPx, dilatePx })
  }, [])

  const cancelStackScan = useCallback(() => {
    workerRef.current?.postMessage({ type: 'scancancel' })
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    bufferRef.current = null
    setMask(null)
    setStack(null)
    setSession(IDLE)
  }, [])

  // IMPORTANT: memoized — a fresh object every render put `verify` in effect
  // dep arrays with a new identity each App render, re-firing PixelPreview's
  // mask-request effect in a loop (each 1 MB maskResult → render → re-request).
  // On large meshes that flood queued ahead of user clicks and made the tab
  // feel frozen. Identity now changes only when the underlying state does.
  return useMemo(
    () => ({ session, run, requestMask, mask, scanStack, cancelStackScan, stack, reset }),
    [session, run, requestMask, mask, scanStack, cancelStackScan, stack, reset],
  )
}
