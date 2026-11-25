import * as THREE from 'three';
import { GLSL_NOISE_LIB } from './shaders/noise';

// Local-space tight AABB framing Pillars I/II/III, Foreground Spur, Pedestal, EGGs & eroding vapor
export const PILLARS_BMIN = new THREE.Vector3(-7.4, -8.2, -4.0);
export const PILLARS_BMAX = new THREE.Vector3(7.4, 7.0, 4.4);
export const PILLARS_BSIZE = new THREE.Vector3().subVectors(PILLARS_BMAX, PILLARS_BMIN);
export const PILLARS_BCENTER = new THREE.Vector3().addVectors(PILLARS_BMIN, PILLARS_BMAX).multiplyScalar(0.5);

export interface PillarsVolumeMaps {
  /** 1024x1024 RGBA8 tiled 3D atlas (8x8 slices of 128x128): R=encodedSDF, G=uvTrans, B=vapor, A=hhWisp */
  volumeAtlas: THREE.Texture;
  /** 256x256 seamless repeat-wrapped 2D FBM cloud/filigree detail map */
  cloudNoiseMap: THREE.Texture;
  dispose: () => void;
}

const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const VOLUME_BAKE_FRAG = /* glsl */ `
  precision highp float;
  ${GLSL_NOISE_LIB}

  const vec3 B_MIN = vec3(-7.4, -8.2, -4.0);
  const vec3 B_MAX = vec3(7.4, 7.0, 4.4);

  float sdTaperCapsule(vec3 p, vec3 a, vec3 b, float ra, float rb) {
    vec3 ba = b - a;
    vec3 pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
  }

  float sminPillar(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  // ESO MUSE 3D staggered & diagonally-swept Pillars of Creation (first-edition crisp trunks + detached EGGs)
  float evalPillarsCoarseSDF(vec3 p) {
    float dPedestal = sdTaperCapsule(p, vec3(-3.8, -5.8, 0.40), vec3(1.65, -4.5, 0.85), 2.05, 1.25);
    float dSpur = sdTaperCapsule(p, vec3(-3.65, -5.25, 2.02), vec3(-1.95, -1.62, 2.36), 0.92, 0.28);

    // Pillar I (Tallest upper-left tower + sculpted hammerhead crown & protruding EGGs)
    float d1a = sdTaperCapsule(p, vec3(-2.10, -3.45, -0.75), vec3(-0.12, 0.80, 0.42), 1.22, 0.80);
    float d1b = sdTaperCapsule(p, vec3(-0.12, 0.80, 0.42), vec3(1.62, 3.95, 1.48), 0.78, 0.54);
    float d1Head = sdTaperCapsule(p, vec3(1.48, 3.72, 1.40), vec3(2.38, 4.95, 1.92), 0.62, 0.40);
    float d1Bulge = sdTaperCapsule(p, vec3(1.92, 4.38, 1.65), vec3(2.82, 4.02, 2.02), 0.48, 0.26);
    float d1egg = sdTaperCapsule(p, vec3(-0.08, 0.92, 0.50), vec3(0.95, 1.48, 0.64), 0.38, 0.18);
    float d1 = sminPillar(
      sminPillar(d1a, d1b, 0.48),
      sminPillar(sminPillar(d1Head, d1Bulge, 0.38), d1egg, 0.30),
      0.40
    );

    // Pillar II (Slanted middle tower + ragged cobweb wing)
    float d2a = sdTaperCapsule(p, vec3(0.05, -4.05, 0.75), vec3(1.85, -0.35, 0.05), 1.06, 0.66);
    float d2b = sdTaperCapsule(p, vec3(1.85, -0.35, 0.05), vec3(3.75, 2.95, -0.82), 0.64, 0.34);
    float d2Wing = sdTaperCapsule(p, vec3(1.82, -0.80, 0.15), vec3(3.30, -1.25, 0.40), 0.36, 0.16);
    float d2 = sminPillar(sminPillar(d2a, d2b, 0.42), d2Wing, 0.32);

    // Pillar III (Lower-right column + dusty bridge to Pillar II)
    float d3a = sdTaperCapsule(p, vec3(1.85, -5.25, 1.25), vec3(3.38, -2.25, 0.12), 0.88, 0.50);
    float d3b = sdTaperCapsule(p, vec3(3.38, -2.25, 0.12), vec3(4.58, 0.15, -0.88), 0.48, 0.26);
    float dBridge = sdTaperCapsule(p, vec3(1.05, -2.95, 0.65), vec3(2.85, -2.55, 0.48), 0.62, 0.34);
    float d3 = sminPillar(sminPillar(d3a, d3b, 0.36), dBridge, 0.48);

    // Detached EGGs right near eroded crowns
    float dDetA = length(p - vec3(4.92, 0.55, -0.96)) - 0.19;
    float dDetB = length(p - vec3(3.15, 3.22, -0.58)) - 0.21;
    float dDetC = length(p - vec3(3.18, 5.22, 1.92)) - 0.18;

    float dMin = min(min(d1, d2), min(d3, dSpur));
    dMin = sminPillar(dMin, dPedestal, 0.72);
    dMin = min(dMin, min(min(dDetA, dDetB), dDetC));
    return dMin;
  }

  float evalShadowDensity(vec3 p) {
    float d = evalPillarsCoarseSDF(p);
    if (d > 0.90) return 0.0;
    float w = snoise(p * 0.65 + vec3(2.1, 3.4, 1.5)) * 0.35;
    return (1.0 - smoothstep(-0.52, 0.18, d - w)) * smoothstep(-7.6, -4.6, p.y);
  }

  void main() {
    const float TILE_RES = 128.0;
    vec2 tile = floor(gl_FragCoord.xy / TILE_RES);
    vec2 localPixel = mod(gl_FragCoord.xy, TILE_RES) - 0.5;
    vec2 uvTile = clamp(localPixel / (TILE_RES - 1.0), 0.0, 1.0);
    float sliceIdx = tile.y * 8.0 + tile.x;
    float w = clamp(sliceIdx / 63.0, 0.0, 1.0);
    vec3 p = mix(B_MIN, B_MAX, vec3(uvTile, w));

    float coarseDist = evalPillarsCoarseSDF(p);
    if (coarseDist >= 1.50) {
      float encCoarse = clamp(coarseDist * 0.25 + 0.375, 0.0, 1.0);
      gl_FragColor = vec4(encCoarse, 1.0, 0.0, 0.0);
      return;
    }

    vec3 uvDir = normalize(vec3(-0.62, 0.74, 0.26));
    float uvProj = dot(p, uvDir);
    vec3 perpUV = p - uvDir * uvProj;
    vec3 fluteP = perpUV * 1.18 + uvDir * (uvProj * 0.30);

    vec3 warp = vec3(
      fbm3(p * 0.54 + vec3(1.7, 4.3, 2.1)),
      fbm3(p * 0.54 + vec3(8.2, 1.1, 6.4)),
      fbm3(p * 0.54 + vec3(3.9, 7.5, 0.8))
    ) * 0.68;

    vec3 pSculpt = p + warp;
    float filaments = fbm4(pSculpt * 1.08 + vec3(2.4, 5.8, 1.2));
    float carve = ridgedFbm(fluteP * 1.82 + warp * 0.55);

    // Sculpted wispy cosmic cloud SDF
    float sdf = coarseDist - ((filaments - 0.44) * 0.68 - (carve - 0.45) * 0.34);
    float radContain = 1.0 - smoothstep(9.0, 12.2, length(p));
    float baseFade = smoothstep(-7.6, -4.6, p.y);

    float tipZone = smoothstep(-1.4, 4.2, p.y + p.x * 0.35);
    float streak = smoothstep(0.35, 0.85, 0.5 + 0.5 * fbm3(fluteP * 2.4 + vec3(0.0, 0.0, 3.1)));
    float vapor = (1.0 - smoothstep(0.06, 0.75, sdf)) * smoothstep(-0.22, 0.14, sdf) * streak * tipZone * radContain;

    // 3-sample Beer-Lambert UV self-shadowing
    float uvTrans = 1.0;
    if (sdf < 0.75 || vapor > 0.01) {
      float occ1 = evalShadowDensity(p + uvDir * 0.60);
      float occ2 = evalShadowDensity(p + uvDir * 1.45);
      float occ3 = evalShadowDensity(p + uvDir * 2.55);
      uvTrans = exp(-(occ1 * 1.20 + occ2 * 0.95 + occ3 * 0.65) * 1.75);
    }

    // Herbig-Haro crimson outflows strictly confined around eroded tip heads
    float hhWisp = 0.0;
    float dHH2 = length(p - vec3(3.66, 2.82, -0.78));
    float dHHSpur = length(p - vec3(-2.02, -1.78, 2.34));
    float dHH3 = length(p - vec3(4.52, 0.06, -0.84));
    if (min(dHH2, min(dHHSpur, dHH3)) < 1.10) {
      float shockTex = pow(max(1e-4, ridgedFbm(p * 2.8 + warp * 0.65)), 1.45);
      hhWisp = (
        exp(-dHH2 * dHH2 * 6.5) * 1.25
        + exp(-dHHSpur * dHHSpur * 6.8) * 1.20
        + exp(-dHH3 * dHH3 * 7.5) * 0.85
      ) * shockTex * baseFade;
    }

    gl_FragColor = vec4(
      clamp(sdf * 0.25 + 0.375, 0.0, 1.0),
      clamp(uvTrans, 0.0, 1.0),
      clamp(vapor, 0.0, 1.0),
      clamp(hhWisp, 0.0, 1.0)
    );
  }
`;

const CLOUD_NOISE_BAKE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  float hash2P(vec2 p, float period) {
    vec2 wp = mod(p, period);
    return fract(sin(dot(wp, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float periodicValueNoise(vec2 uv, float period) {
    vec2 p = uv * period;
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash2P(i, period);
    float b = hash2P(i + vec2(1.0, 0.0), period);
    float c = hash2P(i + vec2(0.0, 1.0), period);
    float d = hash2P(i + vec2(1.0, 1.0), period);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float periodicFbm(vec2 uv, vec2 shift) {
    float sum = 0.0;
    float amp = 0.5;
    float period = 4.0;
    for (int i = 0; i < 4; i++) {
      sum += amp * periodicValueNoise(uv + shift, period);
      period *= 2.0;
      amp *= 0.5;
    }
    return clamp(sum, 0.0, 1.0);
  }

  float periodicRidged(vec2 uv) {
    float sum = 0.0;
    float amp = 0.55;
    float period = 6.0;
    for (int i = 0; i < 4; i++) {
      float n = 1.0 - abs(periodicValueNoise(uv, period) * 2.0 - 1.0);
      sum += n * n * amp;
      period *= 2.0;
      amp *= 0.5;
    }
    return clamp(sum, 0.0, 1.0);
  }

  void main() {
    float c0 = periodicFbm(vUv, vec2(0.0, 0.0));
    float c1 = periodicFbm(vUv, vec2(0.37, 0.61));
    float cr = periodicRidged(vUv);
    gl_FragColor = vec4(c0, c1, cr, 1.0);
  }
`;

function createAtlasTarget(size: number, mipmaps: boolean): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: mipmaps ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    wrapT: mipmaps ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.needsUpdate = true;
  return target;
}

/**
 * Bakes continuous 3D Pillars SDF + UV self-shadowing + vapor + HH atlas and seamless 2D filigree map
 * once on the GPU so runtime raymarching needs zero 3D Simplex math and stays crystal-smooth inside canyons.
 */
export function bakePillarsVolumeMaps(renderer: THREE.WebGLRenderer): PillarsVolumeMaps {
  const volTarget = createAtlasTarget(1024, false);
  const cloudTarget = createAtlasTarget(256, true);

  const bakeScene = new THREE.Scene();
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  const volMat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: VOLUME_BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: CLOUD_NOISE_BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(quadGeo, volMat);
  bakeScene.add(quad);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = true;

  renderer.setRenderTarget(volTarget);
  renderer.clear();
  renderer.render(bakeScene, bakeCam);

  quad.material = cloudMat;
  renderer.setRenderTarget(cloudTarget);
  renderer.clear();
  renderer.render(bakeScene, bakeCam);

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;

  quadGeo.dispose();
  volMat.dispose();
  cloudMat.dispose();

  return {
    volumeAtlas: volTarget.texture,
    cloudNoiseMap: cloudTarget.texture,
    dispose: () => {
      volTarget.dispose();
      cloudTarget.dispose();
    },
  };
}
