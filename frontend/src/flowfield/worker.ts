// V5.3 — F1 field-solver worker: keeps the Darcy solve off the main thread.
import { solveField, type FieldInput } from './field'

self.onmessage = (ev: MessageEvent<{ id: number; input: FieldInput }>) => {
  const { id, input } = ev.data
  try {
    const r = solveField(input)
    const transfer: Transferable[] = [
      r.linePoints.buffer, r.lineOffsets.buffer, r.columnFlux.buffer,
      r.pGrid.buffer, r.vGrid.buffer,
    ]
    if (r.tGrid) transfer.push(r.tGrid.buffer)
    ;(self as unknown as Worker).postMessage(
      { id, ok: true, result: {
        deltaP: r.deltaP, massErr: r.massErr, iters: r.iters,
        uniformity: r.uniformity,
        nx: r.nx, ny: r.ny, dx: r.dx, dy: r.dy,
        columnFlux: r.columnFlux,
        linePoints: r.linePoints, lineOffsets: r.lineOffsets,
        pGrid: r.pGrid, vGrid: r.vGrid, tGrid: r.tGrid,
        outletT: r.outletT, deadFraction: r.deadFraction, tMax: r.tMax,
      } },
      transfer,
    )
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: String(e) })
  }
}
