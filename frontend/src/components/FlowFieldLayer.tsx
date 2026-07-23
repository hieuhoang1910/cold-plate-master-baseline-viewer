// V5.3 — renders the F1 solved field: faint streamline polylines + "comet"
// particles that ride each line at its local time-of-flight (fast where the
// solved velocity is fast — maldistribution is directly visible as comets
// racing in favoured channels and crawling in starved ones).
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SLOWMO } from '../flowviz'
import type { FlowFieldResult } from '../flowfield/useFlowField'
import type { ViewerGeom } from '../viewerGeom'

const COMETS_PER_LINE = 4
const COMET_R = 0.09          // mm — well under a channel gap
const COMET_STRETCH = 7       // elongation along the motion direction
const TRAIL = 4               // fading ghosts behind each comet
const TRAIL_DT = 0.012        // ghost spacing as a fraction of the line transit
const _yAxis = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _col = new THREE.Color()

export function FlowFieldLayer({
  field, g, coreWidth, coreLength, z, code = 1,
}: {
  field: FlowFieldResult
  g: ViewerGeom
  coreWidth: number
  coreLength: number
  z: number
  /** shader layout code — decides which lines get vertical intent legs */
  code?: number
}) {
  // Grid coords (0..nx·dx, 0..ny·dy over the fin band) → object mm (centred).
  const x0 = -(field.nx * field.dx) / 2
  const y0 = -coreLength / 2
  void coreWidth

  // V5.5 — snap streamline points onto the nearest wavy channel centerline.
  // The F1 field is homogenized (per-cell, not fin-resolved); snapping makes
  // lines + comets weave INSIDE channels where the motion is channel-aligned,
  // while header/turn zones (x-motion) keep their solved course.
  const snapped = useMemo(() => {
    const P = field.linePoints
    const out = new Float32Array(P.length)
    out.set(P)
    if (g.family === 'gyroid_tpms') return out
    const pitch = g.finThickness + g.gap
    if (!(pitch > 0)) return out
    const offs = field.lineOffsets
    const wave = (yObj: number) => g.waveAmp * Math.sin((2 * Math.PI * yObj) / g.waveLen)
    for (let l = 0; l < offs.length - 1; l++) {
      for (let k = offs[l]; k < offs[l + 1]; k++) {
        const k2 = Math.min(k + 1, offs[l + 1] - 1)
        const dxs = Math.abs(P[3 * k2] - P[3 * k])
        const dys = Math.abs(P[3 * k2 + 1] - P[3 * k + 1])
        const w = dys / (dxs + dys + 1e-9)          // 1 = channel-aligned motion
        const xObj = x0 + P[3 * k]
        const yObj = y0 + P[3 * k + 1]
        const xw = xObj - wave(yObj)
        const xc = (Math.floor(xw / pitch) + 0.5) * pitch + wave(yObj)
        out[3 * k] = (xObj + (xc - xObj) * w) - x0
      }
    }
    return out
  }, [field, g, x0, y0])

  // V5.5b — extended 3-D paths [x, y, z, t]: the F1-solved in-plane course
  // plus vertical INTENT legs where the layout routes water from/to the
  // manifold above (center-feed & top-jet: down at the rib, up at the ends;
  // distributed-jet: down at the feed ducts, up at the return gaps). The
  // sheet part is solved; the vertical legs are the layout's stated routing.
  const ext = useMemo(() => {
    const P = snapped
    const offs = field.lineOffsets
    const vertical = code === 1 || code === 3
    const zTop = g.baseThickness + g.finHeight
    const zM = zTop + 1.8                       // manifold level (visual intent)
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
      if (vertical) {
        const v0 = segSpeed(a, a + 1)
        if (v0 > 0) {
          tShift = (zM - z) / v0
          pts.push(x0 + P[3 * a], y0 + P[3 * a + 1], zM, 0)
          count++
        }
      }
      for (let k = a; k < b; k++) {
        pts.push(x0 + P[3 * k], y0 + P[3 * k + 1], z, P[3 * k + 2] + tShift)
        count++
      }
      if (vertical) {
        const vE = segSpeed(b - 2, b - 1)
        if (vE > 0) {
          const tEnd = P[3 * (b - 1) + 2] + tShift
          pts.push(x0 + P[3 * (b - 1)], y0 + P[3 * (b - 1) + 1], zM, tEnd + (zM - z) / vE)
          count++
        }
      }
      if (count >= 2) offsOut.push(offsOut[offsOut.length - 1] + count)
      else pts.length = offsOut[offsOut.length - 1] * 4
    }
    return { pts: new Float32Array(pts), offs: new Int32Array(offsOut) }
  }, [field, snapped, g, code, x0, y0, z])

  const lines = useMemo(() => {
    const segs: number[] = []
    const { pts, offs } = ext
    for (let l = 0; l < offs.length - 1; l++) {
      for (let k = offs[l]; k < offs[l + 1] - 1; k++) {
        segs.push(
          pts[4 * k], pts[4 * k + 1], pts[4 * k + 2],
          pts[4 * (k + 1)], pts[4 * (k + 1) + 1], pts[4 * (k + 1) + 2],
        )
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
    return geo
  }, [ext])

  const nLines = ext.offs.length - 1
  const maxInst = Math.max(1, nLines * COMETS_PER_LINE * (1 + TRAIL))
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
        P[4 * lo + 2] + f * (P[4 * hi + 2] - P[4 * lo + 2]) + 0.05,
      )
      dummy.position.copy(_pos)
      _dir.set(P[4 * hi] - P[4 * lo], P[4 * hi + 1] - P[4 * lo + 1], P[4 * hi + 2] - P[4 * lo + 2])
      const dl = _dir.length()
      if (dl > 1e-9) {
        _dir.divideScalar(dl)
        dummy.quaternion.setFromUnitVectors(_yAxis, _dir)
        const shrink = 1 - ghost * 0.15
        dummy.scale.set(shrink, COMET_STRETCH * (1 - ghost * 0.08), shrink)
      } else {
        dummy.quaternion.identity()
        dummy.scale.set(1, 1, 1)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(inst, dummy.matrix)
      mesh.setColorAt(inst, _col.setScalar(Math.pow(0.62, ghost)))  // fading trail
      inst++
    }
    for (let l = 0; l < nLines; l++) {
      const a = offs[l], b = offs[l + 1]
      const T = P[4 * (b - 1) + 3]                 // total transit (s real)
      if (!(T > 0)) continue
      for (let c = 0; c < COMETS_PER_LINE; c++) {
        const head = ((tReal + (c / COMETS_PER_LINE) * T + l * 0.13 * T) % T + T) % T
        for (let k = 0; k <= TRAIL; k++) {
          const tt = head - k * TRAIL_DT * T
          if (tt >= 0) place(a, b, tt, k)
        }
      }
    }
    // park unused instances out of view
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
        <lineBasicMaterial color="#57c8ff" transparent opacity={0.34} depthTest={false} />
      </lineSegments>
      {/* V5.5 — comets depth-test against the raymarcher's written depth:
          fins occlude them; section cuts reveal them. key remounts the
          instanced mesh when the line count (and so the buffer size) changes */}
      <instancedMesh key={maxInst} ref={cometRef} args={[undefined, undefined, maxInst]}
        frustumCulled={false}>
        <sphereGeometry args={[COMET_R, 8, 8]} />
        <meshBasicMaterial color="#aef0ff" transparent opacity={0.92} depthTest />
      </instancedMesh>
    </group>
  )
}
