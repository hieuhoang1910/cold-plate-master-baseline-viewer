import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViewerGeom } from '../viewerGeom'
import type { LayerProfile, Stage, VerifyProgress, VerifyResult, WorkerOutMsg } from './types'

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

export interface VerifyApi {
  session: VerifySession
  /** kick off a run (stage/scale/meshTol/noBase taken from the args) */
  run: (file: { name: string; buffer: ArrayBuffer }, geom: ViewerGeom, stage: Stage, scale: number, meshTol: number, noBase: boolean) => void
  /** request the imported mask for one layer (resolves via onMask callback) */
  requestMask: (layer: number) => void
  /** latest on-demand mask (layer keyed) */
  mask: { layer: number; imported: Uint8Array; nx: number; ny: number } | null
  reset: () => void
}

export function useVerify(): VerifyApi {
  const workerRef = useRef<Worker | null>(null)
  const bufferRef = useRef<ArrayBuffer | null>(null)
  const [session, setSession] = useState<VerifySession>(IDLE)
  const [mask, setMask] = useState<VerifyApi['mask']>(null)

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

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    bufferRef.current = null
    setMask(null)
    setSession(IDLE)
  }, [])

  return { session, run, requestMask, mask, reset }
}
