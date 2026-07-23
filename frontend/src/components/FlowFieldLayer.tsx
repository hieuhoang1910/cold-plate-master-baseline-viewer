// V5.3 — renders the F1 solved field: faint streamline polylines + "comet"
// particles that ride each line at its local time-of-flight (fast where the
// solved velocity is fast — maldistribution is directly visible as comets
// racing in favoured channels and crawling in starved ones).
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SLOWMO } from '../flowviz'
import type { FlowFieldResult } from '../flowfield/useFlowField'

const COMETS_PER_LINE = 3

export function FlowFieldLayer({
  field, coreWidth, coreLength, z,
}: {
  field: FlowFieldResult
  coreWidth: number
  coreLength: number
  z: number
}) {
  // Grid coords (0..nx·dx, 0..ny·dy over the fin band) → object mm (centred).
  const x0 = -(field.nx * field.dx) / 2
  const y0 = -coreLength / 2
  void coreWidth

  const lines = useMemo(() => {
    const segs: number[] = []
    const offs = field.lineOffsets
    for (let l = 0; l < offs.length - 1; l++) {
      for (let k = offs[l]; k < offs[l + 1] - 1; k++) {
        segs.push(
          x0 + field.linePoints[3 * k], y0 + field.linePoints[3 * k + 1], z,
          x0 + field.linePoints[3 * (k + 1)], y0 + field.linePoints[3 * (k + 1) + 1], z,
        )
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
    return g
  }, [field, x0, y0, z])

  const nLines = field.lineOffsets.length - 1
  const cometRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    const mesh = cometRef.current
    if (!mesh) return
    const tReal = state.clock.elapsedTime / SLOWMO
    let inst = 0
    const offs = field.lineOffsets
    const P = field.linePoints
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
        dummy.updateMatrix()
        mesh.setMatrixAt(inst++, dummy.matrix)
      }
    }
    // park unused instances out of view
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
        <lineBasicMaterial color="#57c8ff" transparent opacity={0.28} depthTest={false} />
      </lineSegments>
      <instancedMesh ref={cometRef} args={[undefined, undefined, Math.max(1, nLines * COMETS_PER_LINE)]}
        frustumCulled={false}>
        <sphereGeometry args={[0.26, 8, 8]} />
        <meshBasicMaterial color="#aef0ff" transparent opacity={0.95} depthTest={false} />
      </instancedMesh>
    </group>
  )
}
