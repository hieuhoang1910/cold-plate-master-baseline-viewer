import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { fmt } from '../format'
import { buildStl, type StlQuality } from '../stl'
import { SLOWMO, timeScaleLabel, type FlowViz } from '../flowviz'
import { useFlowField, type FlowFieldResult } from '../flowfield/useFlowField'
import type { FieldInput } from '../flowfield/field'
import { FlowFieldLayer } from './FlowFieldLayer'
import { FlowExplainer } from './FlowExplainer'
import type { ViewerGeom } from '../viewerGeom'

function fmtBytes(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`
}
const pct01 = (f: number) => `${Math.round(f * 100)}%`

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
// V5.2 flow-intent layer (T0): dashes advected along the layout's route at the
// S6-solved speed (slow-motion). Drawn on a mid-height fluid plane, masked to
// the open channel by the same SDF — design intent, not CFD.
uniform float uFlowOn;     // 1 = layer visible
uniform float uTime;       // seconds
uniform float uFlowLayout; // 0 single/u-flow · 1 center-feed · 2 serpentine · 3 distributed-jet
uniform float uFlowSpeed;  // dash speed, mm/s (slow-motion already applied)
uniform float uNSeg;       // serpentine passes / distributed-jet duct count
// V5.4/V5.6 — colour modes. 0 steel · 1 thermal tint · 2 ΔP budget.
// Tint anchors are SOLVER numbers (T_in, ΔT_cal, Q·R_conv, mH from η_f);
// when the F1 field is on its textures replace the 1-D profiles.
uniform float uColorMode;
uniform float uTIn, uDTcal, uDTwall, uMH, uPathLen, uTMaxN;
uniform float uDpTotal, uDpMinorFrac;
uniform sampler2D uTTex, uPTex, uVTex;   // F1 fields, 8-bit normalized
uniform float uTexOn;
uniform vec2 uTexOrigin, uTexSize;       // fin-band rect (mm, min corner + extents)
uniform vec2 uTScale, uPScale, uVScale;  // texel -> physical (min, max)
uniform float uVDead;                    // dead-zone velocity threshold (m/s)
uniform mat4 uViewProj;                  // V5.5 — depth write for compositing

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

float coreField(vec3 p) {
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

  return core;
}

// > 0 where a section plane has removed the point.
float cutsRemove(vec3 p) {
  float d = -1e6;
  if (uCutOn.x > 0.5) d = max(d, uCutSign.x * (p.x - uCut.x));
  if (uCutOn.y > 0.5) d = max(d, uCutSign.y * (p.y - uCut.y));
  if (uCutOn.z > 0.5) d = max(d, uCutSign.z * (p.z - uCut.z));
  return d;
}

float mapScene(vec3 p) {
  // base slab: z in [0, uBase]
  float base = sdBox(p - vec3(0.0, 0.0, uBase * 0.5),
                     vec3(uW * 0.5, uL * 0.5, uBase * 0.5));
  float solid = min(base, coreField(p));
  return max(solid, cutsRemove(p));
}

// V5.2 — distance along the layout's intended route (mm). Dash phase moves
// toward increasing s, so the animation direction IS the routing direction
// (ICE: outward from the feed lines — top windows are the pump inlet, §54 Q1).
float flowPhase(vec3 p) {
  float yy = p.y + uL * 0.5;                      // 0 at the -y edge
  if (uFlowLayout < 0.5) return yy;               // single pass / u-flow
  if (uFlowLayout < 1.5) return abs(p.y);         // center-feed: outward from the rib
  if (uFlowLayout < 2.5) {                        // serpentine: alternating passes
    float bandW = uW / max(uNSeg, 1.0);
    float seg = floor((p.x + uW * 0.5) / bandW);
    float along = (mod(seg, 2.0) < 0.5) ? yy : (uL - yy);
    return seg * uL + along;
  }
  // distributed-jet compartments: feed lines every 2·pitch (duct pitch),
  // dashes radiate from each feed line to its two neighbouring return gaps
  float pc = uL / (2.0 * max(uNSeg, 1.0));        // compartment pitch
  return abs(mod(yy, 2.0 * pc) - pc);
}

// ---- V5.4/V5.6 tint helpers ----
float texVal(sampler2D s, vec2 sc, vec2 xy) {
  vec2 uv = clamp((xy - uTexOrigin) / uTexSize, vec2(0.001), vec2(0.999));
  return sc.x + texture2D(s, uv).r * (sc.y - sc.x);
}
float fluidT(vec3 p) {
  if (uTexOn > 0.5) return texVal(uTTex, uTScale, p.xy);
  return uTIn + uDTcal * clamp(flowPhase(p) / max(uPathLen, 1e-3), 0.0, 1.0);
}
vec3 heatmap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c1 = vec3(0.13, 0.25, 0.70);
  vec3 c2 = vec3(0.05, 0.65, 0.85);
  vec3 c3 = vec3(0.95, 0.85, 0.25);
  vec3 c4 = vec3(0.90, 0.20, 0.12);
  return t < 0.34 ? mix(c1, c2, t / 0.34)
       : t < 0.67 ? mix(c2, c3, (t - 0.34) / 0.33)
       : mix(c3, c4, (t - 0.67) / 0.33);
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

  vec3 col;
  if (hit < 0.0) {
    col = mix(vec3(0.055, 0.075, 0.10), vec3(0.10, 0.13, 0.17), vUv.y);
  } else {
    vec3 nor = calcNormal(pos);
    vec3 vdir = -rd;
    vec3 L1 = normalize(vec3(0.45, 0.35, 0.82));
    vec3 L2 = normalize(vec3(-0.5, -0.6, 0.4));
    float d1 = max(dot(nor, L1), 0.0);
    float d2 = max(dot(nor, L2), 0.0);
    float amb = 0.28 + 0.12 * clamp(nor.z, 0.0, 1.0);
    float h = clamp((pos.z - uBase) / max(uH, 1e-3), 0.0, 1.0);
    vec3 steel = mix(vec3(0.50, 0.53, 0.57), vec3(0.80, 0.82, 0.85), h); // stainless, brighter at tips
    float fres = pow(1.0 - max(dot(nor, vdir), 0.0), 3.0);
    if (uColorMode < 0.5) {
      col = steel * (amb + 0.75 * d1) + vec3(1.0) * (0.20 * d2);
      col += fres * 0.14;
    } else if (uColorMode < 1.5) {
      // thermal tint: local fluid T + the fin conduction (cosh) profile in z
      float Tf = fluidT(pos);
      float T;
      if (pos.z > uBase + 0.001) {
        float hf = clamp((pos.z - uBase) / max(uH, 1e-3), 0.0, 1.0);
        float th = (uMH < 10.0) ? cosh(uMH * (1.0 - hf)) / cosh(uMH) : exp(-uMH * hf);
        T = Tf + uDTwall * th;                       // root hot, tip ~fluid (low η_f)
      } else {
        T = Tf + uDTwall * 1.03;                     // base slab, just above the roots
      }
      float tn = (T - uTIn) / max(uTMaxN - uTIn, 1e-3);
      col = heatmap(tn) * (0.42 + 0.62 * d1 + 0.18 * d2);
      col += fres * 0.10;
    } else {
      // ΔP mode: metal recedes; the budget story lives on the fluid sheet
      col = steel * (amb + 0.75 * d1) * 0.40 + vec3(1.0) * (0.08 * d2);
    }
    col = pow(col, vec3(0.4545));                   // gamma (solid only, as V1)
  }

  // V5.2 — flow-intent lanes: a translucent fluid sheet at mid-fin height,
  // masked to the open channel, dashes advected along the route at S6 speed.
  // V5.7 — hidden in THERMAL mode: the fluid story lives on the moving
  // parcels there; the tint stays the FINS' own conduction picture.
  if (uFlowOn > 0.5 && abs(rd.z) > 1e-5 && (uColorMode < 0.5 || uColorMode > 1.5)) {
    float zPlane = uBase + uH * 0.58;
    float tp = (zPlane - ro.z) / rd.z;
    if (tp > 0.0 && (hit < 0.0 || tp < hit)) {
      vec3 fp = ro + rd * tp;
      bool inCore = abs(fp.x) < uW * 0.5 - uMargin && abs(fp.y) < uL * 0.5;
      if (inCore && cutsRemove(fp) < 0.0 && coreField(fp) > 0.012) {
        float dashLen = max(uLambda, 1.2);
        float ph = (flowPhase(fp) - uFlowSpeed * uTime) / dashLen;
        float dash = smoothstep(0.50, 0.28, abs(fract(ph) - 0.5));
        vec3 laneCol;
        float alpha;
        if (uColorMode < 0.5) {
          laneCol = vec3(0.22, 0.72, 1.0);          // water accent
          alpha = 0.10 + 0.42 * dash;
        } else if (uColorMode < 1.5) {
          float tn = (fluidT(fp) - uTIn) / max(uTMaxN - uTIn, 1e-3);
          laneCol = heatmap(tn);
          alpha = 0.42 + 0.22 * dash;
        } else {
          // ΔP budget: red = pressure unspent (inlet) -> blue = spent (outlet)
          float pn;
          if (uTexOn > 0.5) {
            pn = texVal(uPTex, uPScale, fp.xy) / max(uPScale.y, 1e-3);
          } else {
            float s = clamp(flowPhase(fp) / max(uPathLen, 1e-3), 0.0, 1.0);
            float minorSpent = (uFlowLayout > 1.5 && uFlowLayout < 2.5)
              ? s : smoothstep(0.0, 0.06, s);       // serpentine spends K at bends; others at entry
            pn = 1.0 - (uDpMinorFrac * minorSpent + (1.0 - uDpMinorFrac) * s);
          }
          laneCol = heatmap(pn);
          alpha = 0.46 + 0.20 * dash;
        }
        // F1 dead-zone shading: near-stagnant cells surface as dark magenta
        if (uTexOn > 0.5 && uColorMode > 0.5) {
          float vloc = texVal(uVTex, uVScale, fp.xy);
          if (vloc < uVDead) {
            laneCol = mix(vec3(0.36, 0.05, 0.30), laneCol, 0.30);
            alpha = max(alpha, 0.55);
          }
        }
        col = mix(col, laneCol, alpha);
      }
    }
  }

  // three maps gl_FragDepthEXT -> gl_FragDepth in its WebGL2 prefix; using
  // the EXT alias keeps the shader in three's compatibility path (an explicit
  // glslVersion: GLSL3 would drop the gl_FragColor/varying defines — that
  // exact mistake shipped once and blacked out the stage)
  if (hit >= 0.0) {
    vec4 clip = uViewProj * vec4(pos, 1.0);
    gl_FragDepthEXT = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  } else {
    gl_FragDepthEXT = 1.0;
  }
  gl_FragColor = vec4(col, 1.0);
}
`

const TPMS_IDX: Record<string, number> = {
  gyroid: 0, diamond: 1, schwarz_p: 2, lidinoid: 3,
  split_p: 4, iwp: 5, neovius: 6, fischer_koch: 7, pin_fins: 0,
}

interface Cut { on: boolean; pos: number; flip: boolean }
interface Cuts { x: Cut; y: Cut; z: Cut }

/** V5.2 — what the flow layer animates (from flowVizFrom, null = layer off). */
export interface FlowLayer {
  on: boolean
  code: number
  speedMmS: number
  nSeg: number
}

/** V5.4/V5.6 — solver-anchored tint values for the thermal / ΔP modes. */
export interface TintUniforms {
  colorMode: number   // 0 steel · 1 thermal · 2 ΔP
  TIn: number
  dTcal: number
  dTwall: number
  mH: number
  pathLen: number     // mm — normalizes flowPhase for the 1-D profiles
  tMaxN: number       // colormap top (°C)
  dpTotal: number
  dpMinorFrac: number
}

function makeFieldTex(arr: Float32Array, nx: number, ny: number) {
  let mn = Infinity, mx = -Infinity
  for (let k = 0; k < arr.length; k++) { const v = arr[k]; if (v < mn) mn = v; if (v > mx) mx = v }
  if (!(mx > mn)) mx = mn + 1
  const data = new Uint8Array(arr.length)
  for (let k = 0; k < arr.length; k++) data[k] = Math.round(((arr[k] - mn) / (mx - mn)) * 255)
  const tex = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.UnsignedByteType)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return { tex, min: mn, max: mx }
}
const DUMMY_TEX = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType)
DUMMY_TEX.needsUpdate = true

function RayMarcher({ g, cuts, flow, tint, field }: {
  g: ViewerGeom
  cuts: Cuts
  flow: FlowLayer | null
  tint: TintUniforms | null
  field: FlowFieldResult | null
}) {
  const { camera } = useThree()
  const matRef = useRef<THREE.ShaderMaterial>(null)

  // F1 field textures (8-bit normalized + physical scales)
  const fieldTex = useMemo(() => {
    if (!field) return null
    const p = makeFieldTex(field.pGrid, field.nx, field.ny)
    const v = makeFieldTex(field.vGrid, field.nx, field.ny)
    const t = field.tGrid ? makeFieldTex(field.tGrid, field.nx, field.ny) : null
    let vSum = 0
    for (let k = 0; k < field.vGrid.length; k++) vSum += field.vGrid[k]
    return {
      p, v, t,
      vDead: 0.05 * (vSum / field.vGrid.length),
      origin: [-(field.nx * field.dx) / 2, -(field.ny * field.dy) / 2] as const,
      size: [field.nx * field.dx, field.ny * field.dy] as const,
    }
  }, [field])
  useEffect(() => () => {
    if (!fieldTex) return
    fieldTex.p.tex.dispose(); fieldTex.v.tex.dispose(); fieldTex.t?.tex.dispose()
  }, [fieldTex])

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
      uFlowOn: { value: 0 },
      uTime: { value: 0 },
      uFlowLayout: { value: 1 },
      uFlowSpeed: { value: 0 },
      uNSeg: { value: 2 },
      uColorMode: { value: 0 },
      uTIn: { value: 25 }, uDTcal: { value: 2.4 }, uDTwall: { value: 4 },
      uMH: { value: 3 }, uPathLen: { value: 14 }, uTMaxN: { value: 32 },
      uDpTotal: { value: 1 }, uDpMinorFrac: { value: 0.2 },
      uTTex: { value: DUMMY_TEX }, uPTex: { value: DUMMY_TEX }, uVTex: { value: DUMMY_TEX },
      uTexOn: { value: 0 },
      uTexOrigin: { value: new THREE.Vector2(0, 0) },
      uTexSize: { value: new THREE.Vector2(1, 1) },
      uTScale: { value: new THREE.Vector2(0, 1) },
      uPScale: { value: new THREE.Vector2(0, 1) },
      uVScale: { value: new THREE.Vector2(0, 1) },
      uVDead: { value: 0 },
      uViewProj: { value: new THREE.Matrix4() },
    }),
    [], // created once; kept in sync by the effects below
  )

  useEffect(() => {
    const u = matRef.current?.uniforms
    if (!u) return
    u.uColorMode.value = tint?.colorMode ?? 0
    if (tint) {
      u.uTIn.value = tint.TIn
      u.uDTcal.value = tint.dTcal
      u.uDTwall.value = tint.dTwall
      u.uMH.value = tint.mH
      u.uPathLen.value = tint.pathLen
      u.uTMaxN.value = tint.tMaxN
      u.uDpTotal.value = tint.dpTotal
      u.uDpMinorFrac.value = tint.dpMinorFrac
    }
  }, [tint])

  useEffect(() => {
    const u = matRef.current?.uniforms
    if (!u) return
    if (fieldTex) {
      u.uTexOn.value = 1
      u.uPTex.value = fieldTex.p.tex
      u.uPScale.value.set(fieldTex.p.min, fieldTex.p.max)
      u.uVTex.value = fieldTex.v.tex
      u.uVScale.value.set(fieldTex.v.min, fieldTex.v.max)
      if (fieldTex.t) {
        u.uTTex.value = fieldTex.t.tex
        u.uTScale.value.set(fieldTex.t.min, fieldTex.t.max)
      } else {
        u.uTTex.value = DUMMY_TEX
      }
      u.uVDead.value = fieldTex.vDead
      u.uTexOrigin.value.set(fieldTex.origin[0], fieldTex.origin[1])
      u.uTexSize.value.set(fieldTex.size[0], fieldTex.size[1])
    } else {
      u.uTexOn.value = 0
      u.uTTex.value = DUMMY_TEX
      u.uPTex.value = DUMMY_TEX
      u.uVTex.value = DUMMY_TEX
    }
  }, [fieldTex])

  useEffect(() => {
    const u = matRef.current?.uniforms
    if (!u) return
    u.uFlowOn.value = flow?.on ? 1 : 0
    u.uFlowLayout.value = flow?.code ?? 1
    u.uFlowSpeed.value = flow?.speedMmS ?? 0
    u.uNSeg.value = flow?.nSeg ?? 2
  }, [flow])

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

  useFrame((state) => {
    const u = matRef.current?.uniforms
    if (!u) return
    u.uViewProj.value
      .copy(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
    u.uInvViewProj.value.copy(u.uViewProj.value).invert()
    u.uTime.value = state.clock.elapsedTime
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
        depthWrite
      />
    </mesh>
  )
}

// V4 — scroll-intro rig: while introT < 1 the camera flies a cinematic path
// (far dolly-in with a slow azimuth sweep) that lands exactly on the standard
// iso pose, where OrbitControls takes over. Driven by the page scroll.
const ISO_AZ = Math.atan2(-0.72, -0.72)          // ≈ −2.356 rad
const ISO_EL = Math.asin(0.62 / Math.hypot(0.72, 0.72, 0.62)) // ≈ 0.547 rad

function IntroRig({ t, target, radius }: { t: number; target: [number, number, number]; radius: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null
  useFrame(() => {
    if (t >= 1) return
    const e = 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3) // ease-out cubic
    const az = ISO_AZ - 1.15 * (1 - e)
    const el = 0.14 + (ISO_EL - 0.14) * e
    const r = radius * (4.4 - 3.4 * e)
    camera.up.set(0, 0, 1)
    camera.position.set(
      target[0] + r * Math.cos(el) * Math.cos(az),
      target[1] + r * Math.cos(el) * Math.sin(az),
      target[2] + r * Math.sin(el),
    )
    camera.lookAt(target[0], target[1], target[2])
    if (controls) {
      controls.target.set(target[0], target[1], target[2])
    }
  })
  return null
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

// ---------------------------------------------------------------------------
// V5.2 — routing glyphs: cone+shaft arrows stating the layout's intended flow
// directions (annotations drawn over the raymarch — design intent, not CFD).
// Directions follow §54 Q1: ICE top windows are the pump INLET (feed down),
// returns vent at the part sides; center-feed splits outward at the rib.
// ---------------------------------------------------------------------------
interface Arrow { pos: [number, number, number]; dir: [number, number, number]; len: number; feed?: boolean }

function layoutArrows(g: ViewerGeom, code: number, nSeg: number): Arrow[] {
  const W = g.coreWidth, L = g.coreLength
  const zTop = g.baseThickness + g.finHeight
  const a: Arrow[] = []
  if (code === 0) {
    // single pass / u-flow: in at -y, straight through, out at +y
    a.push({ pos: [0, -L / 2 - 5, zTop / 2], dir: [0, 1, 0], len: 4.5, feed: true })
    a.push({ pos: [0, L / 2 + 1.5, zTop / 2], dir: [0, 1, 0], len: 4.5 })
  } else if (code === 1) {
    // center-feed: down onto the rib crown, split outward, out both ends
    a.push({ pos: [0, 0, zTop + 5.5], dir: [0, 0, -1], len: 4.5, feed: true })
    a.push({ pos: [0, L / 8, zTop + 1.2], dir: [0, 1, 0], len: 3.2 })
    a.push({ pos: [0, -L / 8, zTop + 1.2], dir: [0, -1, 0], len: 3.2 })
    a.push({ pos: [0, L / 2 + 1.5, zTop / 2], dir: [0, 1, 0], len: 4 })
    a.push({ pos: [0, -L / 2 - 5.5, zTop / 2], dir: [0, -1, 0], len: 4 })
  } else if (code === 2) {
    // serpentine: alternating passes with 180° turns
    const bandW = W / nSeg
    for (let k = 0; k < nSeg; k++) {
      const x = -W / 2 + (k + 0.5) * bandW
      const up = k % 2 === 0
      a.push({ pos: [x, up ? -L / 4 : L / 4, zTop + 1.2], dir: [0, up ? 1 : -1, 0], len: 3.4, feed: k === 0 })
    }
    a.push({ pos: [-W / 2 + 0.5 * bandW, -L / 2 - 5, zTop / 2], dir: [0, 1, 0], len: 4, feed: true })
  } else {
    // distributed-jet (ICE rev 3): feed DOWN at each duct line (top windows =
    // pump inlet), returns UP between them, collected out BOTH part sides
    const pc = L / (2 * nSeg)
    for (let k = 0; k < nSeg; k++) {
      const y = -L / 2 + (2 * k + 1) * pc
      a.push({ pos: [0, y, zTop + 4.6], dir: [0, 0, -1], len: 3.6, feed: true })
    }
    for (let k = 1; k < nSeg; k++) {
      const y = -L / 2 + 2 * k * pc
      a.push({ pos: [W / 4, y, zTop + 1.0], dir: [0, 0, 1], len: 2.6 })
      a.push({ pos: [-W / 4, y, zTop + 1.0], dir: [0, 0, 1], len: 2.6 })
    }
    a.push({ pos: [W / 2 + 1.5, 0, zTop - 1], dir: [1, 0, 0], len: 4 })
    a.push({ pos: [-W / 2 - 1.5, 0, zTop - 1], dir: [-1, 0, 0], len: 4 })
  }
  return a
}

// V5.5 — follow-a-parcel: the camera rides the longest solved streamline at
// slow-motion speed; Esc or the button exits. The 30-second design-review demo.
function RideRig({ field, x0, y0, z }: {
  field: FlowFieldResult; x0: number; y0: number; z: number
}) {
  const camera = useThree((s) => s.camera)
  const line = useMemo(() => {
    const offs = field.lineOffsets
    let best = 0, bestT = -1
    for (let l = 0; l < offs.length - 1; l++) {
      const T = field.linePoints[3 * (offs[l + 1] - 1) + 2]
      if (T > bestT) { bestT = T; best = l }
    }
    return { a: offs[best], b: offs[best + 1], T: bestT }
  }, [field])
  useFrame((state) => {
    const { a, b, T } = line
    if (!(T > 0) || b - a < 2) return
    const P = field.linePoints
    const tt = ((state.clock.elapsedTime / SLOWMO) % T + T) % T
    let lo = a, hi = b - 1
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (P[3 * mid + 2] <= tt) lo = mid
      else hi = mid
    }
    const f = P[3 * hi + 2] > P[3 * lo + 2] ? (tt - P[3 * lo + 2]) / (P[3 * hi + 2] - P[3 * lo + 2]) : 0
    const px = x0 + P[3 * lo] + f * (P[3 * hi] - P[3 * lo])
    const py = y0 + P[3 * lo + 1] + f * (P[3 * hi + 1] - P[3 * lo + 1])
    const ax = P[3 * hi] - P[3 * lo], ay = P[3 * hi + 1] - P[3 * lo + 1]
    const al = Math.hypot(ax, ay) || 1
    camera.up.set(0, 0, 1)
    camera.position.set(px - (ax / al) * 6, py - (ay / al) * 6, z + 4)
    camera.lookAt(px + (ax / al) * 3, py + (ay / al) * 3, z)
  })
  return null
}

const _up = new THREE.Vector3(0, 1, 0)

function FlowGlyphs({ g, code, nSeg }: { g: ViewerGeom; code: number; nSeg: number }) {
  const arrows = useMemo(() => layoutArrows(g, code, nSeg), [g, code, nSeg])
  return (
    <group>
      {arrows.map((ar, i) => {
        const dir = new THREE.Vector3(...ar.dir).normalize()
        const quat = new THREE.Quaternion().setFromUnitVectors(_up, dir)
        const color = ar.feed ? '#38c0ff' : '#7fd7ff'
        return (
          <group key={i} position={ar.pos} quaternion={quat}>
            <mesh position={[0, ar.len * 0.32, 0]}>
              <cylinderGeometry args={[0.28, 0.28, ar.len * 0.64, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
            </mesh>
            <mesh position={[0, ar.len * 0.78, 0]}>
              <coneGeometry args={[0.75, ar.len * 0.44, 14]} />
              <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
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
  g, designId, family, introT = 1, hud = true, gizmoMargin = [56, 56], flow = null,
}: {
  g: ViewerGeom
  designId: string
  family: string
  /** V4 scroll intro: 0 = far cinematic view, 1 = interactive workspace pose */
  introT?: number
  /** hide the HUD/section controls/gizmo (e.g. while a pane covers the stage) */
  hud?: boolean
  /** gizmo offset — pushed left of the KPI drawer in stage mode */
  gizmoMargin?: [number, number]
  /** V5.2 — flow-intent layer descriptor (null = fin-flow viz unavailable) */
  flow?: FlowViz | null
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
  const [flowOn, setFlowOn] = useState(false)
  const [colorMode, setColorMode] = useState<'steel' | 'thermal' | 'dp'>('steel')
  const [riding, setRiding] = useState(false)
  const [showExplain, setShowExplain] = useState(false)
  const [probe, setProbe] = useState<{ x: number; y: number; text: string } | null>(null)
  const camRef = useRef<THREE.Camera | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [viewCmd, setViewCmd] = useState({ view: 'iso', n: 0 })

  // V5.4 — the layout's path length (mm), normalizing the 1-D tint profiles.
  const pathLen = useMemo(() => {
    if (!flow) return g.coreLength
    if (flow.code === 1) return g.coreLength / 2
    if (flow.code === 2) return flow.nSeg * g.coreLength
    if (flow.code === 3) return g.coreLength / (2 * Math.max(1, flow.nSeg))
    return g.coreLength
  }, [flow, g.coreLength])

  // V5.3/V5.4 — F1 field solve (worker, debounced); runs for the flow layer
  // AND for the tint modes (their textures come from it when available).
  const fieldInput = useMemo((): FieldInput | null => {
    if (!flow || g.family === 'gyroid_tpms') return null
    return {
      coreWidth: g.coreWidth, coreLength: g.coreLength, finHeight: g.finHeight,
      finThickness: g.finThickness, gap: g.gap, sideMargin: g.sideMargin,
      waveAmp: g.waveAmp, waveLen: g.waveLen,
      layout: flow.layout, nSeg: flow.nSeg,
      mu: flow.mu, rho: flow.rho, flowM3s: flow.flowM3s,
      meanRe: flow.meanRe, relRoughness: 0.03,
      heatW: flow.thermal?.heatW, cp: flow.thermal?.cp, TIn: flow.thermal?.TIn,
    }
  }, [g, flow])
  const vizActive = !!flow && (flowOn || colorMode !== 'steel')
  const { result: field, solving: fieldSolving } = useFlowField(fieldInput, vizActive)

  // V5.4/V5.6 — solver-anchored tint uniforms.
  const tint = useMemo((): TintUniforms | null => {
    if (!flow || colorMode === 'steel') return null
    const th = flow.thermal
    const TIn = th?.TIn ?? 25
    const dTcal = th?.dTcal ?? 0
    const dTwall = th?.dTwall ?? 0
    return {
      colorMode: colorMode === 'thermal' ? 1 : 2,
      TIn, dTcal, dTwall,
      mH: th?.mH ?? 3,
      pathLen,
      tMaxN: Math.max(TIn + dTcal, field?.tMax ?? 0) + dTwall * 1.05,
      dpTotal: flow.dp?.totalPa ?? 1,
      dpMinorFrac: flow.dp?.minorFrac ?? 0.2,
    }
  }, [flow, colorMode, pathLen, field])

  // hover probe over the fluid sheet (thermal / ΔP / flow layers)
  const sheetZ = g.baseThickness + g.finHeight * 0.58
  const onProbeMove = (e: React.PointerEvent) => {
    if (!vizActive || riding || !camRef.current || !wrapRef.current) { if (probe) setProbe(null); return }
    const r = wrapRef.current.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const nyc = -(((e.clientY - r.top) / r.height) * 2 - 1)
    const cam = camRef.current
    const o = new THREE.Vector3(nx, nyc, -1).unproject(cam)
    const f = new THREE.Vector3(nx, nyc, 1).unproject(cam)
    const d = f.sub(o).normalize()
    if (Math.abs(d.z) < 1e-6) { setProbe(null); return }
    const t = (sheetZ - o.z) / d.z
    if (t < 0) { setProbe(null); return }
    const px = o.x + d.x * t, py = o.y + d.y * t
    const Wf = g.coreWidth - 2 * g.sideMargin
    if (Math.abs(px) > Wf / 2 || Math.abs(py) > g.coreLength / 2) { setProbe(null); return }
    let text: string
    if (field) {
      const i = Math.min(field.nx - 1, Math.max(0, Math.floor((px + (field.nx * field.dx) / 2) / field.dx)))
      const j = Math.min(field.ny - 1, Math.max(0, Math.floor((py + (field.ny * field.dy) / 2) / field.dy)))
      const id = j * field.nx + i
      const parts = [`v ${fmt(field.vGrid[id], 2)} m/s`, `p ${fmt(field.pGrid[id] / 1000, 2)} kPa`]
      if (field.tGrid) parts.unshift(`T ${fmt(field.tGrid[id], 2)} °C`)
      text = parts.join(' · ')
    } else if (flow?.thermal) {
      const th = flow.thermal
      text = `T ~${fmt(th.TIn + th.dTcal * 0.5, 1)} °C (1-D) · v ${fmt(flow.realV, 2)} m/s`
    } else {
      text = `v ${fmt(flow?.realV ?? 0, 2)} m/s`
    }
    setProbe({ x: e.clientX - r.left, y: e.clientY - r.top, text })
  }

  // Esc exits the parcel ride
  useEffect(() => {
    if (!riding) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRiding(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [riding])
  useEffect(() => { if (!field) setRiding(false) }, [field])
  // §49 anchor: F1 resolves friction only → reconcile against S6's friction
  // component, never the total (minor losses live outside the sheet).
  const s6Friction = flow?.block?.deltaP_breakdown?.friction_Pa ?? null
  const f1Ratio = field && s6Friction ? field.deltaP / s6Friction : null
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
    <div className="viewer-wrap" ref={wrapRef}
      onPointerMove={onProbeMove} onPointerLeave={() => setProbe(null)}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [-42, -52, 40], up: [0, 0, 1], fov: 40, near: 1, far: 4000 }}
        gl={{ antialias: true }}
        onCreated={(s) => { camRef.current = s.camera }}
      >
        <RayMarcher g={g} cuts={cuts}
          flow={flow ? { on: vizActive, code: flow.code, speedMmS: flow.speedMmS, nSeg: flow.nSeg } : null}
          tint={tint} field={vizActive ? field : null} />
        {flow && flowOn && <FlowGlyphs g={g} code={flow.code} nSeg={flow.nSeg} />}
        {flow && flowOn && field && (
          <FlowFieldLayer field={field} g={g} code={flow.code}
            coreWidth={g.coreWidth} coreLength={g.coreLength}
            z={g.baseThickness + g.finHeight * 0.62}
            mode={colorMode}
            thermal={flow.thermal ? { TIn: flow.thermal.TIn, dTcal: flow.thermal.dTcal } : null} />
        )}
        {riding && field && (
          <RideRig field={field} x0={-(field.nx * field.dx) / 2} y0={-(field.ny * field.dy) / 2} z={sheetZ} />
        )}
        <OrbitControls
          makeDefault
          enabled={introT >= 1 && !riding}
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
        {introT < 1 && <IntroRig t={introT} target={[0, 0, cz]} radius={radius} />}
        <ViewController cmd={viewCmd} target={[0, 0, cz]} radius={radius} />
        {hud && introT >= 1 && (
          <GizmoHelper alignment="top-right" margin={gizmoMargin}>
            <GizmoViewport axisColors={['#e5534b', '#2ea043', '#3fb6ff']} labelColor="white" />
          </GizmoHelper>
        )}
      </Canvas>

      <div className="vo-hud" style={{ opacity: hud && introT >= 1 ? 1 : 0, transition: 'opacity 0.4s ease' }}>
        <div className="vo-title">{designId}</div>
        <div className="vo-views">
          {VIEW_BUTTONS.map((b) => (
            <button key={b.key} className={viewCmd.view === b.key ? 'sel' : ''} onClick={() => setView(b.key)}>
              {b.label}
            </button>
          ))}
        </div>
        {flow && (flowOn || colorMode !== 'steel') && (
          <div className="vo-flowchips">
            <span className="vo-chip vo-chip-intent" title="Everything animated is the layout's routing at the S6 network-solved speed — a statement of design intent for CFD to confirm, not a simulation.">
              design intent — confirm by CFD
            </span>
            <span className="vo-chip" title={`Dashes move at the S6 mean channel velocity (${fmt(flow.realV, 2)} m/s) slowed for readability.`}>
              {timeScaleLabel()} · v {fmt(flow.realV, 2)} m/s
            </span>
            {flow.block?.reconciliation && (
              <span className={`vo-chip ${flow.block.reconciliation.within_tolerance ? 'vo-chip-ok' : 'vo-chip-warn'}`}
                title={`S6 network ΔP ${fmt(flow.block.reconciliation.network_deltaP_Pa / 1000, 1)} kPa vs solver ${fmt(flow.block.reconciliation.solver_deltaP_Pa / 1000, 1)} kPa (ratio ${fmt(flow.block.reconciliation.ratio, 3)}). KPI numbers are always the solver's.`}>
                {flow.block.reconciliation.within_tolerance ? '✓ reconciled' : '⚠ ΔP diverges'}
              </span>
            )}
            {flow.block?.uniformity_computed != null && (
              <span className="vo-chip" title="S6 network-computed flow uniformity (1.0 = perfectly even split across paths).">
                U {fmt(flow.block.uniformity_computed, 3)}
              </span>
            )}
            {colorMode === 'thermal' && flow.thermal && (
              <span className="vo-chip vo-legend"
                title={`Thermal intent: the METAL tint is the fins' own conduction picture (cosh profile, mH ${fmt(flow.thermal.mH, 2)} from η_f; base ≈ fin roots). With ≈ Flow on, the PARCELS carry the fluid temperature (${field?.tGrid ? 'F1 solved T field' : '1-D caloric ramp'}) — they warm blue → red along their journey. Solver-anchored screening, not CHT.`}>
                <i className="vo-lgrad" />
                parcels {fmt(flow.thermal.TIn, 1)}→{fmt(flow.thermal.TIn + flow.thermal.dTcal, 1)} °C
                {' · fin root +'}{fmt(flow.thermal.dTwall, 1)} K
                {flow.thermal.tjC != null && ` · Tj ${fmt(flow.thermal.tjC, 1)}${flow.thermal.tjMaxC != null ? `/${fmt(flow.thermal.tjMaxC, 0)}` : ''} °C`}
              </span>
            )}
            {colorMode === 'dp' && flow.dp && (
              <span className="vo-chip vo-legend"
                title={`ΔP budget: red = pressure unspent (inlet) → blue = spent (outlet). ${field ? 'F1 solved friction field.' : '1-D profile.'} Minor losses (${pct01(flow.dp.minorFrac)}) spend at entries/turns; total is the solver's ΔP.`}>
                <i className="vo-lgrad" />
                ΔP {fmt(flow.dp.totalPa / 1000, 1)} kPa · {pct01(flow.dp.minorFrac)} minor
              </span>
            )}
            {field && field.deadFraction > 0.002 && colorMode !== 'steel' && (
              <span className="vo-chip vo-chip-warn"
                title="Cells with ~no through-flow in the F1 field (shaded dark magenta on the sheet). Low-flow CANDIDATES — reduced-order, confirm recirculation in CFD (FC-5).">
                ◉ {fmt(field.deadFraction * 100, 1)}% low-flow
              </span>
            )}
            {fieldSolving && <span className="vo-chip">F1 solving…</span>}
            {field && !fieldSolving && (
              <span className={`vo-chip ${f1Ratio == null ? '' : Math.abs(f1Ratio - 1) <= 0.15 ? 'vo-chip-ok' : 'vo-chip-warn'}`}
                title={`F1 field solve: ${field.nx}×${field.ny} grid, ${field.iters} sweeps, mass error ${(field.massErr * 100).toFixed(3)}%. Friction ΔP ${fmt(field.deltaP / 1000, 2)} kPa${s6Friction ? ` vs S6 friction ${fmt(s6Friction / 1000, 2)} kPa (ratio ${fmt(f1Ratio ?? 0, 3)})` : ''}. Streamline comets ride the SOLVED field — fast where the flow is favoured. KPIs never read from F1 (spec §49).`}>
                {f1Ratio == null ? `F1 ${fmt(field.deltaP / 1000, 1)} kPa`
                  : Math.abs(f1Ratio - 1) <= 0.15 ? '✓ F1 field' : '⚠ F1 diverges'}
                {` · U ${fmt(field.uniformity, 3)}`}
              </span>
            )}
          </div>
        )}
        <div className="vo-dims">
          {g.family === 'gyroid_tpms'
            ? (g.isPin
                ? <>pin fins{g.pinStagger ? ' · staggered' : ' · inline'}{g.layout === 'cylinder' ? ' · circular' : ''} · {fmt(g.coreLength, 0)}×{fmt(g.coreWidth, 0)}×{fmt(zMax, 1)} mm · Ø{fmt(g.pinDiameter, 2)} mm · pitch {fmt(g.pinPitch, 2)} mm · geometry screening</>
                : <>{g.tpmsType}{g.solid ? ' · solid' : ' · sheet'}{g.layout === 'cylinder' ? ' · circular' : ''}{g.grading > 0 ? ' · graded' : ''} · {fmt(g.coreLength, 0)}×{fmt(g.coreWidth, 0)}×{fmt(zMax, 1)} mm · cell {fmt(g.unitCell, 2)} mm · wall {fmt(g.wallThickness, 2)} mm · geometry screening</>)
            : <>{family} · {fmt(g.coreLength, 0)}×{fmt(g.coreWidth, 0)}×{fmt(zMax, 1)} mm (flow×fins) · {g.finCount} fins · pitch {fmt(g.finThickness + g.gap, 2)} mm{g.waveAmp > 0 ? ` · wave A${fmt(g.waveAmp, 2)}/λ${fmt(g.waveLen, 2)}` : ' · straight'}</>}
        </div>
      </div>

      <div className="vo-controls"
        style={{
          opacity: hud && introT >= 1 ? 1 : 0,
          pointerEvents: hud && introT >= 1 ? 'auto' : 'none',
          transition: 'opacity 0.4s ease',
        }}>
        {flow && (
          <>
            <button className={`vo-flowbtn ${colorMode === 'steel' ? 'on' : ''}`}
              onClick={() => setColorMode('steel')} title="Geometry shading (stainless)">
              Geo
            </button>
            <button className={`vo-flowbtn ${colorMode === 'thermal' ? 'on' : ''}`}
              disabled={!flow.thermal}
              onClick={() => setColorMode(colorMode === 'thermal' ? 'steel' : 'thermal')}
              title="Thermal-intent tint: fluid caloric rise (F1 field when solved) + fin cosh conduction profile — solver-anchored, screening not CHT (spec §50-3)">
              Thermal
            </button>
            <button className={`vo-flowbtn ${colorMode === 'dp' ? 'on' : ''}`}
              disabled={!flow.dp}
              onClick={() => setColorMode(colorMode === 'dp' ? 'steel' : 'dp')}
              title="ΔP-budget mode: where the pressure budget is spent along the route (F1 solved field when available) — the hydraulic twin of the resistance stackup (spec §50-4)">
              ΔP
            </button>
            <span className="vo-sep" />
            <button className={`vo-flowbtn ${flowOn ? 'on' : ''}`} onClick={() => setFlowOn(!flowOn)}
              title="Flow-intent layer: the layout's routing animated at the S6 network-solved speed (design intent — confirm by CFD)">
              ≈ Flow
            </button>
            <button className={`vo-flowbtn ${riding ? 'on' : ''}`} disabled={!field || !flowOn}
              onClick={() => setRiding(!riding)}
              title="Follow a parcel: ride the longest solved streamline inlet → outlet at slow-motion speed (Esc exits)">
              ▶ ride
            </button>
            <button className="vo-flowbtn" onClick={() => setShowExplain(true)}
              title="How the flow & thermal layers work — tiers, physics, chips, and what CFD confirms">
              ⓘ
            </button>
            <span className="vo-sep" />
          </>
        )}
        <span className="vo-cuts-label">Section</span>
        <AxisCut axis="x" min={-xMax} max={xMax} cut={cuts.x} onChange={(p) => patch('x', p)} />
        <AxisCut axis="y" min={-yMax} max={yMax} cut={cuts.y} onChange={(p) => patch('y', p)} />
        <AxisCut axis="z" min={0} max={zMax} cut={cuts.z} onChange={(p) => patch('z', p)} />
        <button className="vo-reset" onClick={() => setCuts(defaultCuts())}>reset</button>
        <span className="vo-sep" />
        <select className="vo-stlq" value={stlQuality} disabled={!isTpmsSurface}
          title={isTpmsSurface
            ? 'Lattice mesh resolution — sheet lattices export dense (draft to review, fine to print)'
            : 'Resolution only applies to TPMS lattices — fins and pins export as exact geometry'}
          onChange={(e) => setStlQuality(e.target.value as StlQuality)}>
          <option value="draft">draft</option>
          <option value="standard">standard</option>
          <option value="fine">fine</option>
        </select>
        <button className="vo-reset" onClick={downloadStl} disabled={stl.busy}
          title="Download the current model as a binary STL (units: mm)">
          {stl.busy ? 'building…' : '⬇ STL'}
        </button>
        {stl.note && <span className="vo-stl-note">{stl.note}</span>}
      </div>

      {probe && !riding && (
        <div className="vo-probe" style={{ left: probe.x + 14, top: probe.y + 12 }}>{probe.text}</div>
      )}
      {riding && (
        <div className="vo-ride-note">riding a parcel — Esc to exit</div>
      )}
      {showExplain && <FlowExplainer onClose={() => setShowExplain(false)} />}
    </div>
  )
}
