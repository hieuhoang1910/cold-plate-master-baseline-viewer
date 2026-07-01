import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { fmt } from '../format'
import type { ViewerGeom } from '../viewerGeom'

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
uniform float uW, uL, uH, uBase, uT, uGap, uMargin, uAmp, uLambda, uRib, uHasRib, uCutY;

const float PI = 3.14159265359;

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float mapScene(vec3 p) {
  // base slab: z in [0, uBase]
  float base = sdBox(p - vec3(0.0, 0.0, uBase * 0.5),
                     vec3(uW * 0.5, uL * 0.5, uBase * 0.5));

  float zc = uBase + uH * 0.5;
  float dx = uAmp * sin(2.0 * PI * p.y / uLambda);   // wave displaces fins in x along flow (y)
  float xw = p.x - dx;
  float pitch = uT + uGap;
  float m = mod(xw + 0.5 * pitch, pitch) - 0.5 * pitch;
  float dWall = abs(m) - uT * 0.5;                   // distance to nearest fin wall
  float fieldHalf = uW * 0.5 - uMargin;
  float dbox = sdBox(p - vec3(0.0, 0.0, zc), vec3(fieldHalf, uL * 0.5, uH * 0.5));
  float fins = max(dWall * 0.6, dbox);               // 0.6 = Lipschitz guard for the wave

  float solid = min(base, fins);

  if (uHasRib > 0.5) {
    float rib = sdBox(p - vec3(0.0, 0.0, zc), vec3(uW * 0.5, uRib * 0.5, uH * 0.5));
    solid = min(solid, rib);
  }

  solid = max(solid, p.y - uCutY);                   // section cut: drop y > uCutY
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
  vec3 cu = mix(vec3(0.78, 0.47, 0.25), vec3(0.95, 0.66, 0.40), h);   // copper, brighter at fin tips
  vec3 col = cu * (amb + 0.75 * d1) + vec3(1.0, 0.92, 0.82) * (0.18 * d2);
  float fres = pow(1.0 - max(dot(nor, vdir), 0.0), 3.0);
  col += fres * 0.14;
  col = pow(col, vec3(0.4545));                       // gamma
  gl_FragColor = vec4(col, 1.0);
}
`

function RayMarcher({ g, cutY }: { g: ViewerGeom; cutY: number }) {
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
      uCutY: { value: cutY },
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
  }, [g])

  useEffect(() => {
    const u = matRef.current?.uniforms
    if (u) u.uCutY.value = cutY
  }, [cutY])

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
    <mesh frustumCulled={false}>
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

export function SdfViewer({
  g, designId, family,
}: {
  g: ViewerGeom
  designId: string
  family: string
}) {
  const noCut = g.coreLength / 2
  const [cut, setCut] = useState(noCut)
  // Reset the section cut when the design changes.
  useEffect(() => setCut(g.coreLength / 2), [designId, g.coreLength])

  const cz = (g.baseThickness + g.finHeight) / 2

  return (
    <div className="viewer-wrap">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [-42, -52, 40], up: [0, 0, 1], fov: 40, near: 1, far: 4000 }}
        gl={{ antialias: true }}
      >
        <RayMarcher g={g} cutY={cut} />
        <OrbitControls makeDefault target={[0, 0, cz]} enablePan={false} minDistance={8} maxDistance={400} />
      </Canvas>

      <div className="viewer-overlay">
        <div className="vo-title">{designId}</div>
        <div className="vo-dims">
          {family} · {g.coreWidth}×{g.coreLength}×{fmt(g.baseThickness + g.finHeight, 1)} mm ·{' '}
          {g.finCount} fins · pitch {fmt(g.finThickness + g.gap, 2)} mm
          {g.waveAmp > 0 ? ` · wave A${fmt(g.waveAmp, 2)}/λ${fmt(g.waveLen, 2)}` : ' · straight'}
        </div>
        <label className="vo-row">
          <span>Section cut {cut >= noCut ? '(off)' : `y = ${fmt(cut, 1)} mm`}</span>
          <input
            type="range"
            min={-g.coreLength / 2}
            max={g.coreLength / 2}
            step={0.5}
            value={cut}
            onChange={(e) => setCut(parseFloat(e.target.value))}
          />
        </label>
        <div className="vo-hint">drag orbit · scroll zoom · slide to cut · 1 unit = 1 mm</div>
      </div>
    </div>
  )
}
