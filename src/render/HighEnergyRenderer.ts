import * as THREE from 'three';
import { METERS_TO_SCENE } from '../physics/constants';
import { CelestialBody, CmeWave, TidalStreamLink, Vec3 } from '../types/cosmos';
import { BodyRenderer, SHARED_PROMINENCE_GEO } from './BodyRenderer';
import { createProminenceMaterial } from './shaders/bodyShaders';
import { textureAtlas } from './TextureAtlas';

const GLSL_NOISE_HELPERS = /* glsl */ `
  float hHash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float hNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hHash2(i);
    float b = hHash2(i + vec2(1.0, 0.0));
    float c = hHash2(i + vec2(0.0, 1.0));
    float d = hHash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float hFbm2(vec2 p) {
    return 0.62 * hNoise2(p) + 0.38 * hNoise2(p * 2.07 + vec2(13.7, 7.3));
  }
  float hHash3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float hNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hHash3(i + vec3(0,0,0)), hHash3(i + vec3(1,0,0)), u.x),
        mix(hHash3(i + vec3(0,1,0)), hHash3(i + vec3(1,1,0)), u.x),
        u.y
      ),
      mix(
        mix(hHash3(i + vec3(0,0,1)), hHash3(i + vec3(1,0,1)), u.x),
        mix(hHash3(i + vec3(0,1,1)), hHash3(i + vec3(1,1,1)), u.x),
        u.y
      ),
      u.z
    );
  }
  float hFbm3(vec3 p) {
    return 0.62 * hNoise3(p) + 0.38 * hNoise3(p * 2.05 + vec3(11.3, 7.1, 5.7));
  }
`;

// 1. Authentic NASA SVS *Dynamic Earth* Fluid Micro-Particle Solar Storm Geometry:
//    ZERO fake gas clouds, ZERO stiff wireframe lines, ZERO dotty prominence glitter!
//    2,400 fluid-advected micro-fine velocity-elongated solar wind & CME ion particles organized into 96 curl-warped
//    plasma currents that physically part & deflect around Earth's parabolic magnetopause bow shock!
function buildSolarWindParticlesGeometry(count = 2400): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3); // computed 100% in GPU vertex shader
  const swA = new Float32Array(count * 4); // (theta, phi, phase, speed)
  const swB = new Float32Array(count * 4); // (sizeScale, filamentSeed, particleSeed, kind [0=ambient+surge, 1=CME shock wave])

  let s = 1337;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const gauss = () => (rand() + rand() + rand() - 1.5) * 0.66;

  // Organize 4,600 micro-particles into 96 coherent fluid filaments so they flow like silky stardust rivers!
  const filamentCount = 96;
  const filTheta = new Float32Array(filamentCount);
  const filPhi = new Float32Array(filamentCount);
  const filSeed = new Float32Array(filamentCount);
  for (let f = 0; f < filamentCount; f++) {
    filTheta[f] = Math.pow(rand(), 0.78) * 0.68;
    filPhi[f] = rand() * Math.PI * 2;
    filSeed[f] = rand();
  }

  for (let i = 0; i < count; i++) {
    const isShockWave = i >= Math.floor(count * 0.45) ? 1.0 : 0.0;
    const fIdx = i % filamentCount;

    // Coherent filament core + tighter organic fluid grouping so 2,400 sparks flow as silky glowing plasma currents!
    const spread = isShockWave > 0.5 ? 0.036 : 0.068;
    const baseT = isShockWave > 0.5 ? filTheta[fIdx] * 0.74 : filTheta[fIdx];
    const theta = Math.max(0.0, baseT + gauss() * spread);
    const phi = filPhi[fIdx] + gauss() * (spread * 1.45);
    const phase = rand();
    const speed = isShockWave > 0.5 ? 0.82 + rand() * 0.42 : 0.68 + rand() * 0.64;

    const sizeScale = 0.72 + Math.pow(rand(), 1.6) * 0.95;
    const seed = rand();

    const o4 = i * 4;
    swA[o4] = theta;
    swA[o4 + 1] = phi;
    swA[o4 + 2] = phase;
    swA[o4 + 3] = speed;

    swB[o4] = sizeScale;
    swB[o4 + 1] = filSeed[fIdx];
    swB[o4 + 2] = seed;
    swB[o4 + 3] = isShockWave;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSwA', new THREE.BufferAttribute(swA, 4));
  geo.setAttribute('aSwB', new THREE.BufferAttribute(swB, 4));
  return geo;
}

const SHARED_SOLAR_WIND_PARTICLES_GEO = buildSolarWindParticlesGeometry(2400);

// 2. Authentic NASA Goddard SVS 3D Magnetosphere Dipole Field Lines (Tsyganenko-inspired solar-wind distortion!)
//    NO sci-fi glowing glass forcefield bubble! Pure delicate 3D magnetic field curves emerging from N/S magnetic poles,
//    compressed on sunward (+Z) side, funneling into polar cusps, and stretching into a comet-like nightside magnetotail (-Z).
function buildMagnetosphereFieldLinesGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const lineMeta: number[] = []; // (u along line [0..1], lineType: 0=closed dayside, 1=polar cusp, 2=magnetotail, phase)

  const addCurve = (pts: THREE.Vector3[], lineType: number, phase: number) => {
    const segs = pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const uA = i / segs;
      const uB = (i + 1) / segs;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      lineMeta.push(uA, lineType, phase, uB, lineType, phase);
    }
  };

  // A. 16 Closed Dipole Magnetic Field Loops (compressed on sunward +Z, stretched slightly on flanks & inner nightside)
  const closedShells = [
    { L: 2.55, count: 8 },
    { L: 3.65, count: 10 },
  ];
  for (const shell of closedShells) {
    for (let k = 0; k < shell.count; k++) {
      const az = (k / shell.count) * Math.PI * 2;
      const cosAz = Math.cos(az); // +1 = sunward (+Z), -1 = nightside (-Z)
      const sinAz = Math.sin(az);
      // Skip far-nightside outer loops (those open into the stretched magnetotail!)
      if (shell.L > 3.0 && cosAz < -0.55) continue;

      // Solar wind compresses dayside (+Z) magnetopause & elongates nightside (-Z)!
      const daysideComp = cosAz > 0 ? 1.0 - 0.28 * cosAz : 1.0 + 0.42 * (-cosAz);
      const L = shell.L * daysideComp;

      const pts: THREE.Vector3[] = [];
      const steps = 40;
      // Dipole equation r = L * sin^2(theta), starting & ending cleanly at Earth's auroral ovals (r ~ 1.04)
      const sinMin = Math.sqrt(Math.min(0.95, 1.04 / L));
      const thetaMin = Math.asin(sinMin);
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const theta = thetaMin + u * (Math.PI - 2 * thetaMin);
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        const r = L * sinT * sinT;
        // Subtle tailward solar-wind sweep on flanks
        const tailSweep = -0.35 * sinT * sinT * Math.max(0, 1.0 - cosAz * 0.65) * (shell.L / 3.5);
        const x = r * sinT * sinAz;
        const y = r * cosT;
        const z = r * sinT * cosAz + tailSweep;
        pts.push(new THREE.Vector3(x, y, z));
      }
      addCurve(pts, 0, k * 0.73 + shell.L);
    }
  }

  // B. 16 Open Polar Cusp & Swept Nightside Magnetotail Field Lines (8 North lobe + 8 South lobe)
  //    Emerge from the North & South auroral ovals, arch sunward/flankward, then sweep far back into -Z magnetotail!
  const hemispheres = [1, -1];
  for (const hemi of hemispheres) {
    for (let k = 0; k < 8; k++) {
      const az = ((k + 0.5) / 8) * Math.PI * 2;
      const cosAz = Math.cos(az);
      const sinAz = Math.sin(az);
      const isDaysideCusp = cosAz > 0.2;
      const pts: THREE.Vector3[] = [];
      const steps = 36;

      // Footpoint right on Earth's polar auroral oval (~18° colatitude)
      const colat0 = 0.31;
      const p0 = new THREE.Vector3(
        1.03 * Math.sin(colat0) * sinAz,
        1.03 * Math.cos(colat0) * hemi,
        1.03 * Math.sin(colat0) * cosAz
      );

      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        // Smoothly curve upward from the magnetic pole, flare over the magnetopause, and stretch far tailward (-Z)!
        const archOut = Math.sin(Math.min(1, u * 1.45) * Math.PI * 0.5);
        const spreadX = p0.x + sinAz * (1.85 + 1.4 * u) * archOut;
        const lobeY =
          p0.y +
          hemi * (1.55 * Math.pow(u, 0.55) * (1.0 - 0.18 * u) + (isDaysideCusp ? 0.45 * Math.sin(u * Math.PI) : 0));
        // Dayside cusp lines bulge slightly sunward (+Z) before being swept dramatically back into the -Z magnetotail!
        const sunBulge = isDaysideCusp ? 1.45 * cosAz * Math.sin(Math.min(1, u * 2.2) * Math.PI) * (1.0 - u) : 0;
        const tailZ = p0.z + sunBulge - Math.pow(u, 1.35) * 7.8;
        pts.push(new THREE.Vector3(spreadX, lobeY, tailZ));
      }
      addCurve(pts, isDaysideCusp ? 1 : 2, k * 1.13 + (hemi > 0 ? 0 : 3.1));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aMeta', new THREE.Float32BufferAttribute(lineMeta, 3));
  return geo;
}

// 3. GPU Plasma Stream Ribbon Geometry (uv.x across [-1..1], uv.y along spline [0..1])
const SHARED_STREAM_RIBBON_GEO = new THREE.PlaneGeometry(1, 1, 6, 64);

// 4. GPU Blazar Jet Axial Ribbon Geometry
const SHARED_BLAZAR_RIBBON_GEO = new THREE.PlaneGeometry(1, 1, 6, 48);

// 5. GPU Plasma Flow Particles for Tidal Streams & Magnetosphere Cusp Funneling
function buildFlowParticleGeometry(count: number): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    params[i * 4] = Math.random(); // phase [0..1]
    params[i * 4 + 1] = Math.random(); // radial offset
    params[i * 4 + 2] = Math.random() * Math.PI * 2; // azimuth
    params[i * 4 + 3] = 0.55 + Math.random() * 0.9; // size/speed factor
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  return geo;
}

const SHARED_MAGNETO_LINES_GEO = buildMagnetosphereFieldLinesGeometry();
const SHARED_STREAM_PARTICLES_GEO = buildFlowParticleGeometry(320);
const SHARED_ACC_DISK_GEO = new THREE.RingGeometry(1.35, 3.8, 96);

// Shared GLSL Parabolic Magnetopause Bow-Shock Deflection & Polar-Cusp Funneling Helper
// Smoothly deflects incoming solar wind streamlines & IMF magnetic field lines around Earth's magnetosphere!
const GLSL_BOW_SHOCK_DEFLECT = /* glsl */ `
  uniform float uHasTarget;
  uniform vec3 uTargetPos;
  uniform float uEarthR;
  uniform float uBowR;

  vec3 deflectAroundMagnetosphere(vec3 p, float seed, bool allowCusp, out float bowCompress, out float cuspGlow) {
    bowCompress = 0.0;
    cuspGlow = 0.0;
    if (uHasTarget < 0.5 || uBowR < 0.01) return p;

    vec3 rel = p - uTargetPos;
    float dz = rel.z; // < 0 sunward (upstream), > 0 nightside (downstream magnetotail)
    vec2 perp = rel.xy;
    float rPerp = length(perp);
    vec2 perpDir = rPerp > 0.0005 ? (perp / rPerp) : vec2(0.0, 1.0);

    // Parabolic magnetopause cavity envelope: nose at dz = -1.05 * uBowR, flaring smoothly into nightside tail
    float axialMask =
      smoothstep(-uBowR * 2.5, -uBowR * 0.72, dz) *
      smoothstep(uBowR * 11.5, uBowR * 4.5, dz);
    if (axialMask < 0.001) return p;

    float s = max(0.0, dz + uBowR * 1.10);
    float envR = uBowR * 1.16 * sqrt(s / (uBowR * 1.10));

    // Smooth potential-flow deflection carving a crisp parabolic magnetopause cavity around Earth!
    float influence = exp(-pow(rPerp / (envR * 2.35 + uBowR * 0.85), 2.0)) * axialMask;
    float deflectedR = sqrt(rPerp * rPerp + envR * envR * influence * 1.16);

    vec3 outPos = vec3(uTargetPos.xy + perpDir * deflectedR, p.z);

    // Subset of polar-aligned charged particle streaks peel off into Earth's N/S polar cusps!
    if (allowCusp) {
      float polarAlign = smoothstep(0.64, 0.95, abs(perpDir.y));
      float isCuspParticle = step(0.82, seed) * polarAlign * smoothstep(envR * 1.25, envR * 0.15, rPerp);
      float cuspWindow =
        smoothstep(-uBowR * 0.95, -uBowR * 0.1, dz) *
        smoothstep(uBowR * 1.35, uBowR * 0.12, dz);
      float cuspFactor = isCuspParticle * cuspWindow;
      if (cuspFactor > 0.01) {
        float hemi = perpDir.y >= 0.0 ? 1.0 : -1.0;
        vec3 poleTarget = uTargetPos + vec3(0.0, hemi * uEarthR * 1.18, -uEarthR * 0.12);
        outPos = mix(outPos, poleTarget, cuspFactor * 0.86);
        cuspGlow = cuspFactor;
      }
    }

    // Dayside bow-shock compression sheen where streamlines pile up along the sunward magnetopause!
    float distToEnv = abs(deflectedR - envR) / (uBowR * 0.58);
    float dayside =
      smoothstep(uBowR * 3.0, -uBowR * 0.45, dz) *
      smoothstep(-uBowR * 1.95, -uBowR * 0.50, dz);
    bowCompress = exp(-distToEnv * distToEnv) * dayside * axialMask;

    return outPos;
  }
`;

/**
 * 1A. Authentic NASA SVS *Dynamic Earth* Fluid Micro-Particle Solar Wind & CME River (60 FPS):
 * - ZERO gas clouds, ZERO stiff wireframe lines, ZERO big cotton balls!
 * - 2,400 velocity-elongated (2.6:1) micro-fine glittering ion droplets flowing in 96 curl-warped fluid currents.
 * - Compresses into a shimmering, rippling golden-white river along the advancing CME shockwave front.
 * - Physically parts & flows smoothly around Earth's parabolic magnetopause bow shock (flashing electric cyan-white
 *   at bow-shock pile-up) while spiraling emerald-cyan motes straight into Earth's N/S polar auroras!
 */
function createSolarWindParticlesMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaveR: { value: 20 },
      uStarR: { value: 3.5 },
      uMaxR: { value: 180 },
      uProgress: { value: 0 },
      uIntensity: { value: 1.2 },
      uHasTarget: { value: 0 },
      uTargetPos: { value: new THREE.Vector3() },
      uEarthR: { value: 1.0 },
      uBowR: { value: 4.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSwA; // (theta, phi, phase, speed)
      attribute vec4 aSwB; // (sizeScale, filamentSeed, particleSeed, kind [0=ambient+surge, 1=CME shock wave])

      uniform float uTime;
      uniform float uWaveR;
      uniform float uStarR;
      uniform float uMaxR;
      uniform float uProgress;

      varying float vSurge;
      varying float vBow;
      varying float vCusp;
      varying float vFade;
      varying float vSeed;
      varying float vKind;
      varying vec2 vVelDir;
      ${GLSL_BOW_SHOCK_DEFLECT}

      void main() {
        float theta = aSwA.x;
        float phi = aSwA.y;
        float phase = aSwA.z;
        float speed = aSwA.w;

        float sizeScale = aSwB.x;
        float filSeed = aSwB.y;
        float pSeed = aSwB.z;
        float kind = aSwB.w;

        vSeed = pSeed;
        vKind = kind;

        float rMin = uStarR * 1.15;
        float spanR = max(12.0, uMaxR * 1.24 - rMin);
        float r;
        float surge;

        float frontReachMask = 1.0;
        if (kind > 0.5) {
          // CME Shockwave Fluid River: strictly expands OUTWARD from rMin (Sun surface) behind uWaveR!
          float maxBand = max(uStarR * 3.8, uMaxR * 0.28);
          float bandWidth = min(maxBand, max(uStarR * 1.4, (uWaveR - rMin) * 0.92));
          float localCycle = fract(phase + uTime * (0.24 * speed));
          // Organic front-skewed distribution strictly trailing uWaveR (0 -> leading crest, never spawns ahead of wave!)
          float rel = (1.0 - pow(1.0 - localCycle, 1.45) - 0.96) * bandWidth;
          float crestRipple =
            sin(phi * 3.0 + filSeed * 6.283 - uTime * 1.6) * (bandWidth * 0.12) +
            cos(theta * 9.0 - phi * 2.0 + uTime * 1.2) * (bandWidth * 0.08);
          r = uWaveR + rel + crestRipple;
          float crestDist = (r - (uWaveR - bandWidth * 0.28)) / max(uStarR, bandWidth * 0.48);
          surge = exp(-crestDist * crestDist);
          frontReachMask = smoothstep(rMin, rMin + uStarR * 0.8, r);
        } else {
          // Continuous Ambient Solar Wind: emerges strictly behind/near the advancing outward CME wave!
          float cycle = fract(phase + uTime * (0.14 * speed));
          r = rMin + cycle * spanR;
          float distToFront = abs(r - uWaveR);
          float shockWidth = max(uStarR * 3.5, uMaxR * 0.18);
          surge = exp(-pow(distToFront / shockWidth, 2.0));
          // Smoothly reveal particles ONLY as the outward CME front reaches that distance from the Sun!
          frontReachMask = smoothstep(uWaveR + max(uStarR * 2.5, uMaxR * 0.06), uWaveR - max(uStarR * 1.5, uMaxR * 0.04), r);
        }

        // Subtle Parker-spiral lag + coherent 3D fluid curl eddies shared per filament!
        float rNorm = r / max(1.0, uMaxR);
        float parkerLag = rNorm * 0.22;
        float eddyPhase = rNorm * 7.5 - uTime * 1.85 + filSeed * 6.283;
        float eddyT = sin(eddyPhase) * 0.036 * (0.35 + surge);
        float eddyP = cos(eddyPhase * 1.3 + filSeed * 9.1) * 0.055 * (0.35 + surge);

        float tAngle = max(0.0, theta + eddyT);
        float az = phi - parkerLag + eddyP;
        float sinT = sin(tAngle);
        vec3 dir = normalize(vec3(sinT * cos(az), sinT * sin(az) * 0.76, cos(tAngle)));
        vec3 localPos = dir * max(rMin * 0.94, r);

        // Real C-infinity parabolic bow-shock deflection around Earth's magnetosphere!
        float bowCompress = 0.0;
        float cuspGlow = 0.0;
        vec3 finalPos = deflectAroundMagnetosphere(localPos, pSeed, true, bowCompress, cuspGlow);

        // Compute screen-space velocity direction so each tiny micro-spark softly elongates along its true curved flight path!
        float bAhead = 0.0;
        float cAhead = 0.0;
        vec3 aheadPos = deflectAroundMagnetosphere(localPos + dir * max(0.8, uBowR * 0.35), pSeed, true, bAhead, cAhead);
        vec4 mvPos = modelViewMatrix * vec4(finalPos, 1.0);
        vec4 clip0 = projectionMatrix * mvPos;
        vec4 clip1 = projectionMatrix * (modelViewMatrix * vec4(aheadPos, 1.0));
        vec2 sDir = (clip1.xy / max(0.001, clip1.w)) - (clip0.xy / max(0.001, clip0.w));
        float sLen = length(sDir);
        vec2 vel2 = sLen > 0.0001 ? (sDir / sLen) : vec2(1.0, 0.0);
        vVelDir = vec2(vel2.x, -vel2.y); // flip Y to match gl_PointCoord top-down orientation

        vSurge = surge;
        vBow = bowCompress;
        vCusp = cuspGlow;

        float startFade = smoothstep(rMin, rMin + uStarR * 2.0, r);
        float endFade = smoothstep(uMaxR * 1.24, uMaxR * 0.86, r);
        float lifeFade = smoothstep(0.0, 0.03, uProgress) * smoothstep(1.0, 0.74, uProgress);
        float coneEdge = exp(-theta * theta * 4.6) * smoothstep(0.84, 0.40, theta);
        vFade = startFade * endFade * lifeFade * coneEdge * frontReachMask;

        gl_Position = clip0;

        // Strictly micro-scale jewel-like velocity-elongated sparks (2.2px - 6.0px max -> zero wireframes, zero cotton balls!)
        float basePt = (1.85 + 1.65 * surge + 1.35 * bowCompress + 1.15 * cuspGlow) * sizeScale;
        gl_PointSize = clamp(basePt * (170.0 / max(18.0, -mvPos.z)), 2.2, 6.2);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;

      varying float vSurge;
      varying float vBow;
      varying float vCusp;
      varying float vFade;
      varying float vSeed;
      varying float vKind;
      varying vec2 vVelDir;

      void main() {
        if (vFade < 0.004) discard;
        vec2 p = gl_PointCoord - 0.5;

        // Softly elongate each anti-aliased micro-spark (~2.6:1 teardrop) along its true 3D curved flight velocity!
        vec2 fwd = vVelDir;
        vec2 side = vec2(-fwd.y, fwd.x);
        float along = dot(p, fwd);
        float across = dot(p, side);
        float stretch = mix(1.75, 2.85, clamp(vSurge + vBow * 0.5, 0.0, 1.0));
        float d2 = (along * along) * 1.15 + (across * across) * (stretch * stretch);
        if (d2 > 0.25) discard;

        // Bright leading ion head tapering smoothly into a wispy sub-pixel motion tail (instantly distinct from static stars!)
        float headBias = smoothstep(-0.46, 0.24, along);
        float core = exp(-d2 * 44.0) * (0.55 + 0.55 * headBias);
        float halo = exp(-d2 * 13.0) * 0.44;
        float shape = (core + halo) * smoothstep(0.25, 0.13, d2);

        // Gentle scintillation so the stardust river feels alive and shimmering
        float twinkle = 0.78 + 0.22 * sin(uTime * 5.5 + vSeed * 43.7);

        // NASA SVS fluid ion palette:
        // Ambient wind: subtle cool silver-champagne glints
        // CME shockwave river: rich solar amber -> incandescent pale-gold stardust core
        // Bow-shock compression & polar cusps: shimmering electric cyan-white & emerald auroral funnel!
        vec3 ambientCol = vec3(0.76, 0.82, 0.96);
        vec3 amberIon = vec3(1.48, 0.82, 0.30);
        vec3 goldSpark = vec3(1.92, 1.62, 1.15);
        vec3 bowCyan = vec3(0.58, 1.28, 1.98);
        vec3 cuspEmerald = vec3(0.45, 1.62, 1.25);

        vec3 surgeCol = mix(amberIon, goldSpark, clamp(core * 0.8 + vSeed * 0.35, 0.0, 1.0));
        vec3 col = mix(ambientCol, surgeCol, clamp(vSurge * 1.25, 0.0, 1.0));
        col = mix(col, bowCyan, clamp(vBow * 1.35, 0.0, 1.0));
        col = mix(col, cuspEmerald, clamp(vCusp * 1.35, 0.0, 1.0));

        float baseAlpha = vKind > 0.5
          ? (0.78 * vSurge)
          : (0.16 + 0.58 * vSurge);
        float bowBoost = 1.0 + vBow * 2.0 + vCusp * 1.85;
        float alpha = clamp(shape * baseAlpha * bowBoost * twinkle * vFade * uIntensity, 0.0, 0.94);
        if (alpha < 0.005) discard;

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Authentic NASA Goddard SVS 3D Magnetic Field Lines Material:
 * Ultra-fine, delicate, translucent dipole & magnetotail field lines with subtle traveling
 * solar-wind reconnection pulses funneling into Earth's polar auroras (ZERO sci-fi bubble!).
 */
function createMagnetosphereLinesMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      // aMeta: x = u [0..1] along field line, y = lineType (0=closed, 1=cusp, 2=tail), z = phase
      attribute vec3 aMeta;
      varying float vU;
      varying float vType;
      varying float vPhase;
      varying float vZ;

      void main() {
        vU = aMeta.x;
        vType = aMeta.y;
        vPhase = aMeta.z;
        vZ = position.z;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlash;

      varying float vU;
      varying float vType;
      varying float vPhase;
      varying float vZ;

      void main() {
        if (uFlash < 0.01) discard;

        float fade;
        vec3 col;
        float pulse;

        if (vType < 0.5) {
          // Closed dayside/flank dipole loops: smooth fade near poles, subtle warm gold-cyan NASA SVS aesthetic
          fade = smoothstep(0.0, 0.10, vU) * smoothstep(1.0, 0.90, vU);
          float sunSide = smoothstep(-2.0, 2.2, vZ);
          pulse = 0.68 + 0.42 * pow(0.5 + 0.5 * sin(vU * 10.0 - uTime * 3.8 + vPhase), 3.0);
          // Compressed dayside lines glow delicate pale amber-gold/cyan; flank lines cool ice-blue
          col = mix(vec3(0.32, 0.68, 1.15), vec3(0.75, 0.90, 1.25), sunSide);
        } else if (vType < 1.5) {
          // Polar cusp funnel lines (channeling solar wind particles down into Earth's auroral ovals!)
          fade = smoothstep(0.0, 0.06, vU) * pow(1.0 - vU, 1.35);
          // Energy pulses race INWARD from the cusp down toward Earth's polar aurora (vU -> 0)!
          pulse = 0.60 + 0.75 * pow(0.5 + 0.5 * sin(vU * 14.0 + uTime * 5.2 + vPhase), 4.0);
          col = mix(vec3(0.24, 0.96, 0.72), vec3(0.52, 0.88, 1.32), smoothstep(0.0, 0.45, vU));
        } else {
          // Stretched comet-like nightside magnetotail field lines fading smoothly into deep space
          fade = smoothstep(0.0, 0.08, vU) * pow(1.0 - vU, 1.65);
          pulse = 0.65 + 0.45 * pow(0.5 + 0.5 * sin(vU * 12.0 - uTime * 3.2 + vPhase), 3.0);
          col = vec3(0.28, 0.56, 1.18);
        }

        // Delicate, refined scientific hairline opacity (never a loud cartoon shield!)
        float alpha = clamp(fade * pulse * uFlash * 0.48, 0.0, 0.68);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * 3D Curved Ballistic-to-Spiral Plasma Stream Ribbon (used for BOTH Black Hole TDE Spaghettification
 * AND Close Binary White Dwarf Roche-Lobe Mass Transfer Gas Bridges!).
 * Spline starts at donor star surface, bends via Coriolis deflection, and wraps ~1.35 turns around accretor!
 */
function createTidalStreamRibbonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1.0 },
      uIsTde: { value: 1.0 },
      uDonorPos: { value: new THREE.Vector3() },
      uAccretorPos: { value: new THREE.Vector3() },
      uBendDir: { value: new THREE.Vector3(0, 0, 1) },
      uPlaneNormal: { value: new THREE.Vector3(0, 1, 0) },
      uDonorRadius: { value: 1.5 },
      uAccretorRadius: { value: 1.2 },
      uDonorColor: { value: new THREE.Color('#ffaa55') },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uIsTde;
      uniform vec3 uDonorPos;
      uniform vec3 uAccretorPos;
      uniform vec3 uBendDir;
      uniform vec3 uPlaneNormal;
      uniform float uDonorRadius;
      uniform float uAccretorRadius;

      varying float vAlong;
      varying float vAcross;

      // Evaluate smooth 3D ballistic-to-spiral stream curve for s in [0..1]
      vec3 evalStreamSpine(float s) {
        vec3 diff = uAccretorPos - uDonorPos;
        float sep = max(length(diff), 0.1);
        vec3 toAcc = diff / sep;
        vec3 lat = normalize(uBendDir - toAcc * dot(uBendDir, toAcc) + vec3(1e-5));
        vec3 upN = normalize(cross(toAcc, lat));

        if (s < 0.58) {
          // Ballistic Coriolis-curved tidal bridge from donor surface to outer accretion capture orbit
          float u = s / 0.58;
          vec3 p0 = uDonorPos + toAcc * (uDonorRadius * 0.85);
          float orbitR = uAccretorRadius * (uIsTde > 0.5 ? 5.6 : 3.2);
          vec3 p2 = uAccretorPos - toAcc * orbitR + lat * (orbitR * 0.85);
          vec3 p1 = mix(p0, p2, 0.52) + lat * (sep * (uIsTde > 0.5 ? 0.24 : 0.20));
          float om = 1.0 - u;
          return om * om * p0 + 2.0 * om * u * p1 + u * u * p2;
        } else {
          // Dramatic spiral accretion wrap plunging around the Black Hole / White Dwarf!
          float u = (s - 0.58) / 0.42;
          float rStart = uAccretorRadius * (uIsTde > 0.5 ? 5.8 : 3.3);
          float rEnd = uAccretorRadius * (uIsTde > 0.5 ? 2.1 : 1.15);
          float rad = mix(rStart, rEnd, pow(u, 0.82));
          float startAng = atan(0.85, -1.0); // matches p2 entry angle smoothly
          float turns = uIsTde > 0.5 ? 7.6 : 5.8; // ~1.2 full glowing spiral loops!
          float ang = startAng + u * turns;
          float vertRipple = sin(ang * 1.5 + uTime * 1.4) * uAccretorRadius * 0.18 * (1.0 - u);
          return uAccretorPos
            + (toAcc * cos(ang) + lat * sin(ang)) * rad
            + upN * vertRipple;
        }
      }

      void main() {
        float s = uv.y;
        float side = uv.x * 2.0 - 1.0;
        vAlong = s;
        vAcross = side;

        vec3 p = evalStreamSpine(s);
        vec3 pNext = evalStreamSpine(min(s + 0.015, 1.0));
        vec3 pPrev = evalStreamSpine(max(s - 0.015, 0.0));
        vec3 tang = normalize(pNext - pPrev + vec3(1e-5));
        vec3 toCam = normalize(cameraPosition - p);
        vec3 sideAxis = cross(tang, toCam);
        float sl = length(sideAxis);
        sideAxis = sl > 0.001 ? sideAxis / sl : normalize(uPlaneNormal);

        // Stream pinches through L1 throat then fans out into a blazing spiral accretion sheet!
        float baseW = max(uDonorRadius * 0.52, 0.65);
        float midW = max(uAccretorRadius * (uIsTde > 0.5 ? 1.85 : 1.15), 0.75);
        float tipW = max(uAccretorRadius * (uIsTde > 0.5 ? 1.35 : 0.85), 0.55);
        float halfW = s < 0.55
          ? mix(baseW, midW, smoothstep(0.0, 0.55, s))
          : mix(midW, tipW, smoothstep(0.55, 1.0, s));

        vec3 worldPos = p + sideAxis * (side * halfW);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uIsTde;
      uniform vec3 uDonorColor;

      varying float vAlong;
      varying float vAcross;
      ${GLSL_NOISE_HELPERS}

      void main() {
        float s = vAlong;
        float a = abs(vAcross);

        float crossFade = exp(-a * a * 4.4) * smoothstep(1.0, 0.52, a);
        float endFade = smoothstep(0.0, 0.07, s) * smoothstep(1.0, 0.84, s);

        // High-speed braided plasma filaments streaming rapidly from donor star -> spiral plunge!
        float flowSpeed = uIsTde > 0.5 ? 2.4 : 1.75;
        float f1 = hFbm2(vec2(vAcross * 3.4, s * 8.5 - uTime * flowSpeed));
        float f2 = hFbm2(vec2(vAcross * 6.5 + f1 * 1.4, s * 16.0 - uTime * flowSpeed * 1.45));
        float coreStrand = exp(-vAcross * vAcross * 18.0) * 0.72;
        float filaments = (0.45 + 0.95 * f1 * (0.55 + 0.65 * f2) + coreStrand) * crossFade * endFade;

        // Tidal shock heating: donor star amber/orange -> blazing golden-white -> superheated blue-white accretion plunge!
        vec3 donorHot = mix(vec3(1.35, 0.52, 0.14), uDonorColor * 1.35, 0.45);
        vec3 shockGold = vec3(1.55, 1.15, 0.58);
        vec3 plasmaBlueWhite = uIsTde > 0.5 ? vec3(1.25, 1.38, 1.75) : vec3(0.95, 1.35, 1.85);

        vec3 col = mix(donorHot, shockGold, smoothstep(0.15, 0.62, s));
        col = mix(col, plasmaBlueWhite, smoothstep(0.60, 0.96, s));

        float alpha = clamp(filaments * uIntensity * 0.74, 0.0, 0.92);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createTidalStreamParticlesMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1.0 },
      uIsTde: { value: 1.0 },
      uDonorPos: { value: new THREE.Vector3() },
      uAccretorPos: { value: new THREE.Vector3() },
      uBendDir: { value: new THREE.Vector3(0, 0, 1) },
      uDonorRadius: { value: 1.5 },
      uAccretorRadius: { value: 1.2 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uDonorColor: { value: new THREE.Color('#ffaa55') },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aParams;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uIsTde;
      uniform vec3 uDonorPos;
      uniform vec3 uAccretorPos;
      uniform vec3 uBendDir;
      uniform float uDonorRadius;
      uniform float uAccretorRadius;
      uniform float uPixelRatio;
      uniform vec3 uDonorColor;

      varying vec3 vCol;
      varying float vAlpha;

      void main() {
        float s = fract(aParams.x + uTime * (0.28 + 0.24 * aParams.w));
        vec3 diff = uAccretorPos - uDonorPos;
        float sep = max(length(diff), 0.1);
        vec3 toAcc = diff / sep;
        vec3 lat = normalize(uBendDir - toAcc * dot(uBendDir, toAcc) + vec3(1e-5));
        vec3 upN = normalize(cross(toAcc, lat));

        vec3 p;
        if (s < 0.58) {
          float u = s / 0.58;
          vec3 p0 = uDonorPos + toAcc * (uDonorRadius * 0.85);
          float orbitR = uAccretorRadius * (uIsTde > 0.5 ? 5.6 : 3.2);
          vec3 p2 = uAccretorPos - toAcc * orbitR + lat * (orbitR * 0.85);
          vec3 p1 = mix(p0, p2, 0.52) + lat * (sep * (uIsTde > 0.5 ? 0.24 : 0.20));
          float om = 1.0 - u;
          p = om * om * p0 + 2.0 * om * u * p1 + u * u * p2;
        } else {
          float u = (s - 0.58) / 0.42;
          float rStart = uAccretorRadius * (uIsTde > 0.5 ? 5.8 : 3.3);
          float rEnd = uAccretorRadius * (uIsTde > 0.5 ? 2.1 : 1.15);
          float rad = mix(rStart, rEnd, pow(u, 0.82));
          float startAng = atan(0.85, -1.0);
          float turns = uIsTde > 0.5 ? 7.6 : 5.8;
          float ang = startAng + u * turns;
          p = uAccretorPos + (toAcc * cos(ang) + lat * sin(ang)) * rad;
        }

        // Organic 3D plasma scatter around spine
        float scatterR = (0.35 + aParams.y * 0.95) * max(uAccretorRadius * 0.72, 0.42);
        vec3 offset = (lat * cos(aParams.z + s * 6.0) + upN * sin(aParams.z + s * 6.0)) * scatterR;
        vec3 worldPos = p + offset;

        vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
        float camDist = max(1.0, -mvPos.z);
        gl_PointSize = clamp((2.2 + 2.6 * aParams.w) * (150.0 / camDist) * uPixelRatio, 1.4, 7.0);

        vAlpha = smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.85, s) * uIntensity * 0.55;
        vec3 warm = mix(vec3(1.4, 0.62, 0.18), uDonorColor * 1.4, 0.45);
        vec3 hot = vec3(1.15, 1.45, 1.85);
        vCol = mix(warm, hot, smoothstep(0.45, 0.95, s));
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d2 = dot(uv, uv) * 4.0;
        if (d2 > 1.0) discard;
        float a = exp(-d2 * 5.0) * (1.0 - d2) * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vCol, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createCompactAccretionDiskMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      varying vec3 vLocalPos;
      ${GLSL_NOISE_HELPERS}

      void main() {
        float r = length(vLocalPos.xy);
        float t = clamp((r - 1.35) / 2.45, 0.0, 1.0);
        float ang = atan(vLocalPos.y, vLocalPos.x);
        float spiral = hFbm2(vec2(r * 3.8 - uTime * 0.9, ang * 2.0 + r * 2.6 - uTime * 3.2));
        float radialEnv = smoothstep(0.0, 0.14, t) * pow(1.0 - t, 1.55);

        vec3 innerBlue = vec3(1.15, 1.48, 1.95);
        vec3 outerGold = vec3(1.38, 0.72, 0.24);
        vec3 col = mix(innerBlue, outerGold, smoothstep(0.05, 0.85, t));

        float alpha = clamp(radialEnv * (0.48 + 0.85 * spiral) * uIntensity * 0.82, 0.0, 0.92);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Twin Relativistic Black Hole Blazar Jets (collimated polar synchrotron beams with helical shock knots!)
 */
function createBlazarJetMaterial(sign: 1 | -1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uLength: { value: 65.0 },
      uWidthBase: { value: 1.4 },
      uWidthTip: { value: 7.5 },
      uOriginWorld: { value: new THREE.Vector3() },
      uAxisWorld: { value: new THREE.Vector3(0, sign, 0) },
    },
    vertexShader: /* glsl */ `
      uniform float uLength;
      uniform float uWidthBase;
      uniform float uWidthTip;
      uniform vec3 uOriginWorld;
      uniform vec3 uAxisWorld;

      varying float vAlong;
      varying float vAcross;

      void main() {
        float t = uv.y;
        float side = uv.x * 2.0 - 1.0;
        vAlong = t;
        vAcross = side;

        vec3 axis = normalize(uAxisWorld);
        vec3 spinePos = uOriginWorld + axis * (uWidthBase * 1.15 + t * uLength);
        vec3 toCam = normalize(cameraPosition - spinePos);
        vec3 sideAxis = cross(axis, toCam);
        float sl = length(sideAxis);
        sideAxis = sl > 0.001 ? sideAxis / sl : normalize(cross(axis, vec3(1.0, 0.0, 0.0)));

        float halfW = mix(uWidthBase, uWidthTip, pow(t, 0.78));
        vec3 worldPos = spinePos + sideAxis * (side * halfW);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      varying float vAlong;
      varying float vAcross;
      ${GLSL_NOISE_HELPERS}

      void main() {
        if (uPower < 0.01) discard;
        float t = vAlong;
        float a = abs(vAcross);

        // Razor-bright collimated inner synchrotron core + wider magnetic cocoon sheath
        float coreBeam = exp(-a * a * 34.0) * 1.25;
        float sheath = exp(-a * a * 5.2) * 0.42 * smoothstep(1.0, 0.52, a);

        // Helical magnetic twist & superluminal plasma shock knots racing outward at c!
        float helix = sin(t * 18.0 - uTime * 7.5 + vAcross * 4.5);
        float knots = 0.55 + 0.65 * pow(0.5 + 0.5 * sin(t * 24.0 - uTime * 11.0), 3.0);
        float turb = hFbm2(vec2(vAcross * 3.2 + helix * 0.18, t * 7.5 - uTime * 4.2));

        float lengthEnv = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.35);
        float beam = (coreBeam * knots + sheath * (0.55 + 0.85 * turb)) * lengthEnv;

        vec3 coreWhiteCyan = vec3(0.82, 0.96, 1.65);
        vec3 electricBlue = vec3(0.28, 0.62, 1.55);
        vec3 ultraViolet = vec3(0.55, 0.28, 1.35);

        vec3 col = mix(coreWhiteCyan, electricBlue, smoothstep(0.05, 0.45, a + t * 0.35));
        col = mix(col, ultraViolet, smoothstep(0.35, 0.95, t));

        float alpha = clamp(beam * uPower * 0.68, 0.0, 0.92);
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ============================================================================
// 6. NASA JUNO / NEW HORIZONS JUPITER–IO VOLCANIC PLUMES, PLASMA TORUS & FLUX TUBE
// ============================================================================

// 6A. Ballistic Volcanic Umbrella Plume Geometry (Tvashtar / Pele fountain rising along +Y & arching gracefully downward)
function buildIoPlumeGeometry(): THREE.BufferGeometry {
  const radSegs = 28;
  const hSegs = 22;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= hSegs; iy++) {
    const v = iy / hSegs; // 0 = volcanic vent on Io surface, 0.58 = ballistic apex, 1.0 = outer umbrella skirt
    let radius: number;
    let y: number;
    if (v <= 0.58) {
      const t = v / 0.58;
      radius = 0.022 + Math.pow(t, 1.65) * 0.16;
      y = 0.99 + Math.sin(t * Math.PI * 0.5) * 0.42;
    } else {
      const t = (v - 0.58) / 0.42;
      radius = 0.182 + t * 0.28;
      y = 1.41 - t * t * 0.24;
    }

    for (let ix = 0; ix <= radSegs; ix++) {
      const u = ix / radSegs;
      const ang = u * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      positions.push(ca * radius, y, sa * radius);
      normals.push(ca, v > 0.58 ? 0.55 : 0.2, sa);
      uvs.push(u, v);
    }
  }

  const stride = radSegs + 1;
  for (let iy = 0; iy < hSegs; iy++) {
    for (let ix = 0; ix < radSegs; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// 6B. Co-Rotating Io Plasma Torus Micro-Ions Geometry (520 subtle ionized sulfur/oxygen particles)
function buildIoTorusParticlesGeometry(count = 520): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const params = new Float32Array(count * 4); // (azimuth, tubeAngle, tubeRadius [0..1], speedSeed)
  let s = 7717;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    params[i * 4] = rand() * Math.PI * 2;
    params[i * 4 + 1] = rand() * Math.PI * 2;
    params[i * 4 + 2] = Math.pow(rand(), 0.65);
    params[i * 4 + 3] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aTorusP', new THREE.BufferAttribute(params, 4));
  return geo;
}

// 6C. 3D Braided Dipole Magnetic Flux Tube connecting Io (equator, +X) directly into Jupiter's 67° N/S polar auroral footprints!
function buildIoFluxTubeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const meta: number[] = []; // (u along tube from Io [0] to Jupiter polar footprint [1], strandIndex, hemi [+1/-1])
  const strands = 7;
  const steps = 40;

  for (const hemi of [1, -1]) {
    for (let k = 0; k < strands; k++) {
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;
        positions.push(0, 0, 0, 0, 0, 0); // dynamically arched onto exact Jupiter 67° polar footprint in GPU vertex shader!
        meta.push(u0, k, hemi, u1, k, hemi);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFluxMeta', new THREE.Float32BufferAttribute(meta, 3));
  return geo;
}

const SHARED_IO_PLUME_GEO = buildIoPlumeGeometry();
const SHARED_IO_TORUS_GEO = new THREE.TorusGeometry(1.0, 0.165, 28, 96);
const SHARED_IO_TORUS_PARTICLES_GEO = buildIoTorusParticlesGeometry(520);
const SHARED_IO_FLUX_TUBE_GEO = buildIoFluxTubeGeometry();

function createIoPlumeMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      ${GLSL_NOISE_HELPERS}

      void main() {
        float v = vUv.y; // 0 = volcanic caldera vent, 0.58 = ballistic apex, 1.0 = outer umbrella edge
        float edgeFade = smoothstep(0.0, 0.10, v) * pow(smoothstep(1.0, 0.42, v), 1.55);
        if (edgeFade < 0.005) discard;

        // Strictly upward & outward rising volcanic gas filaments (New Horizons Tvashtar backlit blue-silver veil!)
        float wisp1 = hFbm2(vec2(vUv.x * 8.0 + uSeed, v * 5.0 - uTime * 0.65));
        float wisp2 = hFbm2(vec2(vUv.x * 16.0 - uSeed * 1.7, v * 9.0 - uTime * 1.05));
        float mist = 0.38 + 0.78 * wisp1 * (0.55 + 0.55 * wisp2);

        // Buttery-soft volumetric grazing silhouette feathering -> ZERO crisp geometric dome/cup rim!
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float viewSoft = pow(smoothstep(0.08, 0.74, abs(dot(N, V))), 1.35);

        // Hot molten sulfur vent glow right at the base -> cool backlit bluish-silver / pale-gold SO2 umbrella above!
        float baseHot = exp(-v * 9.0);
        vec3 lavaVent = vec3(1.85, 0.72, 0.16);
        vec3 sulfurVeil = vec3(0.76, 0.90, 1.24);
        vec3 paleGold = vec3(1.18, 1.02, 0.74);
        vec3 canopyCol = mix(sulfurVeil, paleGold, smoothstep(0.3, 0.8, wisp1) * 0.45);
        vec3 col = mix(canopyCol, lavaVent, baseHot);

        float alpha = clamp(edgeFade * mist * viewSoft * (0.44 + 0.52 * baseHot), 0.0, 0.74);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createIoTorusMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIoAngle: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIoAngle;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      ${GLSL_NOISE_HELPERS}

      void main() {
        // Ultra-soft volumetric grazing feathering: outer torus silhouette ALWAYS dissolves ethereally to 0!
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(N, V));
        float volSoft = pow(smoothstep(0.14, 0.88, ndv), 1.85);
        if (volSoft < 0.004) discard;

        // 100% SEAMLESS 360° periodic 3D noise (ZERO azimuthal UV wrap seam anywhere on the torus!)
        float az = atan(vLocalPos.y, vLocalPos.x);
        float rotAz = az - uTime * 0.22;
        vec3 p3 = vec3(cos(rotAz) * 2.1, sin(rotAz) * 2.1, vLocalPos.z * 4.2);
        vec3 q3 = vec3(
          hFbm3(p3 + vec3(1.3, 4.7, 2.1)),
          hFbm3(p3 + vec3(6.2, 2.1, 3.8)),
          hFbm3(p3 + vec3(3.7, 8.4, 1.5))
        );
        float f = hFbm3(p3 * 1.45 + q3 * 1.15);
        float wisps = 0.35 + 0.85 * pow(clamp(1.0 - abs(f * 2.0 - 1.0), 0.0, 1.0), 1.5);

        float dIo = atan(sin(az - uIoAngle), cos(az - uIoAngle));
        float ioWake = 0.55 + 0.65 * exp(-pow(dIo / 1.15, 2.0));

        // Authentic NASA Juno/UVS Io Plasma Torus palette: ghostly UV indigo-violet outer torus + warm sulfur-amber inner ribbon
        vec3 uvIndigo = vec3(0.36, 0.24, 1.15);
        vec3 uvCyan = vec3(0.32, 0.72, 1.38);
        vec3 sulfurAmber = vec3(1.18, 0.72, 0.28);

        vec3 col = mix(uvIndigo, uvCyan, smoothstep(0.25, 0.80, f));
        col = mix(col, sulfurAmber, clamp((ioWake - 0.55) * 0.85 + pow(ndv, 2.2) * 0.35, 0.0, 0.72));

        float alpha = clamp(volSoft * wisps * ioWake * 0.22, 0.0, 0.34);
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

function createIoTorusParticlesMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIoAngle: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aTorusP; // (az0, tubeAng, tubeR, seed)
      uniform float uTime;
      uniform float uIoAngle;

      varying float vWake;
      varying float vSeed;

      void main() {
        float az = aTorusP.x + uTime * (0.28 + 0.14 * aTorusP.w);
        float tAng = aTorusP.y + uTime * 0.45;
        float tRad = aTorusP.z * 0.155;
        vSeed = aTorusP.w;

        float rMajor = 1.0 + cos(tAng) * tRad;
        float zOff = sin(tAng) * tRad * 0.75; // slightly flattened centrifugally along Jupiter's equator
        vec3 localPos = vec3(cos(az) * rMajor, sin(az) * rMajor, zOff);

        float dIo = atan(sin(az - uIoAngle), cos(az - uIoAngle));
        vWake = exp(-pow(dIo / 1.1, 2.0));

        vec4 mvPos = modelViewMatrix * vec4(localPos, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = clamp((1.5 + 1.4 * vWake) * (36.0 / max(4.0, -mvPos.z)), 1.4, 3.8);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vWake;
      varying float vSeed;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float r2 = dot(p, p);
        if (r2 > 0.25) discard;
        float core = exp(-r2 * 48.0);
        vec3 violetIon = vec3(0.55, 0.62, 1.55);
        vec3 sulfurSpark = vec3(1.55, 1.05, 0.42);
        vec3 col = mix(violetIon, sulfurSpark, clamp(vWake * 0.75 + vSeed * 0.25, 0.0, 1.0));
        float a = clamp(core * (0.32 + 0.45 * vWake), 0.0, 0.82);
        if (a < 0.005) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createIoFluxTubeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uJupRatio: { value: 0.32 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aFluxMeta; // (u [0=Io -> 1=Jupiter 67° polar footprint], strandIdx, hemi)
      uniform float uJupRatio;

      varying float vU;
      varying float vPhase;

      void main() {
        float u = aFluxMeta.x;
        float k = aFluxMeta.y;
        float hemi = aFluxMeta.z;
        vU = u;
        vPhase = k * 0.91 + (hemi > 0.0 ? 0.0 : 2.1);

        // Exact cubic Bezier dipole-like magnetic flux tube from Io (1, 0, 0)
        // curving gracefully up and landing DEAD-CENTER onto Jupiter's 67° N/S Io Auroral Footprint!
        float footLat = 1.169; // 67 deg -> sin(67°) = 0.920 matches createJupiterAuroraMaterial!
        float jR = uJupRatio * 1.036;
        vec3 p0 = vec3(1.0, 0.0, 0.0);
        vec3 p3 = vec3(jR * cos(footLat), hemi * jR * sin(footLat), 0.0);
        vec3 p1 = vec3(0.96, hemi * max(0.58, jR * 1.12), 0.06);
        vec3 p2 = vec3(jR * 0.82, hemi * max(0.76, jR * 1.38), 0.04);

        float om = 1.0 - u;
        vec3 spine =
          om * om * om * p0 +
          3.0 * om * om * u * p1 +
          3.0 * om * u * u * p2 +
          u * u * u * p3;

        // Braided multi-strand flux-tube thickness tapering smoothly to a crisp focal point right at the auroral footprint!
        float angOff = (k / 7.0) * 6.2831853 + u * 5.2;
        float spread = (k < 0.5 ? 0.0 : 0.028) * (1.0 - 0.78 * u);
        spine.x += cos(angOff) * spread;
        spine.z += sin(angOff) * spread;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(spine, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vU;
      varying float vPhase;
      void main() {
        // 400,000-volt Alfven electrical current waves racing strictly from Io (u=0) into Jupiter's N/S polar footprint (u=1)!
        float pulse = pow(0.5 + 0.5 * sin(vU * 18.0 - uTime * 5.8 + vPhase), 3.0);
        float endFade = smoothstep(0.0, 0.05, vU) * smoothstep(1.0, 0.94, vU);
        float footFlare = exp(-pow((1.0 - vU) / 0.12, 2.0)) * 0.65;
        vec3 violetCurrent = vec3(0.45, 0.55, 1.65);
        vec3 cyanBolt = vec3(0.72, 1.58, 2.30);
        vec3 col = mix(violetCurrent, cyanBolt, clamp(pulse * 0.85 + footFlare + smoothstep(0.65, 1.0, vU) * 0.35, 0.0, 1.0));
        float alpha = clamp(endFade * (0.28 + 0.62 * pulse + footFlare), 0.0, 0.94);
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

interface JupiterIoVisual {
  torusMesh: THREE.Mesh;
  torusParticles: THREE.Points;
  fluxTube: THREE.LineSegments;
  plumeGroup: THREE.Group;
  plumeMats: THREE.ShaderMaterial[];
}

interface CmeVisual {
  group: THREE.Group;
  solarWindParticles: THREE.Points;
  eruptProminenceGroup: THREE.Group;
  eruptProminenceMats: THREE.ShaderMaterial[];
}

interface StreamVisual {
  ribbon: THREE.Mesh;
  particles: THREE.Points;
  disk: THREE.Mesh;
}

interface BlazarVisual {
  northJet: THREE.Mesh;
  southJet: THREE.Mesh;
}

export class HighEnergyRenderer {
  private scene: THREE.Scene;
  private cmeMap = new Map<string, CmeVisual>();
  private magnetoMap = new Map<string, THREE.LineSegments>();
  private streamMap = new Map<string, StreamVisual>();
  private blazarMap = new Map<string, BlazarVisual>();
  private jupiterIoVis: JupiterIoVisual | null = null;

  private tempOrigin = new THREE.Vector3();
  private tempDir = new THREE.Vector3();
  private tempAxis = new THREE.Vector3();
  private tempBend = new THREE.Vector3();
  private tempRight = new THREE.Vector3();
  private tempUp = new THREE.Vector3();
  private tempTargetLocal = new THREE.Vector3();
  private tempInvQuat = new THREE.Quaternion();
  private tempBasisMat = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public sync(
    bodies: CelestialBody[],
    cmeWaves: CmeWave[],
    tidalStreams: TidalStreamLink[],
    bodyRenderer: BodyRenderer,
    originMeters: Vec3,
    elapsedTime: number,
    _camera?: THREE.PerspectiveCamera,
    showSpaceWeatherField = true
  ): void {
    this.syncCmes(bodies, cmeWaves, bodyRenderer, originMeters, elapsedTime, showSpaceWeatherField);
    this.syncMagnetospheres(bodies, bodyRenderer, elapsedTime, showSpaceWeatherField);
    this.syncTidalStreams(bodies, tidalStreams, bodyRenderer, elapsedTime);
    this.syncBlazarJets(bodies, bodyRenderer, elapsedTime);
    this.syncJupiterIoSystem(bodies, bodyRenderer, elapsedTime, showSpaceWeatherField);
  }

  private syncCmes(
    bodies: CelestialBody[],
    cmeWaves: CmeWave[],
    bodyRenderer: BodyRenderer,
    originMeters: Vec3,
    elapsedTime: number,
    showSpaceWeatherField = true
  ): void {
    const aliveIds = new Set<string>();
    for (const wave of cmeWaves) {
      aliveIds.add(wave.id);
      let vis = this.cmeMap.get(wave.id);
      if (!vis) {
        const group = new THREE.Group();

        // A. NASA SVS 2,400 fluid-advected micro-particle solar wind & CME ion river (bow-shock deflected!)
        const solarWindParticles = new THREE.Points(
          SHARED_SOLAR_WIND_PARTICLES_GEO,
          createSolarWindParticlesMaterial()
        );
        solarWindParticles.frustumCulled = false;
        solarWindParticles.renderOrder = 4;
        group.add(solarWindParticles);

        // B. Dedicated 3D Crossed Shredded NASA SDO 304Å Eruptive Prominence Plume right at the CME launch site!
        //    (Replaces flat round flare stickers & dotty sparks with genuine billowing molten solar plasma!)
        const eruptProminenceGroup = new THREE.Group();
        // Rotate local +Y (prominence arch radial axis) straight onto +Z (wave.direction)
        eruptProminenceGroup.rotation.x = Math.PI / 2;
        const sunTex = textureAtlas.get()?.sun;
        const seedBase = Math.random() * 90 + 10;
        const eruptProminenceMats: THREE.ShaderMaterial[] = [];
        if (sunTex) {
          const variants = [
            { variant: 1, rotY: 0.22, scaleX: 1.05, scaleY: 1.12 },
            { variant: 2, rotY: 1.62, scaleX: 0.96, scaleY: 1.04 },
          ];
          for (let k = 0; k < variants.length; k++) {
            const v = variants[k];
            const pMat = createProminenceMaterial('#ff5518', sunTex, seedBase + k * 37.3, v.variant);
            pMat.uniforms.uIsEruptive.value = 1.0;
            const mesh = new THREE.Mesh(SHARED_PROMINENCE_GEO, pMat);
            mesh.rotation.y = v.rotY;
            mesh.scale.set(v.scaleX, v.scaleY, 1.0);
            mesh.renderOrder = 2;
            eruptProminenceGroup.add(mesh);
            eruptProminenceMats.push(pMat);
          }
        }
        group.add(eruptProminenceGroup);

        this.scene.add(group);
        vis = { group, solarWindParticles, eruptProminenceGroup, eruptProminenceMats };
        this.cmeMap.set(wave.id, vis);
      }

      this.tempOrigin.set(
        (wave.origin.x - originMeters.x) * METERS_TO_SCENE,
        (wave.origin.y - originMeters.y) * METERS_TO_SCENE,
        (wave.origin.z - originMeters.z) * METERS_TO_SCENE
      );
      this.tempDir.set(wave.direction.x, wave.direction.y, wave.direction.z).normalize();

      // Orient group with +Z along CME direction & +Y aligned with ecliptic North so polar cusps match Earth's poles!
      this.tempUp.set(0, 1, 0);
      this.tempRight.crossVectors(this.tempUp, this.tempDir);
      if (this.tempRight.lengthSq() < 1e-4) {
        this.tempRight.set(1, 0, 0);
      } else {
        this.tempRight.normalize();
      }
      this.tempUp.crossVectors(this.tempDir, this.tempRight).normalize();
      this.tempBasisMat.makeBasis(this.tempRight, this.tempUp, this.tempDir);

      vis.group.position.copy(this.tempOrigin);
      vis.group.quaternion.setFromRotationMatrix(this.tempBasisMat);
      vis.group.scale.setScalar(1);

      const starVis = bodyRenderer.getVisual(wave.starId);
      const starR = starVis ? starVis.renderedRadius : 3.5;
      const waveR = Math.max(starR * 1.25, wave.radiusMeters * METERS_TO_SCENE);
      const maxR = Math.max(starR * 8.0, wave.maxRadiusMeters * METERS_TO_SCENE);
      const progress = Math.min(1, wave.radiusMeters / wave.maxRadiusMeters);

      // Locate primary magnetized target planet inside the CME cone for live bow-shock streamline deflection!
      let hasTarget = 0;
      let targetEarthR = 1.0;
      let targetBowR = 4.0;
      let bestScore = Infinity;
      this.tempTargetLocal.set(0, 0, maxR * 2.0);
      this.tempInvQuat.copy(vis.group.quaternion).invert();

      for (const b of bodies) {
        if (!b.alive || b.id === wave.starId || b.category === 'star' || b.category === 'black_hole') continue;
        const bVis = bodyRenderer.getVisual(b.id);
        if (!bVis) continue;
        this.tempAxis.subVectors(bVis.renderedPos, this.tempOrigin);
        const dist = this.tempAxis.length();
        if (dist < starR * 2.0 || dist > maxR * 1.25) continue;
        const align = this.tempAxis.dot(this.tempDir) / dist;
        if (align < 0.65) continue;
        // Prefer planets with atmospheres (e.g. Earth) over small moons
        const score = dist * (b.atmosphereDensity > 0.05 ? 0.35 : 1.0);
        if (score < bestScore) {
          bestScore = score;
          hasTarget = 1;
          this.tempTargetLocal.copy(this.tempAxis).applyQuaternion(this.tempInvQuat);
          targetEarthR = bVis.renderedRadius;
          targetBowR = Math.max(bVis.renderedRadius * 4.85, 3.6);
        }
      }

      // 1. Update NASA SVS fluid micro-particle solar wind river (hidden in Pure Naked-Eye Mode!)
      vis.solarWindParticles.visible = showSpaceWeatherField;
      if (showSpaceWeatherField) {
        const sMat = vis.solarWindParticles.material as THREE.ShaderMaterial;
        sMat.uniforms.uTime.value = elapsedTime;
        sMat.uniforms.uWaveR.value = waveR;
        sMat.uniforms.uStarR.value = starR;
        sMat.uniforms.uMaxR.value = maxR;
        sMat.uniforms.uProgress.value = progress;
        sMat.uniforms.uIntensity.value = wave.intensity;
        sMat.uniforms.uHasTarget.value = hasTarget;
        sMat.uniforms.uTargetPos.value.copy(this.tempTargetLocal);
        sMat.uniforms.uEarthR.value = targetEarthR;
        sMat.uniforms.uBowR.value = targetBowR;
      }

      // 2. Update 3D shredded NASA SDO 304Å eruptive prominence plume at the exact CME launch site!
      // Silky cubic zero-slope release tail ensures 100% seamless dissipation with ZERO end-of-eruption snap!
      const eruptAge = Math.min(1, progress / 0.42);
      const rem = Math.max(0, 1 - eruptAge);
      const eruptPower = rem * rem * (3 - 2 * rem) * wave.intensity;
      vis.eruptProminenceGroup.visible = eruptAge < 0.99;
      if (vis.eruptProminenceGroup.visible) {
        vis.eruptProminenceGroup.scale.setScalar(starR);
        for (const pMat of vis.eruptProminenceMats) {
          pMat.uniforms.uTime.value = elapsedTime;
          pMat.uniforms.uStarWorldPos.value.copy(this.tempOrigin);
          pMat.uniforms.uSurgePower.value = eruptPower;
          pMat.uniforms.uSurgeAge.value = eruptAge;
          pMat.uniforms.uFlareDirWorld.value.copy(this.tempDir);
        }
      }
    }

    for (const [id, vis] of this.cmeMap.entries()) {
      if (!aliveIds.has(id)) {
        this.scene.remove(vis.group);
        (vis.solarWindParticles.material as THREE.Material).dispose();
        for (const pMat of vis.eruptProminenceMats) {
          pMat.dispose();
        }
        this.cmeMap.delete(id);
      }
    }
  }

  private syncMagnetospheres(
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    elapsedTime: number,
    showSpaceWeatherField = true
  ): void {
    const stars = bodies.filter((b) => b.alive && b.category === 'star');
    const aliveIds = new Set<string>();

    for (const b of bodies) {
      if (!b.alive || !b.magnetosphereFlash || b.magnetosphereFlash <= 0.01) continue;
      const bVis = bodyRenderer.getVisual(b.id);
      if (!bVis) continue;
      aliveIds.add(b.id);

      let lines = this.magnetoMap.get(b.id);
      if (!lines) {
        lines = new THREE.LineSegments(
          SHARED_MAGNETO_LINES_GEO,
          createMagnetosphereLinesMaterial()
        );
        lines.renderOrder = 4;
        this.scene.add(lines);
        this.magnetoMap.set(b.id, lines);
      }

      lines.visible = showSpaceWeatherField;
      if (!showSpaceWeatherField) continue;

      // Build exact geomagnetic dipole + solar-wind basis:
      // +Z = sunward (compressed dayside loops), +Y = planet's North magnetic pole, -Z = stretched magnetotail!
      this.tempDir.set(1, 0, 0);
      if (stars.length > 0) {
        let bestD = Infinity;
        for (const st of stars) {
          const sVis = bodyRenderer.getVisual(st.id);
          if (!sVis) continue;
          const d = bVis.renderedPos.distanceToSquared(sVis.renderedPos);
          if (d < bestD && d > 1e-6) {
            bestD = d;
            this.tempDir.subVectors(sVis.renderedPos, bVis.renderedPos).normalize();
          }
        }
      }

      this.tempUp.set(0, 1, 0).applyEuler(bVis.tiltGroup.rotation).normalize();
      this.tempRight.crossVectors(this.tempUp, this.tempDir);
      if (this.tempRight.lengthSq() < 1e-4) {
        this.tempRight.set(1, 0, 0);
      } else {
        this.tempRight.normalize();
      }
      this.tempUp.crossVectors(this.tempDir, this.tempRight).normalize();
      this.tempBasisMat.makeBasis(this.tempRight, this.tempUp, this.tempDir);

      lines.position.copy(bVis.renderedPos);
      lines.quaternion.setFromRotationMatrix(this.tempBasisMat);
      lines.scale.setScalar(bVis.renderedRadius);

      const mat = lines.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = elapsedTime;
      mat.uniforms.uFlash.value = b.magnetosphereFlash;
    }

    for (const [id, lines] of this.magnetoMap.entries()) {
      if (!aliveIds.has(id)) {
        this.scene.remove(lines);
        (lines.material as THREE.Material).dispose();
        this.magnetoMap.delete(id);
      }
    }
  }

  private syncTidalStreams(
    bodies: CelestialBody[],
    tidalStreams: TidalStreamLink[],
    bodyRenderer: BodyRenderer,
    elapsedTime: number
  ): void {
    const bodyMap = new Map<string, CelestialBody>();
    for (const b of bodies) if (b.alive) bodyMap.set(b.id, b);

    const aliveKeys = new Set<string>();
    for (const link of tidalStreams) {
      const donor = bodyMap.get(link.donorId);
      const acc = bodyMap.get(link.accretorId);
      const dVis = bodyRenderer.getVisual(link.donorId);
      const aVis = bodyRenderer.getVisual(link.accretorId);
      if (!donor || !acc || !dVis || !aVis) continue;

      const key = `${link.donorId}->${link.accretorId}`;
      aliveKeys.add(key);

      let vis = this.streamMap.get(key);
      if (!vis) {
        const ribbon = new THREE.Mesh(SHARED_STREAM_RIBBON_GEO, createTidalStreamRibbonMaterial());
        ribbon.frustumCulled = false;
        ribbon.renderOrder = 3;

        const particles = new THREE.Points(
          SHARED_STREAM_PARTICLES_GEO,
          createTidalStreamParticlesMaterial()
        );
        particles.frustumCulled = false;
        particles.renderOrder = 4;

        const disk = new THREE.Mesh(SHARED_ACC_DISK_GEO, createCompactAccretionDiskMaterial());
        disk.rotation.x = Math.PI / 2;
        disk.renderOrder = 3;

        this.scene.add(ribbon);
        this.scene.add(particles);
        this.scene.add(disk);
        vis = { ribbon, particles, disk };
        this.streamMap.set(key, vis);
      }

      // Compute Coriolis lateral bend direction from donor's relative orbital velocity around accretor
      this.tempBend.set(
        donor.velocity.x - acc.velocity.x,
        donor.velocity.y - acc.velocity.y,
        donor.velocity.z - acc.velocity.z
      );
      if (this.tempBend.lengthSq() > 1) {
        this.tempBend.normalize();
      } else {
        this.tempBend.set(0, 0, 1);
      }

      const isTde = link.kind === 'tde';

      const rMat = vis.ribbon.material as THREE.ShaderMaterial;
      rMat.uniforms.uTime.value = elapsedTime;
      rMat.uniforms.uIntensity.value = link.intensity;
      rMat.uniforms.uIsTde.value = isTde ? 1.0 : 0.0;
      rMat.uniforms.uDonorPos.value.copy(dVis.renderedPos);
      rMat.uniforms.uAccretorPos.value.copy(aVis.renderedPos);
      rMat.uniforms.uBendDir.value.copy(this.tempBend);
      rMat.uniforms.uDonorRadius.value = dVis.renderedRadius;
      rMat.uniforms.uAccretorRadius.value = aVis.renderedRadius;
      rMat.uniforms.uDonorColor.value.set(link.color);

      const pMat = vis.particles.material as THREE.ShaderMaterial;
      pMat.uniforms.uTime.value = elapsedTime;
      pMat.uniforms.uIntensity.value = link.intensity;
      pMat.uniforms.uIsTde.value = isTde ? 1.0 : 0.0;
      pMat.uniforms.uDonorPos.value.copy(dVis.renderedPos);
      pMat.uniforms.uAccretorPos.value.copy(aVis.renderedPos);
      pMat.uniforms.uBendDir.value.copy(this.tempBend);
      pMat.uniforms.uDonorRadius.value = dVis.renderedRadius;
      pMat.uniforms.uAccretorRadius.value = aVis.renderedRadius;
      pMat.uniforms.uDonorColor.value.set(link.color);

      // Show dedicated incandescent accretion disk around White Dwarfs / Neutron Stars (Black Holes already have Gargantua disk!)
      vis.disk.visible = !isTde;
      if (vis.disk.visible) {
        vis.disk.position.copy(aVis.renderedPos);
        vis.disk.scale.setScalar(aVis.renderedRadius * 1.15);
        const dkMat = vis.disk.material as THREE.ShaderMaterial;
        dkMat.uniforms.uTime.value = elapsedTime;
        dkMat.uniforms.uIntensity.value = link.intensity;
      }
    }

    for (const [key, vis] of this.streamMap.entries()) {
      if (!aliveKeys.has(key)) {
        this.scene.remove(vis.ribbon);
        this.scene.remove(vis.particles);
        this.scene.remove(vis.disk);
        (vis.ribbon.material as THREE.Material).dispose();
        (vis.particles.material as THREE.Material).dispose();
        (vis.disk.material as THREE.Material).dispose();
        this.streamMap.delete(key);
      }
    }
  }

  private syncBlazarJets(
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    elapsedTime: number
  ): void {
    const aliveIds = new Set<string>();
    for (const b of bodies) {
      if (!b.alive || b.category !== 'black_hole' || !b.blazarJetPower || b.blazarJetPower <= 0.015) {
        continue;
      }
      const bVis = bodyRenderer.getVisual(b.id);
      if (!bVis) continue;
      aliveIds.add(b.id);

      let vis = this.blazarMap.get(b.id);
      if (!vis) {
        const northJet = new THREE.Mesh(SHARED_BLAZAR_RIBBON_GEO, createBlazarJetMaterial(1));
        northJet.frustumCulled = false;
        northJet.renderOrder = 4;
        const southJet = new THREE.Mesh(SHARED_BLAZAR_RIBBON_GEO, createBlazarJetMaterial(-1));
        southJet.frustumCulled = false;
        southJet.renderOrder = 4;
        this.scene.add(northJet);
        this.scene.add(southJet);
        vis = { northJet, southJet };
        this.blazarMap.set(b.id, vis);
      }

      // Align twin jets strictly perpendicular to Black Hole's tilted accretion disk (+Y / -Y of tiltGroup)
      this.tempAxis.set(0, 1, 0).applyEuler(bVis.tiltGroup.rotation).normalize();
      const power = b.blazarJetPower;
      const jetLen = Math.max(48, bVis.renderedRadius * (32 + power * 42));
      const baseW = Math.max(0.85, bVis.renderedRadius * 1.15);
      const tipW = baseW * (3.8 + power * 2.2);

      const nMat = vis.northJet.material as THREE.ShaderMaterial;
      nMat.uniforms.uTime.value = elapsedTime;
      nMat.uniforms.uPower.value = power;
      nMat.uniforms.uLength.value = jetLen;
      nMat.uniforms.uWidthBase.value = baseW;
      nMat.uniforms.uWidthTip.value = tipW;
      nMat.uniforms.uOriginWorld.value.copy(bVis.renderedPos);
      nMat.uniforms.uAxisWorld.value.copy(this.tempAxis);

      const sMat = vis.southJet.material as THREE.ShaderMaterial;
      sMat.uniforms.uTime.value = elapsedTime;
      sMat.uniforms.uPower.value = power;
      sMat.uniforms.uLength.value = jetLen;
      sMat.uniforms.uWidthBase.value = baseW;
      sMat.uniforms.uWidthTip.value = tipW;
      sMat.uniforms.uOriginWorld.value.copy(bVis.renderedPos);
      sMat.uniforms.uAxisWorld.value.copy(this.tempAxis).negate();
    }

    for (const [id, vis] of this.blazarMap.entries()) {
      if (!aliveIds.has(id)) {
        this.scene.remove(vis.northJet);
        this.scene.remove(vis.southJet);
        (vis.northJet.material as THREE.Material).dispose();
        (vis.southJet.material as THREE.Material).dispose();
        this.blazarMap.delete(id);
      }
    }
  }

  private syncJupiterIoSystem(
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    elapsedTime: number,
    showSpaceWeatherField: boolean
  ): void {
    const jup = bodies.find((b) => b.alive && b.jupiterTorus);
    const io = bodies.find((b) => b.alive && b.volcanicIo);
    const jVis = jup ? bodyRenderer.getVisual(jup.id) : undefined;
    const ioVis = io ? bodyRenderer.getVisual(io.id) : undefined;

    if (!jup || !io || !jVis || !ioVis) {
      if (this.jupiterIoVis) {
        this.scene.remove(this.jupiterIoVis.torusMesh);
        this.scene.remove(this.jupiterIoVis.torusParticles);
        this.scene.remove(this.jupiterIoVis.fluxTube);
        this.scene.remove(this.jupiterIoVis.plumeGroup);
        (this.jupiterIoVis.torusMesh.material as THREE.Material).dispose();
        (this.jupiterIoVis.torusParticles.material as THREE.Material).dispose();
        (this.jupiterIoVis.fluxTube.material as THREE.Material).dispose();
        for (const m of this.jupiterIoVis.plumeMats) m.dispose();
        this.jupiterIoVis = null;
      }
      return;
    }

    if (!this.jupiterIoVis) {
      const torusMesh = new THREE.Mesh(SHARED_IO_TORUS_GEO, createIoTorusMaterial());
      torusMesh.renderOrder = 2;

      const torusParticles = new THREE.Points(
        SHARED_IO_TORUS_PARTICLES_GEO,
        createIoTorusParticlesMaterial()
      );
      torusParticles.frustumCulled = false;
      torusParticles.renderOrder = 3;

      const fluxTube = new THREE.LineSegments(
        SHARED_IO_FLUX_TUBE_GEO,
        createIoFluxTubeMaterial()
      );
      fluxTube.frustumCulled = false;
      fluxTube.renderOrder = 4;

      // 3 Ballistic Volcanic Umbrella Plumes anchored at Io's 3 active caldera hotspots (Tvashtar, Pele, Prometheus)!
      const plumeGroup = new THREE.Group();
      const plumeMats: THREE.ShaderMaterial[] = [];
      const ventDirs = [
        new THREE.Vector3(0.68, 0.58, 0.44).normalize(),
        new THREE.Vector3(-0.74, -0.26, 0.62).normalize(),
        new THREE.Vector3(0.18, -0.14, -0.97).normalize(),
      ];
      const yAxis = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < ventDirs.length; i++) {
        const mat = createIoPlumeMaterial(11.3 + i * 29.7);
        const mesh = new THREE.Mesh(SHARED_IO_PLUME_GEO, mat);
        mesh.quaternion.setFromUnitVectors(yAxis, ventDirs[i]);
        mesh.scale.setScalar(i === 0 ? 1.15 : i === 1 ? 1.0 : 0.88);
        mesh.renderOrder = 3;
        plumeGroup.add(mesh);
        plumeMats.push(mat);
      }

      this.scene.add(torusMesh);
      this.scene.add(torusParticles);
      this.scene.add(fluxTube);
      this.scene.add(plumeGroup);
      this.jupiterIoVis = { torusMesh, torusParticles, fluxTube, plumeGroup, plumeMats };
    }

    const vis = this.jupiterIoVis;
    // Live vector from Jupiter to Io
    this.tempDir.subVectors(ioVis.renderedPos, jVis.renderedPos);
    const orbitR = Math.max(jVis.renderedRadius * 2.2, this.tempDir.length());
    this.tempDir.normalize();

    // 1. Io's 3 Volcanic Umbrella Plumes (always visible, even in Pure Naked-Eye Mode!)
    vis.plumeGroup.visible = true;
    vis.plumeGroup.position.copy(ioVis.renderedPos);
    vis.plumeGroup.rotation.set(0, io.rotationAngle, io.axialTilt);
    vis.plumeGroup.scale.setScalar(ioVis.renderedRadius);
    for (const pm of vis.plumeMats) {
      pm.uniforms.uTime.value = elapsedTime;
    }

    // 2. Io Plasma Torus & 3D Dipole Magnetic Flux Tube (toggled via Space Weather Scientific Overlay!)
    vis.torusMesh.visible = showSpaceWeatherField;
    vis.torusParticles.visible = showSpaceWeatherField;
    vis.fluxTube.visible = showSpaceWeatherField;

    if (showSpaceWeatherField) {
      // Align Torus plane with Jupiter's tilted equatorial plane (TorusGeometry native plane is XY -> rotate X by -PI/2)
      vis.torusMesh.position.copy(jVis.renderedPos);
      vis.torusMesh.rotation.set(-Math.PI / 2, 0, jup.axialTilt);
      vis.torusMesh.scale.setScalar(orbitR);

      vis.torusParticles.position.copy(jVis.renderedPos);
      vis.torusParticles.rotation.set(-Math.PI / 2, 0, jup.axialTilt);
      vis.torusParticles.scale.setScalar(orbitR);

      const ioAngle = Math.atan2(-this.tempDir.z, this.tempDir.x);
      const tMat = vis.torusMesh.material as THREE.ShaderMaterial;
      tMat.uniforms.uTime.value = elapsedTime;
      tMat.uniforms.uIoAngle.value = ioAngle;

      const tpMat = vis.torusParticles.material as THREE.ShaderMaterial;
      tpMat.uniforms.uTime.value = elapsedTime;
      tpMat.uniforms.uIoAngle.value = ioAngle;

      // Orient 3D Dipole Magnetic Flux Tube: +X = Jupiter->Io, +Y = Jupiter's North magnetic pole!
      this.tempUp.set(0, 1, 0).applyEuler(jVis.tiltGroup.rotation).normalize();
      this.tempAxis.crossVectors(this.tempDir, this.tempUp);
      if (this.tempAxis.lengthSq() < 1e-4) {
        this.tempAxis.set(0, 0, 1);
      } else {
        this.tempAxis.normalize();
      }
      this.tempUp.crossVectors(this.tempAxis, this.tempDir).normalize();
      this.tempBasisMat.makeBasis(this.tempDir, this.tempUp, this.tempAxis);

      vis.fluxTube.position.copy(jVis.renderedPos);
      vis.fluxTube.quaternion.setFromRotationMatrix(this.tempBasisMat);
      vis.fluxTube.scale.setScalar(orbitR);

      const fMat = vis.fluxTube.material as THREE.ShaderMaterial;
      fMat.uniforms.uTime.value = elapsedTime;
      fMat.uniforms.uJupRatio.value = THREE.MathUtils.clamp(jVis.renderedRadius / orbitR, 0.12, 0.65);
    }
  }

  public disposeAll(): void {
    for (const vis of this.cmeMap.values()) {
      this.scene.remove(vis.group);
      (vis.solarWindParticles.material as THREE.Material).dispose();
      for (const pMat of vis.eruptProminenceMats) {
        pMat.dispose();
      }
    }
    this.cmeMap.clear();
    for (const lines of this.magnetoMap.values()) {
      this.scene.remove(lines);
      (lines.material as THREE.Material).dispose();
    }
    this.magnetoMap.clear();
    for (const vis of this.streamMap.values()) {
      this.scene.remove(vis.ribbon);
      this.scene.remove(vis.particles);
      this.scene.remove(vis.disk);
      (vis.ribbon.material as THREE.Material).dispose();
      (vis.particles.material as THREE.Material).dispose();
      (vis.disk.material as THREE.Material).dispose();
    }
    this.streamMap.clear();
    for (const vis of this.blazarMap.values()) {
      this.scene.remove(vis.northJet);
      this.scene.remove(vis.southJet);
      (vis.northJet.material as THREE.Material).dispose();
      (vis.southJet.material as THREE.Material).dispose();
    }
    this.blazarMap.clear();
    if (this.jupiterIoVis) {
      this.scene.remove(this.jupiterIoVis.torusMesh);
      this.scene.remove(this.jupiterIoVis.torusParticles);
      this.scene.remove(this.jupiterIoVis.fluxTube);
      this.scene.remove(this.jupiterIoVis.plumeGroup);
      (this.jupiterIoVis.torusMesh.material as THREE.Material).dispose();
      (this.jupiterIoVis.torusParticles.material as THREE.Material).dispose();
      (this.jupiterIoVis.fluxTube.material as THREE.Material).dispose();
      for (const m of this.jupiterIoVis.plumeMats) m.dispose();
      this.jupiterIoVis = null;
    }
  }
}
