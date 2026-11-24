import * as THREE from 'three';
import { GLSL_NOISE_LIB } from './shaders/noise';

export interface AndromedaDiskMaps {
  colorMap: THREE.Texture;
  dustMap: THREE.Texture;
  dispose: () => void;
}

const GLSL_M31_BAKE_SHARED = /* glsl */ `
  ${GLSL_NOISE_LIB}

  float m31Hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Seam-free 3D spiral-streamline coordinate: 2pi-periodic in azimuth, stretched 4-5x along logarithmic arms
  vec3 spiralStream(float ang, float logR, float r, float k, float fAcross, float fAlong) {
    float psi = ang - k * logR;
    float rScale = mix(0.38, 1.0, smoothstep(0.0, 0.34, r));
    return vec3(cos(psi) * fAcross * rScale, sin(psi) * fAcross * rScale, logR * fAlong);
  }

  struct M31Field {
    vec2 d;
    vec3 streamMain;
    vec3 streamBarb;
    float r;
    float ang;
    float logR;
    float phaseWarp;
    float arm2;
    float arm3;
    float flocArm;
    float obArm;
    float shockLane;
    float ring10k;
    float ngcShape;
    float ngcRim;
    float outerFade;
  };

  M31Field evalM31Field(vec2 uv) {
    M31Field s;
    s.d = (uv - 0.5) * 2.0;
    s.r = length(s.d);
    s.ang = s.r > 1e-4 ? atan(s.d.y, s.d.x) : 0.0;
    // Pure polar logR with zero pre-log radial distortion (prevents concentric onion rings)
    s.logR = log(s.r + 0.11);

    // True ~4.5:1 organic cosmic spiral-streamline coordinates (avoids 91:1 Saturn vinyl grooves)
    s.streamMain = spiralStream(s.ang, s.logR, s.r, 4.7, 1.35, 6.4);
    s.streamBarb = spiralStream(s.ang, s.logR, s.r, 2.3, 1.50, 3.8);

    // Gentle phase-only perturbation breaks mathematical rigidity while keeping spiral arcs cohesive
    s.phaseWarp =
      0.30 * fbm4(s.streamMain * 0.95 + vec3(2.1, 6.4, 0.7)) +
      0.14 * fbm3(s.streamMain * 2.20 + vec3(7.3, 1.9, 2.9));

    // Tightly-wound M31 SA(s)b spiral harmonics: m=2 grand backbone + m=3 flocculent branches + m=4 fine spurs
    float m2Phase = 2.0 * s.ang - 9.4 * s.logR - 2.2 + s.phaseWarp * 1.00;
    float m3Phase = 3.0 * s.ang - 13.8 * s.logR + 0.7 + s.phaseWarp * 1.25;
    float m4Phase = 4.0 * s.ang - 18.4 * s.logR - 1.1 + s.phaseWarp * 1.45;

    // Arc modulation evaluated strictly in spiral-streamline coords -> flowing elongated arcs, NEVER circular blobs
    float arcMod2 = smoothstep(0.14, 0.84, 0.5 + 0.5 * fbm4(s.streamMain * 1.05 + vec3(1.4, 5.1, 1.8)));
    float arcMod3 = smoothstep(0.18, 0.86, 0.5 + 0.5 * fbm4(s.streamMain * 1.35 + vec3(7.8, 3.6, 4.2)));
    float arcMod4 = smoothstep(0.22, 0.86, 0.5 + 0.5 * fbm3(s.streamBarb * 1.65 + vec3(3.9, 8.2, 6.5)));

    s.arm2 = pow(max(1e-4, 0.5 + 0.5 * cos(m2Phase)), 2.2) * (0.42 + 0.76 * arcMod2);
    s.arm3 = pow(max(1e-4, 0.5 + 0.5 * cos(m3Phase)), 2.4) * (0.32 + 0.82 * arcMod3);
    float arm4 = pow(max(1e-4, 0.5 + 0.5 * cos(m4Phase)), 2.7) * 0.56 * arcMod4;

    float innerEmergence = smoothstep(0.08, 0.28, s.r);
    s.flocArm = clamp((s.arm2 * 0.64 + s.arm3 * 0.44 + arm4 * 0.30) * innerEmergence, 0.0, 1.35);

    // Young OB bright crests slightly outer/convex relative to concave dust shock lanes
    float ob2 = pow(max(1e-4, 0.5 + 0.5 * cos(m2Phase - 0.12)), 2.3) * (0.42 + 0.78 * arcMod2);
    float ob3 = pow(max(1e-4, 0.5 + 0.5 * cos(m3Phase - 0.12)), 2.5) * (0.32 + 0.82 * arcMod3);
    s.obArm = clamp((ob2 * 0.66 + ob3 * 0.44 + arm4 * 0.28) * smoothstep(0.10, 0.30, s.r), 0.0, 1.35);

    // Concave-edge shock lanes offset +0.68 inside spiral arms (separates dark dust canyons from bright sapphire OB crests)
    float sh2 = pow(max(1e-4, 0.5 + 0.5 * cos(m2Phase + 0.68)), 5.0) * (0.40 + 0.80 * arcMod2);
    float sh3 = pow(max(1e-4, 0.5 + 0.5 * cos(m3Phase + 0.65)), 5.4) * (0.32 + 0.82 * arcMod3);
    float sh4 = pow(max(1e-4, 0.5 + 0.5 * cos(m4Phase + 0.60)), 5.8) * 0.60 * arcMod4;
    s.shockLane = clamp((sh2 * 0.68 + sh3 * 0.56 + sh4 * 0.44) * smoothstep(0.06, 0.22, s.r), 0.0, 1.25);

    // Subtle arm-coupled 10 kpc star-forming boost (enhances arms softly without forming an axisymmetric round donut)
    float ringWarp = 0.055 * fbm4(s.streamMain * 0.72 + vec3(2.2, 1.4, 3.1))
                   + 0.025 * cos(2.0 * s.ang - 0.7);
    float ringR = s.r + ringWarp;
    float ringGauss = exp(-pow((ringR - 0.59) / 0.165, 2.0));
    float lopsidedNgcSide = 0.80 + 0.32 * smoothstep(-0.2, 0.75, -s.d.x * 0.75 + s.d.y * 0.25);
    s.ring10k = clamp(ringGauss * lopsidedNgcSide * (0.45 + 0.85 * s.flocArm) * 0.38, 0.0, 0.75);

    // Shared NGC 206 geometry so bright sapphire cluster & dust clearing align seamlessly
    vec2 pNgc = s.d - vec2(-0.56, 0.09);
    vec2 ngcTang = normalize(vec2(-0.34, -0.94));
    vec2 ngcPerp = vec2(-ngcTang.y, ngcTang.x);
    float uT = dot(pNgc, ngcTang);
    float vP = dot(pNgc, ngcPerp);
    s.ngcShape = exp(-(uT * uT / (0.110 * 0.110) + vP * vP / (0.042 * 0.042)));
    // Slight trailing/inner dust rim hugging NGC 206's edge without dimming its bright blue core
    float vRim = vP - 0.045;
    s.ngcRim = exp(-(uT * uT / (0.115 * 0.115) + vRim * vRim / (0.026 * 0.026)));

    // Spiral-arm-guided & wispy asymmetric outer dissolution (eliminates crisp brushed outer rim at 77 deg)
    float rEdge = 0.78
                + 0.11 * s.arm2
                + 0.05 * s.arm3
                + 0.04 * cos(s.ang + 0.55)
                + 0.075 * fbm4(vec3(s.d * 5.2 + vec2(3.1, 6.2), 2.4))
                + 0.03 * snoise(vec3(s.d * 14.0, 5.8));
    float loEdge = max(0.26, rEdge - 0.44);
    s.outerFade = 1.0 - smoothstep(loEdge, rEdge, s.r);

    return s;
  }
`;

const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DUST_FRAG = /* glsl */ `
  varying vec2 vUv;
  ${GLSL_M31_BAKE_SHARED}

  void main() {
    M31Field s = evalM31Field(vUv);
    if (s.r >= 0.96) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float radialMask = smoothstep(0.045, 0.13, s.r) * (1.0 - smoothstep(0.76, 0.95, s.r));

    // All ridged dust webs with true ~4.5:1 spiral elongation blended with jagged 2D Cartesian turbulence
    vec3 stMain = spiralStream(s.ang, s.logR, s.r, 4.7, 1.75, 8.2);
    vec3 stFine = spiralStream(s.ang, s.logR, s.r, 4.7, 3.10, 14.5);
    vec3 stBarb = spiralStream(s.ang, s.logR, s.r, 2.3, 2.20, 5.6);

    float webMacro = ridgedFbm(stMain * 1.45 + vec3(1.2, 0.7, 1.4));
    float webMid   = ridgedFbm(stFine * 2.15 + vec3(3.7, 8.2, 3.1));
    float webBarb  = ridgedFbm(stBarb * 1.85 + vec3(6.1, 2.4, 5.8));
    float webFine  = 1.0 - abs(snoise(stFine * 4.40 + vec3(11.3, 4.7, 7.2)));
    float turb2D   = ridgedFbm(vec3(s.d * 11.5 + vec2(3.1, 7.4), 2.2)) * 0.62
                   + (1.0 - abs(snoise(vec3(s.d * 26.0 + vec2(9.2, 1.8), 6.5)))) * 0.38;

    float laceRaw = (webMacro * 0.34 + webMid * 0.24 + webBarb * 0.16 + webFine * 0.10) * 0.60 + turb2D * 0.40;
    float laceWeb = pow(clamp(laceRaw, 1e-4, 1.0), 1.85);

    // Jagged multi-scale dust fracture (50/50 spiral-streamline & 2D turbulence) -> clumpy Hubble canyons
    float cavityA = smoothstep(0.18, 0.82, 0.5 + 0.5 * (
      fbm4(stMain * 1.95 + vec3(2.3, 7.1, 4.4)) * 0.50
      + fbm4(vec3(s.d * 9.5 + vec2(1.7, 5.3), 4.4)) * 0.50
    ));
    float cavityB = smoothstep(0.22, 0.80, 0.5 + 0.5 * (
      fbm3(stFine * 3.10 + vec3(8.4, 3.2, 8.1)) * 0.50
      + fbm3(vec3(s.d * 21.0 + vec2(4.2, 1.9), 8.1)) * 0.50
    ));
    float laceBreak = cavityA * 0.62 + cavityB * 0.38;

    // Delicate inner nuclear/bulge sienna tendrils leaving ~85% of luminous warm bulge clear
    float innerZone = smoothstep(0.05, 0.12, s.r) * (1.0 - smoothstep(0.22, 0.38, s.r));
    float innerPatch = smoothstep(0.30, 0.80, 0.5 + 0.5 * fbm4(stMain * 1.50 + vec3(5.1, 2.7, 2.5)));
    float innerWisps = pow(clamp(webMid * 0.62 + webFine * 0.38, 1e-4, 1.0), 3.1) * innerZone * innerPatch * 0.72;

    // Concave-edge dust shock lanes + trailing rim behind NGC 206, WITH dust cavity clearing atop NGC 206 itself
    float ngcClear = 1.0 - 0.82 * s.ngcShape;
    float zoneDrive = clamp((s.shockLane * 0.96 + s.ring10k * 0.55 + s.ngcRim * 0.36) * ngcClear, 0.0, 1.40);
    float midOuterDust = zoneDrive * (0.28 + 1.42 * laceWeb) * (0.34 + 1.00 * laceBreak) * radialMask;

    // R: sweeping spiral fractal dust filaments
    float R = clamp(midOuterDust * 1.24 + innerWisps * 1.15, 0.0, 1.0);

    // G: dense molecular espresso-black soot cores strictly along concave shock ridges & rifts
    float knotMask = smoothstep(0.26, 0.78, cavityA * 0.65 + cavityB * 0.35);
    float denseRift = pow(clamp(zoneDrive * (0.42 + 0.95 * laceWeb), 1e-4, 1.28), 1.40) * knotMask;
    float G = clamp(denseRift * smoothstep(0.16, 0.32, s.r) * (1.0 - smoothstep(0.74, 0.93, s.r)) * 1.18, 0.0, 1.0);

    // B: smooth anti-aliased ruby-rose H-II knots hugging bright OB arm edges (0.28..0.88)
    float h2Zone = clamp(s.obArm * 0.85 + s.ring10k * 0.70 + s.ngcShape * 0.35, 0.0, 1.2)
                 * smoothstep(0.26, 0.42, s.r) * s.outerFade;
    float h2PinA = pow(clamp(0.5 + 0.5 * snoise(stFine * 2.6 + vec3(2.4, 7.1, 1.8)), 1e-4, 1.0), 5.0);
    float h2PinB = smoothstep(0.32, 0.80, 0.5 + 0.5 * snoise(vec3(s.d * 30.0 + vec2(9.1, 4.3), 6.2)));
    float B = clamp(h2PinA * h2PinB * h2Zone * 2.1, 0.0, 1.0);

    // A: smooth vertical dust puffiness factor for 3D edge-on & 77 deg silhouette relief
    float puff = clamp(0.18 + 0.52 * G + 0.24 * R + 0.08 * webMid, 0.0, 1.0);

    gl_FragColor = vec4(R, G, B, puff);
  }
`;

const COLOR_FRAG = /* glsl */ `
  varying vec2 vUv;
  ${GLSL_M31_BAKE_SHARED}

  void main() {
    M31Field s = evalM31Field(vUv);
    if (s.r >= 0.985) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Continuous warm exponential stellar disk sea emerging smoothly into spiral starlight arms
    float expDisk = exp(-s.r * 2.55) * s.outerFade;
    float armContrast = 0.48 + 0.58 * smoothstep(0.14, 0.84, 0.5 + 0.5 * fbm4(s.streamMain * 1.1 + vec3(1.2, 4.9, 1.3)));
    float warmSea = expDisk * (0.52 * armContrast + 0.70 * s.flocArm) * smoothstep(0.04, 0.16, s.r);

    // Spirally elongated powdery OB star clouds mixed with 2D frothy breakup (coherent arms, ragged clouds)
    vec3 stOB = spiralStream(s.ang, s.logR, s.r, 4.7, 1.85, 8.6);
    float obCloudA = smoothstep(0.14, 0.84, 0.5 + 0.5 * (
      fbm4(stOB * 1.45 + vec3(6.3, 2.1, 2.7)) * 0.62
      + fbm4(vec3(s.d * 11.0 + vec2(2.8, 7.5), 4.1)) * 0.38
    ));
    float obCloudB = smoothstep(0.18, 0.82, 0.5 + 0.5 * (
      fbm3(stOB * 2.85 + vec3(3.4, 9.8, 5.1)) * 0.62
      + fbm3(vec3(s.d * 19.5 + vec2(8.1, 3.6), 6.2)) * 0.38
    ));
    float obFroth  = 0.78 + 0.34 * smoothstep(0.20, 0.82, 0.5 + 0.5 * (
      snoise(stOB * 5.6 + vec3(7.2, 4.6, 8.3)) * 0.62
      + snoise(vec3(s.d * 28.0 + vec2(1.4, 6.7), 7.8)) * 0.38
    ));
    float obPowder = clamp((0.40 + 0.72 * (obCloudA * 0.65 + obCloudB * 0.35)) * obFroth, 0.0, 1.30);

    float armEnv = smoothstep(0.15, 0.35, s.r) * s.outerFade;
    float obDensity = (s.obArm * 0.96 + s.ring10k * 0.62) * obPowder * armEnv;

    // Crisp frothy sapphire NGC 206 OB super-association (cleared of muddying foreground dust)
    vec2 pNgc = s.d - vec2(-0.56, 0.09);
    float ngcFrac = smoothstep(0.20, 0.82, 0.5 + 0.5 * fbm4(vec3(pNgc * 28.0, 2.9)));
    float ngcSpark = 0.74 + 0.44 * smoothstep(0.28, 0.85, 0.5 + 0.5 * snoise(vec3(pNgc * 56.0, 6.4)));
    float ngc206 = s.ngcShape * (0.34 + 0.82 * ngcFrac) * ngcSpark;

    // Anti-aliased Hubble PHAT star-sand granularity
    float sandCoarse = 0.5 + 0.5 * snoise(stOB * 7.8 + vec3(3.3, 1.1, 5.9));
    float pixSeedA   = m31Hash(floor(vUv * 1024.0));
    float pixSeedB   = m31Hash(floor(vUv * 1800.0));
    float phatGrain  = 0.84 + 0.14 * sandCoarse
                     + 0.14 * pow(max(pixSeedA, 1e-4), 3.6)
                     + 0.12 * pow(max(pixSeedB, 1e-4), 4.2);

    // Seamless warm-gold -> champagne-lavender -> sapphire-cobalt gradient along sweeping spiral arms
    vec3 warmInnerCol = vec3(0.98, 0.74, 0.52);
    vec3 warmMidCol   = vec3(0.84, 0.72, 0.68);
    vec3 warmOuterCol = vec3(0.50, 0.58, 0.84);
    vec3 seaTint = mix(warmInnerCol, warmMidCol, smoothstep(0.18, 0.48, s.r));
    seaTint = mix(seaTint, warmOuterCol, smoothstep(0.42, 0.78, s.r));

    vec3 obMistCol  = vec3(0.56, 0.66, 0.94);
    vec3 obCobalt   = vec3(0.32, 0.56, 1.06);
    vec3 obIceKnot  = vec3(0.62, 0.82, 1.20);
    vec3 obTint = mix(obMistCol, obCobalt, smoothstep(0.28, 0.68, s.r));
    obTint = mix(obTint, obIceKnot, smoothstep(0.58, 1.08, obPowder));

    vec3 grainTint = mix(vec3(1.02, 0.98, 0.95), vec3(0.96, 0.99, 1.04), pixSeedB);
    vec3 ngcCol = mix(obCobalt, obIceKnot, smoothstep(0.38, 0.92, ngcFrac)) * ngc206 * 0.52;

    vec3 col = (seaTint * warmSea * 0.84 + obTint * obDensity * 1.12 + ngcCol) * phatGrain * grainTint;
    col = clamp(col, vec3(0.0), vec3(1.0));

    float obMask = clamp((obDensity * 1.15 + ngc206 * 0.95) * (0.76 + 0.28 * sandCoarse), 0.0, 1.0);
    gl_FragColor = vec4(col, obMask);
  }
`;

function createBakeTarget(
  size: number,
  maxAnisotropy: number
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.anisotropy = maxAnisotropy;
  return target;
}

/**
 * Bakes paired 2048x2048 spiral-streamline-aligned Andromeda (M31) disk & shattered dust maps on the GPU.
 */
export function bakeAndromedaDiskMaps(
  renderer: THREE.WebGLRenderer,
  resolution = 2048
): AndromedaDiskMaps {
  const maxTex = renderer.capabilities.maxTextureSize || 2048;
  const size = maxTex >= resolution ? resolution : Math.min(1024, maxTex);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const dustTarget = createBakeTarget(size, maxAniso);
  const colorTarget = createBakeTarget(size, maxAniso);

  const bakeScene = new THREE.Scene();
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  const dustMat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: DUST_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const colorMat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: COLOR_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(quadGeo, dustMat);
  bakeScene.add(quad);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = true;

  renderer.setRenderTarget(dustTarget);
  renderer.clear();
  renderer.render(bakeScene, bakeCam);

  quad.material = colorMat;
  renderer.setRenderTarget(colorTarget);
  renderer.clear();
  renderer.render(bakeScene, bakeCam);

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;

  quadGeo.dispose();
  dustMat.dispose();
  colorMat.dispose();

  return {
    colorMap: colorTarget.texture,
    dustMap: dustTarget.texture,
    dispose: () => {
      colorTarget.dispose();
      dustTarget.dispose();
    },
  };
}
