import * as THREE from 'three';
import {
  AstroFilterMode,
  AstroPhotoSettings,
  AstroStackStatus,
  AstroTelescopePreset,
} from '../types/cosmos';

export interface AstroTelescopePresetSpec {
  id: AstroTelescopePreset;
  label: string;
  spec: string;
  defaultFocalMm: number;
  defaultEyepieceMask: boolean;
  defaultSpikeStrength: number;
  spikeMode: 0 | 1 | 2 | 3;
}

export const ASTRO_TELESCOPE_PRESETS: Record<AstroTelescopePreset, AstroTelescopePresetSpec> = {
  eyepiece: {
    id: 'eyepiece',
    label: '目镜直视',
    spec: '82° 超广角目镜 · 目镜圆视场 + 十字星标',
    defaultFocalMm: 480,
    defaultEyepieceMask: true,
    defaultSpikeStrength: 0.25,
    spikeMode: 0,
  },
  hubble: {
    id: 'hubble',
    label: '哈勃 4芒',
    spec: '2.4m RC 反射镜 · 经典正交十字衍射星芒',
    defaultFocalMm: 850,
    defaultEyepieceMask: false,
    defaultSpikeStrength: 1.05,
    spikeMode: 1,
  },
  jwst: {
    id: 'jwst',
    label: '韦伯 6芒',
    spec: '6.5m 18片六角镀金主镜 · 6+2 衍射色散星芒',
    defaultFocalMm: 920,
    defaultEyepieceMask: false,
    defaultSpikeStrength: 1.2,
    spikeMode: 2,
  },
  newtonian: {
    id: 'newtonian',
    label: '牛顿反光',
    spec: 'F/4 摄影牛反 · 45° 对角四叶蜘蛛星芒',
    defaultFocalMm: 600,
    defaultEyepieceMask: false,
    defaultSpikeStrength: 0.95,
    spikeMode: 3,
  },
  refractor: {
    id: 'refractor',
    label: 'APO 折射',
    spec: '三片式复消色差折射镜 · 无遮挡纯净圆星点',
    defaultFocalMm: 420,
    defaultEyepieceMask: false,
    defaultSpikeStrength: 0.15,
    spikeMode: 0,
  },
};

export const ASTRO_FILTER_LABELS: Record<AstroFilterMode, string> = {
  lrgb: 'L-RGB 真彩',
  sho: 'SHO 哈勃调色',
  ha: 'Hα 656nm',
  oiii: 'O III 500nm',
  ir: 'NIR 近红外',
};

export const DEFAULT_ASTRO_SETTINGS: AstroPhotoSettings = {
  telescope: 'eyepiece',
  filter: 'lrgb',
  focalLengthMm: 480,
  iso: 1600,
  subExposureSec: 8,
  targetFrames: 48,
  bortle: 2,
  defocus: 0,
  stretch: 0.44,
  blackPoint: 0.03,
  saturation: 1.08,
  spikeStrength: 0.25,
  eyepieceMask: true,
  showReticle: true,
  mountLock: true,
  includeObservatoryPlate: true,
};

export function focalLengthToFovDeg(focalLengthMm: number): number {
  const f = THREE.MathUtils.clamp(focalLengthMm, 200, 2400);
  const raw = ((2 * Math.atan(135 / f) * 180) / Math.PI) * 1.15;
  return THREE.MathUtils.clamp(raw, 12, 56);
}

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SPIKE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  uniform vec2 uTexel;
  uniform float uSpikeMode; // 0=none, 1=hubble 4-cross, 2=jwst 6+2 hex, 3=newtonian 4-diag
  uniform float uDefocus;

  varying vec2 vUv;

  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 brightSample(vec2 uv) {
    vec3 c = texture2D(uScene, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
    float y = luma(c);
    float gate = smoothstep(0.55, 1.35, y);
    return c * gate;
  }

  vec3 sampleSpikeAxis(vec2 dir, float maxLenPx, float chromDisp) {
    vec3 acc = vec3(0.0);
    for (int i = 1; i <= 10; i++) {
      float fi = float(i);
      float w = exp(-fi * 0.28);
      vec2 stepUv = dir * uTexel * (fi * (maxLenPx * 0.1));
      if (chromDisp > 0.01) {
        float rPos = brightSample(vUv + stepUv * (1.0 + chromDisp)).r;
        float rNeg = brightSample(vUv - stepUv * (1.0 + chromDisp)).r;
        float gPos = brightSample(vUv + stepUv).g;
        float gNeg = brightSample(vUv - stepUv).g;
        float bPos = brightSample(vUv + stepUv * (1.0 - chromDisp)).b;
        float bNeg = brightSample(vUv - stepUv * (1.0 - chromDisp)).b;
        acc += vec3(rPos + rNeg, gPos + gNeg, bPos + bNeg) * (0.5 * w);
      } else {
        vec3 pos = brightSample(vUv + stepUv);
        vec3 neg = brightSample(vUv - stepUv);
        acc += (pos + neg) * (0.5 * w);
      }
    }
    return acc;
  }

  vec3 sampleDefocusBokeh(float radiusPx, float isReflector) {
    vec3 acc = vec3(0.0);
    float wSum = 0.0;
    for (int i = 0; i < 12; i++) {
      float ang = float(i) * 0.52359877;
      vec2 cs = vec2(cos(ang), sin(ang));
      vec2 outerUv = vUv + cs * uTexel * radiusPx;
      acc += texture2D(uScene, clamp(outerUv, vec2(0.001), vec2(0.999))).rgb * 1.1;
      wSum += 1.1;
      if (isReflector < 0.5) {
        vec2 innerUv = vUv + cs * uTexel * (radiusPx * 0.45);
        acc += texture2D(uScene, clamp(innerUv, vec2(0.001), vec2(0.999))).rgb * 0.9;
        wSum += 0.9;
      }
    }
    return acc / max(1.0, wSum);
  }

  void main() {
    vec3 spike = vec3(0.0);

    if (uSpikeMode > 0.5 && uSpikeMode < 1.5) {
      // Hubble 4-ray orthogonal cross
      spike += sampleSpikeAxis(vec2(1.0, 0.0), 46.0, 0.04);
      spike += sampleSpikeAxis(vec2(0.0, 1.0), 46.0, 0.04);
      spike *= 0.24;
    } else if (uSpikeMode >= 1.5 && uSpikeMode < 2.5) {
      // JWST 6-ray hexagonal primary + 2 vertical strut spikes
      spike += sampleSpikeAxis(vec2(1.0, 0.0), 54.0, 0.08);
      spike += sampleSpikeAxis(vec2(0.5, 0.8660254), 54.0, 0.08);
      spike += sampleSpikeAxis(vec2(-0.5, 0.8660254), 54.0, 0.08);
      spike += sampleSpikeAxis(vec2(0.0, 1.0), 32.0, 0.04) * 0.35;
      spike *= 0.22;
    } else if (uSpikeMode >= 2.5) {
      // Newtonian 45-deg diagonal 4-ray spider vanes
      spike += sampleSpikeAxis(vec2(0.7071068, 0.7071068), 44.0, 0.05);
      spike += sampleSpikeAxis(vec2(-0.7071068, 0.7071068), 44.0, 0.05);
      spike *= 0.24;
    }

    vec3 bokeh = vec3(0.0);
    if (uDefocus > 0.005) {
      float isReflector = (uSpikeMode > 0.5 && uSpikeMode < 3.5) ? 1.0 : 0.0;
      bokeh = sampleDefocusBokeh(uDefocus * 14.0, isReflector);
    }

    gl_FragColor = vec4(spike + bokeh, 1.0);
  }
`;

const ACCUM_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  uniform sampler2D uSpike;
  uniform sampler2D uPrevAccum;
  uniform float uStackCount;
  uniform float uSpikeStrength;
  uniform float uFilterMode; // 0=lrgb, 1=sho, 2=ha, 3=oiii, 4=ir
  uniform float uIsoGain;
  uniform float uExposureScale;
  uniform float uBortleFloor;
  uniform float uFrameSeed;
  uniform float uDefocus;
  uniform float uChromShift;

  varying vec2 vUv;

  float hash12(vec2 p, float seed) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031 + vec3(seed * 0.317, seed * 0.619, seed * 0.193));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float triNoise(vec2 px, float seed) {
    float r1 = hash12(px, seed);
    float r2 = hash12(px + vec2(37.2, 19.7), seed + 13.7);
    return (r1 + r2) - 1.0;
  }

  vec3 applyAstroFilter(vec3 c, float mode) {
    if (mode < 0.5) {
      return c;
    } else if (mode < 1.5) {
      // SHO Hubble Palette (SII -> R, Ha -> G, OIII -> B/Teal)
      float s2 = c.r * 0.90 + c.g * 0.28;
      float ha = c.r * 0.42 + c.g * 0.68 + c.b * 0.08;
      float o3 = c.g * 0.42 + c.b * 0.94;
      return vec3(
        s2 * 0.98 + ha * 0.22,
        ha * 0.72 + o3 * 0.38,
        o3 * 0.92 + s2 * 0.06
      );
    } else if (mode < 2.5) {
      // Ha 656.3nm Crimson Narrowband
      float ha = dot(c, vec3(0.76, 0.20, 0.04));
      return vec3(ha * 1.38, ha * 0.20, ha * 0.14);
    } else if (mode < 3.5) {
      // OIII 500.7nm Teal-Cyan Narrowband
      float o3 = dot(c, vec3(0.08, 0.56, 0.62));
      return vec3(o3 * 0.12, o3 * 1.05, o3 * 1.18);
    } else {
      // NIR 850nm Infrared Monochrome Silver-Amber
      float nir = dot(c, vec3(0.62, 0.28, 0.10));
      return vec3(nir * 1.18, nir * 0.96, nir * 0.76);
    }
  }

  void main() {
    vec2 radial = vUv - vec2(0.5);
    vec2 shift = radial * uChromShift;
    vec3 rawScene = texture2D(uScene, vUv).rgb;
    if (uChromShift > 0.0002) {
      rawScene.r = texture2D(uScene, clamp(vUv + shift, vec2(0.001), vec2(0.999))).r;
      rawScene.b = texture2D(uScene, clamp(vUv - shift, vec2(0.001), vec2(0.999))).b;
    }

    vec3 spikeCol = texture2D(uSpike, vUv).rgb;
    float defocusMix = smoothstep(0.0, 0.28, uDefocus) * 0.88;
    vec3 col = mix(rawScene, spikeCol, defocusMix);
    col += spikeCol * (uSpikeStrength * (1.0 - smoothstep(0.0, 0.65, uDefocus) * 0.65));

    col = applyAstroFilter(col, uFilterMode);

    // Skyglow floor from Bortle 1..9 (amber-cyan light pollution dome)
    vec3 skyGlow = vec3(0.0014, 0.0016, 0.0022) * uBortleFloor;
    col = col * uExposureScale * uIsoGain + skyGlow * (0.55 + 0.45 * uIsoGain);

    // Authentic Poisson shot noise + CMOS read noise (averages down by 1/sqrt(N) on stack!)
    vec2 px = gl_FragCoord.xy;
    float shotSigma = sqrt(max(vec3(0.0), col).g * 0.014 + uBortleFloor * 0.0008);
    float readSigma = 0.011 * sqrt(max(0.2, uIsoGain));
    vec3 sensorNoise = vec3(
      triNoise(px, uFrameSeed + 1.1),
      triNoise(px, uFrameSeed + 5.7),
      triNoise(px, uFrameSeed + 11.3)
    ) * (shotSigma + readSigma);

    vec3 subFrame = max(vec3(0.0), col + sensorNoise);

    if (uStackCount <= 1.0) {
      gl_FragColor = vec4(subFrame, 1.0);
      return;
    }

    vec3 prev = texture2D(uPrevAccum, vUv).rgb;
    vec3 averaged = mix(prev, subFrame, 1.0 / uStackCount);
    gl_FragColor = vec4(averaged, 1.0);
  }
`;

const DISPLAY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAccum;
  uniform float uAspect;
  uniform float uStretch;
  uniform float uBlackPoint;
  uniform float uSaturation;
  uniform float uEyepieceMask;
  uniform float uShowReticle;

  varying vec2 vUv;

  float safeAsinh(float x) {
    return log(x + sqrt(x * x + 1.0));
  }

  vec3 acesFilmic(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void main() {
    vec3 raw = texture2D(uAccum, vUv).rgb;

    // 1. Darkroom black-point clip
    float bp = clamp(uBlackPoint, 0.0, 0.45);
    vec3 col = max(vec3(0.0), raw - vec3(bp)) / max(0.08, 1.0 - bp);

    // 2. Luminance-preserving Asinh deep-sky stretch (standard astrophotography curve)
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float beta = mix(1.0, 26.0, uStretch * uStretch);
    if (lum > 1e-5) {
      float stretchedLum = safeAsinh(lum * beta) / safeAsinh(beta);
      col *= stretchedLum / lum;
    }

    // 3. Saturation control
    float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(vec3(0.0), mix(vec3(gray), col, uSaturation));

    // 4. ACES Filmic + Linear->sRGB gamma encode
    col = acesFilmic(col);
    col = pow(max(vec3(0.0), col), vec3(1.0 / 2.2));

    // Aspect-corrected radial coordinate centered at (0.5, 0.5)
    vec2 p = (vUv - vec2(0.5)) * vec2(uAspect, 1.0);
    float r = length(p);

    // Natural subtle corner optical vignetting
    float cornerVig = 1.0 - smoothstep(0.42, 0.95, r) * 0.28;
    col *= cornerVig;

    // Eyepiece optical reticle crosshair & tick marks
    if (uShowReticle > 0.5) {
      float innerGap = smoothstep(0.032, 0.038, r);
      float hLine = (1.0 - smoothstep(0.0, 0.0018, abs(p.y))) * innerGap;
      float vLine = (1.0 - smoothstep(0.0, 0.0018, abs(p.x))) * innerGap;
      float ringA = 1.0 - smoothstep(0.0, 0.0022, abs(r - 0.14));
      float ringB = 1.0 - smoothstep(0.0, 0.0022, abs(r - 0.30));
      float reticleMask = clamp(max(max(hLine, vLine) * 0.55, max(ringA, ringB) * 0.45), 0.0, 1.0);
      reticleMask *= 1.0 - smoothstep(0.40, 0.45, r);
      col = mix(col, vec3(0.95, 0.36, 0.28), reticleMask * 0.48);
    }

    // Circular telescope eyepiece field stop + subtle optical glass rim
    if (uEyepieceMask > 0.5) {
      float fieldRadius = 0.455;
      float inside = 1.0 - smoothstep(fieldRadius - 0.008, fieldRadius + 0.004, r);
      float bevelGlow = exp(-pow((r - fieldRadius) / 0.011, 2.0)) * 0.16;
      col = col * inside + vec3(0.28, 0.55, 0.85) * bevelGlow;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

function mapFilterToFloat(filter: AstroFilterMode): number {
  switch (filter) {
    case 'sho':
      return 1;
    case 'ha':
      return 2;
    case 'oiii':
      return 3;
    case 'ir':
      return 4;
    case 'lrgb':
    default:
      return 0;
  }
}

export class AstroPhotoPipeline {
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadGeo = new THREE.PlaneGeometry(2, 2);
  private quadMesh: THREE.Mesh;

  private spikeMat: THREE.ShaderMaterial;
  private accumMat: THREE.ShaderMaterial;
  private displayMat: THREE.ShaderMaterial;

  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private spikeTarget: THREE.WebGLRenderTarget | null = null;
  private accumTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private targetWidth = 0;
  private targetHeight = 0;

  private readIdx = 0;
  private stackedFrames = 0;

  constructor() {
    this.spikeMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 640, 1 / 360) },
        uSpikeMode: { value: 0 },
        uDefocus: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: SPIKE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.accumMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null },
        uSpike: { value: null },
        uPrevAccum: { value: null },
        uStackCount: { value: 1 },
        uSpikeStrength: { value: 0.25 },
        uFilterMode: { value: 0 },
        uIsoGain: { value: 1 },
        uExposureScale: { value: 1 },
        uBortleFloor: { value: 1 },
        uFrameSeed: { value: 1 },
        uDefocus: { value: 0 },
        uChromShift: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: ACCUM_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.displayMat = new THREE.ShaderMaterial({
      uniforms: {
        uAccum: { value: null },
        uAspect: { value: 16 / 9 },
        uStretch: { value: 0.44 },
        uBlackPoint: { value: 0.03 },
        uSaturation: { value: 1.08 },
        uEyepieceMask: { value: 1 },
        uShowReticle: { value: 1 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: DISPLAY_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.quadMesh = new THREE.Mesh(this.quadGeo, this.displayMat);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
  }

  public getStackedFrames(): number {
    return this.stackedFrames;
  }

  public resetStack(): void {
    this.stackedFrames = 0;
    this.readIdx = 0;
  }

  public getStatus(
    settings: AstroPhotoSettings,
    stacking: boolean,
    completed: boolean
  ): AstroStackStatus {
    return {
      stacking,
      stackedFrames: this.stackedFrames,
      targetFrames: settings.targetFrames,
      totalExposureSec: this.stackedFrames * settings.subExposureSec,
      snrGain: Math.sqrt(Math.max(1, this.stackedFrames)),
      completed,
    };
  }

  private supportsHalfFloatRender(renderer: THREE.WebGLRenderer): boolean {
    if (!renderer.capabilities.isWebGL2) return false;
    const gl = renderer.getContext();
    return Boolean(
      gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
    );
  }

  private ensureTargets(renderer: THREE.WebGLRenderer): void {
    const drawingSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(drawingSize);
    const w = Math.max(2, Math.floor(drawingSize.x));
    const h = Math.max(2, Math.floor(drawingSize.y));

    if (this.sceneTarget && this.targetWidth === w && this.targetHeight === h) {
      return;
    }

    this.disposeTargets();
    this.targetWidth = w;
    this.targetHeight = h;

    const texType = this.supportsHalfFloatRender(renderer)
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: texType,
      depthBuffer: true,
    });

    const sw = Math.max(2, Math.floor(w / 2));
    const sh = Math.max(2, Math.floor(h / 2));
    this.spikeTarget = new THREE.WebGLRenderTarget(sw, sh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: texType,
      depthBuffer: false,
    });

    const accumOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: texType,
      depthBuffer: false,
    };
    this.accumTargets = [
      new THREE.WebGLRenderTarget(w, h, accumOpts),
      new THREE.WebGLRenderTarget(w, h, accumOpts),
    ];

    this.stackedFrames = 0;
    this.readIdx = 0;
  }

  public renderFrame(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    settings: AstroPhotoSettings,
    mode: 'live' | 'stack' | 'frozen',
    timeSec: number
  ): AstroStackStatus {
    this.ensureTargets(renderer);
    if (!this.sceneTarget || !this.spikeTarget || !this.accumTargets) {
      return this.getStatus(settings, false, false);
    }

    const sw = this.spikeTarget.width;
    const sh = this.spikeTarget.height;
    const presetSpec = ASTRO_TELESCOPE_PRESETS[settings.telescope];

    if (mode !== 'frozen' || this.stackedFrames === 0) {
      // 1. Render crisp linear HDR base scene into sceneTarget
      renderer.setRenderTarget(this.sceneTarget);
      renderer.clear();
      renderer.render(scene, camera);

      // 2. Half-res diffraction starburst & optical defocus pass
      this.spikeMat.uniforms.uScene.value = this.sceneTarget.texture;
      this.spikeMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.spikeMat.uniforms.uSpikeMode.value = presetSpec.spikeMode;
      this.spikeMat.uniforms.uDefocus.value = settings.defocus;
      this.quadMesh.material = this.spikeMat;
      renderer.setRenderTarget(this.spikeTarget);
      renderer.render(this.quadScene, this.quadCam);

      // 3. Running average accumulation ping-pong pass (strictly distinct read vs write FBOs)
      if (mode === 'stack') {
        this.stackedFrames = Math.min(settings.targetFrames, this.stackedFrames + 1);
      } else {
        this.stackedFrames = 1;
      }

      const writeIdx = this.stackedFrames <= 1 ? 0 : 1 - this.readIdx;
      const safePrevIdx = 1 - writeIdx;
      const isoGain = settings.iso / 1600;
      const exposureScale = 0.72 + Math.sqrt(settings.subExposureSec / 8) * 0.44;
      const chromShift =
        settings.telescope === 'eyepiece'
          ? 0.0022
          : settings.telescope === 'newtonian'
            ? 0.001
            : 0.0;

      this.accumMat.uniforms.uScene.value = this.sceneTarget.texture;
      this.accumMat.uniforms.uSpike.value = this.spikeTarget.texture;
      this.accumMat.uniforms.uPrevAccum.value = this.accumTargets[safePrevIdx].texture;
      this.accumMat.uniforms.uStackCount.value = mode === 'stack' ? this.stackedFrames : 1.0;
      this.accumMat.uniforms.uSpikeStrength.value = settings.spikeStrength;
      this.accumMat.uniforms.uFilterMode.value = mapFilterToFloat(settings.filter);
      this.accumMat.uniforms.uIsoGain.value = isoGain;
      this.accumMat.uniforms.uExposureScale.value = exposureScale;
      this.accumMat.uniforms.uBortleFloor.value = Math.max(0, settings.bortle - 1);
      this.accumMat.uniforms.uFrameSeed.value = (timeSec * 19.37 + this.stackedFrames * 3.17) % 1000;
      this.accumMat.uniforms.uDefocus.value = settings.defocus;
      this.accumMat.uniforms.uChromShift.value = chromShift;

      this.quadMesh.material = this.accumMat;
      renderer.setRenderTarget(this.accumTargets[writeIdx]);
      renderer.render(this.quadScene, this.quadCam);
      this.readIdx = writeIdx;
    }

    // 4. Darkroom non-destructive Asinh display pass to default framebuffer
    this.renderDisplayToScreen(renderer, settings);

    const isStacking = mode === 'stack' && this.stackedFrames < settings.targetFrames;
    const isCompleted =
      (mode === 'stack' && this.stackedFrames >= settings.targetFrames) ||
      (mode === 'frozen' && this.stackedFrames > 0);
    if (mode === 'live') {
      // Live viewfinder carries 0 accumulated stack frames until stacking starts
      this.stackedFrames = 0;
      return this.getStatus(settings, false, false);
    }
    return this.getStatus(settings, isStacking, isCompleted);
  }

  private renderDisplayToScreen(
    renderer: THREE.WebGLRenderer,
    settings: AstroPhotoSettings
  ): void {
    if (!this.accumTargets) return;
    this.displayMat.uniforms.uAccum.value = this.accumTargets[this.readIdx].texture;
    this.displayMat.uniforms.uAspect.value = this.targetWidth / Math.max(1, this.targetHeight);
    this.displayMat.uniforms.uStretch.value = settings.stretch;
    this.displayMat.uniforms.uBlackPoint.value = settings.blackPoint;
    this.displayMat.uniforms.uSaturation.value = settings.saturation;
    this.displayMat.uniforms.uEyepieceMask.value = settings.eyepieceMask ? 1.0 : 0.0;
    this.displayMat.uniforms.uShowReticle.value = settings.showReticle ? 1.0 : 0.0;

    this.quadMesh.material = this.displayMat;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }

  public exportPhotoPng(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    timeSec: number,
    meta: {
      targetTitle: string | null;
      scenarioName: string;
      settings: AstroPhotoSettings;
      status: AstroStackStatus;
    }
  ): { filename: string; width: number; height: number } {
    if (!this.accumTargets) {
      this.renderFrame(renderer, scene, camera, meta.settings, 'live', timeSec);
    } else {
      this.renderDisplayToScreen(renderer, meta.settings);
    }
    const glCanvas = renderer.domElement;
    const w = Math.max(2, glCanvas.width);
    const h = Math.max(2, glCanvas.height);
    const plateH = meta.settings.includeObservatoryPlate ? 84 : 0;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h + plateH;
    const ctx = outCanvas.getContext('2d');

    if (ctx) {
      ctx.drawImage(glCanvas, 0, 0, w, h);

      if (plateH > 0) {
        const grad = ctx.createLinearGradient(0, h, 0, h + plateH);
        grad.addColorStop(0, '#060c18');
        grad.addColorStop(1, '#03060d');
        ctx.fillStyle = grad;
        ctx.fillRect(0, h, w, plateH);

        ctx.strokeStyle = 'rgba(92, 225, 255, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h + 0.5);
        ctx.lineTo(w, h + 0.5);
        ctx.stroke();

        const rig = ASTRO_TELESCOPE_PRESETS[meta.settings.telescope];
        const filterLabel = ASTRO_FILTER_LABELS[meta.settings.filter];
        const fov = focalLengthToFovDeg(meta.settings.focalLengthMm).toFixed(1);
        const title = meta.targetTitle || meta.scenarioName;

        ctx.fillStyle = '#eef4ff';
        ctx.font = '600 18px "Inter", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(`🔭 ${title}`, 24, h + 34);

        ctx.fillStyle = '#8ea4c8';
        ctx.font = '13px "JetBrains Mono", "Inter", "PingFang SC", sans-serif';
        const stackSummary =
          meta.status.stackedFrames > 0
            ? `${meta.status.stackedFrames}×${meta.settings.subExposureSec}s (${meta.status.totalExposureSec}s) · SNR ×${meta.status.snrGain.toFixed(1)}`
            : '单帧实时观测';
        ctx.fillText(
          `${rig.label} · ${meta.settings.focalLengthMm}mm (FOV ${fov}°) · ${filterLabel} · ISO ${meta.settings.iso} · ${stackSummary} · Bortle ${meta.settings.bortle}`,
          24,
          h + 62
        );

        ctx.fillStyle = '#5ce1ff';
        ctx.font = '600 12px "JetBrains Mono", "Inter", sans-serif';
        const rightTag = 'CosmosBox Virtual Observatory';
        const tagWidth = ctx.measureText(rightTag).width;
        ctx.fillText(rightTag, Math.max(24, w - tagWidth - 24), h + 34);
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `CosmosBox-Astro-${meta.settings.telescope}-${stamp}.png`;
    const url = outCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return { filename, width: outCanvas.width, height: outCanvas.height };
  }

  public resize(renderer: THREE.WebGLRenderer): boolean {
    const drawingSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(drawingSize);
    const w = Math.max(2, Math.floor(drawingSize.x));
    const h = Math.max(2, Math.floor(drawingSize.y));
    if (this.targetWidth === w && this.targetHeight === h) {
      return false;
    }
    this.targetWidth = 0;
    this.targetHeight = 0;
    return true;
  }

  private disposeTargets(): void {
    this.sceneTarget?.dispose();
    this.spikeTarget?.dispose();
    this.accumTargets?.[0].dispose();
    this.accumTargets?.[1].dispose();
    this.sceneTarget = null;
    this.spikeTarget = null;
    this.accumTargets = null;
  }

  public dispose(): void {
    this.disposeTargets();
    this.quadGeo.dispose();
    this.spikeMat.dispose();
    this.accumMat.dispose();
    this.displayMat.dispose();
  }
}
