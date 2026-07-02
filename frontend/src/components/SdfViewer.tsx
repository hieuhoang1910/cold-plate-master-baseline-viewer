import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { fmt } from '../format'
import { buildStl, type StlQuality } from '../stl'
import type { ViewerGeom } from '../viewerGeom'

function fmtBytes(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`
}

// Fullscreen triangle: the vertex shader writes clip space directly, so the
// pass ignores the scene camera. Rays are reconstructed in the fragment shader
// from the inverse view-projection, so OrbitControls still drives the view.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform mat4 uInvViewProj;
uniform float uW, uL, uH, uBase, uT, uGap, uMargin, uAmp, uLambda, uRib, uHasRib;
uniform float uFamily;   // 0 = fin field, 1 = TPMS/lattice
uniform float uUnitCell, uWall;
uniform float uTpms;     // 0 gyroid·1 diamond·2 schwarz-P·3 lidinoid·4 split-P·5 I-WP·6 neovius·7 fischer-koch
uniform float uLayout;   // 0 rectangular · 1 cylinder
uniform float uGrade;    // radial cell grading (0 = uniform)
uniform float uSolid;    // 0 = shelled sheet, 1 = solid/network fill
uniform float uIsPin;    // 1 = pin-fin array (ignore TPMS field)
uniform float uPinD, uPinPitch, uPinStagger;
uniform vec3 uCut;       // plane position per axis (mm)
uniform vec3 uCutSign;   // +1 removes the +side, -1 removes the -side
uniform vec3 uCutOn;     // 1 = plane enabled, 0 = off

const float PI = 3.14159265359;

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCylinder(vec3 p, float h, float r) {
  vec2 d = vec2(length(p.xy) - r, abs(p.z) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// TPMS level-set fields (period set by k = 2*pi/cell). Nodal approximations
// after Gandy et al. (1999-2001) and standard TPMS references.
float tpmsField(vec3 p, float k, float ty) {
  float x = k * p.x, y = k * p.y, z = k * p.z;
  float c2x = cos(2.0 * x), c2y = cos(2.0 * y), c2z = cos(2.0 * z);
  if (ty < 0.5) return cos(x) * sin(y) + cos(y) * sin(z) + cos(z) * sin(x);      // gyroid
  if (ty < 1.5) return sin(x) * sin(y) * sin(z) + sin(x) * cos(y) * cos(z)
                     + cos(x) * sin(y) * cos(z) + cos(x) * cos(y) * sin(z);       // Schwarz diamond
  if (ty < 2.5) return cos(x) + cos(y) + cos(z);                                  // Schwarz P
  if (ty < 3.5) return sin(2.0 * x) * cos(y) * sin(z) + sin(2.0 * y) * cos(z) * sin(x)   // lidinoid
                     + sin(2.0 * z) * cos(x) * sin(y) - c2x * c2y - c2y * c2z - c2z * c2x + 0.3;
  if (ty < 4.5) return 1.1 * (sin(2.0 * x) * sin(z) * cos(y) + sin(2.0 * y) * sin(x) * cos(z) // split-P
                     + sin(2.0 * z) * sin(y) * cos(x)) - 0.2 * (c2x * c2y + c2y * c2z + c2z * c2x)
                     - 0.4 * (c2x + c2y + c2z);
  if (ty < 5.5) return 2.0 * (cos(x) * cos(y) + cos(y) * cos(z) + cos(z) * cos(x))         // Schoen I-WP
                     - (c2x + c2y + c2z);
  if (ty < 6.5) return 3.0 * (cos(x) + cos(y) + cos(z)) + 4.0 * cos(x) * cos(y) * cos(z);  // Neovius
  return cos(2.0 * x) * sin(y) * cos(z) + cos(2.0 * y) * sin(z) * cos(x)                    // Fischer-Koch S
       + cos(2.0 * z) * sin(x) * cos(y);
}

float mapScene(vec3 p) {
  // base slab: z in [0, uBase]
  float base = sdBox(p - vec3(0.0, 0.0, uBase * 0.5),
                     vec3(uW * 0.5, uL * 0.5, uBase * 0.5));

  float zc = uBase + uH * 0.5;
  float core;

  if (uFamily < 0.5) {
    // --- fin field ---
    float dx = uAmp * sin(2.0 * PI * p.y / uLambda);  // wave displaces fins in x along flow (y)
    float xw = p.x - dx;
    float pitch = uT + uGap;
    float m = mod(xw + 0.5 * pitch, pitch) - 0.5 * pitch;
    float dWall = abs(m) - uT * 0.5;                  // distance to nearest fin wall
    float fieldHalf = uW * 0.5 - uMargin;
    float dbox = sdBox(p - vec3(0.0, 0.0, zc), vec3(fieldHalf, uL * 0.5, uH * 0.5));
    core = max(dWall * 0.6, dbox);                    // 0.6 = Lipschitz guard for the wave
    if (uHasRib > 0.5) {
      float rib = sdBox(p - vec3(0.0, 0.0, zc), vec3(uW * 0.5, uRib * 0.5, uH * 0.5));
      core = min(core, rib);
    }
  } else {
    // --- TPMS / lattice / pin geometry screening ---
    float R = 0.5 * min(uW, uL);
    float clip = (uLayout < 0.5)
      ? sdBox(p - vec3(0.0, 0.0, zc), vec3(uW * 0.5, uL * 0.5, uH * 0.5))
      : sdCylinder(p - vec3(0.0, 0.0, zc), uH * 0.5, R);

    if (uIsPin > 0.5) {
      // pin-fin array (finite cylinders on the base)
      float pp = max(uPinPitch, 0.1);
      float rowY = floor(p.y / pp + 0.5);
      float xoff = (uPinStagger > 0.5) ? mod(rowY, 2.0) * 0.5 * pp : 0.0;
      float qx = mod(p.x + xoff + 0.5 * pp, pp) - 0.5 * pp;
      float qy = mod(p.y + 0.5 * pp, pp) - 0.5 * pp;
      float dRad = length(vec2(qx, qy)) - uPinD * 0.5;
      float dz = abs(p.z - zc) - uH * 0.5;
      core = max(max(dRad, dz), clip);
    } else {
      float rr = length(p.xy);
      // radially graded cell — jet-adaptive: finer than nominal at the centre,
      // coarser at the edges (crossover at r = 0.5 R) when uGrade > 0
      float cLocal = uUnitCell * (1.0 + uGrade * (clamp(rr / max(R, 1e-3), 0.0, 1.5) - 0.5));
      float c = max(cLocal, 0.3);
      float k = 2.0 * PI / c;
      float f = tpmsField(p, k, uTpms);
      float iso = clamp(uWall * PI / c, 0.06, 1.2);
      float scale = (c / (2.0 * PI)) * 0.5;
      // sheet = shell around the surface; solid = fill one side of the level set
      float d = (uSolid < 0.5) ? (abs(f) - iso) * scale : (f - iso) * scale;
      core = max(d, clip);
    }
  }

  float solid = min(base, core);

  // section planes (each removes one side of one axis when enabled)
  if (uCutOn.x > 0.5) solid = max(solid, uCutSign.x * (p.x - uCut.x));
  if (uCutOn.y > 0.5) solid = max(solid, uCutSign.y * (p.y - uCut.y));
  if (uCutOn.z > 0.5) solid = max(solid, uCutSign.z * (p.z - uCut.z));
  return solid;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.012, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy) - mapScene(p - e.xyy),
    mapScene(p + e.yxy) - mapScene(p - e.yxy),
    mapScene(p + e.yyx) - mapScene(p - e.yyx)
  ));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 near = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 far  = uInvViewProj * vec4(ndc,  1.0, 1.0);
  vec3 ro = near.xyz / near.w;
  vec3 rd = normalize(far.xyz / far.w - ro);

  float t = 0.0;
  float hit = -1.0;
  vec3 pos = ro;
  for (int i = 0; i < 200; i++) {
    pos = ro + rd * t;
    float d = mapScene(pos);
    if (d < 0.004) { hit = t; break; }
    t += d;
    if (t > 500.0) break;
  }

  if (hit < 0.0) {
    vec3 bg = mix(vec3(0.055, 0.075, 0.10), vec3(0.10, 0.13, 0.17), vUv.y);
    gl_FragColor = vec4(bg, 1.0);
    return;
  }

  vec3 nor = calcNormal(pos);
  vec3 vdir = -rd;
  vec3 L1 = normalize(vec3(0.45, 0.35, 0.82));
  vec3 L2 = normalize(vec3(-0.5, -0.6, 0.4));
  float d1 = max(dot(nor, L1), 0.0);
  float d2 = max(dot(nor, L2), 0.0);
  float amb = 0.28 + 0.12 * clamp(nor.z, 0.0, 1.0);
  float h = clamp((pos.z - uBase) / max(uH, 1e-3), 0.0, 1.0);
  vec3 steel = mix(vec3(0.50, 0.53, 0.57), vec3(0.80, 0.82, 0.85), h);   // stainless steel, brighter at fin tips
  vec3 col = steel * (amb + 0.75 * d1) + vec3(1.0) * (0.20 * d2);
  float fres = pow(1.0 - max(dot(nor, vdir), 0.0), 3.0);
  col += fres * 0.14;
  col = pow(col, vec3(0.4545));                       // gamma
  gl_FragColor = vec4(col, 1.0);
}
`

const TPMS_IDX: Record<string, number> = {
  gyroid: 0, diamond: 1, schwarz_p: 2, lidinoid: 3,
  split_p: 4, iwp: 5, neovius: 6, fischer_koch: 7, pin_fins: 0,
}

interface Cut { on: boolean; pos: number; flip: boolean }
interface Cuts { x: Cut; y: Cut; z: Cut }

function RayMarcher({ g, cuts }: { g: ViewerGeom; cuts: Cuts }) {
  const { camera } = useThree()
  const matRef = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uInvViewProj: { value: new THREE.Matrix4() },
      uW: { value: g.coreWidth },
      uL: { value: g.coreLength },
      uH: { value: g.finHeight },
      uBase: { value: g.baseThickness },
      uT: { value: g.finThickness },
      uGap: { value: g.gap },
      uMargin: { value: g.sideMargin },
      uAmp: { value: g.waveAmp },
      uLambda: { value: g.waveLen },
      uRib: { value: g.ribWidth },
      uHasRib: { value: g.ribWidth > 0 ? 1 : 0 },
      uFamily: { value: g.family === 'gyroid_tpms' ? 1 : 0 },
      uUnitCell: { value: g.unitCell },
      uWall: { value: g.wallThickness },
      uTpms: { value: TPMS_IDX[g.tpmsType] ?? 0 },
      uLayout: { value: g.layout === 'cylinder' ? 1 : 0 },
      uGrade: { value: g.grading },
      uSolid: { value: g.solid ? 1 : 0 },
      uIsPin: { value: g.isPin ? 1 : 0 },
      uPinD: { value: g.pinDiameter },
      uPinPitch: { value: g.pinPitch },
      uPinStagger: { value: g.pinStagger ? 1 : 0 },
      uCut: { value: new THREE.Vector3(cuts.x.pos, cuts.y.pos, cuts.z.pos) },
      uCutSign: { value: new THREE.Vector3(1, 1, 1) },
      uCutOn: { value: new THREE.Vector3(0, 0, 0) },
    }),
    [], // created once; kept in sync by the effects below
  )

  useEffect(() => {
    const u = matRef.current?.uniforms
    if (!u) return
    u.uW.value = g.coreWidth
    u.uL.value = g.coreLength
    u.uH.value = g.finHeight
    u.uBase.value = g.baseThickness
    u.uT.value = g.finThickness
    u.uGap.value = g.gap
    u.uMargin.value = g.sideMargin
    u.uAmp.value = g.waveAmp
    u.uLambda.value = g.waveLen
    u.uRib.value = g.ribWidth
    u.uHasRib.value = g.ribWidth > 0 ? 1 : 0
    u.uFamily.value = g.family === 'gyroid_tpms' ? 1 : 0
    u.uUnitCell.value = g.unitCell
    u.uWall.value = g.wallThickness
    u.uTpms.value = TPMS_IDX[g.tpmsType] ?? 0
    u.uLayout.value = g.layout === 'cylinder' ? 1 : 0
    u.uGrade.value = g.grading
    u.uSolid.value = g.solid ? 1 : 0
    u.uIsPin.value = g.isPin ? 1 : 0
    u.uPinD.value = g.pinDiameter
    u.uPinPitch.value = g.pinPitch
    u.uPinStagger.value = g.pinStagger ? 1 : 0
  }, [g])

  useEffect(() => {
    const u = matRef.current?.uniforms
    if (!u) return
    u.uCut.value.set(cuts.x.pos, cuts.y.pos, cuts.z.pos)
    u.uCutSign.value.set(cuts.x.flip ? -1 : 1, cuts.y.flip ? -1 : 1, cuts.z.flip ? -1 : 1)
    u.uCutOn.value.set(cuts.x.on ? 1 : 0, cuts.y.on ? 1 : 0, cuts.z.on ? 1 : 0)
  }, [cuts])

  useFrame(() => {
    const u = matRef.current?.uniforms
    if (!u) return
    u.uInvViewProj.value
      .copy(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
      .invert()
  })

  const positions = useMemo(() => new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), [])

  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

// Standard view directions (z-up). Camera sits at target + dir*radius.
const VIEW_DIRS: Record<string, [number, number, number]> = {
  iso: [-0.72, -0.72, 0.62],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
}

function ViewController({
  cmd, target, radius,
}: {
  cmd: { view: string; n: number }
  target: [number, number, number]
  radius: number
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null

  useEffect(() => {
    const t = new THREE.Vector3(...target)
    const d = VIEW_DIRS[cmd.view] ?? VIEW_DIRS.iso
    const pos = new THREE.Vector3(d[0], d[1], d[2]).normalize().multiplyScalar(radius).add(t)
    // Top/bottom look down the z axis, so z-up is degenerate — use y-up there.
    camera.up.set(0, cmd.view === 'top' || cmd.view === 'bottom' ? 1 : 0, cmd.view === 'top' || cmd.view === 'bottom' ? 0 : 1)
    camera.position.copy(pos)
    camera.lookAt(t)
    if (controls) {
      controls.target.copy(t)
      controls.update()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.n])

  return null
}

const VIEW_BUTTONS: { key: string; label: string }[] = [
  { key: 'iso', label: 'Iso' },
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
]

function AxisCut({
  axis, min, max, cut, onChange,
}: {
  axis: 'x' | 'y' | 'z'
  min: number
  max: number
  cut: Cut
  onChange: (patch: Partial<Cut>) => void
}) {
  return (
    <div className={`vo-cut ${cut.on ? 'on' : ''}`}>
      <button className="vo-axisbtn" onClick={() => onChange({ on: !cut.on })} title="toggle plane">
        {axis.toUpperCase()}
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={cut.pos}
        disabled={!cut.on}
        onChange={(e) => onChange({ pos: parseFloat(e.target.value) })}
      />
      <button className="vo-flip" disabled={!cut.on} onClick={() => onChange({ flip: !cut.flip })} title="flip side">
        ⇄
      </button>
    </div>
  )
}

export function SdfViewer({
  g, designId, family,
}: {
  g: ViewerGeom
  designId: string
  family: string
}) {
  const xMax = g.coreWidth / 2
  const yMax = g.coreLength / 2
  const zMax = g.baseThickness + g.finHeight
  const cz = zMax / 2
  const radius = Math.max(g.coreWidth, g.coreLength, zMax) * 1.85

  const defaultCuts = (): Cuts => ({
    x: { on: false, pos: 0, flip: false },
    y: { on: false, pos: 0, flip: false },
    z: { on: false, pos: cz, flip: false },
  })
  const [cuts, setCuts] = useState<Cuts>(defaultCuts)
  const [viewCmd, setViewCmd] = useState({ view: 'iso', n: 0 })
  const [stl, setStl] = useState<{ busy: boolean; note: string }>({ busy: false, note: '' })
  const [stlQuality, setStlQuality] = useState<StlQuality>('standard')
  // sheet/solid lattices are meshed from the implicit field, so they get a
  // resolution choice; fins and pins are meshed exactly and need none
  const isTpmsSurface = g.family === 'gyroid_tpms' && !g.isPin

  // Reset cuts + framing when the design changes.
  useEffect(() => {
    setCuts(defaultCuts())
    setViewCmd((c) => ({ view: 'iso', n: c.n + 1 }))
    setStl({ busy: false, note: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId])

  const downloadStl = () => {
    if (stl.busy) return
    setStl({ busy: true, note: '' })
    // defer so the "building…" label paints before meshing blocks the thread
    setTimeout(() => {
      try {
        const { buffer, triangles } = buildStl(g, stlQuality)
        const blob = new Blob([buffer], { type: 'model/stl' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${designId.replace(/[^\w.-]+/g, '_')}.stl`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        setStl({ busy: false, note: `${fmtBytes(buffer.byteLength)} · ${triangles.toLocaleString()} tris` })
      } catch (e) {
        setStl({ busy: false, note: `export failed: ${e instanceof Error ? e.message : String(e)}` })
      }
    }, 30)
  }

  const setView = (view: string) => setViewCmd((c) => ({ view, n: c.n + 1 }))
  const patch = (axis: 'x' | 'y' | 'z', p: Partial<Cut>) =>
    setCuts((c) => ({ ...c, [axis]: { ...c[axis], ...p } }))

  return (
    <div className="viewer-wrap">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [-42, -52, 40], up: [0, 0, 1], fov: 40, near: 1, far: 4000 }}
        gl={{ antialias: true }}
      >
        <RayMarcher g={g} cuts={cuts} />
        <OrbitControls
          makeDefault
          target={[0, 0, cz]}
          enablePan
          screenSpacePanning
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
          minDistance={8}
          maxDistance={400}
        />
        <ViewController cmd={viewCmd} target={[0, 0, cz]} radius={radius} />
        <GizmoHelper alignment="top-right" margin={[56, 56]}>
          <GizmoViewport axisColors={['#e5534b', '#2ea043', '#3fb6ff']} labelColor="white" />
        </GizmoHelper>
      </Canvas>

      <div className="vo-hud">
        <div className="vo-title">{designId}</div>
        <div className="vo-views">
          {VIEW_BUTTONS.map((b) => (
            <button key={b.key} className={viewCmd.view === b.key ? 'sel' : ''} onClick={() => setView(b.key)}>
              {b.label}
            </button>
          ))}
        </div>
        <div className="vo-dims">
          {g.family === 'gyroid_tpms'
            ? (g.isPin
                ? <>pin fins{g.pinStagger ? ' · staggered' : ' · inline'}{g.layout === 'cylinder' ? ' · circular' : ''} · {fmt(g.coreLength, 0)}×{fmt(g.coreWidth, 0)}×{fmt(zMax, 1)} mm · Ø{fmt(g.pinDiameter, 2)} mm · pitch {fmt(g.pinPitch, 2)} mm · geometry screening</>
                : <>{g.tpmsType}{g.solid ? ' · solid' : ' · sheet'}{g.layout === 'cylinder' ? ' · circular' : ''}{g.grading > 0 ? ' · graded' : ''} · {fmt(g.coreLength, 0)}×{fmt(g.coreWidth, 0)}×{fmt(zMax, 1)} mm · cell {fmt(g.unitCell, 2)} mm · wall {fmt(g.wallThickness, 2)} mm · geometry screening</>)
            : <>{family} · {fmt(g.coreLength, 0)}×{fmt(g.coreWidth, 0)}×{fmt(zMax, 1)} mm (flow×fins) · {g.finCount} fins · pitch {fmt(g.finThickness + g.gap, 2)} mm{g.waveAmp > 0 ? ` · wave A${fmt(g.waveAmp, 2)}/λ${fmt(g.waveLen, 2)}` : ' · straight'}</>}
        </div>
      </div>

      <div className="vo-controls">
        <span className="vo-cuts-label">Section</span>
        <AxisCut axis="x" min={-xMax} max={xMax} cut={cuts.x} onChange={(p) => patch('x', p)} />
        <AxisCut axis="y" min={-yMax} max={yMax} cut={cuts.y} onChange={(p) => patch('y', p)} />
        <AxisCut axis="z" min={0} max={zMax} cut={cuts.z} onChange={(p) => patch('z', p)} />
        <button className="vo-reset" onClick={() => setCuts(defaultCuts())}>reset</button>
        <span className="vo-sep" />
        {isTpmsSurface && (
          <select className="vo-stlq" value={stlQuality} title="Lattice mesh resolution — sheet lattices export dense"
            onChange={(e) => setStlQuality(e.target.value as StlQuality)}>
            <option value="draft">draft</option>
            <option value="standard">standard</option>
            <option value="fine">fine</option>
          </select>
        )}
        <button className="vo-reset" onClick={downloadStl} disabled={stl.busy}
          title="Download the current model as a binary STL (units: mm)">
          {stl.busy ? 'building…' : '⬇ STL'}
        </button>
        {stl.note && <span className="vo-stl-note">{stl.note}</span>}
      </div>
    </div>
  )
}
