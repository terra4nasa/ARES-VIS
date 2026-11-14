// ARES-VIS first-person WebGL engine — real-time 3D Mars surface scene.
//
// Terrain : HRSC-MOLA hybrid DEM (200 m/px) displaced mesh + fractal detail,
//           draped with the Esri/CTX 20 m/px optical window, exp2 dust fog,
//           real sun-shadow map (PCF) — rocks, lander and relief occlude.
// Scene   : procedural crater field, ~7.5k instanced rocks (3 tiers), distant
//           highland ring on the horizon, drifting dust, InSight lander model,
//           dashed traverse line + pulsing waypoint beacons with labels,
//           12 grabbable science-sample targets (3D catch with [E]).
// Camera  : IS the walking astronaut — gait bob, eased heading to the next
//           waypoint, drag-to-look, Mars sun position from LST. Manual foot
//           control: WASD/arrows + on-screen D-pad, SHIFT to dash, slope- and
//           gradient-aware speed, bounds-clamped free walking.
import * as THREE from "three";
import { loadFpvEnv, elevAt, sunElevAt, approachAngle, type FpvEnv } from "./fpv";
import { useStore } from "./store";
import { SITE, POIS } from "./data";
import { slopeAdjustedSpeed } from "./mars";

/* ---------------- shared camera bus (HUD reads without React re-render) --- */
export interface CaptureTargetInfo {
  code: string;
  kind: string;
  massKg: number;
  distM: number;
}
export const camBus = {
  yawDeg: 0,
  pitchDeg: -5,
  lon: SITE.lon,
  lat: SITE.lat,
  centerLon: SITE.lon,
  centerLat: SITE.lat,
  spanM: 12000,
  fps: 0,
  moving: false,
  /* manual walk + sample capture telemetry (written by the engine each frame) */
  manual: false,
  speedMs: 0,
  dashing: false,
  offRouteM: 0,
  slopeDeg: 0,
  elevM: 0,
  target: null as CaptureTargetInfo | null,
};

/* on-screen pad input — HUD D-pad / DASH button write, the engine reads */
export const walkInput = { fwd: 0, strafe: 0, dash: false };

/* sample-capture handshake — HUD [E] / button bumps the nonce, engine collects */
let collectNonce = 0;
export function requestSampleCollect() {
  collectNonce++;
}

/* E2E/debug: teleport the astronaut (consumed by the running scene) */
let teleportReq: { lon: number; lat: number } | null = null;
export function debugTeleport(lon: number, lat: number) {
  teleportReq = { lon, lat };
}

/* E2E/debug: live list of sample-target positions (filled at scene build) */
export const debugSamples: Array<{ code: string; lon: number; lat: number }> = [];

const RAD = Math.PI / 180;

/* low-end / software-renderer detection (SwiftShader, llvmpipe…) */
const LOW_END = (() => {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const g = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!g) return false;
    const ext = g.getExtension("WEBGL_debug_renderer_info");
    const s = ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(s);
  } catch {
    return false;
  }
})();

/* touch-first devices (tablets / phones) — cap fill-rate a notch lower so the
 * visor stays fluid; desktop GPUs keep the full-resolution pipeline */
const TOUCH_TIER =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/* debug/E2E handle */
if (typeof window !== "undefined") {
  (window as unknown as { __FPV_CAMBUS__?: typeof camBus }).__FPV_CAMBUS__ = camBus;
  (window as unknown as { __FPV_TELEPORT__?: typeof debugTeleport }).__FPV_TELEPORT__ = debugTeleport;
  (window as unknown as { __FPV_SAMPLES__?: typeof debugSamples }).__FPV_SAMPLES__ = debugSamples;
}

/* ---------------- small deterministic noise / prng ---------------- */
function ihash(x: number, y: number): number {
  let n = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = x - xi, ty = y - yi;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  return (
    ihash(xi, yi) * (1 - u) * (1 - v) + ihash(xi + 1, yi) * u * (1 - v) +
    ihash(xi, yi + 1) * (1 - u) * v + ihash(xi + 1, yi + 1) * u * v
  );
}
function fbm01(x: number, y: number, oct: number): number {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    norm += a; a *= 0.5; f *= 2.13;
  }
  return s / norm;
}
function ridged(x: number, y: number, oct: number): number {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * (1 - Math.abs(2 * vnoise(x * f, y * f) - 1));
    norm += a; a *= 0.5; f *= 2.31;
  }
  return s / norm;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------------- engine -------------------------------------------- */
export interface FpvScene {
  dispose(): void;
}

export interface FpvSceneOpts {
  /** per-site variation seed — crater fields / mesas / rock scatter differ per location */
  seed?: number;
  /** site elevation fallback when the baked DEM window doesn't cover the area */
  elev0?: number;
}

export async function createFpvScene(canvas: HTMLCanvasElement, opts?: FpvSceneOpts): Promise<FpvScene> {
  const env = await loadFpvEnv();
  const store = useStore.getState();
  const elev0 = opts?.elev0 ?? env.siteElev; // elevation outside the baked DEM window

  /* ---- scene window (meters, local ENU around a center) ---- */
  const route = store.route.length >= 1 ? store.route : [{ lon: SITE.lon, lat: SITE.lat, id: "s", name: "S" }];
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const w of route) {
    minLon = Math.min(minLon, w.lon); maxLon = Math.max(maxLon, w.lon);
    minLat = Math.min(minLat, w.lat); maxLat = Math.max(maxLat, w.lat);
  }
  const cLon = (minLon + maxLon) / 2 || SITE.lon;
  const cLat = (minLat + maxLat) / 2 || SITE.lat;
  const mLonDeg = env.mLonDeg, mLatDeg = env.mLatDeg;
  const halfW = Math.min(9000, Math.max(4200, Math.max((maxLon - minLon) * mLonDeg, (maxLat - minLat) * mLatDeg) / 2 + 3600));
  const size = halfW * 2;
  camBus.centerLon = cLon; camBus.centerLat = cLat; camBus.spanM = size;

  const toX = (lon: number) => (lon - cLon) * mLonDeg;
  const toZ = (lat: number) => -(lat - cLat) * mLatDeg;

  /* ---- route polyline in meters (for crater avoidance + rock scatter) ---- */
  const routePts: Array<{ x: number; z: number }> = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const ax = toX(a.lon), az = toZ(a.lat), bx = toX(b.lon), bz = toZ(b.lat);
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 10));
    for (let k = 0; k <= n; k++) routePts.push({ x: ax + (bx - ax) * (k / n), z: az + (bz - az) * (k / n) });
  }
  if (routePts.length === 0) routePts.push({ x: toX(SITE.lon), z: toZ(SITE.lat) });
  const distToRoute = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < routePts.length; i += 2) {
      const d = (routePts[i].x - x) ** 2 + (routePts[i].z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  /* ---- heightfield: DEM + fractal detail + craters + far highlands ---- */
  const HF_N = LOW_END ? 384 : 512;
  const cell = size / (HF_N - 1);
  const hf = new Float32Array(HF_N * HF_N);
  const siteSeed = (opts?.seed ?? 20260417) >>> 0;
  const rndC = mulberry32(siteSeed ^ 0x9e370105);
  interface Crater { x: number; z: number; r: number }
  const craters: Crater[] = [];
  for (let i = 0; i < 46 && craters.length < 32; i++) {
    const x = (rndC() * 2 - 1) * halfW * 0.92;
    const z = (rndC() * 2 - 1) * halfW * 0.92;
    const r = 18 + 300 * Math.pow(rndC(), 2.0);
    if (distToRoute(x, z) < Math.max(34, r * 0.5)) continue;
    craters.push({ x, z, r });
  }
  const rndM = mulberry32((siteSeed ^ 0x51ab3c) >>> 0);
  const mesas: Array<{ x: number; z: number; s: number; a: number }> = [];
  for (let i = 0; i < 5; i++) {
    const ang = rndM() * Math.PI * 2;
    const rr = halfW * (0.62 + rndM() * 0.28);
    mesas.push({ x: Math.cos(ang) * rr, z: Math.sin(ang) * rr, s: 620 + rndM() * 480, a: 320 + rndM() * 260 });
  }
  const far0 = Math.min(5200, halfW * 0.6);
  const far1 = halfW * 0.985;
  /* DEM sample with per-site elevation fallback outside the baked window */
  const elevAtSite = (lon: number, lat: number) => {
    const e = elevAt(env, lon, lat);
    return e === env.siteElev ? elev0 : e;
  };
  for (let gy = 0; gy < HF_N; gy++) {
    const z = -halfW + gy * cell;
    const lat = cLat - z / mLatDeg;
    for (let gx = 0; gx < HF_N; gx++) {
      const x = -halfW + gx * cell;
      const lon = cLon + x / mLonDeg;
      let h = elevAtSite(lon, lat);
      h += (vnoise(x * 0.00042 + 11.7, z * 0.00042 + 5.1) - 0.5) * 16;      // broad swell
      h += (fbm01(x * 0.0058 + 7.3, z * 0.0058, 3) - 0.5) * 5.2;            // ~170 m undulation
      h += (vnoise(x * 0.0165, z * 0.0165 + 3.1) - 0.5) * 1.8;              // ~60 m
      h += (vnoise(x * 0.042, z * 0.042 + 9.7) - 0.5) * 0.8;                // ~24 m
      for (const c of craters) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < c.r * 2.0) {
          const q = d / c.r;
          if (q < 1) h -= c.r * 0.14 * Math.pow(1 - q * q, 1.15);
          const rim = Math.exp(-Math.pow((q - 1) / 0.24, 2));
          h += c.r * 0.05 * rim;
        }
      }
      const dc = Math.hypot(x, z);
      const t = smoothstep(far0, far1, dc);
      if (t > 0) {
        const ridge = ridged(x * 0.00082 + 3.7, z * 0.00082, 3);
        h += t * (55 + 780 * Math.pow(ridge, 1.55));
        for (const m of mesas) h += t * m.a * Math.exp(-((x - m.x) ** 2 + (z - m.z) ** 2) / (2 * m.s * m.s));
      }
      hf[gy * HF_N + gx] = h;
    }
  }
  const groundH = (x: number, z: number): number => {
    const fx = Math.min(HF_N - 1.001, Math.max(0, (x + halfW) / cell));
    const fy = Math.min(HF_N - 1.001, Math.max(0, (z + halfW) / cell));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const i = (yy: number, xx: number) => hf[yy * HF_N + xx];
    return i(y0, x0) * (1 - tx) * (1 - ty) + i(y0, x0 + 1) * tx * (1 - ty) + i(y0 + 1, x0) * (1 - tx) * ty + i(y0 + 1, x0 + 1) * tx * ty;
  };

  /* ---- renderer / scene / camera ---- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_END, powerPreference: "high-performance" });
  let dpr = LOW_END ? 1.0 : TOUCH_TIER ? Math.min(window.devicePixelRatio || 1, 1.25) : Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  /* real sun shadows — terrain/rocks/lander cast + receive (desktop GPUs) */
  const SHADOWS = !LOW_END;
  renderer.shadowMap.enabled = SHADOWS;
  renderer.shadowMap.type = THREE.PCFShadowMap; // hardware PCF (sampler2DShadow)

  const CAST_TERRAIN = SHADOWS; // nearby relief (crater rims) casts too

  const scene = new THREE.Scene();
  const fogDen = 0.00019;
  const fogColor = new THREE.Color(0.93, 0.7, 0.47);
  scene.fog = new THREE.FogExp2(fogColor.getHex(), fogDen);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.12, 46000);

  /* lights (rocks / lander — terrain shades itself in-shader) */
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
  scene.add(sun); scene.add(sun.target);
  if (SHADOWS) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130;
    sc.near = 2200; sc.far = 3900; // light rides 3000 m out along the sun vector
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.45;
    sc.updateProjectionMatrix();
  }
  const hemi = new THREE.HemisphereLight(0xd9a06b, 0x5a2f1c, 0.55);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x40281a, 0.7);
  scene.add(amb);

  /* ---- sky dome ---- */
  const skyUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDay: { value: 1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(halfW * 2.4, 40, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uSunDir;
        uniform float uDay;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.06, 1.0);
          vec3 zen = vec3(0.185, 0.105, 0.075) * uDay;
          vec3 hor = vec3(0.98, 0.76, 0.53) * uDay;
          vec3 col = mix(hor, zen, smoothstep(0.02, 0.5, h));
          float s = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0, 0.84, 0.58) * pow(s, 7.0) * 0.24 * uDay;
          col += vec3(1.0, 0.9, 0.72) * pow(s, 60.0) * 0.55 * uDay;
          float disc = smoothstep(0.999948, 0.999982, s);
          col = mix(col, vec3(1.5, 1.32, 1.05), disc * uDay);
          col = mix(col, vec3(1.0, 0.86, 0.66) * uDay, exp(-abs(d.y) * 9.0) * 0.32);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  /* ---- terrain mesh ---- */
  const SEG = LOW_END ? 280 : TOUCH_TIER ? 320 : 360;
  const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i);
      pos.setY(i, groundH(px, pz));
      const e = cell;
      const nx = groundH(px - e, pz) - groundH(px + e, pz);
      const nz = groundH(px, pz - e) - groundH(px, pz + e);
      const n = new THREE.Vector3(nx, 2 * e, nz).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
  }

  /* tileable multi-octave regolith micro-texture (periodic value noise — no seams) */
  const detailTex = (() => {
    const n = 256;
    const data = new Uint8Array(n * n * 4);
    const phash = (x: number, y: number, p: number) => ihash(((x % p) + p) % p | 0, ((y % p) + p) % p | 0);
    const pnoise = (u: number, v: number, p: number) => {
      const x = u * p, y = v * p;
      const xi = Math.floor(x), yi = Math.floor(y);
      const tx = x - xi, ty = y - yi;
      const s = tx * tx * (3 - 2 * tx), t2 = ty * ty * (3 - 2 * ty);
      const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
      const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
      return phash(x0, y0, p) * (1 - s) * (1 - t2) + phash(x1, y0, p) * s * (1 - t2) +
             phash(x0, y1, p) * (1 - s) * t2 + phash(x1, y1, p) * s * t2;
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = x / n, v = y / n;
        const g = pnoise(u, v, 4) * 0.42 + pnoise(u, v, 9) * 0.3 + pnoise(u, v, 21) * 0.18 + pnoise(u, v, 53) * 0.1;
        const val = Math.round(38 + Math.min(1, Math.max(0, g)) * 217);
        const i = (y * n + x) * 4;
        data[i] = val; data[i + 1] = val; data[i + 2] = val; data[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();

  const ctxTex = (() => {
    if (!env.tex) return null;
    const t = new THREE.DataTexture(new Uint8Array(env.tex.buffer, env.tex.byteOffset, env.tex.byteLength), env.tw, env.th, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  })();

  const terrainUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    {
      uCtx: { value: null as THREE.Texture | null },
      uHasCtx: { value: ctxTex ? 1 : 0 },
      uCtxBox: { value: new THREE.Vector4(env.tlon0, env.tlat0, env.tlon1, env.tlat1) },
      uDetail: { value: null as THREE.Texture | null },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uDay: { value: 1 },
      uFogColor: { value: new THREE.Color(0.93, 0.7, 0.47) },
      uFogDen: { value: fogDen },
      uCamPos: { value: new THREE.Vector3() },
      uCLon: { value: cLon },
      uCLat: { value: cLat },
      uMLonDeg: { value: mLonDeg },
      uMLatDeg: { value: mLatDeg },
    },
  ]);
  terrainUniforms.uCtx.value = ctxTex;
  terrainUniforms.uDetail.value = detailTex;
  const terrain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: terrainUniforms,
    lights: true,
    fog: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <shadowmap_pars_vertex>
      varying vec3 vWorld;
      varying vec3 vNorm;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorld = worldPosition.xyz;
        vNorm = normalize(mat3(modelMatrix) * normal);
        vec3 transformedNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <shadowmap_pars_fragment>
      varying vec3 vWorld;
      varying vec3 vNorm;
      uniform sampler2D uCtx;
      uniform float uHasCtx;
      uniform vec4 uCtxBox;
      uniform sampler2D uDetail;
      uniform vec3 uSunDir;
      uniform float uDay;
      uniform vec3 uFogColor;
      uniform float uFogDen;
      uniform vec3 uCamPos;
      uniform float uCLon;
      uniform float uCLat;
      uniform float uMLonDeg;
      uniform float uMLatDeg;

      float dn(vec2 p) { return texture2D(uDetail, p).r; }

      void main() {
        vec3 nGeom = normalize(vNorm);
        float dCam = distance(vWorld, uCamPos);

        /* near-field normal perturbation from detail noise (2 scales) */
        float nFade = exp(-dCam * 0.012);
        vec2 p1 = vWorld.xz * 0.061;
        vec2 p2 = vWorld.xz * 0.173;
        float e = 0.35;
        float nA = dn(p1), nAx = dn(p1 + vec2(e, 0.0)), nAy = dn(p1 + vec2(0.0, e));
        float nB = dn(p2), nBx = dn(p2 + vec2(e, 0.0)), nBy = dn(p2 + vec2(0.0, e));
        vec3 n = normalize(nGeom + vec3((nA - nAx) + (nB - nBx), 0.0, (nA - nAy) + (nB - nBy)) * (2.0 * nFade));

        /* albedo: CTX drape inside window, procedural regolith outside */
        float lon = uCLon + vWorld.x / uMLonDeg;
        float lat = uCLat - vWorld.z / uMLatDeg;
        float gu = (lon - uCtxBox.x) / (uCtxBox.z - uCtxBox.x);
        float gv = (uCtxBox.y - lat) / (uCtxBox.y - uCtxBox.w);
        float g = -1.0;
        if (uHasCtx > 0.5 && gu > 0.002 && gu < 0.998 && gv > 0.002 && gv < 0.998) {
          g = texture2D(uCtx, vec2(gu, gv)).r;
        }
        float macro = dn(vWorld.xz * 0.00023);
        float fine = dn(vWorld.xz * 0.0035);
        float macro2 = dn(vWorld.xz * 0.00007);              // km-scale basaltic patches
        float ripple = dn(vWorld.xz * vec2(0.0045, 0.045));  // aeolian ripples (anisotropic)
        vec3 albedo;
        if (g >= 0.0) {
          g = clamp((g - 0.5) * 1.45 + 0.5 + (macro - 0.5) * 0.4 + (fine - 0.5) * 0.18 * nFade - smoothstep(0.62, 0.86, macro2) * 0.18, 0.0, 1.0);
          albedo = mix(vec3(0.40, 0.235, 0.15), vec3(0.82, 0.56, 0.365), g);
        } else {
          float k = clamp(macro * 0.72 + fine * 0.22 + (ripple - 0.5) * 0.10 * nFade - smoothstep(0.62, 0.86, macro2) * 0.16, 0.0, 1.0);
          albedo = mix(vec3(0.43, 0.25, 0.16), vec3(0.80, 0.55, 0.36), k);
        }
        /* dark basaltic sweeps (large-scale) */
        albedo = mix(albedo, vec3(0.30, 0.19, 0.13), smoothstep(0.63, 0.88, macro2) * 0.5);
        /* bright dust settles on flat ground */
        float dust = clamp((nGeom.y - 0.93) * 6.0, 0.0, 1.0) * 0.22;
        albedo = mix(albedo, vec3(0.85, 0.62, 0.41), dust);

        /* Mars lighting: warm low sun + dusty hemispheric ambient */
        float nl = max(dot(n, uSunDir), 0.0);
        /* real sun shadow map — rocks, lander and nearby relief occlude the sun */
        float shK = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        if (nl > 0.002) {
          shK = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
        }
        #endif
        vec3 sunC = vec3(1.5, 1.26, 1.0);
        vec3 ambC = mix(vec3(0.16, 0.095, 0.07), vec3(0.36, 0.23, 0.155), n.y * 0.5 + 0.5);
        vec3 col = albedo * (ambC * uDay + sunC * (nl * shK * 0.92 + 0.012) * uDay);

        /* dust fog (exact FogExp2 match) */
        float fog = 1.0 - exp(-pow(dCam * uFogDen, 2.0));
        vec3 vdir = normalize(vWorld - uCamPos);
        float sunAmt = pow(max(dot(vdir, uSunDir), 0.0), 5.0);
        col = mix(col, uFogColor * (1.0 + sunAmt * 0.7), clamp(fog, 0.0, 0.965));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  terrain.receiveShadow = SHADOWS;
  terrain.castShadow = CAST_TERRAIN;
  scene.add(terrain);

  /* ---- rocks (3 instanced tiers) ---- */
  const disposables: Array<{ dispose(): void }> = [];
  function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
    const g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const r = mulberry32(seed);
    const o1 = r() * 89, o2 = r() * 47, o3 = r() * 23;
    /* per-shape anisotropy — slabs, shards and squat blocks instead of eggs */
    const ax = 0.72 + r() * 0.85;
    const az = 0.72 + r() * 0.85;
    const ay = 0.40 + r() * 0.55;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      /* 3-octave radial profile: big lobes + angular facets + fine grit */
      const n0 = vnoise(v.x * 1.05 + o1, v.y * 1.05 + v.z * 1.15 + o1);
      const n1 = vnoise(v.x * 2.7 + o2, v.y * 2.2 + v.z * 2.9 + o2);
      const n2 = vnoise(v.x * 5.6 + o3, v.y * 4.6 + v.z * 5.9 + o3);
      let rad = 0.58 + 0.62 * n0 + 0.34 * (n1 - 0.5) + 0.14 * (n2 - 0.5);
      if (v.y < 0) rad *= 0.86 + v.y * 0.30; // taper below the equator — sits on the ground
      v.multiplyScalar(rad);
      v.x *= ax; v.z *= az; v.y *= ay;
      if (v.y < 0) v.y *= 0.68;              // sink into the regolith
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    disposables.push(g);
    return g;
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0.02, flatShading: true });
  disposables.push(rockMat);
  function scatter(
    mesh: THREE.InstancedMesh, count: number, sigma: number, sMin: number, sMax: number, seed: number, minPathDist: number
  ) {
    const r = mulberry32(seed);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    /* natural Martian lithologies: dark basalt · ferric crust · dust-mantled · weathered */
    const fams = [
      new THREE.Color(0.245, 0.195, 0.165),
      new THREE.Color(0.36, 0.27, 0.205),
      new THREE.Color(0.49, 0.375, 0.27),
      new THREE.Color(0.315, 0.26, 0.225),
    ];
    const coat = new THREE.Color(0.60, 0.455, 0.315);
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 12) {
      guard++;
      const rp = routePts[(r() * routePts.length) | 0];
      const gx = (r() + r() + r() - 1.5) / 1.5 * sigma * 1.9;
      const gz = (r() + r() + r() - 1.5) / 1.5 * sigma * 1.9;
      const x = rp.x + gx, z = rp.z + gz;
      if (Math.abs(x) > halfW - 30 || Math.abs(z) > halfW - 30) continue;
      const s = sMin + (sMax - sMin) * Math.pow(r(), 1.6);
      if (Math.hypot(gx, gz) < minPathDist + s) continue;
      const y = groundH(x, z) - s * (0.24 + r() * 0.16);
      eu.set(r() * 0.4 - 0.2, r() * Math.PI * 2, r() * 0.4 - 0.2);
      q.setFromEuler(eu);
      p.set(x, y, z); sc.set(s, s * (0.75 + r() * 0.45), s);
      m.compose(p, q, sc);
      mesh.setMatrixAt(placed, m);
      /* lithology family + value jitter; ~40 % get a dust coating on top */
      const f = fams[(r() * fams.length) | 0];
      const j = (r() - 0.5) * 0.075;
      col.setRGB(f.r + j, f.g + j, f.b + j * 0.8);
      if (r() < 0.4) col.lerp(coat, 0.22 + r() * 0.35);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = SHADOWS;
    mesh.receiveShadow = SHADOWS;
    scene.add(mesh);
    disposables.push(mesh);
    return mesh;
  }
  const rockMeshes: THREE.InstancedMesh[] = [];
  const pebbleCount = LOW_END ? 7000 : 14000;
  const cobbleCount = LOW_END ? 2200 : 3000;
  rockMeshes.push(scatter(new THREE.InstancedMesh(rockGeometry(11, 2), rockMat, 80), 80, 340, 1.2, 4.2, 101, 7));
  rockMeshes.push(scatter(new THREE.InstancedMesh(rockGeometry(23, 2), rockMat, 26), 26, 170, 2.2, 5.0, 24, 10));
  rockMeshes.push(scatter(new THREE.InstancedMesh(rockGeometry(31, 1), rockMat, cobbleCount), cobbleCount, 60, 0.34, 1.1, 32, 1.6));
  rockMeshes.push(scatter(new THREE.InstancedMesh(rockGeometry(47, 0), rockMat, pebbleCount), pebbleCount, 20, 0.14, 0.38, 49, 0.6));
  /* hero rocks near the trail — 1–2 m boulders within 6–30 m of the path */
  rockMeshes.push(scatter(new THREE.InstancedMesh(rockGeometry(63, 2), rockMat, 60), 60, 26, 0.8, 2.1, 66, 2.2));
  /* wind-fractured slab/shard tier */
  const slabCount = LOW_END ? 240 : 420;
  rockMeshes.push(scatter(new THREE.InstancedMesh(rockGeometry(71, 1), rockMat, slabCount), slabCount, 120, 0.45, 1.5, 77, 3));
  /* ejecta blocks hugging the rims of the freshest, largest craters */
  {
    const rE = mulberry32((siteSeed ^ 0x2c1b) >>> 0);
    const big = [...craters].sort((a, b) => b.r - a.r).slice(0, 3);
    const meshE = new THREE.InstancedMesh(rockGeometry(83, 1), rockMat, big.length * 34);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0;
    for (const c of big) {
      for (let k = 0; k < 34; k++) {
        const ang = rE() * Math.PI * 2;
        const rr = c.r * (1.05 + rE() * 0.55);
        const x = c.x + Math.cos(ang) * rr;
        const z = c.z + Math.sin(ang) * rr;
        if (Math.abs(x) > halfW - 20 || Math.abs(z) > halfW - 20) continue;
        const s = 0.25 + c.r * (0.018 + rE() * 0.035);
        const y = groundH(x, z) - s * 0.3;
        eu.set(rE() * 0.5 - 0.25, rE() * Math.PI * 2, rE() * 0.5 - 0.25);
        q.setFromEuler(eu);
        p.set(x, y, z);
        sc.set(s, s * (0.5 + rE() * 0.4), s);
        m.compose(p, q, sc);
        meshE.setMatrixAt(placed, m);
        const j = (rE() - 0.5) * 0.06;
        col.setRGB(0.42 + j, 0.33 + j, 0.25 + j);
        meshE.setColorAt(placed, col);
        placed++;
      }
    }
    meshE.count = placed;
    meshE.instanceMatrix.needsUpdate = true;
    if (meshE.instanceColor) meshE.instanceColor.needsUpdate = true;
    meshE.frustumCulled = false;
    meshE.castShadow = SHADOWS;
    meshE.receiveShadow = SHADOWS;
    scene.add(meshE);
    disposables.push(meshE);
    rockMeshes.push(meshE);
  }

  /* ---- drifting dust particles ---- */
  const dustTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const cx = c.getContext("2d")!;
    const grad = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,225,190,0.85)");
    grad.addColorStop(0.5, "rgba(230,180,130,0.32)");
    grad.addColorStop(1, "rgba(220,170,120,0)");
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    disposables.push(t);
    return t;
  })();
  const DUST_N = LOW_END ? 240 : 420;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_N * 3);
  const dustSeed = mulberry32(555);
  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3] = (dustSeed() * 2 - 1) * 50;
    dustPos[i * 3 + 1] = dustSeed() * 14 + 0.2;
    dustPos[i * 3 + 2] = (dustSeed() * 2 - 1) * 50;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  /* custom point shader: clamps sprite size and fades particles near the eye
     (attenuated PointsMaterial sprites blow up to giant blobs < 2 m away) */
  const dustUniforms = {
    uTex: { value: dustTex },
    uScale: { value: 700 },
    uOpacity: { value: 0.3 },
    uDay: { value: 1 },
  };
  const dustMat = new THREE.ShaderMaterial({
    uniforms: dustUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(0.1, -mv.z);
        gl_PointSize = clamp(0.55 * uScale / dist, 2.0, 44.0);
        vAlpha = smoothstep(0.9, 3.2, dist);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uOpacity;
      uniform float uDay;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uTex, gl_PointCoord);
        vec3 col = vec3(0.88, 0.69, 0.5) * uDay;
        gl_FragColor = vec4(col, tex.a * vAlpha * uOpacity);
        if (gl_FragColor.a < 0.01) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  disposables.push(dustGeo, dustMat);

  /* ---- traverse line + waypoint beacons ---- */
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const CYAN = 0x54e0ff, GREEN = 0x4ade80, AMBER = 0xffb347;
  interface Beacon { group: THREE.Group; diamond: THREE.Mesh; ring: THREE.Mesh; matDiamond: THREE.MeshBasicMaterial; matPole: THREE.MeshBasicMaterial; matRing: THREE.MeshBasicMaterial; x: number; z: number; idx: number }
  const beacons: Beacon[] = [];
  {
    if (route.length >= 2) {
      const linePts: THREE.Vector3[] = [];
      for (const p of routePts) linePts.push(new THREE.Vector3(p.x, groundH(p.x, p.z) + 0.32, p.z));
      const lg = new THREE.BufferGeometry().setFromPoints(linePts);
      const lm = new THREE.LineDashedMaterial({ color: AMBER, dashSize: 9, gapSize: 5, transparent: true, opacity: 1 });
      const line = new THREE.Line(lg, lm);
      line.computeLineDistances();
      routeGroup.add(line);
      disposables.push(lg, lm);
    }
    route.forEach((wp, i) => {
      const x = toX(wp.lon), z = toZ(wp.lat);
      const y = groundH(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const color = i === route.length - 1 ? GREEN : CYAN;
      const matPole = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
      const matDiamond = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const matRing = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 7, 6), matPole);
      pole.position.y = 3.5;
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), matDiamond);
      diamond.position.y = 7.6;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.95, 40), matRing);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.25;
      g.add(pole, diamond, ring);
      /* floating label */
      const label = makeLabelSprite(`${wp.name}`, color === GREEN ? "#4ade80" : "#54e0ff");
      label.position.y = 9.2;
      g.add(label);
      routeGroup.add(g);
      disposables.push(matPole, matDiamond, matRing, pole.geometry, diamond.geometry, ring.geometry);
      beacons.push({ group: g, diamond, ring, matDiamond, matPole, matRing, x, z, idx: i });
    });
  }

  function makeLabelSprite(text: string, color: string): THREE.Sprite {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const cx = c.getContext("2d")!;
    cx.font = "600 54px 'Share Tech Mono', ui-monospace, monospace";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.lineWidth = 10;
    cx.strokeStyle = "rgba(5,8,12,0.9)";
    cx.strokeText(text, 256, 64);
    cx.fillStyle = color;
    cx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.center.set(0.5, 0);
    sp.userData.aspect = 4;
    disposables.push(tex, mat);
    return sp;
  }

  /* ---- InSight lander at the base waypoint ---- */
  {
    const base = POIS.find((p) => p.id === "base");
    if (base) {
      /* park the lander ~8 m SE of the base pad so the spawn view is clear */
      const azL = 118 * RAD;
      const x = toX(base.lon) + Math.sin(azL) * 8;
      const z = toZ(base.lat) - Math.cos(azL) * 8;
      const y = groundH(x, z);
      const lander = new THREE.Group();
      /* materials: bright anodized-gold bus · brushed-gray deck · cell-textured panels */
      const gold = new THREE.MeshStandardMaterial({ color: 0xe6bb5e, roughness: 0.52, metalness: 0.22 });
      const deckM = new THREE.MeshStandardMaterial({ color: 0x92959e, roughness: 0.6, metalness: 0.18 });
      const legM = new THREE.MeshStandardMaterial({ color: 0xcdd1d8, roughness: 0.55, metalness: 0.22 });
      const darkM = new THREE.MeshStandardMaterial({ color: 0x4a4c55, roughness: 0.65, metalness: 0.12 });
      const whiteM = new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.55, metalness: 0.03 });
      const cellTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g2 = c.getContext("2d")!;
        g2.fillStyle = "#1c2940";
        g2.fillRect(0, 0, 256, 256);
        const rc = mulberry32(4);
        for (let gy = 0; gy < 8; gy++) {
          for (let gx = 0; gx < 8; gx++) {
            const l = 24 + rc() * 26;
            g2.fillStyle = `rgb(${26 + l},${38 + l},${58 + l})`;
            g2.fillRect(gx * 32 + 2, gy * 32 + 2, 28, 28);
          }
        }
        g2.strokeStyle = "#aeb6c2";
        g2.lineWidth = 10;
        g2.strokeRect(5, 5, 246, 246);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const faceM = new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.42, metalness: 0.18, emissive: 0x1a2a48, emissiveIntensity: 0.55 });
      const rimM = new THREE.MeshStandardMaterial({ color: 0x6a707c, roughness: 0.55, metalness: 0.2 });
      disposables.push(gold, deckM, legM, darkM, whiteM, faceM, rimM, cellTex);
      const legGeo = new THREE.CylinderGeometry(0.052, 0.042, 1.02, 8);
      const padGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.05, 10);
      for (let i = 0; i < 4; i++) {
        const ax = i < 2 ? -0.85 : 0.85;
        const az = i % 2 === 0 ? -0.6 : 0.6;
        const leg = new THREE.Mesh(legGeo, legM);
        leg.position.set(ax * 1.15, 0.45, az * 1.15);
        leg.rotation.set(az > 0 ? 0.32 : -0.32, 0, ax > 0 ? -0.32 : 0.32);
        const pad = new THREE.Mesh(padGeo, darkM);
        pad.position.y = -0.52;
        leg.add(pad);
        lander.add(leg);
      }
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.52, 1.25), gold);
      body.position.y = 0.95;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.075, 1.52), deckM);
      deck.position.y = 1.26;
      const panGeo = new THREE.CylinderGeometry(1.08, 1.08, 0.03, 28);
      const panL = new THREE.Mesh(panGeo, [rimM, faceM, faceM]);
      panL.position.set(-1.9, 1.24, 0);
      const panR = new THREE.Mesh(panGeo, [rimM, faceM, faceM]);
      panR.position.set(1.9, 1.24, 0);
      const seis = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), whiteM);
      seis.scale.y = 0.6; seis.position.set(0.28, 1.44, 0.18);
      const seisCol = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.30, 0.06, 20), darkM);
      seisCol.position.set(0.28, 1.335, 0.18);
      const hp3 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), whiteM);
      hp3.position.set(-0.46, 1.41, -0.12);
      const hp3Top = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.045, 0.31), darkM);
      hp3Top.position.set(-0.46, 1.53, -0.12);
      const armA = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 1.12, 8), legM);
      armA.position.set(1.08, 0.96, 0.46); armA.rotation.z = 1.22; armA.rotation.x = 0.5;
      const armB = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.92, 8), legM);
      armB.position.set(1.62, 0.56, 0.64); armB.rotation.z = 1.88; armB.rotation.x = 0.4;
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.2), darkM);
      scoop.position.set(1.86, 0.34, 0.72); scoop.rotation.z = 1.88; scoop.rotation.x = 0.4;
      const uhf = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 6), whiteM);
      uhf.position.set(-0.58, 1.62, -0.3); uhf.rotation.z = -0.3;
      const ict = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 5), darkM);
      ict.position.set(-0.38, 1.56, 0.32); ict.rotation.z = 0.35;
      lander.add(body, deck, panL, panR, seis, seisCol, hp3, hp3Top, armA, armB, scoop, uhf, ict);
      disposables.push(legGeo, padGeo, panGeo);
      lander.scale.setScalar(1.5);
      lander.rotation.y = 0.6;
      lander.position.set(x, y, z);
      lander.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = SHADOWS;
          o.receiveShadow = SHADOWS;
        }
      });
      scene.add(lander);
    }
  }

  /* ---- blinking beacons shared by the habitat / pad / caches ---- */
  const blinkers: Array<{ mat: THREE.MeshBasicMaterial; phase: number }> = [];

  /* ---- habitat complex at the base waypoint (opposite side from the lander) ---- */
  {
    const base = POIS.find((p) => p.id === "base");
    if (base) {
      const azH = 305 * RAD;
      const hx = toX(base.lon) + Math.sin(azH) * 16;
      const hz = toZ(base.lat) - Math.cos(azH) * 16;
      const hy = groundH(hx, hz);
      const hab = new THREE.Group();
      hab.position.set(hx, hy, hz);
      hab.rotation.y = 2.1;

      const habWhite = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5, metalness: 0.08 });
      const habAccent = new THREE.MeshStandardMaterial({ color: 0xcf7a35, roughness: 0.55, metalness: 0.1 });
      const habDark = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7, metalness: 0.05 });
      const strut = new THREE.MeshStandardMaterial({ color: 0x8d939c, roughness: 0.5, metalness: 0.35 });
      const panelM = new THREE.MeshStandardMaterial({ color: 0x1d2c46, roughness: 0.35, metalness: 0.25, emissive: 0x0a1526, emissiveIntensity: 0.5 });
      const windowM = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
      const padMarkM = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 });
      const beaconM = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.9 });
      const flagM = new THREE.MeshBasicMaterial({ color: 0xcf7a35, side: THREE.DoubleSide });
      disposables.push(habWhite, habAccent, habDark, strut, panelM, windowM, padMarkM, beaconM, flagM);

      /* pressurized dome habitat */
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3.1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), habWhite);
      dome.position.y = 0.2;
      dome.scale.y = 0.72;
      const domeRing = new THREE.Mesh(new THREE.CylinderGeometry(3.12, 3.2, 0.5, 24), habAccent);
      domeRing.position.y = 0.3;
      /* dome windows */
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.06), windowM);
        w.position.set(Math.cos(a) * 2.55, 1.35, Math.sin(a) * 2.55);
        w.lookAt(Math.cos(a) * 4, 1.35, Math.sin(a) * 4);
        hab.add(w);
      }
      /* airlock tunnel */
      const airlock = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 14), habWhite);
      airlock.rotation.z = Math.PI / 2;
      airlock.position.set(4.1, 0.9, 0);
      /* crew modules — two cylinders with rounded caps */
      const modGeo = new THREE.CylinderGeometry(1.05, 1.05, 5.0, 16);
      const capGeo = new THREE.SphereGeometry(1.05, 16, 12);
      for (const mz of [-1, 1]) {
        const mod = new THREE.Mesh(modGeo, habWhite);
        mod.rotation.x = Math.PI / 2;
        mod.position.set(7.6, 1.05, mz * 1.55);
        const capA = new THREE.Mesh(capGeo, habWhite);
        capA.position.set(7.6, 1.05, mz * 1.55 - mz * 2.5);
        const capB = new THREE.Mesh(capGeo, habWhite);
        capB.position.set(7.6, 1.05, mz * 1.55 + mz * 2.5);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.07, 0.35, 16), habAccent);
        stripe.rotation.x = Math.PI / 2;
        stripe.position.set(7.6, 1.05, mz * 1.55 - mz * 1.6);
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.06), windowM);
        win.position.set(7.6, 1.35, mz * 1.55 + mz * 1.12);
        hab.add(mod, capA, capB, stripe, win);
      }
      /* solar array wings on struts behind the modules */
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 8), strut);
        post.position.set(7.6, 1.9, sx * 3.6);
        post.rotation.x = sx * 0.35;
        const wing = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.06, 2.0), panelM);
        wing.position.set(7.6 + sx * 0.3, 2.7, sx * 4.6);
        wing.rotation.x = 0.42;
        hab.add(post, wing);
      }
      /* comms mast with blinking beacon */
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 6.4, 8), strut);
      mast.position.set(-4.2, 3.2, -2.4);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), habWhite);
      dish.position.set(-4.2, 5.6, -2.4);
      dish.rotation.x = Math.PI * 0.72;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), beaconM);
      beacon.position.set(-4.2, 6.45, -2.4);
      blinkers.push({ mat: beaconM, phase: 0 });
      hab.add(mast, dish, beacon);
      /* landing pad with edge markers */
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.8, 0.14, 28), habDark);
      pad.position.set(0.5, 0.07, -7.6);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const mk = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), padMarkM.clone());
        mk.position.set(0.5 + Math.cos(a) * 4.1, 0.17, -7.6 + Math.sin(a) * 4.1);
        blinkers.push({ mat: mk.material as THREE.MeshBasicMaterial, phase: i * 0.7 });
        hab.add(mk);
      }
      /* crew flag */
      const fPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), strut);
      fPole.position.set(-1.6, 1.2, -4.6);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.62), flagM);
      flag.position.set(-1.05, 2.0, -4.6);
      flag.rotation.y = 0.35;
      hab.add(fPole, flag);

      hab.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = SHADOWS;
          o.receiveShadow = SHADOWS;
        }
      });
      disposables.push(modGeo, capGeo);
      scene.add(hab);
    }
  }

  /* ---- instrument cache at every science / hazard site waypoint ---- */
  {
    const cacheWhite = new THREE.MeshStandardMaterial({ color: 0xd7dce2, roughness: 0.55, metalness: 0.1 });
    const cacheDark = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 });
    const cacheStrut = new THREE.MeshStandardMaterial({ color: 0x8d939c, roughness: 0.5, metalness: 0.35 });
    const cachePanel = new THREE.MeshStandardMaterial({ color: 0x1d2c46, roughness: 0.35, metalness: 0.25, emissive: 0x0a1526, emissiveIntensity: 0.5 });
    const cacheLight = new THREE.MeshBasicMaterial({ color: 0x54e0ff, transparent: true, opacity: 0.85 });
    disposables.push(cacheWhite, cacheDark, cacheStrut, cachePanel, cacheLight);
    const boxGeo = new THREE.BoxGeometry(0.7, 0.42, 0.5);
    const legGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6);
    const mastGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6);
    const puckGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 12);
    const lightGeo = new THREE.SphereGeometry(0.08, 8, 6);
    disposables.push(boxGeo, legGeo, mastGeo, puckGeo, lightGeo);
    route.forEach((wp, i) => {
      const poi = POIS.find((p) => p.id === wp.poiId);
      if (!poi || poi.type === "base") return;
      const az = (35 + i * 47) * RAD;
      const x = toX(wp.lon) + Math.sin(az) * 6.5;
      const z = toZ(wp.lat) - Math.cos(az) * 6.5;
      const g = new THREE.Group();
      g.position.set(x, groundH(x, z), z);
      g.rotation.y = i * 1.3;
      /* seismometer / env-package box on legs */
      const box = new THREE.Mesh(boxGeo, cacheWhite);
      box.position.y = 0.6;
      for (const [lx, lz] of [[-0.24, -0.16], [0.24, -0.16], [-0.24, 0.16], [0.24, 0.16]] as const) {
        const leg = new THREE.Mesh(legGeo, cacheStrut);
        leg.position.set(lx, 0.28, lz);
        leg.rotation.z = lx > 0 ? -0.18 : 0.18;
        leg.rotation.x = lz > 0 ? 0.18 : -0.18;
        g.add(leg);
      }
      /* antenna mast with status light */
      const mast = new THREE.Mesh(mastGeo, cacheStrut);
      mast.position.set(0.45, 0.75, -0.1);
      mast.rotation.z = -0.12;
      const light = new THREE.Mesh(lightGeo, cacheLight.clone());
      light.position.set(0.55, 1.5, -0.1);
      blinkers.push({ mat: light.material as THREE.MeshBasicMaterial, phase: 1 + i * 0.5 });
      /* solar puck + dark instrument crate */
      const puck = new THREE.Mesh(puckGeo, cachePanel);
      puck.position.set(-0.5, 0.5, 0.25);
      puck.rotation.z = 0.25;
      const crate = new THREE.Mesh(boxGeo, cacheDark);
      crate.position.set(-0.3, 0.22, -0.35);
      crate.scale.set(0.8, 0.6, 0.9);
      g.add(box, mast, light, puck, crate);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = SHADOWS;
          o.receiveShadow = SHADOWS;
        }
      });
      scene.add(g);
    });
  }

  /* ---- astronaut location beacon — pulsing rings + light pillar at the walker's feet ---- */
  const beaconMatRing = new THREE.MeshBasicMaterial({ color: 0x54e0ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  const beaconMatBeam = new THREE.MeshBasicMaterial({ color: 0x54e0ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const astroRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.78, 40), beaconMatRing);
  astroRing.rotation.x = -Math.PI / 2;
  const astroRing2 = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.99, 40), beaconMatRing);
  astroRing2.rotation.x = -Math.PI / 2;
  const astroBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 5.5, 8, 1, true), beaconMatBeam);
  astroBeam.position.y = 2.75;
  const astroBeacon = new THREE.Group();
  astroBeacon.add(astroRing, astroRing2, astroBeam);
  scene.add(astroBeacon);
  disposables.push(beaconMatRing, beaconMatBeam, astroRing.geometry, astroRing2.geometry, astroBeam.geometry);

  /* ---- 3D sample targets — grabbable science rocks along the traverse ---- */
  interface SampleTarget {
    code: string;
    kind: string;
    note: string;
    massKg: number;
    x: number;
    z: number;
    lon: number;
    lat: number;
    group: THREE.Group;
    rock: THREE.Mesh;
    ring: THREE.Mesh;
    sprite: THREE.Sprite;
    ringMat: THREE.MeshBasicMaterial;
    pillarMat: THREE.MeshBasicMaterial;
    spriteMat: THREE.SpriteMaterial;
    baseScale: number;
    alive: boolean;
    animT: number; // ≥ 0 → collecting animation progress
  }
  const SAMPLE_KINDS: Array<{ kind: string; note: string }> = [
    { kind: "basaltic fragment", note: "Angular basalt clast — Amazonian plains unit" },
    { kind: "impact-glass shard", note: "Vitreous melt fragment from a fresh impact" },
    { kind: "dust-cemented regolith", note: "Fine aeolian aggregate, weakly cemented" },
    { kind: "vesicular lava bomb", note: "Gas-vesiculated basalt from the young flow" },
    { kind: "sulfate-crusted pebble", note: "Light-toned sulfate rind on a basalt core" },
    { kind: "ejecta block", note: "Excavated block from a nearby crater rim" },
  ];
  const samples: SampleTarget[] = [];
  debugSamples.length = 0;
  {
    const rS = mulberry32(424242);
    const CYAN_S = 0x54e0ff;
    const stride = Math.max(24, Math.floor(routePts.length / 13));
    const used: Array<{ x: number; z: number }> = [];
    let codeN = 0;
    for (let i = 6; i < routePts.length - 6 && samples.length < 12; i += stride) {
      for (let att = 0; att < 10; att++) {
        const rp = routePts[Math.min(routePts.length - 1, Math.max(0, i + ((rS() * 10) | 0) - 5))];
        const ang = rS() * Math.PI * 2;
        const rr = att < 4 ? 3.5 + rS() * 4 : 9 + rS() * 22; // a few right beside the trail
        const x = rp.x + Math.cos(ang) * rr;
        const z = rp.z + Math.sin(ang) * rr;
        if (Math.abs(x) > halfW - 80 || Math.abs(z) > halfW - 80) continue;
        if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 40)) continue;
        used.push({ x, z });
        codeN++;
        const meta = SAMPLE_KINDS[(codeN - 1) % SAMPLE_KINDS.length];
        const s0 = 0.5 + rS() * 0.5;
        const group = new THREE.Group();
        group.position.set(x, groundH(x, z), z);
        const rockMatS = new THREE.MeshLambertMaterial({ color: 0x4d4338, emissive: 0x06272e });
        const rock = new THREE.Mesh(rockGeometry(200 + codeN * 7, 1), rockMatS);
        rock.scale.set(s0, s0 * (0.7 + rS() * 0.4), s0);
        rock.rotation.y = rS() * Math.PI * 2;
        rock.castShadow = SHADOWS;
        rock.receiveShadow = SHADOWS;
        const ringMat = new THREE.MeshBasicMaterial({ color: CYAN_S, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.18, 40), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.09;
        const pillarMat = new THREE.MeshBasicMaterial({ color: CYAN_S, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 7, 6, 1, true), pillarMat);
        pillar.position.y = 3.5;
        const sprite = makeLabelSprite(`S-${String(codeN).padStart(2, "0")}`, "#54e0ff");
        sprite.position.y = 2.0;
        sprite.scale.set(2.6, 0.65, 1);
        group.add(rock, ring, pillar, sprite);
        scene.add(group);
        disposables.push(rock.geometry, rockMatS, ring.geometry, ringMat, pillar.geometry, pillarMat);
        samples.push({
          code: `S-${String(codeN).padStart(2, "0")}`,
          kind: meta.kind,
          note: meta.note,
          massKg: 0.2 + rS() * 1.5,
          x,
          z,
          lon: cLon + x / mLonDeg,
          lat: cLat - z / mLatDeg,
          group,
          rock,
          ring,
          sprite,
          ringMat,
          pillarMat,
          spriteMat: sprite.material as THREE.SpriteMaterial,
          baseScale: s0,
          alive: true,
          animT: -1,
        });
        debugSamples.push({ code: samples[samples.length - 1].code, lon: samples[samples.length - 1].lon, lat: samples[samples.length - 1].lat });
        break;
      }
    }
  }

  /* ---- pointer look-around (low sensitivity + eased smoothing) ---- */
  let dragging = false;
  let lastPX = 0, lastPY = 0;
  /* raw look targets from drag input + smoothed values actually applied */
  let lookT = 0, pitchT = 0;
  let lookS = 0, pitchS = 0;
  const SENS_X = 0.055; // ≈ ⅓ of the old default — calm, deliberate camera
  const SENS_Y = 0.042;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic / already-released pointer ids — drag still works */
    }
    canvas.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    lookT -= (e.clientX - lastPX) * SENS_X;
    pitchT = Math.min(26, Math.max(-34, pitchT + (e.clientY - lastPY) * SENS_Y));
    lastPX = e.clientX; lastPY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    canvas.style.cursor = "grab";
  };
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  /* ---- manual foot controls: keyboard (WASD/arrows · SHIFT dash · E collect) ---- */
  const pressed = new Set<string>();
  const keyGuard = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (keyGuard(e)) return;
    if (useStore.getState().walk.active && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyE" && !e.repeat) {
      collectNonce++;
      return;
    }
    pressed.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => pressed.delete(e.code);
  const onBlur = () => pressed.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  /* ---- resize ---- */
  const resize = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dustUniforms.uScale.value = (h * dpr) / (2 * Math.tan(36 * RAD));
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /* ---- camera / walk state ---- */
  const st0 = useStore.getState();
  const startWp = st0.route[0];
  const pos = { x: toX(startWp?.lon ?? SITE.lon), z: toZ(startWp?.lat ?? SITE.lat) };
  let yaw = 0;
  {
    const a = startWp, b = st0.route[1];
    if (a && b) yaw = (Math.atan2(toX(b.lon) - toX(a.lon), -(toZ(b.lat) - toZ(a.lat))) * 180) / Math.PI;
  }
  let phase = 0;
  let slowFrames = 0;
  let downscaled = false;
  let trimmed = false;
  let dustFade = 1;
  let fogDenLerp = fogDen; /* eases up when a dust-storm drill darkens the sky */

  const sunDir = new THREE.Vector3(0, 1, 0);
  let raf = 0;
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, tGlobal = 0;
  let lastCollect = 0;

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tGlobal += dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { camBus.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

    const st = useStore.getState();
    const r = st.walk.readout;
    const routeNow = st.route;
    const playing = st.walk.playing;
    const dwelling = (r?.dwellH ?? 0) > 0;
    const atEnd = !!r?.atEnd;
    const walking = !!r && playing && !atEnd;

    /* E2E teleport */
    if (teleportReq) {
      pos.x = toX(teleportReq.lon);
      pos.z = toZ(teleportReq.lat);
      teleportReq = null;
    }

    /* ---- manual foot controls (WASD / D-pad · SHIFT dash) ---- */
    const kbF = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0) - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
    const kbS = (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0) - (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0);
    const iF = Math.max(-1, Math.min(1, kbF + walkInput.fwd));
    const iS = Math.max(-1, Math.min(1, kbS + walkInput.strafe));
    const inputMove = st.walk.active && !atEnd && (iF !== 0 || iS !== 0);
    if (inputMove && !st.walk.manual && !st.walk.readout?.finished) {
      useStore.getState().setWalkManual(true); // WalkEngine pauses the auto-traverse
    }
    const manual = st.walk.active && st.walk.manual && !atEnd;
    let manualSpeed = 0;
    if (manual) {
      /* local terrain gradient → uphill/downhill speed factor */
      const e2 = 2.0;
      const gx = (groundH(pos.x + e2, pos.z) - groundH(pos.x - e2, pos.z)) / (2 * e2);
      const gz = (groundH(pos.x, pos.z + e2) - groundH(pos.x, pos.z - e2)) / (2 * e2);
      const grad = Math.hypot(gx, gz);
      const slopeNow = (Math.atan(grad) / Math.PI) * 180;
      const dashOn = (pressed.has("ShiftLeft") || pressed.has("ShiftRight") || walkInput.dash) && inputMove;
      if (inputMove) {
        const yawR = yaw * RAD;
        let dx = Math.sin(yawR) * iF + Math.cos(yawR) * iS;
        let dz = -Math.cos(yawR) * iF + Math.sin(yawR) * iS;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        const upDot = grad > 1e-4 ? Math.max(-1, Math.min(1, (dx * gx + dz * gz) / grad)) : 0;
        const slopeEff = slopeNow * upDot; // + uphill · − downhill
        /* suited EVA pace: ~3.4 km/h careful walk, ~5.6 km/h brief suit lope on
         * the dash — Apollo crews averaged 2.2–3.6 km/h; sprinting in a
         * pressurized suit is not survivable physics */
        const spd = Math.max(0.25, Math.min(1.7, slopeAdjustedSpeed(dashOn ? 5.6 : 3.4, slopeEff) / 3.6));
        manualSpeed = spd;
        pos.x = Math.max(-halfW + 60, Math.min(halfW - 60, pos.x + dx * spd * dt));
        pos.z = Math.max(-halfW + 60, Math.min(halfW - 60, pos.z + dz * spd * dt));
      }
      camBus.manual = true;
      camBus.speedMs = manualSpeed;
      camBus.dashing = dashOn;
      camBus.offRouteM = distToRoute(pos.x, pos.z);
      camBus.slopeDeg = slopeNow;
    } else {
      camBus.manual = false;
      camBus.speedMs = 0;
      camBus.dashing = false;
      camBus.offRouteM = 0;
      camBus.slopeDeg = 0;
    }

    /* position target (auto-walk eases toward the sim readout) */
    let tLon: number, tLat: number, lst: number;
    if (r) { tLon = r.lon; tLat = r.lat; lst = r.lstNow; }
    else {
      const a = routeNow[0] ?? { lon: SITE.lon, lat: SITE.lat };
      tLon = a.lon; tLat = a.lat; lst = st.eva.startLst;
    }
    if (!manual) {
      const kPos = Math.min(1, dt * 3.2);
      pos.x += (toX(tLon) - pos.x) * kPos;
      pos.z += (toZ(tLat) - pos.z) * kPos;
    }

    /* heading */
    let yawT: number;
    if (manual) yawT = yaw; // free look — heading is user-driven on foot
    else if (r && !atEnd) yawT = r.bearing;
    else if (r) yawT = yaw;
    else {
      const a = routeNow[0], b = routeNow[1];
      yawT = a && b
        ? (Math.atan2(toX(b.lon) - toX(a.lon), -(toZ(b.lat) - toZ(a.lat))) * 180) / Math.PI
        : yaw;
    }
    const autoMoving = walking && !dwelling;
    const moving = autoMoving || (manual && manualSpeed > 0.05);
    if (!dragging) {
      if (autoMoving) {
        lookT *= Math.exp(-dt * 2.0);
        pitchT *= Math.exp(-dt * 2.0);
      }
      if (!r) lookT += Math.sin(tGlobal * 0.10) * dt * 1.3; // slow idle pan
    }
    /* ease toward the raw look targets — smooths out abrupt drag jumps */
    const kLook = Math.min(1, dt * 9);
    lookS += (lookT - lookS) * kLook;
    pitchS += (pitchT - pitchS) * kLook;
    const yawSpeed = r ? 2.4 : 1.5;
    yaw = approachAngle(yaw, yawT + lookS, Math.min(1, dt * yawSpeed));

    /* gait */
    const speed = manual ? manualSpeed : (r?.speedEff ?? 0);
    if (moving) phase += dt * 2 * Math.PI * Math.min(2.6, Math.max(0.8, speed / 1.3));
    const bob = moving ? Math.sin(phase) * 0.045 : Math.sin(tGlobal * 1.2) * 0.012;
    const roll = moving ? Math.sin(phase * 0.5) * 0.011 : 0;

    const ground = groundH(pos.x, pos.z);
    const eye = ground + 1.72 + bob;
    const pitchDeg = (moving ? -5 + Math.sin(phase * 2) * 0.35 : -4) + pitchS;

    camera.position.set(pos.x, eye, pos.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitchDeg * RAD, -yaw * RAD, roll);

    /* astronaut beacon rides with the walker */
    astroBeacon.position.set(pos.x, ground + 0.06, pos.z);
    astroRing.rotation.z = tGlobal * 1.4;
    astroRing2.rotation.z = -tGlobal * 0.9;
    const bp = 0.5 + 0.5 * Math.sin(tGlobal * 3.4);
    astroRing.scale.setScalar(1 + bp * 0.35);
    astroRing2.scale.setScalar(1 + (1 - bp) * 0.5);
    beaconMatRing.opacity = 0.45 + 0.4 * bp;
    beaconMatBeam.opacity = 0.14 + 0.16 * bp;

    /* sun + atmosphere */
    const sunAz = (180 + (lst - 12) * 15) * RAD;
    const sunEl = Math.max(-8, sunElevAt(lst)) * RAD;
    sunDir.set(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl)).normalize();
    const day = Math.min(1, Math.max(0.16, 0.18 + Math.sin(sunEl) * 1.05));
    /* shadow frustum rides with the walker — texel-snapped to avoid shimmer */
    const shOn = SHADOWS && st.visorPrefs.shadows;
    if (shOn !== sun.castShadow) sun.castShadow = shOn;
    const snX = Math.round(camera.position.x * 2) / 2;
    const snY = Math.round(camera.position.y * 2) / 2;
    const snZ = Math.round(camera.position.z * 2) / 2;
    sun.target.position.set(snX, snY, snZ);
    sun.position.set(snX, snY, snZ).addScaledVector(sunDir, 3000);
    sun.target.updateMatrixWorld();
    sun.intensity = 2.6 * day;
    hemi.intensity = 0.6 * day;
    amb.intensity = 0.75 * day;
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uDay.value = day;
    sky.position.set(camera.position.x, 0, camera.position.z);
    fogColor.setRGB(0.93 * day, 0.70 * day, 0.47 * day);
    if (day < 0.45) fogColor.lerp(new THREE.Color(0.32, 0.22, 0.15), (0.45 - day) * 1.6);
    (scene.fog as THREE.FogExp2).color.copy(fogColor);
    /* dust-storm drill: sky closes in, fog thickens, airborne dust doubles */
    const dustStorm = st.hazard?.id === "dust_storm";
    fogDenLerp += ((dustStorm ? 0.00058 : fogDen) - fogDenLerp) * Math.min(1, dt * 0.7);
    (scene.fog as THREE.FogExp2).density = fogDenLerp;
    terrainUniforms.uFogDen.value = fogDenLerp;
    if (dustStorm) fogColor.lerp(new THREE.Color(0.52, 0.34, 0.19), 0.35);
    (scene.fog as THREE.FogExp2).color.copy(fogColor);
    terrainUniforms.uSunDir.value.copy(sunDir);
    terrainUniforms.uDay.value = day;
    terrainUniforms.uFogColor.value.copy(fogColor);
    terrainUniforms.uCamPos.value.copy(camera.position);

    /* dust drift + wrap around camera */
    {
      const arr = dustGeo.attributes.position.array as Float32Array;
      const windX = Math.sin(2.1) * 2.0, windZ = Math.cos(2.1) * 2.0;
      for (let i = 0; i < DUST_N; i++) {
        const ix = i * 3;
        arr[ix] += (windX + Math.sin(tGlobal * 0.7 + i) * 0.5) * dt;
        arr[ix + 1] += Math.sin(tGlobal * 0.5 + i * 1.7) * 0.12 * dt;
        arr[ix + 2] += (windZ + Math.cos(tGlobal * 0.6 + i) * 0.5) * dt;
        let rx = arr[ix] - camera.position.x;
        let rz = arr[ix + 2] - camera.position.z;
        if (rx > 50) arr[ix] -= 100; else if (rx < -50) arr[ix] += 100;
        if (rz > 50) arr[ix + 2] -= 100; else if (rz < -50) arr[ix + 2] += 100;
        const ry = arr[ix + 1] - camera.position.y;
        if (ry > 16) arr[ix + 1] -= 15; else if (ry < -2) arr[ix + 1] += 15;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustUniforms.uOpacity.value = (0.16 + 0.2 * day) * dustFade * (dustStorm ? 2.4 : 1);
    }

    /* habitat / pad / cache beacons blink */
    for (const b of blinkers) {
      b.mat.opacity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(tGlobal * 2.4 + b.phase));
    }

    /* beacons: pulse + next highlight + labels + route state */
    const nextIdx = r ? r.nextIdx : Math.min(1, routeNow.length - 1);
    for (const b of beacons) {
      const isNext = b.idx === nextIdx && !atEnd;
      const passed = r ? b.idx < nextIdx : false;
      const pulse = 0.5 + 0.5 * Math.sin(tGlobal * (isNext ? 4.2 : 2.0) + b.idx);
      const base = passed ? 0.35 : isNext ? 1 : 0.75;
      b.matDiamond.opacity = (0.55 + 0.45 * pulse) * base;
      b.matPole.opacity = 0.5 * base;
      b.matRing.opacity = (0.25 + 0.4 * pulse) * base;
      const rs = 1 + (isNext ? 0.5 : 0.2) * pulse;
      b.ring.scale.setScalar(rs);
      b.diamond.rotation.y = tGlobal * (isNext ? 2.4 : 1.1);
      b.diamond.position.y = 7.6 + Math.sin(tGlobal * 1.7 + b.idx) * 0.25;
      /* labels + route sprites scale with distance */
      for (const child of b.group.children) {
        if ((child as THREE.Sprite).isSprite) {
          const d = camera.position.distanceTo(child.getWorldPosition(new THREE.Vector3()));
          const k = Math.min(30, Math.max(2.4, d * 0.05));
          child.scale.set(k * 4, k, 1);
        }
      }
    }

    /* sample targets: pulse, capture-range check, collect animation */
    let capTarget: SampleTarget | null = null;
    let capScore = Infinity;
    const fwdX = Math.sin(yaw * RAD);
    const fwdZ = -Math.cos(yaw * RAD);
    for (const sm of samples) {
      if (sm.animT >= 0) {
        const nt = Math.min(1, sm.animT + dt / 0.55);
        sm.animT = nt >= 1 ? -2 : nt; // -2 → done, group hidden below
        const k = 1 - nt;
        sm.rock.scale.setScalar(Math.max(0.001, sm.baseScale * k));
        sm.rock.position.y = nt * 0.9;
        sm.rock.rotation.y += dt * 7;
        sm.ringMat.opacity = 0.55 * (1 - nt);
        sm.ring.scale.setScalar(1 + nt * 2.6);
        sm.pillarMat.opacity = 0.3 * (1 - nt);
        sm.spriteMat.opacity = 1 - nt;
        if (nt >= 1) {
          sm.alive = false;
          sm.group.visible = false;
        }
        continue;
      }
      if (!sm.alive) continue;
      const pulse = 0.5 + 0.5 * Math.sin(tGlobal * 3.1 + sm.x);
      sm.ringMat.opacity = 0.32 + 0.3 * pulse;
      sm.ring.scale.setScalar(1 + 0.16 * pulse);
      sm.pillarMat.opacity = 0.18 + 0.2 * pulse;
      const dxs = sm.x - pos.x;
      const dzs = sm.z - pos.z;
      const ds = Math.hypot(dxs, dzs);
      const lk = Math.min(16, Math.max(2.2, ds * 0.05));
      sm.sprite.scale.set(lk * 2.2, lk * 0.55, 1);
      if (st.walk.active && ds < 7) {
        const cosA = (dxs * fwdX + dzs * fwdZ) / (ds || 1);
        if (cosA > 0.9) { // within ~26° of the view center
          const score = ds + (1 - cosA) * 10;
          if (score < capScore) {
            capScore = score;
            capTarget = sm;
          }
        }
      }
    }
    camBus.target = capTarget
      ? { code: capTarget.code, kind: capTarget.kind, massKg: capTarget.massKg, distM: Math.hypot(capTarget.x - pos.x, capTarget.z - pos.z) }
      : null;
    if (capTarget && collectNonce !== lastCollect) {
      lastCollect = collectNonce;
      capTarget.animT = 0;
      const s2 = useStore.getState();
      s2.collectSample({
        code: capTarget.code,
        kind: capTarget.kind,
        note: capTarget.note,
        massKg: capTarget.massKg,
        lon: capTarget.lon,
        lat: capTarget.lat,
        t: Date.now(),
      });
      s2.pushWalkEvent(`SAMPLE SECURED · ${capTarget.code} — ${capTarget.kind.toUpperCase()} (${capTarget.massKg.toFixed(2)} KG)`, "arrive");
    }

    camBus.yawDeg = yaw;
    camBus.pitchDeg = pitchDeg;
    camBus.lon = cLon + pos.x / mLonDeg;
    camBus.lat = cLat - pos.z / mLatDeg;
    camBus.elevM = ground;
    camBus.moving = moving;

    renderer.render(scene, camera);

    /* adaptive quality: one-shot DPR downgrade, then instance-count trim
     * (touch devices get a quicker trigger — seconds matter on a tablet) */
    const slowA = TOUCH_TIER ? 45 : 90;
    const slowB = TOUCH_TIER ? 120 : 240;
    if (!downscaled && camBus.fps > 0 && camBus.fps < 24) {
      if (++slowFrames > slowA) {
        downscaled = true;
        dpr = 1.0;
        renderer.setPixelRatio(dpr);
      }
    } else if (downscaled && !trimmed && camBus.fps > 0 && camBus.fps < 20) {
      if (++slowFrames > slowB) {
        trimmed = true;
        for (let i = 2; i < rockMeshes.length; i++) rockMeshes[i].count = Math.floor(rockMeshes[i].count * 0.55);
        dustFade = 0.7;
      }
    } else if (camBus.fps >= 24) {
      slowFrames = Math.max(0, slowFrames - 2);
    }
  };
  raf = requestAnimationFrame(loop);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      for (const d of disposables) d.dispose();
      geo.dispose();
      (terrain.material as THREE.Material).dispose();
      ctxTex?.dispose();
      detailTex.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
