import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { ViewerGeom } from '../viewerGeom'
import type { VerifyResult } from '../verify/types'
import { PX_FINAL } from '../verify/types'

// V4 — the imported mesh painted by signed deviation from the design field.
// blue = surface sits INSIDE the design (undersize) · light = on the surface ·
// red = OUTSIDE (oversize) · dark grey = buried internal faces (not judged).
// Range clamps at ±1 printer pixel (±29 µm).
//
// The worker ships the FULL indexed mesh. Small files render as a solid mesh
// immediately; heavy ones (> 2 M triangles) start as a fast point cloud with
// an explicit "render full mesh" opt-in (normals for millions of vertices
// take a few seconds to build — the user decides, nothing is silently slow).

const POINT_TARGET = 2_000_000

export function DeviationViewer({ view, geom }: { view: VerifyResult['view']; geom: ViewerGeom }) {
  const [wantMesh, setWantMesh] = useState(!view.heavy)
  const [building, setBuilding] = useState(false)
  const [meshGeo, setMeshGeo] = useState<THREE.BufferGeometry | null>(null)
  const buildToken = useRef(0)

  useEffect(() => {
    setWantMesh(!view.heavy)
    setMeshGeo(null)
    setBuilding(false)
    buildToken.current++
  }, [view])

  // fast path: stride-sampled point cloud (instant at any size)
  const pointsGeo = useMemo(() => {
    const n = view.positions.length / 3
    const stride = Math.max(1, Math.ceil(n / POINT_TARGET))
    let pv = view.positions
    let pc = view.colors
    if (stride > 1) {
      const m = Math.ceil(n / stride)
      pv = new Float32Array(m * 3)
      pc = new Uint8Array(m * 3)
      for (let i = 0, o = 0; i < n; i += stride, o++) {
        pv[o * 3] = view.positions[i * 3]; pv[o * 3 + 1] = view.positions[i * 3 + 1]; pv[o * 3 + 2] = view.positions[i * 3 + 2]
        pc[o * 3] = view.colors[i * 3]; pc[o * 3 + 1] = view.colors[i * 3 + 1]; pc[o * 3 + 2] = view.colors[i * 3 + 2]
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pv, 3))
    g.setAttribute('color', new THREE.BufferAttribute(pc, 3, true))
    return g
  }, [view])

  // full mesh: built on demand (computeVertexNormals over millions of verts
  // blocks for a few seconds — deferred so the "building…" label paints first)
  useEffect(() => {
    if (!wantMesh || meshGeo) return
    setBuilding(true)
    const token = ++buildToken.current
    const t = setTimeout(() => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(view.positions, 3))
      g.setAttribute('color', new THREE.BufferAttribute(view.colors, 3, true))
      g.setIndex(new THREE.BufferAttribute(view.index, 1))
      g.computeVertexNormals()
      if (buildToken.current === token) {
        setMeshGeo(g)
        setBuilding(false)
      } else {
        g.dispose()
      }
    }, 30)
    return () => clearTimeout(t)
  }, [wantMesh, meshGeo, view])

  const zMax = geom.baseThickness + geom.finHeight
  const cz = zMax / 2
  const radius = Math.max(geom.coreWidth, geom.coreLength, zMax) * 1.85
  const um = (v: number) => `${Math.round(v * 1000)}`
  const showMesh = wantMesh && meshGeo != null
  const tris = view.index.length / 3

  return (
    <div className="dev-viewer" data-cursor="drag">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [-radius * 0.62, -radius * 0.62, radius * 0.55], up: [0, 0, 1], fov: 40, near: 0.5, far: 4000 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#0a0c10']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[40, -50, 80]} intensity={1.1} />
        <directionalLight position={[-40, 40, 20]} intensity={0.35} />
        {showMesh ? (
          <mesh geometry={meshGeo}>
            <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
          </mesh>
        ) : (
          <points geometry={pointsGeo}>
            <pointsMaterial vertexColors size={0.09} sizeAttenuation />
          </points>
        )}
        <OrbitControls makeDefault target={[0, 0, cz]} enablePan screenSpacePanning
          minDistance={2} maxDistance={600} />
      </Canvas>
      <div className="dev-legend">
        <span className="dl-cap">surface deviation</span>
        <span className="dl-end">−{um(PX_FINAL)} µm<br /><em>inside · undersize</em></span>
        <span className="dl-bar" />
        <span className="dl-end">+{um(PX_FINAL)} µm<br /><em>outside · oversize</em></span>
        <span className="dl-note">±1 printer pixel — light grey means “on the design surface”</span>
      </div>
      <div className="dev-mode">
        {view.heavy && (
          <button className="v-small" disabled={building}
            onClick={() => { if (showMesh) { setWantMesh(false) } else { setWantMesh(true) } }}>
            {building ? 'building full mesh…'
              : showMesh ? '· points (fast)'
              : `▲ render full mesh (${(tris / 1e6).toFixed(1)} M tris — a few seconds + needs a decent GPU)`}
          </button>
        )}
        {!showMesh && !building && (
          <span className="dev-decim-note">
            point-cloud preview — every measurement ran on the full mesh
          </span>
        )}
      </div>
    </div>
  )
}
