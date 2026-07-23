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
const _yAxis = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()

export function FlowFieldLayer({
  field, g, coreWidth, coreLength, z,
}: {
  field: FlowFieldResult
  g: ViewerGeom
  coreWidth: number
  coreLength: number
  z: number
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

  const lines = useMemo(() => {
    const segs: number[] = []
    const offs = field.lineOffsets
    for (let l = 0; l < offs.length - 1; l++) {
      for (let k = offs[l]; k < offs[l + 1] - 1; k++) {
        segs.push(
          x0 + snapped[3 * k], y0 + snapped[3 * k + 1], z,
          x0 + snapped[3 * (k + 1)], y0 + snapped[3 * (k + 1) + 1], z,
        )
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
    return geo
  }, [field, snapped, x0, y0, z])

  const nLines = field.lineOffsets.length - 1
  const cometRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    const mesh = cometRef.current
    if (!mesh) return
    const tReal = state.clock.elapsedTime / SLOWMO
    let inst = 0
    const offs = field.lineOffsets
    const P = snapped
    for (let l = 0; l < nLines; l++) {
      const a = offs[l], b = offs[l + 1]
      const T = P[3 * (b - 1) + 2]                 // line's total transit (s real)
      if (!(T > 0)) continue
      for (let c = 0; c < COMETS_PER_LINE; c++) {
        const tt = ((tReal + (c / COMETS_PER_LINE) * T + l * 0.13 * T) % T + T) % T
        // binary search cumulative time
        let lo = a, hi = b - 1
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1
          if (P[3 * mid + 2] <= tt) lo = mid
          else hi = mid
        }
        const t0 = P[3 * lo + 2], t1 = P[3 * hi + 2]
        const f = t1 > t0 ? (tt - t0) / (t1 - t0) : 0
        dummy.position.set(
          x0 + P[3 * lo] + f * (P[3 * hi] - P[3 * lo]),
          y0 + P[3 * lo + 1] + f * (P[3 * hi + 1] - P[3 * lo + 1]),
          z + 0.05,
        )
        // streak: stretch the sphere along the local motion direction so the
        // particle field READS as flow, not as static pearls
        _dir.set(P[3 * hi] - P[3 * lo], P[3 * hi + 1] - P[3 * lo + 1], 0)
        const dl = _dir.length()
        if (dl > 1e-9) {
          _dir.divideScalar(dl)
          dummy.quaternion.setFromUnitVectors(_yAxis, _dir)
          dummy.scale.set(1, COMET_STRETCH, 1)
        } else {
          dummy.quaternion.identity()
          dummy.scale.set(1, 1, 1)
        }
        dummy.updateMatrix()
        mesh.setMatrixAt(inst++, dummy.matrix)
      }
    }
    // park unused instances out of view
    dummy.quaternion.identity()
    dummy.scale.set(1, 1, 1)
    for (; inst < nLines * COMETS_PER_LINE; inst++) {
      dummy.position.set(0, 0, -9999)
      dummy.updateMatrix()
      mesh.setMatrixAt(inst, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial color="#57c8ff" transparent opacity={0.34} depthTest={false} />
      </lineSegments>
      {/* V5.5 — comets depth-test against the raymarcher's written depth:
          fins occlude them; section cuts reveal them */}
      <instancedMesh ref={cometRef} args={[undefined, undefined, Math.max(1, nLines * COMETS_PER_LINE)]}
        frustumCulled={false}>
        <sphereGeometry args={[COMET_R, 8, 8]} />
        <meshBasicMaterial color="#aef0ff" transparent opacity={0.92} depthTest />
      </instancedMesh>
    </group>
  )
}
