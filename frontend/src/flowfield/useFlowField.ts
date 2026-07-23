// V5.3 — debounced F1 solve hook. Solves only while the flow layer is on;
// re-solves ~250 ms after the geometry / layout / flow stop changing.
import { useEffect, useRef, useState } from 'react'
import type { FieldInput } from './field'

export interface FlowFieldResult {
  deltaP: number
  massErr: number
  iters: number
  uniformity: number
  nx: number; ny: number; dx: number; dy: number
  columnFlux: Float64Array
  linePoints: Float32Array
  lineOffsets: Int32Array
  // V5.4 — cell fields + thermal stats
  pGrid: Float32Array
  vGrid: Float32Array
  tGrid: Float32Array | null
  outletT: number
  deadFraction: number
  tMax: number
}

export function useFlowField(input: FieldInput | null, enabled: boolean) {
  const [result, setResult] = useState<FlowFieldResult | null>(null)
  const [solving, setSolving] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const seq = useRef(0)

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])

  useEffect(() => {
    if (!enabled || !input) { setResult(null); return }
    const h = setTimeout(() => {
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      }
      const id = ++seq.current
      setSolving(true)
      const w = workerRef.current
      const onMsg = (ev: MessageEvent) => {
        if (ev.data.id !== id) return
        w.removeEventListener('message', onMsg)
        setSolving(false)
        if (ev.data.ok) setResult(ev.data.result as FlowFieldResult)
      }
      w.addEventListener('message', onMsg)
      w.postMessage({ id, input })
    }, 250)
    return () => clearTimeout(h)
  }, [input, enabled])

  return { result, solving }
}
