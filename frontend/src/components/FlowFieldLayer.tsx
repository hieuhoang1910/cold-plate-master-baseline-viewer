// V5.3/V5.5 — renders the flow-particle field.
//
// Fin layouts (single/u-flow, center-feed, serpentine): one particle stream
// per PHYSICAL fin gap, following that channel's exact sine path, timed by
// the F1-solved per-column velocity (maldistribution shows per gap). Seven
// depth layers fill the channel height; center-feed streams dive at mid-top,
// descend continuously along the run and exit down the 45° ramps at the fin
// endings to the base level (lattce_lmm_rev3 geometry, user-confirmed).
//
// Distributed-jet (ICE) keeps the solved-streamline mode (short crossings).
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SLOWMO } from '../flowviz'
import type { FlowFieldResult } from '../flowfield/useFlowField'
import type { ViewerGeom } from '../viewerGeom'

const COMET_R = 0.07          // mm — reads as a particle
const COMET_STRETCH = 1.35    // near-round head; the trail carries the motion
const TRAIL = 4               // fading ghosts behind each head
const TRAIL_DT = 0.010        // ghost spacing (fraction of line transit)
const LEG_SPEED = 2           // vertical intent legs vs channel speed
const N_LAYERS = 7            // depth layers across the channel height
const LAYER_LO = 0.10, LAYER_HI = 0.88
const DS_Y = 0.45             // path sampling step along the flow (mm)

const _yAxis = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _col = new THREE.Color()

interface Paths {
  pts: Float32Array       // [x, y, z, t] quadruplets (object mm, seconds real)
  offs: Int32Array
  linePts: Float32Array   // guide polylines (mid layer only in channel mode)
  lineOffs: Int32Array
  perLine: number         // comets per line
}

export function FlowFieldLayer({
  field, g, coreWidth, coreLength, z, code = 1,
}: {
  field: FlowFieldResult
  g: ViewerGeom
  coreWidth: number
  coreLength: number
  z: number
  code?: number
}) {
  const x0 = -(field.nx * field.dx) / 2
  const y0 = -coreLength / 2
  void coreWidth
  void z // layers define their own heights; prop kept for API stability

  // ---- per-channel analytic paths at F1 column speeds (codes 0, 1, 2) ----
  const chan = useMemo((): Paths | null => {
    if (g.family === 'gyroid_tpms' || code === 3) return null
    const pitch = g.finThickness + g.gap
    if (!(pitch > 0)) return null
    const Wf = field.nx * field.dx
    const L = field.ny * field.dy
    const nCh = Math.max(1, Math.floor(Wf / pitch))
    // per-column mean solved speed (m/s) — per-gap maldistribution
    const colV = new Float64Array(field.nx)
    for (let i = 0; i < field.nx; i++) {
      let s = 0
      for (let j = 0; j < field.ny; j++) s += field.vGrid[j * field.nx + i]
      colV[i] = s / field.ny
    }
    const zTop = g.baseThickness + g.finHeight
    const zM = zTop + 1.0
    const wave = (yObj: number) => g.waveAmp * Math.sin((2 * Math.PI * yObj) / g.waveLen)
    const mid = Math.floor(N_LAYERS / 2)

    const pts: number[] = []
    const offs: number[] = [0]
    const linePts: number[] = []
    const lineOffs: number[] = [0]

    for (let li = 0; li < N_LAYERS; li++) {
      const lf = LAYER_LO + ((LAYER_HI - LAYER_LO) * li) / (N_LAYERS - 1)
      const zS = g.baseThickness + g.finHeight * lf
      const isLineLayer = li === mid
      for (let k = 0; k < nCh; k++) {
        const xw = -Wf / 2 + (k + 0.5) * pitch
        if (Math.abs(xw) > Wf / 2 - g.gap / 2) continue
        const i = Math.min(field.nx - 1, Math.max(0, Math.floor((xw + Wf / 2) / field.dx)))
        const vMm = Math.max(colV[i], 1e-4) * 1000       // mm/s real
        // route(s) through this channel, in field-y coords [0, L]
        const routes: Array<{ yA: number; yB: number }> = []
        if (code === 1) {
          routes.push({ yA: L / 2, yB: L }, { yA: L / 2, yB: 0 })
        } else if (code === 2) {
          const nSeg = Math.max(2, Math.round(Wf / Math.max(Wf / 6, pitch * 8))) // fallback
          const band = Math.min(nSeg - 1, Math.floor(((xw + Wf / 2) / Wf) * nSeg))
          routes.push(band % 2 === 0 ? { yA: 0, yB: L } : { yA: L, yB: 0 })
        } else {
          routes.push({ yA: 0, yB: L })
        }
        for (const r of routes) {
          const span = Math.abs(r.yB - r.yA)
          const dirY = Math.sign(r.yB - r.yA)
          const n = Math.max(3, Math.round(span / DS_Y))
          // z-profile (laminar channel physics, user-validated 2026-07-23):
          // the top-entry redistribution is GRADUAL — entrance effects in a
          // slot decay ~e^(−x/H), so parcels keep descending over roughly one
          // channel height of travel (~40% of this half-path), deep-bound
          // parcels the longest; beyond that the streamlines run parallel
          // (no continued sinking — pressure equalizes across the 0.15 mm
          // gap instantly by comparison). Exits stay straight out.
          const legs = code === 1
          const zHi = g.baseThickness + g.finHeight * 0.95
          // settle shortened below the ~1·H physics estimate so the descent
          // fan reads clearly as DESIGN INTENT (user 2026-07-23); CFD will
          // measure the real development length (FC checklist)
          const settle = 0.45 * g.finHeight
          let t = 0
          let count = 0
          const emit = (xo: number, yo: number, zo: number, tt: number) => {
            pts.push(xo, yo, zo, tt)
            if (isLineLayer) linePts.push(xo, yo, zo, tt)
            count++
          }
          // entry dive (center-feed: from the manifold at mid-top)
          if (legs) {
            const yObj0 = y0 + r.yA
            emit(xw + wave(yObj0), yObj0, zM, 0)
            t += (zM - zHi) / (vMm * LEG_SPEED)
          }
          for (let s = 0; s <= n; s++) {
            const frac = s / n
            const yObj = y0 + r.yA + dirY * span * frac
            let zk = zS
            if (legs) {
              zk = zS + (zHi - zS) * Math.exp(-(span * frac) / settle)
            }
            emit(xw + wave(yObj), yObj, zk, t)
            if (s < n) t += span / n / vMm
          }
          // exit: straight out into the collector trough at this height
          if (legs) {
            const yEnd = y0 + r.yB
            const run = 2.2
            emit(xw + wave(yEnd), yEnd + dirY * run, zS, t + run / vMm)
          }
          if (count >= 2) {
            offs.push(offs[offs.length - 1] + count)
            if (isLineLayer) lineOffs.push(lineOffs[lineOffs.length - 1] + count)
          }
        }
      }
    }
    return {
      pts: new Float32Array(pts), offs: new Int32Array(offs),
      linePts: new Float32Array(linePts), lineOffs: new Int32Array(lineOffs),
      perLine: 1,
    }
  }, [field, g, code, y0])

  // ---- solved-streamline fallback (distributed-jet / TPMS) ---------------
  const solved = useMemo((): Paths => {
    const P = field.linePoints
    const offs = field.lineOffsets
    const zTop = g.baseThickness + g.finHeight
    const zM = zTop + 1.0
    const zS = g.baseThickness + g.finHeight * 0.55
    const pts: number[] = []
    const offsOut: number[] = [0]
    for (let l = 0; l < offs.length - 1; l++) {
      const a = offs[l], b = offs[l + 1]
      if (b - a < 2) continue
      let count = 0
      const segSpeed = (k1: number, k2: number) => {
        const d = Math.hypot(P[3 * k2] - P[3 * k1], P[3 * k2 + 1] - P[3 * k1 + 1])
        const dt = P[3 * k2 + 2] - P[3 * k1 + 2]
        return dt > 1e-12 ? d / dt : 0
      }
      let tShift = 0
      const v0 = segSpeed(a, a + 1)
      if (code === 3 && v0 > 0) {
        tShift = (zM - zS) / (v0 * LEG_SPEED)
        pts.push(x0 + P[3 * a], y0 + P[3 * a + 1], zM, 0)
        count++
      }
      for (let k = a; k < b; k++) {
        pts.push(x0 + P[3 * k], y0 + P[3 * k + 1], zS, P[3 * k + 2] + tShift)
        count++
      }
      const vE = segSpeed(b - 2, b - 1)
      if (code === 3 && vE > 0) {
        const tEnd = P[3 * (b - 1) + 2] + tShift
        pts.push(x0 + P[3 * (b - 1)], y0 + P[3 * (b - 1) + 1], zM,
                 tEnd + (zM - zS) / (vE * LEG_SPEED))
        count++
      }
      if (count >= 2) offsOut.push(offsOut[offsOut.length - 1] + count)
      else pts.length = offsOut[offsOut.length - 1] * 4
    }
    const arr = new Float32Array(pts)
    const off = new Int32Array(offsOut)
    return { pts: arr, offs: off, linePts: arr, lineOffs: off, perLine: 3 }
  }, [field, g, code, x0, y0])

  const ext = chan ?? solved

  const lines = useMemo(() => {
    const segs: number[] = []
    const { linePts: P, lineOffs: offs } = ext
    for (let l = 0; l < offs.length - 1; l++) {
      for (let k = offs[l]; k < offs[l + 1] - 1; k++) {
        segs.push(
          P[4 * k], P[4 * k + 1], P[4 * k + 2],
          P[4 * (k + 1)], P[4 * (k + 1) + 1], P[4 * (k + 1) + 2],
        )
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
    return geo
  }, [ext])

  const nLines = ext.offs.length - 1
  const maxInst = Math.max(1, nLines * ext.perLine * (1 + TRAIL))
  const cometRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    const mesh = cometRef.current
    if (!mesh) return
    const { pts: P, offs } = ext
    const tReal = state.clock.elapsedTime / SLOWMO
    let inst = 0
    const place = (a: number, b: number, tt: number, ghost: number) => {
      let lo = a, hi = b - 1
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1
        if (P[4 * mid + 3] <= tt) lo = mid
        else hi = mid
      }
      const t0 = P[4 * lo + 3], t1 = P[4 * hi + 3]
      const f = t1 > t0 ? (tt - t0) / (t1 - t0) : 0
      _pos.set(
        P[4 * lo] + f * (P[4 * hi] - P[4 * lo]),
        P[4 * lo + 1] + f * (P[4 * hi + 1] - P[4 * lo + 1]),
        P[4 * lo + 2] + f * (P[4 * hi + 2] - P[4 * lo + 2]) + 0.04,
      )
      dummy.position.copy(_pos)
      _dir.set(P[4 * hi] - P[4 * lo], P[4 * hi + 1] - P[4 * lo + 1], P[4 * hi + 2] - P[4 * lo + 2])
      const dl = _dir.length()
      if (dl > 1e-9) {
        _dir.divideScalar(dl)
        dummy.quaternion.setFromUnitVectors(_yAxis, _dir)
        const shrink = 1 - ghost * 0.14
        dummy.scale.set(shrink, COMET_STRETCH * (1 - ghost * 0.06), shrink)
      } else {
        dummy.quaternion.identity()
        dummy.scale.set(1, 1, 1)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(inst, dummy.matrix)
      mesh.setColorAt(inst, _col.setScalar(Math.pow(0.66, ghost)))
      inst++
    }
    for (let l = 0; l < nLines; l++) {
      const a = offs[l], b = offs[l + 1]
      const T = P[4 * (b - 1) + 3]
      if (!(T > 0)) continue
      for (let c = 0; c < ext.perLine; c++) {
        const head = ((tReal + (c / ext.perLine) * T + l * 0.37 * T) % T + T) % T
        for (let k = 0; k <= TRAIL; k++) {
          const tt = head - k * TRAIL_DT * T
          if (tt >= 0) place(a, b, tt, k)
        }
      }
    }
    dummy.quaternion.identity()
    dummy.scale.set(1, 1, 1)
    for (; inst < maxInst; inst++) {
      dummy.position.set(0, 0, -9999)
      dummy.updateMatrix()
      mesh.setMatrixAt(inst, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <group>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial color="#57c8ff" transparent opacity={0.22} depthTest={false} />
      </lineSegments>
      {/* comets depth-test against the raymarcher's written depth: fins occlude
          them, section cuts reveal them. key re-buffers when counts change */}
      <instancedMesh key={maxInst} ref={cometRef} args={[undefined, undefined, maxInst]}
        frustumCulled={false}>
        <sphereGeometry args={[COMET_R, 6, 6]} />
        <meshBasicMaterial color="#aef0ff" transparent opacity={0.92} depthTest />
      </instancedMesh>
    </group>
  )
}
