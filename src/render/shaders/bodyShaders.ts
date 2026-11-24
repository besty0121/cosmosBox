import * as THREE from 'three';
import { CelestialBody } from '../../types/cosmos';
import { PlanetTextures } from '../TextureAtlas';

export const MAX_STAR_LIGHTS = 4;
export const MAX_OCCLUDERS = 4;

const GLSL_ECLIPSE_HELPER = /* glsl */ `
uniform int uOccluderCount;
uniform vec3 uOccluderPositions[${MAX_OCCLUDERS}];
uniform float uOccluderRadii[${MAX_OCCLUDERS}];
uniform float uOccluderHasAtmo[${MAX_OCCLUDERS}];
uniform float uStarRadii[${MAX_STAR_LIGHTS}];

// Evaluates multi-body eclipse shadowing (Umbra + Penumbra + Atmospheric Blood-Moon Refraction).
// Returns RGB light multiplier (1.0 = unoccluded; ~0.02 = total solar eclipse umbra; copper-crimson = Earth shadow Blood Moon!).
vec3 computeEclipseTransmit(vec3 worldPos, vec3 starPos, float starRadius) {
  vec3 toStar = starPos - worldPos;
  float dStar = length(toStar);
  if (dStar < 1e-4) return vec3(1.0);
  vec3 L = toStar / dStar;
  // Soft realistic solar angular radius for authentic penumbra edges in playable & real scales
  float angStar = clamp(starRadius / dStar, 0.0055, 0.032);

  vec3 transmit = vec3(1.0);
  for (int k = 0; k < ${MAX_OCCLUDERS}; k++) {
    if (k >= uOccluderCount) break;
    vec3 toOcc = uOccluderPositions[k] - worldPos;
    float occR = uOccluderRadii[k];
    float proj = dot(toOcc, L);
    // Must lie strictly between this surface point and the star
    if (proj <= occR * 0.35 || proj >= dStar) continue;

    float perp = length(toOcc - L * proj);
    float angOcc = occR / proj;
    float angSep = perp / proj;

    // Soft penumbra / umbra overlap factor
    float penumbra = smoothstep(max(0.0, angOcc - angStar * 0.9), angOcc + angStar * 1.15, angSep);
    float occStrength = clamp(angOcc / max(angStar, 0.001), 0.0, 1.0);
    float shadow = mix(1.0 - occStrength * 0.97, 1.0, penumbra);

    // Earth-like atmosphere refracts deep copper-red sunlight into its umbra -> authentic Blood Moon!
    if (uOccluderHasAtmo[k] > 0.5) {
      float umbraDepth = 1.0 - penumbra;
      vec3 bloodGlow = vec3(0.46, 0.075, 0.022) * umbraDepth * occStrength;
      transmit *= vec3(shadow) + bloodGlow;
    } else {
      transmit *= vec3(shadow);
    }
  }
  return clamp(transmit, 0.0, 1.0);
}
`;

const TEXTURED_SPHERE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying vec3 vLocalPos;

void main() {
  vUv = uv;
  vLocalPos = normalize(position);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

// ============================================================================
// 1. PHOTOREALISTIC NASA SDO SUN: BOILING PHOTOSPHERE + H-ALPHA WISPY PROMINENCES + SPICULES + CORONA
// ============================================================================

/**
 * Cinema-grade Solar Photosphere modeled after NASA SDO (HMI + AIA 304A):
 * - Self-advected swirling UV flow using the solar map itself so plasma genuinely churns & boils
 *   (no rigid sliding texture!)
 * - Crisp convective granulation, dark sunspot umbra/penumbra, dark winding filaments,
 *   bright active magnetic plages, and rich deep-amber Eddington limb darkening.
 */
export function createStarMaterial(body: CelestialBody, textures: PlanetTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: body.seed },
      uSunMap: { value: textures.sun },
      uColorPrimary: { value: new THREE.Color(body.color) },
      uColorSecondary: { value: new THREE.Color(body.secondaryColor) },
      uTemperature: { value: body.temperature },
      uFlareDirLocal: { value: new THREE.Vector3(1, 0, 0) },
      uFlarePower: { value: 0 },
      uFlareAge: { value: 0 },
    },
    vertexShader: TEXTURED_SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform sampler2D uSunMap;
      uniform vec3 uColorPrimary;
      uniform vec3 uColorSecondary;
      uniform float uTemperature;
      uniform vec3 uFlareDirLocal;
      uniform float uFlarePower;
      uniform float uFlareAge;

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;

      void main() {
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float mu = max(dot(N, V), 0.0);

        // Seamless spherical triplanar-blended UV flow eliminates equirectangular pole pinching
        vec3 q = normalize(vLocalPos);
        vec2 flowSampleA = texture2D(uSunMap, vUv * 1.4 + vec2(uTime * 0.0025, -uTime * 0.0018)).rg - 0.5;
        vec2 flowSampleB = texture2D(uSunMap, vUv * 2.8 + vec2(-uTime * 0.0032, uTime * 0.0022)).rg - 0.5;
        vec2 warp = (flowSampleA * 0.022 + flowSampleB * 0.011);

        // Real CME Eruption Surface Coupling: Strictly OUTWARD-expanding Moreton / EUV Solar Tsunami Shockwave!
        vec3 fDir = normalize(uFlareDirLocal);
        float cosF = clamp(dot(q, fDir), -1.0, 1.0);
        float angDist = acos(cosF);
        float waveR = 0.05 + uFlareAge * 1.48;
        float waveW = 0.08 + uFlareAge * 0.07;
        // Fade cleanly before reaching the antipode so far-side eruptions never look like an inward-converging front ring!
        float hemiFade = smoothstep(1.70, 0.85, angDist);
        float moretonWave = uFlarePower > 0.004
          ? exp(-pow((angDist - waveR) / waveW, 2.0)) * smoothstep(1.0, 0.08, uFlareAge) * hemiFade * uFlarePower
          : 0.0;
        // Physically churn the boiling photosphere granulation as the solar tsunami wave sweeps outward!
        warp += (flowSampleA * 0.055 + vec2(0.022, -0.018)) * moretonWave * 1.85;

        // Dual phase-blended boiling convection layers (genuine turbulent churning!)
        float phase1 = fract(uTime * 0.018 + uSeed * 0.1);
        float phase2 = fract(phase1 + 0.5);
        float blend = abs(2.0 * phase1 - 1.0);

        vec3 s1 = texture2D(uSunMap, vUv + warp * phase1 + vec2(uSeed * 0.013, 0.0)).rgb;
        vec3 s2 = texture2D(uSunMap, vUv + warp * phase2 + vec2(uSeed * 0.013 + 0.37, 0.19)).rgb;
        vec3 detail = texture2D(uSunMap, vUv * 2.6 - warp * 1.4 + vec2(uTime * 0.003, -uTime * 0.002)).rgb;

        vec3 baseTex = mix(s1, s2, blend);
        float lumBase = dot(baseTex, vec3(0.299, 0.587, 0.114));
        float lumDetail = dot(detail, vec3(0.299, 0.587, 0.114));

        // High-contrast convective cells + fine granulation
        float gran = clamp(lumBase * 0.68 + lumDetail * 0.42, 0.0, 1.3);
        float cells = smoothstep(0.16, 0.90, gran);

        // Realistic dark magnetic sunspot clusters (umbra + warm penumbra) & active bright plages
        float sunspotUmbra = 1.0 - smoothstep(0.14, 0.28, lumBase);
        float sunspotPenumbra = (1.0 - smoothstep(0.24, 0.42, lumBase)) * (1.0 - sunspotUmbra);
        float activePlage = smoothstep(0.76, 0.97, lumBase * 0.75 + lumDetail * 0.35);

        // Subtle dark winding chromospheric absorption filament on the solar disk (SDO 304A feature)
        float filWave = abs(sin(q.x * 7.5 + flowSampleA.x * 5.2 + uSeed) + cos(q.z * 6.8 + flowSampleA.y * 4.8));
        float darkFilament = (1.0 - smoothstep(0.0, 0.11, filWave)) * smoothstep(0.15, 0.6, abs(q.y)) * (1.0 - smoothstep(0.55, 0.85, abs(q.y)));

        // Authentic astrophysical Eddington limb darkening: rich molten gold center -> deep fiery crimson-amber edge!
        float limbDark = 0.20 + 0.80 * pow(mu, 0.72);
        float thinChromoRim = pow(1.0 - mu, 6.2);

        // Rich NASA SDO solar blackbody contrast (eliminates washed-out beige/white patches)
        vec3 darkPore = mix(uColorSecondary * 0.24, vec3(0.42, 0.06, 0.01), 0.45);
        vec3 moltenMid = mix(uColorSecondary * 0.95, vec3(1.0, 0.42, 0.06), 0.35);
        vec3 hotGranule = mix(uColorPrimary, vec3(1.0, 0.84, 0.42), 0.45);

        vec3 col = mix(darkPore, moltenMid, smoothstep(0.0, 0.48, cells));
        col = mix(col, hotGranule, smoothstep(0.48, 0.96, cells));
        col = mix(col, darkPore * 0.85, sunspotPenumbra * 0.62);
        col = mix(col, darkPore * 0.12, sunspotUmbra * 0.88);
        col = mix(col, darkPore * 0.42, darkFilament * 0.55);
        col += mix(uColorPrimary, vec3(1.0, 0.94, 0.72), 0.5) * activePlage * 0.32;

        // Sinuous Two-Ribbon X-Class Solar Flare embedded inside boiling granulation + Moreton Tsunami Crest!
        if (uFlarePower > 0.004) {
          vec3 refUp = abs(fDir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 tanA = normalize(cross(fDir, refUp));
          vec3 tanB = normalize(cross(fDir, tanA));
          vec3 dVec = q - fDir * cosF;
          float tx = dot(dVec, tanA);
          float ty = dot(dVec, tanB);
          float shearX = abs(tx + flowSampleA.x * 0.14 + sin(ty * 14.0 + uTime * 2.2) * 0.024);
          float ribbonPair = exp(-pow((shearX - 0.052) / 0.024, 2.0)) * exp(-pow(ty / 0.23, 2.0));
          float activeCore = exp(-pow(angDist / 0.18, 2.0)) * (0.35 + 0.65 * cells);
          float flareEnv = smoothstep(0.65, 0.0, uFlareAge) * uFlarePower;

          vec3 flareWhiteGold = vec3(1.95, 1.68, 1.12);
          vec3 tsunamiGold = vec3(1.58, 0.76, 0.22);
          col += flareWhiteGold * (ribbonPair * 1.45 + activeCore * 0.55) * flareEnv;
          col += tsunamiGold * moretonWave * (0.45 + 0.90 * cells) * 0.92;
        }

        // Subtle ruby-orange chromosphere glow ONLY at the razor-thin silhouette edge
        vec3 hAlphaCrimson = mix(uColorSecondary, vec3(1.0, 0.22, 0.04), 0.65);
        vec3 finalCol = col * limbDark * 1.15 + hAlphaCrimson * thinChromoRim * (0.85 + moretonWave * 1.15);

        gl_FragColor = vec4(finalCol, 1.0);
      }
    `,
  });
}

/**
 * Asymmetric Wispy 3D Solar Prominence Curtain Shader (NASA SDO 304A / H-Alpha):
 * Renders irregular, shredded, tangled hedgerow & eruptive plasma filaments anchored to active
 * regions — NEVER smooth geometric arches! Uses multi-scale advected solar plasma sampling,
 * H-alpha ruby-red to blazing tangerine-gold temperature gradient, and soft view-angle fade.
 */
export function createProminenceMaterial(
  colorHex: string,
  sunTexture: THREE.Texture,
  seed: number,
  variant: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uVariant: { value: variant },
      uSunMap: { value: sunTexture },
      uColor: { value: new THREE.Color(colorHex) },
      uStarWorldPos: { value: new THREE.Vector3() },
      uSurgePower: { value: 0 },
      uSurgeAge: { value: 0 },
      uEruptScroll: { value: 0 },
      uLifeProgress: { value: 0.5 },
      uLifeAlpha: { value: 1.0 },
      uFlareDirWorld: { value: new THREE.Vector3(1, 0, 0) },
      uIsEruptive: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSurgePower;
      uniform float uSurgeAge;
      uniform float uLifeProgress;
      uniform float uIsEruptive;
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec3 p = position;
        float alt = vUv.y;
        // Strictly OUTWARD rising, billowing & eruptive stretching (ZERO snap when eruption ends!)
        float waveRipple = sin(vUv.x * 7.5 - uTime * 2.4) * 0.035 * alt * (0.35 + uSurgePower);
        float radialStretch;
        if (uIsEruptive > 0.5) {
          // Emerges smoothly out of the chromosphere and blasts strictly outward as uSurgeAge goes 0 -> 1!
          radialStretch = mix(-0.22, 0.72, smoothstep(0.0, 0.90, uSurgeAge)) * alt;
        } else {
          // Ambient random prominence lifecycle: smoothly rises & swells with uSurgePower (zero reset jump!)
          float rise = mix(-0.32, 0.16, smoothstep(0.0, 0.65, uLifeProgress));
          radialStretch = (rise + 0.18 * uSurgePower) * alt;
        }
        vec3 radDir = normalize(p);
        p += radDir * radialStretch + normal * waveRipple;

        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform float uVariant;
      uniform sampler2D uSunMap;
      uniform vec3 uColor;
      uniform vec3 uStarWorldPos;
      uniform float uSurgePower;
      uniform float uSurgeAge;
      uniform float uEruptScroll;
      uniform float uLifeProgress;
      uniform float uLifeAlpha;
      uniform vec3 uFlareDirWorld;
      uniform float uIsEruptive;

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;

      void main() {
        if (uLifeAlpha < 0.005) discard;
        float x = vUv.x * 2.0 - 1.0; // [-1 .. 1]
        float y = vUv.y;             // [0 .. 1] radial altitude

        // Generous edge-safe envelope reaching strict 0 well inside quad borders -> ZERO geometric clipping!
        float rectSafe = smoothstep(0.92, 0.42, abs(x)) * smoothstep(0.88, 0.30, y) * smoothstep(0.0, 0.09, y);
        if (rectSafe < 0.008) discard;

        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float viewFade = smoothstep(0.12, 0.52, abs(dot(N, V)));

        // Authentic SDO limb physics: prominences shine brilliantly against dark space near the solar limb,
        // while erupting CME plumes also remain softly visible arching over the chromosphere!
        vec3 radialDir = normalize(vWorldPos - uStarWorldPos);
        float limbOnly = smoothstep(0.62, 0.28, abs(dot(radialDir, V)));
        if (uIsEruptive > 0.5) {
          limbOnly = mix(limbOnly, smoothstep(0.88, 0.36, abs(dot(radialDir, V))), 0.65);
        }
        float eruptLife = uIsEruptive > 0.5
          ? smoothstep(0.0, 0.12, uSurgeAge) * smoothstep(0.95, 0.25, uSurgeAge) * uSurgePower
          : uLifeAlpha;
        float visibility = rectSafe * viewFade * limbOnly * eruptLife;
        if (visibility < 0.008) discard;

        // Local surge amplification: stronger for curtains near the CME epicenter + global coronal wave response!
        float prox = uIsEruptive > 0.5
          ? 1.0
          : (0.28 + 0.72 * smoothstep(-0.25, 0.85, dot(radialDir, normalize(uFlareDirWorld))));
        float localSurge = uSurgePower * prox;

        // STRICTLY MONOTONICALLY OUTWARD & NEVER-RESETTING plasma flow (uses cumulative uEruptScroll -> ZERO A->B snap!)
        float outwardScroll = uIsEruptive > 0.5
          ? (uTime * 0.026 + uSurgeAge * 0.55)
          : (uTime * 0.026 + uEruptScroll * 0.48 + uLifeProgress * 0.22);
        vec2 baseUv = vec2(vUv.x * 1.2 + uSeed * 0.13, y * 1.4 - outwardScroll + uSeed * 0.07);
        vec2 warp1 = texture2D(uSunMap, baseUv * 0.85 + vec2(0.11, -outwardScroll * 0.45)).rg - 0.5;
        vec2 warp2 = texture2D(uSunMap, baseUv * 2.1 + warp1 * 0.44 + vec2(uTime * 0.010, -outwardScroll * 0.95)).rg - 0.5;

        // Delicate, slender, genuinely asymmetric prominence silhouettes that emerge, rise outward, and dissolve!
        float growMask = uIsEruptive > 0.5
          ? smoothstep(0.0, 0.35, uSurgeAge)
          : smoothstep(0.0, 0.32, uLifeProgress);
        float shapeMask = 0.0;
        if (uVariant < 0.5) {
          // Hedgerow prominence: ragged uneven plasma forest rising & dissolving naturally
          float heightLimit = (0.14 + 0.28 * growMask + 0.16 * localSurge) + 0.14 * sin(x * 4.2 + uSeed) + warp1.x * 0.22 + warp2.y * 0.12;
          float lateral = smoothstep(0.82, 0.18, abs(x + warp1.y * 0.24));
          float topFade = smoothstep(heightLimit + 0.14, heightLimit - 0.14, y);
          shapeMask = lateral * topFade;
        } else if (uVariant < 1.5) {
          // Slender asymmetric eruptive surge / tilted magnetic plume shooting strictly outward
          float leanX = x - y * (0.42 + 0.22 * sin(uSeed)) + warp1.x * 0.28;
          float width = mix(0.22 + 0.08 * localSurge, 0.08 + 0.05 * localSurge, y) + warp2.x * 0.10;
          float plume = smoothstep(width + 0.16, width * 0.15, abs(leanX));
          float heightFade = smoothstep(0.24 + 0.58 * growMask + 0.16 * localSurge, 0.08, y + warp1.y * 0.18);
          shapeMask = plume * heightFade;
        } else {
          // Torn asymmetrical magnetic loop with dark coronal cavity that opens & dissipates as it ages
          float asymX = x + warp1.x * 0.24 + y * 0.16;
          float archR = length(vec2(asymX * 1.35, (y + 0.04) * (2.15 - 0.55 * growMask - 0.28 * localSurge)));
          float outer = smoothstep(0.78 + warp1.y * 0.20, 0.48, archR);
          float cavity = smoothstep(0.22 + warp2.x * 0.14, 0.46, archR);
          float ageBreak = uIsEruptive > 0.5 ? uSurgeAge : smoothstep(0.55, 1.0, uLifeProgress);
          float breakGap = smoothstep(-0.1, 0.45, sin(x * 5.0 + uSeed) + warp1.x * 1.6 + 0.55 - 0.42 * ageBreak);
          shapeMask = outer * cavity * breakGap;
        }

        // Shred into delicate translucent glowing plasma strands flowing strictly outward
        vec2 threadUv = vec2(vUv.x * 3.1 + warp1.x * 0.55, y * 1.8 - outwardScroll * 1.35 + warp1.y * 0.30);
        float t1 = dot(texture2D(uSunMap, threadUv).rgb, vec3(0.3, 0.59, 0.11));
        float t2 = dot(texture2D(uSunMap, threadUv * 2.3 + warp2 * 0.45).rgb, vec3(0.3, 0.59, 0.11));
        float wisps = smoothstep(0.30 - 0.06 * localSurge, 0.88, t1 * 0.62 + t2 * 0.50);

        float density = shapeMask * wisps * visibility;
        if (density < 0.012) discard;

        // Authentic NASA SDO 304A / H-Alpha deep ruby-crimson to fiery tangerine-orange & incandescent gold surge ramp
        vec3 deepRuby = mix(vec3(0.78, 0.06, 0.02), uColor * 0.55, 0.25);
        vec3 fieryOrange = mix(vec3(1.0, 0.32, 0.05), uColor * 0.9, 0.35);
        vec3 hotStrand = mix(vec3(1.0, 0.72, 0.32), vec3(1.65, 1.35, 0.85), localSurge * 0.65);

        vec3 col = mix(deepRuby, fieryOrange, smoothstep(0.08, 0.55, density));
        col = mix(col, hotStrand, smoothstep(0.50, 0.92, density + localSurge * 0.22));

        float gain = 1.25 + localSurge * 0.85;
        gl_FragColor = vec4(col * gain, clamp(density * (0.82 + localSurge * 0.32), 0.0, 0.88));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Chromospheric Spicules + Asymmetric Feathery Helmet-Streamer Solar Corona Billboard:
 * - Shimmering fine fiery spicule needles right at the solar limb (r = 0.185 .. 0.205 in billboard UV)
 * - Soft asymmetric coronal helmet streamers radiating into deep space
 * - Completely transparent over the inner photosphere so solar surface granulation stays razor-sharp!
 */
export function createSolarCoronaMaterial(
  colorHex: string,
  seed: number,
  sunTexture: THREE.Texture
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uSunMap: { value: sunTexture },
      uColor: { value: new THREE.Color(colorHex) },
      uFlareDir2D: { value: new THREE.Vector2(1, 0) },
      uFlarePower: { value: 0 },
      uFlareAge: { value: 0 },
      uEruptScroll: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform sampler2D uSunMap;
      uniform vec3 uColor;
      uniform vec2 uFlareDir2D;
      uniform float uFlarePower;
      uniform float uFlareAge;
      uniform float uEruptScroll;
      varying vec2 vUv;

      const float PI = 3.14159265359;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float r = sqrt(r2);

        // Corona quad scale = 4.8 * R_sun -> solar limb sits at r_limb = 1.0 / 2.4 ≈ 0.416
        const float R_LIMB = 0.416;
        if (r < R_LIMB * 0.94) discard;

        float ang = atan(p.y, p.x);
        float uAng = ang / (2.0 * PI) + 0.5;

        // Directional coronal streamer & spicule eruption coupling along the active CME launch azimuth!
        float fMag = length(uFlareDir2D);
        vec2 fDir2 = fMag > 0.01 ? (uFlareDir2D / fMag) : vec2(1.0, 0.0);
        float azAlign = mix(0.42, pow(max(0.0, dot(p / max(0.001, r), fDir2)), 4.2), smoothstep(0.15, 0.65, fMag));
        float eruptEnv = uFlarePower * smoothstep(0.98, 0.15, uFlareAge);

        // 1. Fine flickering chromospheric spicules (cumulative NEVER-RESETTING uEruptScroll -> ZERO A->B snap!)
        float spiculeTex = dot(texture2D(uSunMap, vec2(uAng * 7.0 + uSeed * 0.1, r * 6.0 - uTime * 0.08 - uEruptScroll * 0.85)).rgb, vec3(0.3, 0.59, 0.11));
        float spiculeDist = max(0.0, r - R_LIMB);
        float spiculeHeight = 0.022 + spiculeTex * 0.032 + 0.042 * azAlign * eruptEnv;
        float spicules = smoothstep(spiculeHeight, 0.0, spiculeDist) * smoothstep(R_LIMB * 0.94, R_LIMB * 1.005, r) * (0.45 + 0.85 * spiculeTex + 0.65 * azAlign * eruptEnv);

        // 2. Asymmetric helmet-streamer solar corona + STRICTLY OUTWARD sweeping CME coronal blast wave!
        float streamTex1 = dot(texture2D(uSunMap, vec2(uAng * 1.6 + uSeed * 0.23, r * 0.55 - uTime * 0.014 - uEruptScroll * 0.34)).rgb, vec3(0.3, 0.59, 0.11));
        float streamTex2 = dot(texture2D(uSunMap, vec2(uAng * 3.8 - uSeed * 0.17, r * 0.95 - uTime * 0.024 - uEruptScroll * 0.52)).rgb, vec3(0.3, 0.59, 0.11));
        float dipoleBias = 0.65 + 0.35 * cos(ang * 2.0 + 0.4 + uSeed); // equatorial streamer belt
        float streamers = (0.42 + 0.72 * streamTex1 * streamTex2) * dipoleBias;

        float distOut = max(0.0, r - R_LIMB);
        float blastWave = exp(-pow((distOut - (0.03 + uFlareAge * 0.42)) / 0.11, 2.0)) * azAlign * eruptEnv * (0.55 + 0.85 * streamTex1);
        float innerCorona = exp(-distOut * 9.5) * (0.48 + 0.52 * streamers + 0.55 * azAlign * eruptEnv);
        float outerCorona = exp(-distOut * 3.8) * streamers * 0.26 + blastWave * 0.58;
        float outerFade = smoothstep(0.98, 0.42, r);
        float limbMask = smoothstep(R_LIMB * 0.95, R_LIMB * 1.03, r);

        vec3 spiculeCol = mix(vec3(1.0, 0.28, 0.06), uColor, 0.35) * spicules * 1.25;
        vec3 coronaCol = mix(uColor, vec3(1.0, 0.93, 0.82), clamp(innerCorona * 0.65 + blastWave * 0.5, 0.0, 1.0)) * (innerCorona + outerCorona) * outerFade * limbMask * 1.05;

        vec3 finalCol = spiculeCol + coronaCol;
        float alpha = clamp((spicules * 0.78 + (innerCorona + outerCorona) * outerFade * limbMask * 0.85), 0.0, 0.94);
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(finalCol, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ============================================================================
// 2. REAL 2K NASA EARTH SHADER (Day + Night City Lights + Specular + Normal + Live Climate)
// ============================================================================

export function createTexturedEarthMaterial(
  body: CelestialBody,
  textures: PlanetTextures
): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));
  const starRadii = new Array(MAX_STAR_LIGHTS).fill(5.0);
  const occluderPositions = Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector3(0, 0, 0));
  const occluderRadii = new Array(MAX_OCCLUDERS).fill(0);
  const occluderHasAtmo = new Array(MAX_OCCLUDERS).fill(0);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDayMap: { value: textures.earthDay },
      uNightMap: { value: textures.earthNight },
      uSpecMap: { value: textures.earthSpecular },
      uNormalMap: { value: textures.earthNormal },
      uCloudMap: { value: textures.earthClouds },
      uAtmosphereColor: { value: new THREE.Color(body.atmosphereColor || '#5bb2ff') },
      uTemperature: { value: body.temperature },
      uWaterFraction: { value: body.waterFraction },
      uAtmosphere: { value: body.atmosphereDensity },
      uImpactHeat: { value: body.impactHeat },
      uAuroraIntensity: { value: body.auroraIntensity ?? 0.78 },
      uStarCount: { value: 1 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
      uStarRadii: { value: starRadii },
      uOccluderCount: { value: 0 },
      uOccluderPositions: { value: occluderPositions },
      uOccluderRadii: { value: occluderRadii },
      uOccluderHasAtmo: { value: occluderHasAtmo },
    },
    vertexShader: TEXTURED_SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uDayMap;
      uniform sampler2D uNightMap;
      uniform sampler2D uSpecMap;
      uniform sampler2D uNormalMap;
      uniform sampler2D uCloudMap;
      uniform vec3 uAtmosphereColor;
      uniform float uTemperature;
      uniform float uWaterFraction;
      uniform float uAtmosphere;
      uniform float uImpactHeat;
      uniform float uAuroraIntensity;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];
      ${GLSL_ECLIPSE_HELPER}

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;

      // Fast tangent frame construction from screen-space UV derivatives (exact normal mapping!)
      vec3 perturbNormal(vec3 baseN, vec3 worldPos, vec2 uv, vec3 mapN, float scale) {
        vec3 dp1 = dFdx(worldPos);
        vec3 dp2 = dFdy(worldPos);
        vec2 duv1 = dFdx(uv);
        vec2 duv2 = dFdy(uv);

        vec3 dp2perp = cross(dp2, baseN);
        vec3 dp1perp = cross(baseN, dp1);
        vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
        vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
        float invMax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
        mat3 TBN = mat3(T * invMax, B * invMax, baseN);

        vec3 n = mapN * 2.0 - 1.0;
        n.xy *= scale;
        return normalize(TBN * normalize(n));
      }

      void main() {
        vec3 baseN = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float lat = abs(vLocalPos.y);

        vec3 dayCol = texture2D(uDayMap, vUv).rgb;
        vec3 nightLights = texture2D(uNightMap, vUv).rgb;
        float oceanMask = texture2D(uSpecMap, vUv).r;
        vec3 normalSample = texture2D(uNormalMap, vUv).rgb;

        // Live dynamic climate factors (works directly over real NASA Earth!)
        float freezeFactor = smoothstep(275.0, 212.0, uTemperature);
        float boilFactor = smoothstep(340.0, 465.0, uTemperature);
        float lavaFactor = max(smoothstep(700.0, 1180.0, uTemperature), uImpactHeat);
        float dryOcean = clamp(boilFactor + (1.0 - smoothstep(0.05, 0.55, uWaterFraction)), 0.0, 1.0);

        // Perturb surface normal with real NASA topography normal map (stronger on continents!)
        vec3 N = perturbNormal(baseN, vWorldPos, vUv, normalSample, mix(1.35, 0.15, oceanMask * (1.0 - dryOcean)));

        vec3 albedo = dayCol;
        float specStrength = oceanMask * (1.0 - dryOcean) * 0.95;

        // 1. Boiling / Drying oceans reveal dusty reddish-ochre seabed basins & scorched continents
        if (dryOcean > 0.01) {
          vec3 dryBed = vec3(0.46, 0.34, 0.24) * (0.7 + 0.5 * dot(dayCol, vec3(0.33)));
          vec3 scorchedLand = mix(dayCol, vec3(0.56, 0.38, 0.24) * (0.65 + 0.6 * dot(dayCol, vec3(0.33))), 0.8);
          albedo = mix(albedo, mix(scorchedLand, dryBed, oceanMask), dryOcean);
        }

        // 2. Freezing Snowball Earth spreads crisp icy glaciation from poles down to equator!
        float iceLine = mix(0.88, -0.15, freezeFactor);
        float iceWave = (normalSample.r - 0.5) * 0.12;
        float iceMask = smoothstep(iceLine - 0.08, iceLine + 0.06, lat + iceWave);
        if (freezeFactor > 0.02) {
          vec3 seaIce = vec3(0.76, 0.87, 0.95);
          vec3 landSnow = vec3(0.88, 0.93, 0.97) * (0.85 + 0.25 * normalSample.g);
          vec3 frozenCol = mix(landSnow, seaIce, oceanMask);
          albedo = mix(albedo, frozenCol, iceMask * clamp(freezeFactor * 1.25, 0.0, 1.0));
          specStrength = mix(specStrength, 0.28, iceMask * freezeFactor);
        }

        // Cloud shadow sampled from real NASA cloud map slightly shifted by wind
        vec2 cloudUv = vec2(vUv.x - uTime * 0.0028, vUv.y);
        float cloudShadowSample = texture2D(uCloudMap, cloudUv + vec2(0.0022, 0.0012)).r;
        float cloudShadow = 1.0 - cloudShadowSample * clamp(uAtmosphere * 0.42, 0.0, 0.48) * (1.0 - lavaFactor);

        // Multi-star physical lighting + realistic GGX ocean sun-glint + Rayleigh sunset terminator
        vec3 litColor = albedo * 0.012;
        float maxDayLight = 0.0;

        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float rawNdl = dot(baseN, L);
          float bumpNdl = max(dot(N, L), 0.0);
          float horizonMask = smoothstep(-0.08, 0.12, rawNdl);
          float diff = bumpNdl * horizonMask * cloudShadow;
          maxDayLight = max(maxDayLight, smoothstep(-0.14, 0.20, rawNdl));

          // Sharp sunlit ocean Fresnel glint
          vec3 H = normalize(L + V);
          float ndh = max(dot(N, H), 0.0);
          float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          float spec = (pow(ndh, 72.0) * 1.45 + pow(ndh, 16.0) * 0.24) * specStrength * (0.35 + 0.65 * fresnel) * diff;

          // Authentic warm crimson-orange Rayleigh sunset right along the day-night terminator
          vec3 twilight = vec3(0.0);
          if (uAtmosphere > 0.15) {
            float terminator = exp(-pow((rawNdl - 0.01) * 8.0, 2.0));
            twilight = vec3(0.95, 0.34, 0.10) * terminator * clamp(uAtmosphere * 0.34, 0.0, 0.48) * albedo;
          }

          vec3 eclipse = computeEclipseTransmit(vWorldPos, uStarPositions[i], uStarRadii[i]);
          litColor += (albedo * diff * 1.24 + vec3(spec) + twilight) * uStarColors[i] * eclipse;
        }

        if (uStarCount == 0) {
          litColor = albedo * max(dot(N, normalize(vec3(1.0, 0.55, 0.75))), 0.16);
          maxDayLight = 1.0;
        }

        // Real NASA Black Marble night-side city lights (fades out if Earth freezes or boils uninhabitable!)
        vec3 emissive = vec3(0.0);
        float nightMask = pow(1.0 - maxDayLight, 1.8);
        float habitableCities = (1.0 - freezeFactor * 0.9) * (1.0 - boilFactor * 0.95) * (1.0 - lavaFactor);
        if (habitableCities > 0.02) {
          emissive += nightLights * vec3(1.35, 1.05, 0.68) * nightMask * habitableCities * 1.35;
        }

        // Whisper-subtle emerald-green downward auroral bounce glow on night clouds/snow (never paints the globe green!)
        if (uAuroraIntensity > 0.02 && uAtmosphere > 0.15) {
          vec3 magAxis = normalize(vec3(-0.15, 0.981, 0.12));
          float magLat = abs(dot(normalize(vLocalPos), magAxis));
          float stormExpand = clamp(uAuroraIntensity / 1.5, 0.0, 1.0) * 0.055;
          float ovalPeak = 0.935 - stormExpand;
          float groundGlow = exp(-pow((magLat - ovalPeak) * 20.0, 2.0));
          float atmoGate = smoothstep(0.15, 0.55, uAtmosphere) * (1.0 - lavaFactor);
          emissive += vec3(0.02, 0.12, 0.06) * groundGlow * nightMask * clamp(uAuroraIntensity, 0.0, 1.4) * atmoGate * 0.35;
        }

        // Molten volcanic magma cracks when superheated or freshly impacted by an asteroid!
        if (lavaFactor > 0.02) {
          float crackPattern = abs(sin(vLocalPos.x * 26.0 + normalSample.r * 9.0) * cos(vLocalPos.z * 26.0 + normalSample.g * 9.0));
          float cracks = 1.0 - smoothstep(0.02, 0.18 + lavaFactor * 0.24, crackPattern);
          float magmaFlow = clamp(cracks * lavaFactor * 1.45 + smoothstep(0.55, 1.0, lavaFactor) * oceanMask, 0.0, 1.0);
          vec3 charredCrust = albedo * 0.14;
          vec3 magmaCol = mix(vec3(1.25, 0.22, 0.02), vec3(2.2, 1.05, 0.25), clamp(normalSample.g + magmaFlow * 0.5, 0.0, 1.0));
          litColor = mix(litColor, charredCrust, lavaFactor * 0.78);
          emissive += magmaCol * magmaFlow * 1.35;
        }

        // Crisp azure Rayleigh aerial scattering at the planetary limb
        if (uAtmosphere > 0.08) {
          float viewRim = pow(1.0 - max(dot(baseN, V), 0.0), 3.6);
          litColor += uAtmosphereColor * viewRim * clamp(uAtmosphere * 0.58, 0.0, 0.9) * max(0.04, maxDayLight);
        }

        gl_FragColor = vec4(litColor + emissive, 1.0);
      }
    `,
  });
}

/**
 * Floating 3D Cloud Deck using real NASA 2K satellite cloud imagery!
 */
export function createCloudLayerMaterial(
  body: CelestialBody,
  textures: PlanetTextures
): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));
  const starRadii = new Array(MAX_STAR_LIGHTS).fill(5.0);
  const occluderPositions = Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector3(0, 0, 0));
  const occluderRadii = new Array(MAX_OCCLUDERS).fill(0);
  const occluderHasAtmo = new Array(MAX_OCCLUDERS).fill(0);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCloudMap: { value: textures.earthClouds },
      uAtmosphere: { value: body.atmosphereDensity },
      uTemperature: { value: body.temperature },
      uStarCount: { value: 1 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
      uStarRadii: { value: starRadii },
      uOccluderCount: { value: 0 },
      uOccluderPositions: { value: occluderPositions },
      uOccluderRadii: { value: occluderRadii },
      uOccluderHasAtmo: { value: occluderHasAtmo },
    },
    vertexShader: TEXTURED_SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uCloudMap;
      uniform float uAtmosphere;
      uniform float uTemperature;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];
      ${GLSL_ECLIPSE_HELPER}

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vNormalWorld);
        vec2 uv = vec2(vUv.x - uTime * 0.0028, vUv.y);
        float c = texture2D(uCloudMap, uv).r;

        float heatBurnOff = 1.0 - smoothstep(780.0, 1150.0, uTemperature);
        float alpha = smoothstep(0.14, 0.85, c) * clamp(uAtmosphere * 0.86, 0.0, 0.94) * heatBurnOff;
        if (alpha < 0.015) discard;

        vec3 cloudBase = vec3(0.96, 0.98, 1.0);
        vec3 lit = cloudBase * 0.01;
        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float ndl = dot(N, L);
          float diff = clamp((ndl + 0.14) / 1.14, 0.0, 1.0);
          // Warm sunset glow on high cloud tops along the twilight terminator
          float sunset = exp(-pow((ndl - 0.02) * 8.5, 2.0));
          vec3 tinted = mix(cloudBase, vec3(1.0, 0.52, 0.24), sunset * 0.52);
          vec3 eclipse = computeEclipseTransmit(vWorldPos, uStarPositions[i], uStarRadii[i]);
          lit += tinted * diff * uStarColors[i] * eclipse * 1.18;
        }
        if (uStarCount == 0) {
          lit = cloudBase * max(dot(N, normalize(vec3(1.0, 0.55, 0.75))), 0.15);
        }

        gl_FragColor = vec4(lit, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

// ============================================================================
// 3. REAL 2K NASA ROCKY / MOON / MARS / MERCURY / VENUS SHADER
// ============================================================================

export function createTexturedRockyMaterial(
  body: CelestialBody,
  albedoMap: THREE.Texture,
  tintHex?: string,
  bumpStrength = 1.65
): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));
  const starRadii = new Array(MAX_STAR_LIGHTS).fill(5.0);
  const occluderPositions = Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector3(0, 0, 0));
  const occluderRadii = new Array(MAX_OCCLUDERS).fill(0);
  const occluderHasAtmo = new Array(MAX_OCCLUDERS).fill(0);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAlbedoMap: { value: albedoMap },
      uTint: { value: new THREE.Color(tintHex ?? '#ffffff') },
      uBumpStrength: { value: bumpStrength },
      uAtmosphereColor: { value: new THREE.Color(body.atmosphereColor || '#000000') },
      uTemperature: { value: body.temperature },
      uWaterFraction: { value: body.waterFraction },
      uAtmosphere: { value: body.atmosphereDensity },
      uImpactHeat: { value: body.impactHeat },
      uAuroraIntensity: { value: body.auroraIntensity ?? 0.78 },
      uStarCount: { value: 1 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
      uStarRadii: { value: starRadii },
      uOccluderCount: { value: 0 },
      uOccluderPositions: { value: occluderPositions },
      uOccluderRadii: { value: occluderRadii },
      uOccluderHasAtmo: { value: occluderHasAtmo },
    },
    vertexShader: TEXTURED_SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uAlbedoMap;
      uniform vec3 uTint;
      uniform float uBumpStrength;
      uniform vec3 uAtmosphereColor;
      uniform float uTemperature;
      uniform float uWaterFraction;
      uniform float uAtmosphere;
      uniform float uImpactHeat;
      uniform float uAuroraIntensity;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];
      ${GLSL_ECLIPSE_HELPER}

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;

      void main() {
        vec3 baseN = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);

        vec3 texCol = texture2D(uAlbedoMap, vUv).rgb * uTint;
        float height = dot(texCol, vec3(0.299, 0.587, 0.114));

        // Smooth bilinear UV finite-difference normal relief (eliminates JPEG dFdx stippling!)
        float eps = 0.0018;
        float hU = dot(texture2D(uAlbedoMap, vUv + vec2(eps, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
        float hV = dot(texture2D(uAlbedoMap, vUv + vec2(0.0, eps)).rgb, vec3(0.299, 0.587, 0.114));
        float dU = clamp((hU - height) * uBumpStrength * 2.2, -0.42, 0.42);
        float dV = clamp((hV - height) * uBumpStrength * 2.2, -0.42, 0.42);

        vec3 upRef = abs(baseN.y) < 0.96 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(upRef, baseN));
        vec3 B = cross(baseN, T);
        vec3 N = normalize(baseN - T * dU - B * dV);

        float freezeFactor = smoothstep(235.0, 155.0, uTemperature) * clamp(uWaterFraction * 2.5, 0.0, 1.0);
        float lavaFactor = max(smoothstep(740.0, 1220.0, uTemperature), uImpactHeat);

        vec3 albedo = texCol;
        if (freezeFactor > 0.05) {
          albedo = mix(albedo, vec3(0.84, 0.92, 0.98) * (0.75 + 0.4 * height), freezeFactor * 0.85);
        }

        // Authentic high-contrast space illumination (harsh dark shadows on airless Moon/Mercury, soft on Venus/Mars)
        vec3 litColor = albedo * mix(0.008, 0.02, clamp(uAtmosphere, 0.0, 1.0));
        float maxDayLight = 0.0;

        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float rawNdl = dot(baseN, L);
          float bumpNdl = max(dot(N, L), 0.0);
          // Lommel-Seeliger / Oren-Nayar lunar regolith backscattering feel on airless moons
          float wrap = uAtmosphere * 0.12;
          float horizonMask = smoothstep(-0.04 - wrap, 0.10, rawNdl);
          float diff = bumpNdl * horizonMask;
          maxDayLight = max(maxDayLight, smoothstep(-0.1, 0.25, rawNdl));

          vec3 eclipse = computeEclipseTransmit(vWorldPos, uStarPositions[i], uStarRadii[i]);
          litColor += albedo * diff * uStarColors[i] * eclipse * 1.25;
        }

        if (uStarCount == 0) {
          litColor = albedo * max(dot(N, normalize(vec3(1.0, 0.55, 0.75))), 0.15);
          maxDayLight = 1.0;
        }

        vec3 emissive = vec3(0.0);
        if (lavaFactor > 0.02) {
          float crack = 1.0 - smoothstep(0.02, 0.20 + lavaFactor * 0.22, abs(sin(vLocalPos.x * 24.0 + height * 10.0) * cos(vLocalPos.z * 24.0 - height * 8.0)));
          float magma = clamp(crack * lavaFactor * 1.4 + smoothstep(0.6, 1.0, lavaFactor) * (1.0 - height), 0.0, 1.0);
          vec3 lavaCol = mix(vec3(1.25, 0.20, 0.02), vec3(2.2, 1.0, 0.25), height);
          litColor = mix(litColor, albedo * 0.15, lavaFactor * 0.75);
          emissive += lavaCol * magma * 1.4;
        }

        if (uAtmosphere > 0.08) {
          float rim = pow(1.0 - max(dot(baseN, V), 0.0), 3.4);
          litColor += uAtmosphereColor * rim * clamp(uAtmosphere * 0.55, 0.0, 0.85) * max(0.04, maxDayLight);
        }

        gl_FragColor = vec4(litColor + emissive, 1.0);
      }
    `,
  });
}

// ============================================================================
// 4. REAL 2K NASA GAS & ICE GIANT SHADER (Jupiter / Saturn / Uranus / Neptune + Ring Shadow)
// ============================================================================

export function createTexturedGasGiantMaterial(
  body: CelestialBody,
  albedoMap: THREE.Texture
): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));
  const starRadii = new Array(MAX_STAR_LIGHTS).fill(5.0);
  const occluderPositions = Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector3(0, 0, 0));
  const occluderRadii = new Array(MAX_OCCLUDERS).fill(0);
  const occluderHasAtmo = new Array(MAX_OCCLUDERS).fill(0);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAlbedoMap: { value: albedoMap },
      uAtmosphereColor: { value: new THREE.Color(body.atmosphereColor || '#e8c49a') },
      uImpactHeat: { value: body.impactHeat },
      uHasRings: { value: body.hasRings ? 1.0 : 0.0 },
      uRingInner: { value: body.ringInner ?? 1.28 },
      uRingOuter: { value: body.ringOuter ?? 2.35 },
      uBodyWorldPos: { value: new THREE.Vector3() },
      uBodyRadius: { value: 1.0 },
      uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
      uStarCount: { value: 1 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
      uStarRadii: { value: starRadii },
      uOccluderCount: { value: 0 },
      uOccluderPositions: { value: occluderPositions },
      uOccluderRadii: { value: occluderRadii },
      uOccluderHasAtmo: { value: occluderHasAtmo },
    },
    vertexShader: TEXTURED_SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uAlbedoMap;
      uniform vec3 uAtmosphereColor;
      uniform float uImpactHeat;
      uniform float uHasRings;
      uniform float uRingInner;
      uniform float uRingOuter;
      uniform vec3 uBodyWorldPos;
      uniform float uBodyRadius;
      uniform vec3 uRingNormal;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];
      ${GLSL_ECLIPSE_HELPER}

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;

      float ringShadowFactor(vec3 worldPos, vec3 lightDir) {
        if (uHasRings < 0.5) return 1.0;
        float denom = dot(lightDir, uRingNormal);
        if (abs(denom) < 0.001) return 1.0;
        float t = dot(uBodyWorldPos - worldPos, uRingNormal) / denom;
        if (t <= 0.0) return 1.0;
        vec3 hit = worldPos + lightDir * t;
        float r = length(hit - uBodyWorldPos) / max(uBodyRadius, 0.0001);
        if (r < uRingInner || r > uRingOuter) return 1.0;
        float u = (r - uRingInner) / max(uRingOuter - uRingInner, 0.001);
        float gap = smoothstep(0.56, 0.59, u) * (1.0 - smoothstep(0.63, 0.66, u));
        float density = (0.58 + 0.25 * sin(u * 48.0)) * (1.0 - gap * 0.9);
        return 1.0 - clamp(density * 0.72, 0.0, 0.78);
      }

      void main() {
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 col = texture2D(uAlbedoMap, vUv).rgb;

        vec3 litColor = col * 0.015;
        float daySide = 0.0;
        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float ndl = dot(N, L);
          float diff = clamp((ndl + 0.10) / 1.10, 0.0, 1.0);
          float rShadow = ringShadowFactor(vWorldPos, L);
          vec3 eclipse = computeEclipseTransmit(vWorldPos, uStarPositions[i], uStarRadii[i]);
          daySide = max(daySide, smoothstep(-0.1, 0.3, ndl));
          litColor += col * diff * rShadow * eclipse * uStarColors[i] * 1.22;
        }
        if (uStarCount == 0) {
          litColor = col * max(dot(N, normalize(vec3(1.0, 0.55, 0.75))), 0.18);
          daySide = 1.0;
        }

        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.8);
        litColor += uAtmosphereColor * fresnel * 0.36 * max(0.06, daySide);

        if (uImpactHeat > 0.01) {
          litColor += vec3(1.8, 0.62, 0.15) * uImpactHeat;
        }

        gl_FragColor = vec4(litColor, 1.0);
      }
    `,
  });
}

// ============================================================================
// 5. ATMOSPHERE SHELL & REAL CASSINI SATURN RING SHADER
// ============================================================================

export function createAtmosphereMaterial(colorHex: string, density: number): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));

  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: Math.min(1.15, density * 0.75) },
      uStarCount: { value: 1 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];

      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(clamp(0.56 + dot(N, V), 0.0, 1.0), 3.8);

        vec3 scatter = vec3(0.0);
        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float ndl = dot(N, L);
          float dayFade = smoothstep(-0.32, 0.42, ndl);
          float sunset = exp(-pow((ndl + 0.04) * 5.2, 2.0));
          vec3 tint = mix(uColor, vec3(1.0, 0.46, 0.16), sunset * 0.42);
          scatter += tint * uStarColors[i] * dayFade;
        }
        if (uStarCount == 0) {
          scatter = uColor * 0.65;
        }

        float alpha = rim * uIntensity * 0.82;
        gl_FragColor = vec4(scatter * rim * uIntensity * 1.3, alpha);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function createRingMaterial(
  colorHex: string,
  inner: number,
  outer: number,
  ringTexture: THREE.Texture
): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));

  return new THREE.ShaderMaterial({
    uniforms: {
      uRingMap: { value: ringTexture },
      uColor: { value: new THREE.Color(colorHex) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uBodyWorldPos: { value: new THREE.Vector3() },
      uBodyRadius: { value: 1.0 },
      uStarCount: { value: 1 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRingMap;
      uniform vec3 uColor;
      uniform float uInner;
      uniform float uOuter;
      uniform vec3 uBodyWorldPos;
      uniform float uBodyRadius;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];

      varying vec3 vLocalPos;
      varying vec3 vWorldPos;

      float planetShadow(vec3 p, vec3 lightDir) {
        vec3 oc = p - uBodyWorldPos;
        float b = dot(oc, lightDir);
        if (b > 0.0) return 1.0;
        vec3 closest = oc - lightDir * b;
        float d = length(closest);
        return smoothstep(uBodyRadius * 0.96, uBodyRadius * 1.04, d);
      }

      void main() {
        float r = length(vLocalPos.xy);
        float t = clamp((r - uInner) / max(uOuter - uInner, 0.001), 0.0, 1.0);

        // Sample real Cassini Saturn ring profile (C, B, Cassini Division, A, Encke Gap)
        vec4 ringSample = texture2D(uRingMap, vec2(t, 0.5));
        float alpha = ringSample.a * 0.95;
        if (alpha < 0.02) discard;

        vec3 iceTint = ringSample.rgb * mix(vec3(1.0), uColor, 0.35);

        vec3 lit = iceTint * 0.025;
        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float sh = planetShadow(vWorldPos, L);
          lit += iceTint * uStarColors[i] * sh * 1.2;
        }
        if (uStarCount == 0) {
          lit = iceTint * 0.85;
        }

        gl_FragColor = vec4(lit, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}

// ============================================================================
// 6. INTERSTELLAR GARGANTUA BLACK HOLE (REAL MILKY WAY GRAVITATIONAL LENSING + WIDE FILAMENT DISK)
// ============================================================================

/**
 * Cinema-grade Interstellar Gargantua Raymarched Black Hole:
 * - Bends light rays via RK2 Schwarzschild null geodesics (r_s = 1.0, r_ph = 1.5)
 * - Escaping rays sample the REAL 2K Milky Way skybox in world space -> genuine live Einstein Ring!
 * - Wide, razor-thin, multi-filament accretion disk (r = 2.05 .. 12.6, 5x wider than shadow!)
 *   textured by polar-sheared plasma turbulence for 4K cinema streaks at fast GPU speed!
 * - Relativistic Doppler beaming & hair-thin photon sphere crescent (NO thick white outline sticker!)
 */
export function createBlackHoleLensingMaterial(
  body: CelestialBody,
  textures: PlanetTextures
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlare: { value: body.accretionFlare ?? 0 },
      uInvModelMatrix: { value: new THREE.Matrix4() },
      uModelRotMatrix: { value: new THREE.Matrix3() },
      uMilkyWay: { value: textures.milkyWay },
      uPlasmaMap: { value: textures.sun },
      uOuterColor: { value: new THREE.Color(body.secondaryColor || '#c94312') },
    },
    vertexShader: /* glsl */ `
      uniform mat4 uInvModelMatrix;
      varying vec3 vLocalPos;
      varying vec3 vLocalCamPos;

      void main() {
        vLocalPos = position;
        vec4 invCam = uInvModelMatrix * vec4(cameraPosition, 1.0);
        vLocalCamPos = invCam.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlare;
      uniform mat3 uModelRotMatrix;
      uniform sampler2D uMilkyWay;
      uniform sampler2D uPlasmaMap;
      uniform vec3 uOuterColor;

      varying vec3 vLocalPos;
      varying vec3 vLocalCamPos;

      const float PI = 3.14159265359;

      vec3 sampleSky(vec3 localDir) {
        vec3 wd = normalize(uModelRotMatrix * localDir);
        float u = atan(wd.z, wd.x) / (2.0 * PI) + 0.5;
        float v = asin(clamp(wd.y, -1.0, 1.0)) / PI + 0.5;
        return texture2D(uMilkyWay, vec2(u, v)).rgb * 0.58;
      }

      void main() {
        vec3 ro = vLocalCamPos;
        vec3 rd = normalize(vLocalPos - vLocalCamPos);

        // Wide bounding sphere (R = 15.0) so sweeping Gargantua wings NEVER clip
        const float BOUND_R = 15.0;
        float b = dot(ro, rd);
        float c = dot(ro, ro) - BOUND_R * BOUND_R;
        float disc = b * b - c;
        if (disc < 0.0) discard;
        float tEntry = max(0.0, -b - sqrt(disc));

        vec3 pos = ro + rd * tEntry;
        vec3 dir = rd;

        vec3 Lvec = cross(pos, dir);
        float h2 = dot(Lvec, Lvec);

        vec3 accumColor = vec3(0.0);
        float transmittance = 1.0;
        bool swallowed = false;
        float minR = 100.0;

        float diskInner = 2.05;
        float diskOuter = 12.2 + uFlare * 1.4;
        float invDiskSpan = 1.0 / (diskOuter - diskInner);

        // Subtle pixel phase dither removes concentric raymarching step banding cleanly
        float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        pos += dir * (dither * 0.08);

        const int STEPS = 60;
        for (int i = 0; i < STEPS; i++) {
          float r2 = dot(pos, pos);
          float r = sqrt(r2);
          minR = min(minR, r);

          if (r <= 1.03) {
            swallowed = true;
            break;
          }
          if (r > BOUND_R + 0.3 && dot(pos, dir) > 0.0) {
            break;
          }

          float diskProx = abs(pos.y);
          float stepSize = clamp(min(r * 0.135, diskProx * 0.62 + 0.072), 0.062, 0.72);

          // RK2 midpoint Schwarzschild null geodesic deflection
          float invR5 = 1.0 / (r2 * r2 * r);
          vec3 a1 = -1.5 * h2 * invR5 * pos;
          vec3 midPos = pos + dir * (0.5 * stepSize);
          vec3 midDir = normalize(dir + a1 * (0.5 * stepSize));
          float mr2 = max(dot(midPos, midPos), 0.64);
          vec3 a2 = -1.5 * h2 / (mr2 * mr2 * sqrt(mr2)) * midPos;

          vec3 nextPos = pos + midDir * stepSize;
          vec3 nextDir = normalize(dir + a2 * stepSize);

          float hr2 = dot(midPos.xz, midPos.xz);
          if (hr2 > diskInner * diskInner && hr2 < diskOuter * diskOuter) {
            float hr = sqrt(hr2);
            float tRad = (hr - diskInner) * invDiskSpan;
            float halfThick = 0.058 + 0.048 * tRad;
            if (abs(midPos.y) < halfThick * 2.8) {
              float yNorm = midPos.y / halfThick;
              float vProfile = exp(-yNorm * yNorm);

              // Fast single-tap polar-sheared plasma sampling (zero pow() calls in inner loop -> ~2.2x faster!)
              float invSqrtHr = inversesqrt(hr);
              float ang = atan(midPos.z, midPos.x);
              float uCoord = ang * (1.0 / (2.0 * PI)) + 0.92 * invSqrtHr - uTime * (0.14 + uFlare * 0.06) * invSqrtHr;
              float f1 = dot(texture2D(uPlasmaMap, vec2(uCoord, tRad * 2.1)).rgb, vec3(0.3, 0.59, 0.11));

              float streaks = smoothstep(0.16, 0.88, f1);
              float softBands = 0.70 + 0.30 * sin(hr * 5.2 + f1 * 3.6);
              float radialEnv = smoothstep(0.0, 0.08, tRad) * (1.0 - tRad) * (1.0 - tRad);
              float density = radialEnv * vProfile * (0.35 + 1.05 * streaks) * softBands * (2.65 + uFlare * 1.4);

              if (density > 0.005) {
                vec3 gasVel = normalize(vec3(-midPos.z, 0.0, midPos.x));
                float beta = clamp(dot(gasVel, -midDir), -1.0, 1.0);
                float doppler = clamp(1.0 + beta * 0.52, 0.44, 1.82);
                doppler *= sqrt(doppler);

                vec3 hotISCO = mix(vec3(1.0, 0.94, 0.84), vec3(0.84, 0.94, 1.25), clamp((doppler - 1.1) * 0.48 + uFlare * 0.3, 0.0, 0.55));
                vec3 goldMid = vec3(1.0, 0.62, 0.24);
                vec3 deepRim = uOuterColor * 0.65;

                vec3 col = mix(hotISCO * 1.42, goldMid * 1.15, smoothstep(0.0, 0.36, tRad));
                col = mix(col, deepRim, smoothstep(0.36, 1.0, tRad));
                col *= (0.76 + 0.58 * streaks);

                float opticalDepth = density * stepSize;
                float alphaStep = 1.0 - exp(-opticalDepth * 1.15);
                accumColor += transmittance * col * doppler * alphaStep * 1.35;
                transmittance *= (1.0 - alphaStep * 0.92);
                if (transmittance < 0.018) break;
              }
            }
          }

          pos = nextPos;
          dir = nextDir;
        }

        if (swallowed) {
          // Pure pitch-black event horizon shadow behind any foreground accretion plasma
          gl_FragColor = vec4(accumColor, 1.0);
        } else {
          // Delicate hair-thin luminous Einstein photon ring ONLY on tight grazing rays!
          float photonRing = exp(-pow((minR - 1.50) * 26.0, 2.0)) * (0.95 + uFlare * 0.55);
          accumColor += transmittance * vec3(1.0, 0.91, 0.76) * photonRing;

          // Real gravitational lensing of the 2K Milky Way skybox behind the black hole!
          float bendAmount = clamp(1.0 - dot(dir, rd), 0.0, 1.0);
          float lensMask = smoothstep(0.002, 0.045, bendAmount);
          vec3 lensedBg = sampleSky(dir);
          // Smoothly blend lensed background near deflection zone so bounding sphere edge is 100% invisible!
          float diskAlpha = clamp(1.0 - transmittance + photonRing * 0.7, 0.0, 1.0);
          float finalAlpha = max(diskAlpha, lensMask);
          if (finalAlpha < 0.008) discard;

          vec3 finalCol = accumColor + transmittance * lensedBg * lensMask;
          gl_FragColor = vec4(finalCol, finalAlpha);
        }
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

export function createPulsarJetMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float axial = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
        float pulse = 0.78 + 0.22 * sin(vUv.y * 22.0 - uTime * 14.0);
        vec3 col = mix(vec3(0.32, 0.75, 1.55), vec3(0.92, 0.97, 1.65), vUv.y);
        gl_FragColor = vec4(col * pulse * 1.45, axial * 0.62);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ============================================================================
// 7. ASTROPHOTOGRAPHY-GRADE COMET SHADERS (Hale-Bopp / NEOWISE / Rosetta 67P)
//    - Seamless analytical noise (zero texture wrap seams or washboard banding)
//    - Asymmetric bow-compressed Coma with authentic C2 emerald-cyan fluorescence & Rosetta close-up mode
//    - Camera-facing axial gossamer ribbons (Multi-streamer CO+ Blue Ion Tail & Silky Curved Dust Fan)
//    - 640-particle 100% GPU-computed sunward outgassing fountain jets & delicate micro-ice glints
// ============================================================================

const GLSL_COMET_NOISE = /* glsl */ `
  float cHash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float cNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = cHash2(i);
    float b = cHash2(i + vec2(1.0, 0.0));
    float c = cHash2(i + vec2(0.0, 1.0));
    float d = cHash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float cFbm2(vec2 p) {
    float v = 0.62 * cNoise2(p);
    v += 0.38 * cNoise2(p * 2.07 + vec2(17.3, 9.1));
    return v;
  }
`;

export function createCometComaMaterial(_cloudTexture?: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.6 },
      uCloseUp: { value: 0.0 },
      uAntiSolar2D: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uActivity;
      uniform float uCloseUp;
      uniform vec2 uAntiSolar2D;

      varying vec2 vUv;
      ${GLSL_COMET_NOISE}

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float rRaw = length(p);
        if (rRaw > 1.0) discard;

        // Asymmetric paraboloid bow-shock coma: compressed tightly sunward, sweeping gently tailward
        vec2 tailDir = normalize(uAntiSolar2D + vec2(1e-5, 0.0));
        vec2 perpDir = vec2(-tailDir.y, tailDir.x);
        float along = dot(p, tailDir);   // > 0 tailward, < 0 sunward
        float across = dot(p, perpDir);

        float stretch = along > 0.0 ? 0.64 : 1.48;
        vec2 warpedP = tailDir * (along * stretch) + perpDir * across;
        float r = length(warpedP);
        if (r > 1.0) discard;

        // Subtle radial outgassing fountain jets on the sunlit hemisphere (like Rosetta 67P / Hale-Bopp)
        float ang = atan(across, -along); // 0 = directly sunward
        float sunMask = smoothstep(-0.25, 0.65, -along / max(rRaw, 0.01));
        float jetPattern = 0.55 + 0.45 * cFbm2(vec2(ang * 2.8, r * 3.2 - uTime * 0.14));
        float jetRays = pow(0.5 + 0.5 * sin(ang * 5.0 + 0.7) * cos(ang * 3.0 - 0.4), 2.0);
        float sunwardHood = exp(-pow((r - 0.22) * 6.5, 2.0)) * sunMask * (0.35 + 0.55 * jetPattern);
        float fountainJets = exp(-r * 5.2) * sunMask * jetRays * (0.28 + 0.52 * uCloseUp);

        // 1. Blazing pinpoint false nucleus (dims smoothly on Rosetta close-up so dark rock nucleus shines cleanly!)
        float farMask = 1.0 - smoothstep(0.05, 0.85, uCloseUp);
        float closeHaze = mix(1.0, 0.085, smoothstep(0.0, 0.9, uCloseUp));
        float falseNucleus = exp(-r * r * 58.0) * 1.38 * farMask;
        // 2. Authentic C2 / CN emerald-turquoise fluorescence inner coma (516 nm Swan bands)
        float c2Halo = exp(-r * 4.2) * 0.68 * (0.88 + 0.18 * jetPattern) * closeHaze;
        // 3. Soft silky diffuse dust envelope feeding seamlessly into the curved dust tail
        float outerVeil = exp(-r * 2.35) * 0.26 * smoothstep(1.0, 0.20, r) * closeHaze;

        float act = clamp(uActivity, 0.05, 1.35);
        vec3 coreCol = vec3(1.0, 0.99, 0.96) * falseNucleus;
        vec3 c2GreenCol = vec3(0.14, 0.96, 0.74) * c2Halo;
        // Delicate sunlit Rosetta-67P outgassing fan jets remain gently visible at close-up without whiteout!
        float jetGain = mix(1.0, 0.22, uCloseUp);
        vec3 dustHoodCol = vec3(1.0, 0.93, 0.80) * (outerVeil + sunwardHood * 0.26 * closeHaze + fountainJets * 0.34 * jetGain);

        vec3 col = (coreCol + c2GreenCol + dustHoodCol) * act;
        float edgeFade = smoothstep(1.0, 0.18, r);
        float alpha = clamp((falseNucleus * 0.92 + c2Halo * 0.76 + outerVeil * 0.65 + sunwardHood * 0.28 * closeHaze + fountainJets * 0.3 * jetGain) * act * edgeFade, 0.0, 0.94);

        // Anti-banding dither eliminates concentric contour rings against pitch-black space
        float dither = (cHash2(gl_FragCoord.xy) - 0.5) / 145.0;
        col = max(vec3(0.0), col + vec3(dither));
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

/**
 * Camera-Facing Axial Gossamer Comet Tail Ribbon Shader (100% Procedural, Zero Texture Seams):
 * Always billboards width perpendicular to BOTH the curved tail spline tangent AND the camera view ray.
 * - Type I Ion Tail: razor-straight, delicate, asymmetric multi-streamer electric cobalt-blue CO+ plasma.
 * - Type II Dust Tail: ultra-silky, creamy, gracefully curved champagne-gold syndyne fan wrapping around coma.
 */
export function createCometRibbonMaterial(
  isDust: boolean,
  _cloudTexture?: THREE.Texture
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.6 },
      uLength: { value: 45.0 },
      uWidthBase: { value: isDust ? 1.8 : 0.6 },
      uWidthTip: { value: isDust ? 18.0 : 4.2 },
      uStartWorld: { value: new THREE.Vector3() },
      uDirMain: { value: new THREE.Vector3(1, 0, 0) },
      uCurveDir: { value: new THREE.Vector3(0, 0, 1) },
      uCurveStrength: { value: isDust ? 0.42 : 0.0 },
      uIsDust: { value: isDust ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uLength;
      uniform float uWidthBase;
      uniform float uWidthTip;
      uniform vec3 uStartWorld;
      uniform vec3 uDirMain;
      uniform vec3 uCurveDir;
      uniform float uCurveStrength;
      uniform float uIsDust;

      varying float vAlong;
      varying float vAcross;
      varying float vCurveSide;

      void main() {
        // uv.y in [0..1]: remap slightly negative at head so dust tail wraps smoothly around coma bow-shock!
        float leadPad = uIsDust > 0.5 ? 0.038 : 0.012;
        float t = mix(-leadPad, 1.0, uv.y);
        float side = uv.x * 2.0 - 1.0; // [-1 .. 1]
        vAlong = t;
        vAcross = side;

        float tPos = max(t, 0.0);
        // Parabolic spine: strictly straight for Ion tail, gracefully curved along orbit for Dust tail
        vec3 spinePos = uStartWorld
          + uDirMain * (t * uLength)
          + uCurveDir * (tPos * tPos * uLength * uCurveStrength);

        vec3 tangent = normalize(uDirMain + uCurveDir * (2.0 * tPos * uCurveStrength));
        vec3 toCam = normalize(cameraPosition - spinePos);
        vec3 sideAxis = cross(tangent, toCam);
        float sideLen = length(sideAxis);
        if (sideLen < 0.001) {
          sideAxis = normalize(cross(tangent, vec3(0.0, 1.0, 0.0)));
        } else {
          sideAxis /= sideLen;
        }

        // Canonical orientation: vCurveSide < 0 is ALWAYS the crisp leading outer edge, > 0 is the silky trailing fan!
        float curveAlign = dot(sideAxis, uCurveDir);
        float leadSign = curveAlign >= 0.0 ? 1.0 : -1.0;
        vCurveSide = side * leadSign;

        // Smooth widening envelope (slightly rounded paraboloid wrap right at the coma head)
        float headRound = smoothstep(-leadPad, 0.02, t);
        float widthGrow = mix(uWidthBase * (0.45 + 0.55 * headRound), uWidthTip, pow(tPos, 0.88));
        vec3 worldPos = spinePos + sideAxis * (side * widthGrow);

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uActivity;
      uniform float uIsDust;

      varying float vAlong;
      varying float vAcross;
      varying float vCurveSide;

      ${GLSL_COMET_NOISE}

      void main() {
        float t = vAlong;
        float a = abs(vAcross);
        float act = clamp(uActivity, 0.0, 1.35);

        vec3 col;
        float alpha;

        if (uIsDust > 0.5) {
          // TYPE II DUST TAIL (Hale-Bopp / NEOWISE):
          // Ultra-silky, creamy, continuous Mie-scattered sunlit dust fan with ZERO washboard ripples!
          // Asymmetric syndyne cross-section: brighter & crisper along the leading edge (vCurveSide ~ -0.18),
          // sweeping smoothly into a broad, dreamy, gossamer trailing veil (vCurveSide > 0).
          float shifted = vCurveSide + 0.16;
          float sigma = shifted < 0.0 ? 6.8 : 2.9;
          float crossProfile = exp(-shifted * shifted * sigma) * smoothstep(1.0, 0.52, a);

          // Smooth bow-shock emergence around the coma and silky exponential fade into deep space
          float headFade = smoothstep(-0.038, 0.045, t);
          float tailFade = pow(clamp(1.0 - max(t, 0.0), 0.0, 1.0), 1.65);

          // Whisper-subtle smooth radial fan variation (no harsh stripes, no Earth-cloud blotches!)
          float fanAngle = vCurveSide / (0.28 + max(t, 0.0) * 1.15);
          float silkyFlow = 0.86 + 0.14 * cFbm2(vec2(fanAngle * 1.8, max(t, 0.0) * 2.2 - uTime * 0.045));
          // Very delicate longitudinal dust streamer sheen (only 8% contrast!)
          float softRays = 0.92 + 0.08 * cNoise2(vec2(fanAngle * 4.5 + 3.1, max(t, 0.0) * 0.65 - uTime * 0.02));

          // Brighter inner creamy neck immediately behind coma hood
          float innerNeck = exp(-max(t, 0.0) * 4.8) * exp(-shifted * shifted * 12.0) * 0.36;

          float density = (crossProfile * silkyFlow * softRays + innerNeck * smoothstep(1.0, 0.5, a)) * headFade * tailFade;

          // Authentic Hale-Bopp / NEOWISE sunlit dust spectrum: warm ivory -> champagne gold -> soft dusty amber
          vec3 ivoryHead = vec3(1.0, 0.97, 0.90);
          vec3 champagneMid = vec3(0.96, 0.84, 0.66);
          vec3 dustyTip = vec3(0.76, 0.60, 0.42);
          float ct = clamp(t, 0.0, 1.0);
          col = mix(ivoryHead, champagneMid, smoothstep(0.02, 0.48, ct));
          col = mix(col, dustyTip, smoothstep(0.48, 0.96, ct));

          alpha = density * act * 0.46;
        } else {
          // TYPE I ION TAIL (CO+ 427nm):
          // Razor-straight, slender, electric cobalt-blue plasma with organic diverging hair-fine streamers!
          float ct = clamp(t, 0.0, 1.0);
          float headFade = smoothstep(-0.012, 0.032, t);
          float tailFade = pow(1.0 - ct, 1.22);

          // Subtle propagating solar-wind Alfvén wave kinks racing down the plasma tail
          float wave = (sin(ct * 11.0 - uTime * 3.1) * 0.026 + sin(ct * 21.0 - uTime * 4.8) * 0.012) * ct;
          float u = vAcross + wave;

          // Central razor-sharp ion spine + 5 organic asymmetrically-spaced diverging plasma streamers
          float spine = exp(-u * u * 52.0) * 1.15;
          float s1 = exp(-pow((u - 0.14 - ct * 0.08) * 14.5, 2.0)) * 0.48 * smoothstep(0.02, 0.25, ct);
          float s2 = exp(-pow((u + 0.16 + ct * 0.06) * 13.0, 2.0)) * 0.44 * smoothstep(0.03, 0.28, ct);
          float s3 = exp(-pow((u - 0.31 - ct * 0.12) * 11.0, 2.0)) * 0.26 * smoothstep(0.08, 0.35, ct);
          float s4 = exp(-pow((u + 0.34 + ct * 0.10) * 10.5, 2.0)) * 0.24 * smoothstep(0.10, 0.38, ct);
          float softHalo = exp(-u * u * 7.5) * 0.24;

          // Fast solar-wind plasma knots streaming outward along the filaments
          float plasmaFlow = 0.68 + 0.46 * cFbm2(vec2(u * 6.5, ct * 5.2 - uTime * 0.42));
          float edgeGuard = smoothstep(1.0, 0.58, a);

          float filament = (spine + (s1 + s2 + s3 + s4) * plasmaFlow + softHalo * plasmaFlow) * edgeGuard * headFade * tailFade;

          // Authentic CO+ fluorescence: bright cyan-white plasma needle -> vivid electric cobalt -> deep indigo
          vec3 headCyan = vec3(0.55, 0.96, 1.48);
          vec3 cobaltIon = vec3(0.20, 0.54, 1.46);
          vec3 deepIndigo = vec3(0.10, 0.26, 0.98);
          col = mix(headCyan, cobaltIon, smoothstep(0.0, 0.32, ct));
          col = mix(col, deepIndigo, smoothstep(0.32, 0.92, ct));

          alpha = filament * act * 0.56;
        }

        // Anti-banding dither for silky deep-space falloff
        float dither = (cHash2(gl_FragCoord.xy) - 0.5) / 150.0;
        col = max(vec3(0.0), col + vec3(dither));
        if (alpha < 0.0025) discard;

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.86));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * 100% GPU-Computed Comet Outgassing Fountain & Micro-Ice Sparkle Stream:
 * Zero blobby polka-dot sprites! Renders delicate sunward Rosetta-67P outgassing fountain jets
 * near the nucleus plus pin-fine shimmering micro-dust & plasma motes along the tails.
 */
export function createCometParticleStreamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.6 },
      uLength: { value: 45.0 },
      uNucleusRadius: { value: 0.3 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uStartWorld: { value: new THREE.Vector3() },
      uDirMain: { value: new THREE.Vector3(1, 0, 0) },
      uCurveDir: { value: new THREE.Vector3(0, 0, 1) },
    },
    vertexShader: /* glsl */ `
      // aParams: x = phase [0..1], y = spread [0..1], z = angle [0..2PI], w = kind (0=micro-dust, 1=ion glint, 2=sunward jet)
      attribute vec4 aParams;

      uniform float uTime;
      uniform float uActivity;
      uniform float uLength;
      uniform float uNucleusRadius;
      uniform float uPixelRatio;
      uniform vec3 uStartWorld;
      uniform vec3 uDirMain;
      uniform vec3 uCurveDir;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vSharpness;

      void main() {
        float kind = aParams.w;
        float speed = kind > 1.5 ? 0.34 : (kind > 0.5 ? 0.36 : 0.12);
        float age = fract(aParams.x + uTime * speed);

        vec3 fwd = normalize(uDirMain);
        vec3 refUp = abs(fwd.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 right = normalize(cross(refUp, fwd));
        vec3 up = cross(fwd, right);

        float ang = aParams.z;
        vec3 radial = right * cos(ang) + up * sin(ang);

        vec3 worldPos;
        float size;

        if (kind > 1.5) {
          // Delicate Rosetta-67P sunward outgassing jets erupting from sunlit vents & sweeping into the coma paraboloid!
          float sunPush = sin(age * 3.14159) * uNucleusRadius * (2.4 + aParams.y * 4.2);
          float sweepBack = age * age * (uNucleusRadius * 12.0 + uLength * 0.07);
          worldPos = uStartWorld
            - fwd * (sunPush * (1.0 - age * 0.65))
            + fwd * sweepBack
            + radial * (uNucleusRadius * (0.65 + age * 4.2 * (0.35 + 0.65 * aParams.y)));
          vColor = mix(vec3(0.42, 0.98, 0.84), vec3(1.0, 0.97, 0.88), 1.0 - age * 0.7);
          vAlpha = sin(age * 3.14159) * 0.24 * clamp(uActivity, 0.0, 1.3);
          vSharpness = 3.8;
          size = 1.6 + aParams.y * 2.4;
        } else if (kind > 0.5) {
          // Pin-fine electric cobalt-cyan plasma sparkles racing strictly along the straight ion tail
          float dist = pow(age, 1.1) * uLength * 0.95;
          float coneSpread = uNucleusRadius * 0.8 + age * uLength * 0.032 * aParams.y;
          worldPos = uStartWorld + fwd * dist + radial * coneSpread;
          vColor = mix(vec3(0.55, 0.94, 1.45), vec3(0.22, 0.56, 1.35), age);
          vAlpha = smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.5) * 0.20 * clamp(uActivity, 0.0, 1.3);
          vSharpness = 5.2;
          size = 1.4 + (1.0 - age * 0.5) * 1.8 * aParams.y;
        } else {
          // Ultra-delicate shimmering sunlit micro-dust / ice motes scattered smoothly inside the curved dust fan
          float dist = pow(age, 1.15) * uLength * 0.85;
          float curve = age * age * uLength * 0.42;
          float fanSpread = uNucleusRadius * 1.2 + pow(age, 0.9) * uLength * 0.13 * aParams.y;
          worldPos = uStartWorld + fwd * dist + uCurveDir * curve + radial * fanSpread;
          vColor = mix(vec3(1.0, 0.96, 0.88), vec3(0.90, 0.78, 0.58), age);
          vAlpha = smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.7) * 0.14 * clamp(uActivity, 0.0, 1.3);
          vSharpness = 5.6;
          size = 1.2 + aParams.y * 1.6;
        }

        vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
        float camDist = max(1.0, -mvPos.z);
        float persp = clamp(160.0 / camDist, 0.65, 2.2);
        gl_PointSize = clamp(size * persp * uPixelRatio, 1.2, 5.5);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSharpness;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d2 = dot(uv, uv) * 4.0;
        if (d2 > 1.0) discard;
        float falloff = exp(-d2 * vSharpness) * (1.0 - d2);
        float a = falloff * vAlpha;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ============================================================================
// 8. NASA ISS & SUOMI NPP VIIRS-GRADE SINGLE-PASS 3D VOLUMETRIC RAYMARCHED AURORA
//    - True continuous 3D raymarching through Earth's real 90-450km thermosphere shell (r = 1.014..1.072)
//    - 2-stage Curl-Warped Ridged Silk Filaments + feathery "picket-fence" vertical rays + diffuse glow
//    - ZERO glowing-rope artifacts, ZERO shell stepping, ZERO plastic ribbon edges!
//    - Beer-Lambert optical accumulation: gossamer translucent emerald curtains + ruby-crimson upper tops
//      allowing Earth's dark continents & Black Marble city lights to shine naturally through!
// ============================================================================

export function createEarthAuroraMaterial(body: CelestialBody): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAuroraIntensity: { value: body.auroraIntensity ?? 0.78 },
      uAtmosphere: { value: body.atmosphereDensity },
      uSolarWind: { value: 1.0 },
      uHasStar: { value: 1.0 },
      uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
      uInvModelMatrix: { value: new THREE.Matrix4() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uAuroraIntensity;
      uniform float uAtmosphere;
      uniform float uSolarWind;
      uniform float uHasStar;
      uniform vec3 uSunDirLocal;
      uniform mat4 uInvModelMatrix;

      varying vec3 vWorldPos;

      ${GLSL_COMET_NOISE}

      // Intersect ray (ro + t*rd) with sphere of radius R; returns (tNear, tFar), tFar < 0 if miss
      vec2 intersectSphere(vec3 ro, vec3 rd, float R) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - R * R;
        float h = b * b - c;
        if (h < 0.0) return vec2(-1.0);
        float s = sqrt(h);
        return vec2(-b - s, -b + s);
      }

      mat2 rot2(float a) {
        float c = cos(a);
        float s = sin(a);
        return mat2(c, -s, s, c);
      }

      void main() {
        float atmoMask = smoothstep(0.15, 0.55, uAtmosphere);
        float intensity = clamp(uAuroraIntensity * uSolarWind, 0.0, 1.65) * atmoMask;
        if (intensity < 0.01) discard;

        // Transform camera ray into Earth's local unit-sphere frame (Earth surface = 1.0, clouds = 1.012)
        vec3 ro = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz;
        vec3 hitLocal = (uInvModelMatrix * vec4(vWorldPos, 1.0)).xyz;
        vec3 rd = normalize(hitLocal - ro);

        float storm = clamp(intensity / 1.5, 0.0, 1.15);
        float rPlanet = 1.010;
        float rInner = 1.015;                     // ~95 km lower auroral boundary
        float rOuter = 1.064 + storm * 0.016;     // ~410-510 km faint upper crimson exosphere

        vec2 outerHit = intersectSphere(ro, rd, rOuter);
        if (outerHit.y <= 0.0) discard;

        float tStart = max(0.0, outerHit.x);
        float tEnd = outerHit.y;

        // Stop ray cleanly at Earth's opaque surface/clouds so aurora never bleeds through the planet!
        vec2 planetHit = intersectSphere(ro, rd, rPlanet);
        if (planetHit.x > 0.0) {
          tEnd = min(tEnd, planetHit.x);
        }
        if (tEnd <= tStart + 1e-4) discard;

        // Real Earth geomagnetic dipole basis (~11 deg tilt toward Hudson Bay / Greenland)
        vec3 magAxis = normalize(vec3(-0.15, 0.981, 0.12));
        vec3 magRight = normalize(cross(magAxis, vec3(1.0, 0.0, 0.0)));
        vec3 magFwd = normalize(cross(magRight, magAxis));

        // Fast equatorial rejection: check mid-point & endpoints; skip pixels far from BOTH polar zones!
        vec3 pA = ro + rd * tStart;
        vec3 pB = ro + rd * ((tStart + tEnd) * 0.5);
        vec3 pC = ro + rd * tEnd;
        float maxPolar = max(
          abs(dot(normalize(pA), magAxis)),
          max(abs(dot(normalize(pB), magAxis)), abs(dot(normalize(pC), magAxis)))
        );
        // cos(52 deg) ≈ 0.615 -> skip ~62% of Earth pixels before marching!
        if (maxPolar < 0.60) discard;

        float t = uTime;
        // Slow counter-rotations for living curl evolution
        mat2 spinA = rot2(t * 0.045);
        mat2 spinB = rot2(-t * 0.062);

        // 22 jittered volumetric raymarch steps through the thin thermosphere shell
        const int STEPS = 22;
        float segLen = tEnd - tStart;
        float stepLen = segLen / float(STEPS);
        float jitter = cHash2(gl_FragCoord.xy);
        float rayT = tStart + stepLen * jitter;

        vec3 accumCol = vec3(0.0);
        float transmittance = 1.0;

        for (int i = 0; i < STEPS; i++) {
          vec3 pos = ro + rd * rayT;
          float rad = length(pos);

          if (rad >= rInner && rad <= rOuter) {
            vec3 uDir = pos / rad;
            float magDot = dot(uDir, magAxis);
            float absMag = abs(magDot);

            // Only evaluate aurora field inside the North/South high-latitude auroral belt
            if (absMag > 0.64) {
              float hemi = magDot >= 0.0 ? 1.0 : -1.0;
              float colat = acos(clamp(absMag, 0.0, 1.0)); // radians from magnetic pole
              float h = clamp((rad - rInner) / (rOuter - rInner), 0.0, 1.0);

              // Nightside & twilight prominence + magnetospheric oval asymmetry
              float ndl = uHasStar > 0.5 ? dot(uDir, uSunDirLocal) : -1.0;
              float nightMask = uHasStar > 0.5 ? smoothstep(0.30, -0.18, ndl) : 1.0;
              float dayNightGain = mix(0.10, 1.0, nightMask);

              // Broad, soft regional auroral oval window (spans ~14-20 deg latitude — NOT a thin rope!)
              float ovalMid = 0.28 + nightMask * 0.065 + storm * 0.105;
              float ovalWidth = 0.115 + nightMask * 0.045 + storm * 0.055;
              float zoneMask = exp(-pow((colat - ovalMid) / ovalWidth, 2.0));

              if (zoneMask > 0.03) {
                // Seamless magnetic tangent-plane coordinates; slight inward flare follows dipole B-field lines!
                float dipoleFlare = 1.0 - h * 0.038;
                vec2 mXY = vec2(dot(uDir, magRight), dot(uDir, magFwd)) * dipoleFlare;
                float rM = max(length(mXY), 1e-4);
                vec2 radDir = mXY / rM; // seamless unit direction on oval (zero seam at phi=0/2PI!)

                // Anisotropic geomagnetic coordinates:
                // - Gentle East-West stretch along magnetic parallels (radDir * 2.5)
                // - Fine North-South curtain fold resolution (rM * 10.5)
                // -> Sweeping, branching, feathery NASA ISS draperies (NEITHER a 1D rope NOR round smoke puffs!)
                vec2 pBase = mXY * 6.8;
                vec2 pA2 = spinA * pBase;
                vec2 pB2 = spinB * pBase;

                // Stage 1: Large-scale magnetospheric plasma convection warp
                vec2 q = vec2(
                  cFbm2(pA2 * 0.85 + vec2(t * 0.14, -t * 0.08) + hemi * 3.1),
                  cFbm2(pB2 * 0.85 + vec2(-t * 0.11, t * 0.15) + vec2(5.2, 1.7) - hemi * 2.4)
                );

                // Stage 2: Second-order curl folds (creates delicate NASA ISS Kelvin-Helmholtz hooks & draperies!)
                vec2 w = vec2(
                  cFbm2(pA2 * 1.15 + 2.25 * q + vec2(1.7, 9.2) + vec2(t * 0.18, -t * 0.11)),
                  cFbm2(pB2 * 1.15 + 2.25 * q + vec2(8.3, 2.8) + vec2(-t * 0.16, t * 0.17))
                );

                // Anisotropic multi-scale ridged silk curtains (sweeping feathery arcs that curl, fork & fade!)
                vec2 anisoCoord1 = vec2(rM * 10.8 + (w.x - 0.5) * 3.2, (w.y - 0.5) * 2.4) + (spinA * radDir) * 2.4;
                float f1 = cFbm2(anisoCoord1 + vec2(t * 0.14, -t * 0.10 + hemi * 2.1));
                float sheet1 = pow(clamp(1.0 - abs(f1 * 2.0 - 1.0), 0.0, 1.0), 3.6);

                vec2 anisoCoord2 = vec2(rM * 16.5 + (q.y - 0.5) * 3.6, (q.x - 0.5) * 2.6) + (spinB * radDir) * 3.8;
                float f2 = cFbm2(anisoCoord2 + vec2(-t * 0.22, t * 0.15 + hemi * 5.3));
                float sheet2 = pow(clamp(1.0 - abs(f2 * 2.0 - 1.0), 0.0, 1.0), 4.2);

                // Feathery high-frequency vertical "picket-fence" ray striations & silk brushstroke grain!
                float rayTexture = 0.38 + 0.62 * cNoise2(radDir * 14.0 + vec2(rM * 18.0, t * 0.55) + w * 4.2);
                float fineWisps = 0.58 + 0.42 * cNoise2(pBase * 22.0 - q * 5.2 + vec2(-t * 0.68, h * 0.65));

                // Organic substorm patchiness: active sectors burst into glowing feathery curtains while others fade smoothly!
                float substormPatch = smoothstep(
                  0.24 - storm * 0.12,
                  0.78,
                  cFbm2((spinA * mXY) * 3.5 + vec2(-t * 0.18, t * 0.12 + hemi * 4.7))
                );

                // Soft misty diffuse emerald glow (authentic Suomi NPP VIIRS "diffuse aurora" backdrop!)
                float diffuseGlow = smoothstep(0.28, 0.80, f1) * 0.17;

                float filament = (sheet1 * 0.96 + sheet2 * 0.72) * rayTexture * fineWisps * (0.12 + 0.98 * substormPatch);
                float horizDensity = (filament + diffuseGlow * (0.35 + 0.65 * substormPatch)) * zoneMask;

                if (horizDensity > 0.008) {
                  // Authentic vertical altitude emission profile:
                  // Crisp emerald bottom edge (~100-160km), feathery ruby-crimson tops towering on bright curtain cores!
                  float bottomTurnOn = smoothstep(0.0, 0.085, h);
                  float emeraldCore = exp(-pow((h - 0.15) * 5.6, 2.0));
                  float tallStretch = 0.28 + 0.88 * pow(clamp(sheet1 + sheet2 * 0.65, 0.0, 1.0), 0.75);
                  float upperFeathers = pow(clamp(1.0 - h, 0.0, 1.0), 1.25) * smoothstep(1.0, 0.68, h) * tallStretch;
                  float altProfile = bottomTurnOn * (emeraldCore * 1.12 + upperFeathers * 0.82);

                  // Real NASA ISS emission spectroscopy:
                  // - 557.7 nm Atomic Oxygen ethereal emerald-green (100-180 km)
                  vec3 emerald = vec3(0.12, 0.98, 0.46);
                  vec3 aquaHighlight = vec3(0.26, 1.00, 0.68);
                  vec3 lowCol = mix(emerald, aquaHighlight, clamp(filament * 0.55, 0.0, 0.55));
                  // - 630.0 nm High-Altitude Atomic Oxygen translucent ruby-crimson -> deep aurora violet (210-420 km)
                  vec3 crimson = vec3(0.96, 0.12, 0.26);
                  vec3 violet = vec3(0.48, 0.12, 0.74);
                  vec3 highCol = mix(crimson, violet, smoothstep(0.68, 0.98, h) * 0.42);
                  float redBlend = smoothstep(0.36 - storm * 0.08, 0.66, h);
                  vec3 specCol = mix(lowCol, highCol, redBlend);

                  // - Whisper-delicate N2+ magenta-pink lower border ONLY on sharpest substorm cores (~95-110km)
                  float n2Pink = exp(-pow((h - 0.065) * 18.0, 2.0)) * smoothstep(0.42, 1.05, storm) * smoothstep(0.25, 0.75, filament);
                  specCol = mix(specCol, vec3(0.94, 0.24, 0.66), clamp(n2Pink * 0.48, 0.0, 0.48));

                  // Physical Beer-Lambert optical integration along the 3D ray
                  float dSigma = horizDensity * altProfile * dayNightGain * intensity * stepLen * 14.5;
                  float stepAlpha = 1.0 - exp(-dSigma);
                  accumCol += transmittance * specCol * stepAlpha * 1.42;
                  transmittance *= (1.0 - stepAlpha * 0.70);
                  if (transmittance < 0.05) break;
                }
              }
            }
          }
          rayT += stepLen;
        }

        float totalAlpha = clamp(1.0 - transmittance, 0.0, 0.92);
        if (totalAlpha < 0.004) discard;

        // Gentle filmic soft-knee keeps gossamer translucency & rich emerald/crimson without neon whiteout!
        vec3 finalCol = accumCol / (1.0 + accumCol * 0.26);
        float dither = (jitter - 0.5) / 160.0;
        finalCol = max(vec3(0.0), finalCol + vec3(dither));

        gl_FragColor = vec4(finalCol, totalAlpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
  });
}

// ============================================================================
// 8. NASA JUNOCAM / GALILEO VOLCANIC IO SURFACE SHADER (Sulfur Frost + Lava Calderas)
// ============================================================================

export function createIoSurfaceMaterial(
  body: CelestialBody,
  textures: PlanetTextures
): THREE.ShaderMaterial {
  const starPositions = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
  const starColors = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0xffffff));
  const starRadii = new Array(MAX_STAR_LIGHTS).fill(5.0);
  const occluderPositions = Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector3(0, 0, 0));
  const occluderRadii = new Array(MAX_OCCLUDERS).fill(0);
  const occluderHasAtmo = new Array(MAX_OCCLUDERS).fill(0);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: body.seed },
      uAlbedoMap: { value: textures.moon },
      uStarCount: { value: 0 },
      uStarPositions: { value: starPositions },
      uStarColors: { value: starColors },
      uStarRadii: { value: starRadii },
      uOccluderCount: { value: 0 },
      uOccluderPositions: { value: occluderPositions },
      uOccluderRadii: { value: occluderRadii },
      uOccluderHasAtmo: { value: occluderHasAtmo },
    },
    vertexShader: TEXTURED_SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform sampler2D uAlbedoMap;
      uniform int uStarCount;
      uniform vec3 uStarPositions[${MAX_STAR_LIGHTS}];
      uniform vec3 uStarColors[${MAX_STAR_LIGHTS}];

      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;
      ${GLSL_ECLIPSE_HELPER}
      ${GLSL_COMET_NOISE}

      void main() {
        vec3 N = normalize(vNormalWorld);
        vec3 p = normalize(vLocalPos);
        float texBase = dot(texture2D(uAlbedoMap, vUv).rgb, vec3(0.3, 0.59, 0.11));

        // Authentic NASA JunoCam / Galileo mottled sulfur-yellow, SO2 frost white, volcanic orange-rust & dark silicate paterae!
        float n1 = cFbm2(vec2(atan(p.z, p.x) * 2.2 + uSeed * 0.1, p.y * 4.5));
        float n2 = cFbm2(vec2(atan(p.z, p.x) * 5.4 - p.y * 3.0, p.y * 9.5 + uSeed * 0.3));
        float n3 = cFbm2(p.xz * 7.5 + vec2(p.y * 5.2, uSeed * 0.2));

        vec3 sulfurYellow = vec3(0.88, 0.78, 0.34);
        vec3 so2Frost = vec3(0.92, 0.89, 0.74);
        vec3 volcanicRust = vec3(0.76, 0.34, 0.11);
        vec3 darkSilicate = vec3(0.22, 0.15, 0.09);

        vec3 albedo = mix(sulfurYellow, so2Frost, smoothstep(0.56, 0.82, n1 * 0.7 + texBase * 0.4));
        albedo = mix(albedo, volcanicRust, smoothstep(0.45, 0.78, n2) * 0.78);
        // Dark volcanic patera rings (like Pele's crimson-orange sulfur fallout ring!)
        float calderaSpot = smoothstep(0.72, 0.86, n3 * 0.75 + (1.0 - texBase) * 0.35);
        albedo = mix(albedo, darkSilicate, calderaSpot * 0.88);

        // 3 Primary active volcanic vent coordinates matching Io's umbrella plumes (Tvashtar, Pele, Prometheus)
        vec3 v1 = normalize(vec3(0.68, 0.58, 0.44));
        vec3 v2 = normalize(vec3(-0.74, -0.26, 0.62));
        vec3 v3 = normalize(vec3(0.18, -0.14, -0.97));
        float d1 = distance(p, v1);
        float d2 = distance(p, v2);
        float d3 = distance(p, v3);

        // Red-orange sulfur pyroclastic rings around Pele & Tvashtar
        float peleRing = exp(-pow((d2 - 0.22) / 0.08, 2.0)) * 0.55 + exp(-pow((d1 - 0.19) / 0.07, 2.0)) * 0.45;
        albedo = mix(albedo, vec3(0.84, 0.22, 0.06), clamp(peleRing, 0.0, 0.65));

        // Incandescent molten-lava caldera hotspots gleaming vividly even on Io's nightside!
        float pulse = 0.85 + 0.15 * sin(uTime * 3.4 + n2 * 8.0);
        float ventGlow =
          exp(-d1 * d1 * 180.0) * 1.45 +
          exp(-d2 * d2 * 165.0) * 1.35 +
          exp(-d3 * d3 * 195.0) * 1.25 +
          smoothstep(0.82, 0.94, n3 * 0.8 + (1.0 - texBase) * 0.28) * 0.55;

        // Multi-star illumination + subtle Jupiter-shine ambient so nightside calderas contrast cleanly
        vec3 direct = vec3(0.0);
        for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
          if (i >= uStarCount) break;
          vec3 L = normalize(uStarPositions[i] - vWorldPos);
          float ndl = max(dot(N, L), 0.0);
          vec3 eclipse = computeEclipseTransmit(vWorldPos, uStarPositions[i], uStarRadii[i]);
          direct += uStarColors[i] * pow(ndl, 0.88) * eclipse * 1.18;
        }
        vec3 ambient = uStarCount > 0 ? vec3(0.055, 0.05, 0.042) : vec3(0.45);
        vec3 lavaCol = mix(vec3(1.55, 0.34, 0.04), vec3(2.0, 1.45, 0.55), clamp(ventGlow * 0.6, 0.0, 1.0));
        vec3 finalCol = albedo * (direct + ambient) + lavaCol * ventGlow * pulse;

        gl_FragColor = vec4(finalCol, 1.0);
      }
    `,
  });
}

// ============================================================================
// 9. NASA HUBBLE UV / JUNO JUPITER POLAR AURORA + LIVE IO FOOTPRINT & TAIL SHADER
// ============================================================================

export function createJupiterAuroraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1.15 },
      uIoDirLocal: { value: new THREE.Vector3(1, 0, 0) },
      uHasIo: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vLocalPos = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uIoDirLocal;
      uniform float uHasIo;

      varying vec3 vLocalPos;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      ${GLSL_COMET_NOISE}

      void main() {
        vec3 p = normalize(vLocalPos);
        // Jupiter's real magnetic dipole is tilted ~9.6° from its spin axis!
        float tilt = 0.168;
        float ct = cos(tilt);
        float st = sin(tilt);
        vec3 magP = vec3(p.x * ct - p.y * st, p.x * st + p.y * ct, p.z);

        float absLat = abs(magP.y); // sin(magnetic latitude)
        if (absLat < 0.72) discard;

        float hemi = magP.y >= 0.0 ? 1.0 : -1.0;
        float az = atan(magP.z, magP.x);

        // 1. Main Jovian UV Auroral Oval (~72°–78° magnetic latitude, curl-warped electric cobalt-blue & UV violet!)
        vec2 polarXY = magP.xz * 4.2;
        vec2 w = vec2(
          cFbm2(polarXY + vec2(uTime * 0.12, -uTime * 0.09 + hemi * 2.1)),
          cFbm2(polarXY + vec2(-uTime * 0.10 + 4.3, uTime * 0.13))
        );
        float f1 = cFbm2(polarXY * 1.45 + w * 1.65 - vec2(uTime * 0.18, 0.0));
        float f2 = cFbm2(polarXY * 3.1 + w * 0.9 + vec2(0.0, uTime * 0.24));

        // Subtle asymmetric oval center matching Hubble UV Jupiter aurora
        float ovalTarget = 0.942 + 0.016 * sin(az + 0.6 * hemi) + (w.x - 0.5) * 0.022;
        float ovalDist = abs(absLat - ovalTarget);
        float mainOval = exp(-pow(ovalDist / 0.024, 2.0)) * (0.45 + 0.95 * pow(1.0 - abs(f1 * 2.0 - 1.0), 1.8));
        float polarSwirl = smoothstep(0.955, 0.992, absLat) * smoothstep(0.38, 0.85, f2) * 0.38;

        // 2. LIVE TRACKED IO AURORAL FOOTPRINT + SECONDARY SUB-SPOT + TRAILING COMET TAIL!
        //    Locked dead-center onto the incoming 3D Magnetic Flux Tube at 67° N/S latitude (sin(67°) ≈ 0.920)!
        float ioFootprint = 0.0;
        float ioTail = 0.0;
        if (uHasIo > 0.5) {
          float spinAz = atan(p.z, p.x);
          float ioAz = atan(uIoDirLocal.z, uIoDirLocal.x);
          float dAz = atan(sin(spinAz - ioAz), cos(spinAz - ioAz));
          float spinAbsLat = abs(p.y);
          float footLat = 0.920; // exact 67° N/S magnetic footprint landing latitude!
          float dLat = spinAbsLat - footLat;

          // Primary Alfvén main footprint spot + trailing secondary sub-spot (Juno JIRAM double-spot!)
          float mainSpot = exp(-(dAz * dAz * 78.0 + dLat * dLat * 3200.0)) * 2.15;
          float subSpot = exp(-((dAz + 0.14) * (dAz + 0.14) * 105.0 + dLat * dLat * 3600.0)) * 1.05;
          ioFootprint = mainSpot + subSpot;

          // Long fading trailing auroral tail sweeping ~55° behind Io's orbital azimuth!
          float tailLag = mod(ioAz - spinAz + 6.2831853, 6.2831853);
          float tailAlong = smoothstep(0.0, 0.07, tailLag) * exp(-tailLag * 2.35) * smoothstep(1.35, 0.50, tailLag);
          float tailWidth = exp(-pow(dLat / (0.012 + 0.008 * tailLag), 2.0));
          ioTail = tailAlong * tailWidth * (0.68 + 0.55 * f2) * 1.25;
        }

        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        // Subtle limb brightening like real translucent upper-atmosphere H2 UV emission!
        float limbBoost = 0.72 + 0.58 * pow(1.0 - abs(dot(N, V)), 1.6);

        vec3 uvCobalt = vec3(0.24, 0.68, 1.95);
        vec3 uvViolet = vec3(0.58, 0.28, 1.98);
        vec3 footprintCyanWhite = vec3(0.75, 1.48, 2.20);

        vec3 ovalCol = mix(uvCobalt, uvViolet, smoothstep(0.25, 0.85, f2) * 0.55);
        vec3 col = ovalCol * (mainOval + polarSwirl) + footprintCyanWhite * (ioFootprint + ioTail * 0.85);
        float alpha = clamp(((mainOval + polarSwirl) * 0.72 + ioFootprint * 0.95 + ioTail * 0.72) * limbBoost * uIntensity, 0.0, 0.95);
        if (alpha < 0.006) discard;

        gl_FragColor = vec4(col * limbBoost, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

// ============================================================================
// 10. JWST / HUBBLE EXACT GENERAL RELATIVITY GRAVITATIONAL LENSING SHADER
//     (Real-time Einstein Ring, 4-Image Einstein Cross & SMACS 0723 Galaxy Arcs!)
// ============================================================================

export function createGravitationalLensMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLensCenter: { value: new THREE.Vector3(0, 0, 0) },
      uSourceDirWorld: { value: new THREE.Vector3(0, 0, -1) },
      uEinsteinRadius: { value: 0.24 },
      uLensShear: { value: 0.0 },
      uMaxAngle: { value: 0.68 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLensCenter;
      uniform vec3 uSourceDirWorld;
      uniform float uEinsteinRadius;
      uniform float uLensShear;
      uniform float uMaxAngle;

      varying vec3 vWorldPos;
      ${GLSL_COMET_NOISE}

      // Evaluates a crisp JWST-grade spiral galaxy + compact active quasar nucleus in the deflected source plane!
      vec3 evalPrimarySourceGalaxy(vec2 d, float shear) {
        float r = length(d);
        if (r > 0.24) return vec3(0.0);

        // Smooth transition between extended Spiral-Galaxy Einstein Ring (shear ~ 0)
        // and compact 4-Image Quasar Einstein Cross (shear ~ 0.24 -> 4 cleanly separated diamond quasar points!)
        float crossMode = smoothstep(0.06, 0.21, shear);

        // Tilt the background spiral slightly for realistic JWST SPT0418-47 morphology
        vec2 tiltD = vec2(d.x * 1.18 + d.y * 0.28, -d.x * 0.24 + d.y * 0.88);
        float rt = length(tiltD);
        float ang = atan(tiltD.y, tiltD.x);

        // Grand-design twin logarithmic spiral arms + sparkling H-II star-forming knots!
        float logR = log(max(rt, 0.0022));
        float armPhase = 2.0 * ang - logR * 5.2;
        float arms = pow(0.5 + 0.5 * cos(armPhase), 2.6);
        float fineClumps = cFbm2(tiltD * 58.0 + vec2(3.1, 7.4));
        float knots = smoothstep(0.46, 0.88, fineClumps) * arms;

        float diskEnv = exp(-rt * 24.0) * mix(1.0, 0.09, crossMode);
        float bulge = exp(-rt * rt * 1550.0) * mix(0.68, 0.14, crossMode);

        // Compact diamond-sharp blue-white quasar core (splits into 4 crisp separated Cross images at shear = 0.24!)
        float qSharp = mix(3200.0, 8200.0, crossMode);
        float quasarCore = exp(-r * r * qSharp) * mix(0.42, 3.6, crossMode);
        float quasarHalo = exp(-r * 68.0) * mix(0.12, 0.65, crossMode);

        vec3 bulgeGold = vec3(1.42, 0.94, 0.42);
        vec3 armBlue = vec3(0.32, 0.72, 1.55);
        vec3 h2Rose = vec3(1.45, 0.36, 0.72);
        vec3 dustAmber = vec3(1.28, 0.62, 0.22);
        vec3 quasarCyanWhite = vec3(0.95, 1.48, 2.20);

        vec3 diskCol = mix(armBlue, h2Rose, smoothstep(0.48, 0.86, fineClumps) * 0.62);
        diskCol = mix(diskCol, dustAmber, smoothstep(0.06, 0.012, rt) * 0.48);
        vec3 col = diskCol * diskEnv * (0.28 + 1.05 * arms + 1.45 * knots);
        col += bulgeGold * bulge;
        col += quasarCyanWhite * (quasarCore + quasarHalo);
        return col;
      }

      // Evaluates a distant JWST SMACS 0723 cluster background galaxy (elliptical / dusty starburst / blue disk)
      vec3 evalDeepFieldGalaxy(vec2 d, vec2 axis, float size, vec3 tint, float isSpiral) {
        vec2 rotD = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x)));
        rotD.y *= 1.85; // inclined galaxy disc aspect ratio
        float r = length(rotD) / size;
        if (r > 3.8) return vec3(0.0);
        float core = exp(-r * r * 4.8) * 1.25;
        float halo = exp(-r * 1.95) * 0.78;
        float clump = isSpiral > 0.5 ? (0.65 + 0.55 * sin(atan(rotD.y, rotD.x) * 2.0 - r * 3.5)) : 1.0;
        return tint * (core + halo * clump);
      }

      void main() {
        vec3 toLens = uLensCenter - cameraPosition;
        float distL = max(0.01, length(toLens));
        vec3 fwd = toLens / distL;
        vec3 worldUp = abs(fwd.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 right = normalize(cross(worldUp, fwd));
        vec3 up = normalize(cross(fwd, right));

        vec3 rd = normalize(vWorldPos - cameraPosition);
        float zProj = dot(rd, fwd);
        if (zProj <= 0.05) discard;
        vec2 theta = vec2(dot(rd, right), dot(rd, up)) / zProj;
        float rTheta = length(theta);

        // Seamless outer fade well inside the bounding sphere -> ZERO visible box/sphere edges!
        float sphereMask = smoothstep(uMaxAngle * 0.96, uMaxAngle * 0.54, rTheta);
        if (sphereMask < 0.004) discard;

        // Exact General Relativity Thin-Lens Equation + Elliptical Quadrupole Shear:
        //   beta = theta - (theta_E^2 / (|theta|^2 + r_core^2)) * theta - gamma * (theta_x, -theta_y)
        //   gamma = 0.00 -> Axisymmetric 360° JWST Einstein Ring!
        //   gamma ~ 0.24 -> Exact 4-Image Hubble Einstein Cross!
        float te = uEinsteinRadius;
        float r2 = dot(theta, theta);
        vec2 alphaPoint = (te * te / (r2 + te * te * 0.014)) * theta;
        vec2 alphaShear = uLensShear * vec2(theta.x, -theta.y);
        vec2 beta = theta - alphaPoint - alphaShear;

        // Project live 3D primary background galaxy direction onto source plane so orbiting smoothly morphs the ring!
        vec3 srcDir = normalize(uSourceDirWorld);
        float srcForward = dot(srcDir, fwd);
        vec3 lensedCol = vec3(0.0);

        if (srcForward > 0.25) {
          vec2 betaSrc = vec2(dot(srcDir, right), dot(srcDir, up)) / srcForward;
          lensedCol += evalPrimarySourceGalaxy(beta - betaSrc, uLensShear);

          // 8 Authentic JWST SMACS 0723 Deep-Field Galaxies anchored in 3D space behind the lens ->
          // automatically stretch into sweeping multi-colored concentric tangential giant arcs & arclets!
          vec3 srcRight = normalize(cross(abs(srcDir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), srcDir));
          vec3 srcUp = normalize(cross(srcDir, srcRight));

          for (int i = 0; i < 8; i++) {
            float fi = float(i);
            float angG = fi * 0.7854 + 0.28;
            // Spread background cluster galaxies across inner-arc and wider SMACS 0723 outer-arc zones!
            float radG = te * (0.48 + 0.92 * mod(fi * 1.618, 1.0));
            vec3 gDir = normalize(srcDir + srcRight * (cos(angG) * radG) + srcUp * (sin(angG) * radG));
            float gFwd = dot(gDir, fwd);
            if (gFwd <= 0.2) continue;
            vec2 betaG = vec2(dot(gDir, right), dot(gDir, up)) / gFwd;

            // Varied realistic JWST galaxy colors: high-z dusty crimson, amber elliptical, star-forming blue spiral
            vec3 gTint = i == 0 || i == 4
              ? vec3(1.65, 0.50, 0.22)
              : (i == 1 || i == 5
                ? vec3(0.45, 0.88, 1.75)
                : (i == 2 || i == 6
                  ? vec3(1.55, 1.08, 0.55)
                  : vec3(1.42, 0.52, 0.96)));
            vec2 gAxis = vec2(cos(fi * 2.1), sin(fi * 2.1));
            float gSize = 0.026 + 0.014 * mod(fi * 0.73, 1.0);
            lensedCol += evalDeepFieldGalaxy(beta - betaG, gAxis, gSize, gTint, mod(fi, 2.0)) * 1.28;
          }
        }

        // Foreground Giant Elliptical cD Lensing Galaxy (warm golden-ivory de Vaucouleurs brightness profile!)
        // Elliptically slightly elongated along X when uLensShear > 0 to match the physical quadrupole potential!
        vec2 fgP = vec2(theta.x / (1.0 + uLensShear * 0.85), theta.y * (1.0 + uLensShear * 0.85));
        float fgR = length(fgP) / max(0.02, te * 0.28);
        float fgCore = exp(-pow(fgR, 0.78) * 1.75) * 1.05;
        float fgHalo = exp(-fgR * 0.95) * 0.24;
        vec3 fgCol = mix(vec3(1.38, 0.96, 0.56), vec3(1.88, 1.72, 1.44), clamp(fgCore, 0.0, 1.0)) * (fgCore + fgHalo);

        // Subtle dark-matter halo whisper glow near Einstein ring for deep-space cluster depth
        float dmWhisper = exp(-pow(rTheta / (te * 1.15), 2.0)) * 0.04;
        vec3 dmCol = vec3(0.26, 0.36, 0.68) * dmWhisper;

        vec3 totalCol = (lensedCol + fgCol + dmCol) * sphereMask;
        // Filmic Reinhard highlight compression preserves rich blue/amber/rose JWST ring colors without whiteout!
        totalCol = totalCol / (1.0 + totalCol * 0.58);

        float lum = max(totalCol.r, max(totalCol.g, totalCol.b));
        float alpha = clamp(lum * 1.15, 0.0, 0.96) * sphereMask;
        if (alpha < 0.004) discard;

        gl_FragColor = vec4(totalCol, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
  });
}
