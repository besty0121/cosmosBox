import * as THREE from 'three';
import { METERS_TO_SCENE } from '../physics/constants';
import { CelestialBody, CmeWave, TidalStreamLink, Vec3 } from '../types/cosmos';
import { BodyRenderer } from './BodyRenderer';

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
`;

// 1. Authentic NASA SOHO/STEREO 3-Part CME Magnetic Flux-Rope & Delicate Micro-Spark Geometry
//    ZERO fake orange umbrella dome, ZERO blobby snowball puffs! Uses 7 silky braided flux-rope arches + 320 pin-fine plasma sparks.
function buildCmeCloudGeometry(): THREE.BufferGeometry {
  const count = 320;
  const pos = new Float32Array(count * 3);
  // aParams: x = arch position [0..1], y = radial spread [0..1], z = twist azimuth [0..2PI], w = kind (0=leading filament spark, 1=flux rope spark, 2=prominence spark)
  const params = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const kind = r < 0.45 ? 0 : r < 0.80 ? 1 : 2;
    params[i * 4] = Math.random();
    params[i * 4 + 1] = Math.random();
    params[i * 4 + 2] = Math.random() * Math.PI * 2;
    params[i * 4 + 3] = kind;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  return geo;
}

// Helical CME Magnetic Flux-Rope Arch Ribbon Geometry (uv.x across [-1..1], uv.y along arch [0..1])
const SHARED_CME_LOOP_GEO = new THREE.PlaneGeometry(1, 1, 4, 48);

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

const SHARED_CME_CLOUD_GEO = buildCmeCloudGeometry();
const SHARED_MAGNETO_LINES_GEO = buildMagnetosphereFieldLinesGeometry();
const SHARED_STREAM_PARTICLES_GEO = buildFlowParticleGeometry(320);
const SHARED_ACC_DISK_GEO = new THREE.RingGeometry(1.35, 3.8, 96);

/**
 * Pin-Fine Shimmering Coronal Plasma Micro-Sparks (320 particles, <= 4.5px, ZERO cotton-ball blobs!):
 * Adds delicate depth along the expanding braided flux-rope loops at rock-solid 60 FPS.
 */
function createCmeCloudMaterial(colorHex: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: 10 },
      uProgress: { value: 0 },
      uIntensity: { value: 1.2 },
      uColor: { value: new THREE.Color(colorHex) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aParams;
      uniform float uTime;
      uniform float uRadius;
      uniform float uProgress;
      uniform float uIntensity;
      uniform vec3 uColor;
      uniform float uPixelRatio;

      varying float vAlpha;
      varying vec3 vCol;

      void main() {
        float seed = aParams.x;
        float spread = aParams.y;
        float az = aParams.z;
        float kind = aParams.w;

        vec3 localPos;
        float ptSize;

        if (kind < 0.5) {
          // Leading tenuous shockfront micro-sparks
          float coneAng = pow(spread, 0.72) * 0.58;
          float rShell = uRadius * (0.88 + 0.14 * seed);
          localPos = vec3(
            sin(coneAng) * cos(az) * 1.15,
            sin(coneAng) * sin(az) * 0.85,
            cos(coneAng)
          ) * rShell;
          vCol = vec3(1.35, 1.05, 0.65);
          vAlpha = smoothstep(0.58, 0.12, coneAng) * 0.24 * uIntensity;
          ptSize = 1.4 + 1.8 * seed;
        } else {
          // Delicate plasma motes spiraling along the braided magnetic flux-rope loops
          float s = fract(seed + uTime * 0.06);
          float archAng = (s - 0.5) * 3.14159;
          float loopR = uRadius * (kind > 1.5 ? 0.62 : 0.84);
          vec3 spine = vec3(
            sin(archAng) * loopR * 0.62,
            sin(archAng * 2.0 + uTime * 0.25) * loopR * 0.16,
            cos(archAng) * loopR * 0.96
          );
          float twistAng = s * 16.0 + az + uTime * 0.9;
          float tubeR = uRadius * (0.04 + 0.09 * cos(archAng)) * spread;
          vec3 tang = normalize(vec3(cos(archAng) * 0.62, 0.0, -sin(archAng) * 0.96) + vec3(1e-4));
          vec3 sideV = normalize(cross(vec3(0.0, 1.0, 0.0), tang));
          vec3 normV = cross(tang, sideV);
          localPos = spine + (sideV * cos(twistAng) + normV * sin(twistAng)) * tubeR;

          vCol = mix(uColor * 1.2, vec3(1.42, 0.96, 0.52), 0.5 + 0.5 * cos(archAng));
          vAlpha = (0.18 + 0.26 * cos(archAng)) * uIntensity;
          ptSize = 1.3 + 1.9 * spread;
        }

        float distFade = smoothstep(0.0, 0.04, uProgress) * pow(1.0 - clamp(uProgress, 0.0, 1.0), 0.95);
        vAlpha *= distFade;

        vec4 mvPos = modelViewMatrix * vec4(localPos, 1.0);
        float camDist = max(1.0, -mvPos.z);
        float persp = clamp(150.0 / camDist, 0.65, 1.8);
        gl_PointSize = clamp(ptSize * persp * uPixelRatio, 1.3, 4.4);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vCol;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d2 = dot(uv, uv) * 4.0;
        if (d2 > 1.0) discard;
        float falloff = exp(-d2 * 5.2) * (1.0 - d2);
        float a = falloff * vAlpha;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vCol, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Gossamer Helical Coronal Magnetic Flux-Rope Arch Ribbon (7 staggered braided arches erupting from the Sun):
 * Forms a genuine billowing, wispy NASA SOHO/STEREO three-part coronal mass ejection (leading veil,
 * dark magnetic cavity, and inner erupting prominence strands) with ZERO hard dome & ZERO snowballs!
 */
function createCmeFluxLoopMaterial(
  phaseOffset: number,
  tiltAngle: number,
  depthScale: number,
  spanScale: number,
  widthScale: number,
  alphaScale: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: 10 },
      uProgress: { value: 0 },
      uIntensity: { value: 1.2 },
      uPhase: { value: phaseOffset },
      uTilt: { value: tiltAngle },
      uDepthScale: { value: depthScale },
      uSpanScale: { value: spanScale },
      uWidthScale: { value: widthScale },
      uAlphaScale: { value: alphaScale },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uRadius;
      uniform float uPhase;
      uniform float uTilt;
      uniform float uDepthScale;
      uniform float uSpanScale;
      uniform float uWidthScale;

      varying float vAlong;
      varying float vAcross;

      vec3 evalFluxArch(float s) {
        // Staggered croissant-shaped magnetic flux rope anchored back near the Sun, expanding outward along +Z
        float a = (s - 0.5) * 3.14159;
        float span = uRadius * uSpanScale;
        float depth = uRadius * uDepthScale;
        // Organic helical writhe (smoothly offset per loop so arches NEVER pinch into a single vertex!)
        float helix = sin(s * 9.0 - uTime * 1.1 + uPhase) * uRadius * 0.036 * cos(a);
        float offY = sin(uPhase * 1.7) * uRadius * 0.09 * cos(a);
        float x0 = sin(a) * span;
        float y0 = helix + offY + sin(a * 2.0 + uPhase) * uRadius * 0.065;
        float z0 = max(0.0, cos(a)) * depth;

        float ct = cos(uTilt);
        float st = sin(uTilt);
        return vec3(x0 * ct - y0 * st, x0 * st + y0 * ct, z0);
      }

      void main() {
        float s = uv.y;
        float side = uv.x * 2.0 - 1.0;
        vAlong = s;
        vAcross = side;

        vec3 pLocal = evalFluxArch(s);
        vec3 pNext = evalFluxArch(min(s + 0.02, 1.0));
        vec3 pPrev = evalFluxArch(max(s - 0.02, 0.0));

        // Smooth camera-independent radial width axis inside the erupting coronal loop plane:
        // NEVER flips 180° when the arch tangent points toward the camera (eliminates bowtie fold/pinch!)
        vec3 tangLocal = normalize(pNext - pPrev + vec3(1e-5));
        vec3 radialLocal = normalize(pLocal + vec3(0.0, 0.0, uRadius * 0.15));
        vec3 sideLocal = radialLocal - tangLocal * dot(radialLocal, tangLocal);
        float sl = length(sideLocal);
        sideLocal = sl > 0.001 ? sideLocal / sl : vec3(0.0, 0.0, 1.0);

        // Wide billowing silky apex, slender wispy solar anchor legs
        float apex = pow(sin(s * 3.14159), 0.78);
        float halfW = uRadius * uWidthScale * (0.042 + 0.135 * apex);
        vec3 finalLocal = pLocal + sideLocal * (side * halfW);
        vec3 worldPos = (modelMatrix * vec4(finalLocal, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uIntensity;
      uniform float uPhase;
      uniform float uAlphaScale;

      varying float vAlong;
      varying float vAcross;
      ${GLSL_NOISE_HELPERS}

      void main() {
        float s = vAlong;
        float a = abs(vAcross);

        float crossFade = exp(-a * a * 4.4) * smoothstep(1.0, 0.48, a);
        float archFade = pow(sin(s * 3.14159), 1.25);

        // Multi-scale silky coronal plasma filaments (100% smooth procedural, zero snowballs!)
        float f1 = hFbm2(vec2(vAcross * 2.6, s * 6.0 - uTime * 0.48 + uPhase));
        float f2 = hFbm2(vec2(vAcross * 5.2 + f1 * 1.1, s * 11.0 - uTime * 0.78));
        float strand = pow(clamp(1.0 - abs(f1 * 2.0 - 1.0), 0.0, 1.0), 2.1);
        float distFade = smoothstep(0.0, 0.045, uProgress) * pow(1.0 - clamp(uProgress, 0.0, 1.0), 1.05);

        // Authentic NASA SOHO/STEREO coronal hue: warm amber-crimson inner filament -> gossamer pale-gold shock veil
        vec3 deepAmber = vec3(1.18, 0.46, 0.14);
        vec3 solarGold = vec3(1.36, 0.88, 0.42);
        vec3 paleVeil = vec3(1.35, 1.22, 0.92);
        vec3 col = mix(deepAmber, solarGold, 0.35 + 0.65 * f2);
        col = mix(col, paleVeil, strand * 0.55);

        float alpha = clamp(crossFade * archFade * (0.34 + 0.72 * strand + 0.28 * f2) * distFade * uIntensity * uAlphaScale, 0.0, 0.42);
        if (alpha < 0.002) discard;
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

interface CmeVisual {
  group: THREE.Group;
  cloud: THREE.Points;
  loops: THREE.Mesh[];
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

  private tempOrigin = new THREE.Vector3();
  private tempDir = new THREE.Vector3();
  private tempAxis = new THREE.Vector3();
  private tempBend = new THREE.Vector3();
  private tempRight = new THREE.Vector3();
  private tempUp = new THREE.Vector3();
  private tempZ = new THREE.Vector3(0, 0, 1);
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
    elapsedTime: number
  ): void {
    this.syncCmes(cmeWaves, originMeters, elapsedTime);
    this.syncMagnetospheres(bodies, bodyRenderer, elapsedTime);
    this.syncTidalStreams(bodies, tidalStreams, bodyRenderer, elapsedTime);
    this.syncBlazarJets(bodies, bodyRenderer, elapsedTime);
  }

  private syncCmes(cmeWaves: CmeWave[], originMeters: Vec3, elapsedTime: number): void {
    const aliveIds = new Set<string>();
    for (const wave of cmeWaves) {
      aliveIds.add(wave.id);
      let vis = this.cmeMap.get(wave.id);
      if (!vis) {
        const group = new THREE.Group();
        const cloud = new THREE.Points(SHARED_CME_CLOUD_GEO, createCmeCloudMaterial(wave.color));
        cloud.frustumCulled = false;
        cloud.renderOrder = 4;
        group.add(cloud);

        // 7 staggered silky coronal flux-rope & leading shock-veil arches (zero vertex pinch, zero snowballs!)
        const loopConfigs = [
          // Broad tenuous leading shock veil arches
          { phase: 0.2, tilt: 0.04, depth: 1.00, span: 0.74, width: 1.65, alpha: 0.14 },
          { phase: 1.8, tilt: 0.52, depth: 0.96, span: 0.68, width: 1.45, alpha: 0.13 },
          { phase: 3.4, tilt: -0.48, depth: 0.94, span: 0.66, width: 1.40, alpha: 0.13 },
          // Crisp braided helical flux-rope loops
          { phase: 0.9, tilt: 0.22, depth: 0.84, span: 0.58, width: 0.92, alpha: 0.22 },
          { phase: 2.7, tilt: -0.26, depth: 0.80, span: 0.54, width: 0.88, alpha: 0.20 },
          // Inner erupting coronal prominence filament arches behind the dark cavity
          { phase: 4.5, tilt: 0.14, depth: 0.62, span: 0.44, width: 0.76, alpha: 0.19 },
          { phase: 5.6, tilt: -0.34, depth: 0.56, span: 0.40, width: 0.70, alpha: 0.17 },
        ];
        const loops: THREE.Mesh[] = [];
        for (const cfg of loopConfigs) {
          const loopMesh = new THREE.Mesh(
            SHARED_CME_LOOP_GEO,
            createCmeFluxLoopMaterial(
              cfg.phase,
              cfg.tilt,
              cfg.depth,
              cfg.span,
              cfg.width,
              cfg.alpha
            )
          );
          loopMesh.frustumCulled = false;
          loopMesh.renderOrder = 4;
          group.add(loopMesh);
          loops.push(loopMesh);
        }

        this.scene.add(group);
        vis = { group, cloud, loops };
        this.cmeMap.set(wave.id, vis);
      }

      this.tempOrigin.set(
        (wave.origin.x - originMeters.x) * METERS_TO_SCENE,
        (wave.origin.y - originMeters.y) * METERS_TO_SCENE,
        (wave.origin.z - originMeters.z) * METERS_TO_SCENE
      );
      this.tempDir.set(wave.direction.x, wave.direction.y, wave.direction.z).normalize();

      const radiusScene = Math.max(1.0, wave.radiusMeters * METERS_TO_SCENE);
      const progress = Math.min(1, wave.radiusMeters / wave.maxRadiusMeters);

      vis.group.position.copy(this.tempOrigin);
      vis.group.quaternion.setFromUnitVectors(this.tempZ, this.tempDir);

      const cMat = vis.cloud.material as THREE.ShaderMaterial;
      cMat.uniforms.uTime.value = elapsedTime;
      cMat.uniforms.uRadius.value = radiusScene;
      cMat.uniforms.uProgress.value = progress;
      cMat.uniforms.uIntensity.value = wave.intensity;

      for (const loop of vis.loops) {
        const lMat = loop.material as THREE.ShaderMaterial;
        lMat.uniforms.uTime.value = elapsedTime;
        lMat.uniforms.uRadius.value = radiusScene;
        lMat.uniforms.uProgress.value = progress;
        lMat.uniforms.uIntensity.value = wave.intensity;
      }
    }

    for (const [id, vis] of this.cmeMap.entries()) {
      if (!aliveIds.has(id)) {
        this.scene.remove(vis.group);
        (vis.cloud.material as THREE.Material).dispose();
        for (const loop of vis.loops) {
          (loop.material as THREE.Material).dispose();
        }
        this.cmeMap.delete(id);
      }
    }
  }

  private syncMagnetospheres(
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    elapsedTime: number
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

  public disposeAll(): void {
    for (const vis of this.cmeMap.values()) {
      this.scene.remove(vis.group);
      (vis.cloud.material as THREE.Material).dispose();
      for (const loop of vis.loops) {
        (loop.material as THREE.Material).dispose();
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
  }
}
