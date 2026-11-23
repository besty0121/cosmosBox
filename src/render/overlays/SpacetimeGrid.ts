import * as THREE from 'three';
import { METERS_TO_SCENE, M_EARTH } from '../../physics/constants';
import { CelestialBody, GravitationalWaveSource, Vec3 } from '../../types/cosmos';

const MAX_WELLS = 16;
const MAX_GW_BURSTS = 4;

interface ActiveGwBurst {
  centerMeters: Vec3;
  age: number;
  maxAge: number;
  speedScenePerSec: number;
}

/**
 * Real-time 3D Spacetime Curvature Gravity Potential Mesh + Gravitational Wave Ripple Visualizer:
 * - Bends a glowing coordinate grid downward beneath stars, planets, and black holes
 * - Renders live rotating twin-arm Archimedean spiral gravitational waves around inspiraling binary BH/NS pairs
 * - Propagates high-energy annular merger ringdown waves across spacetime after compact mergers!
 */
export class SpacetimeGrid {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private scene: THREE.Scene;
  private wellPositions: THREE.Vector3[];
  private wellWeights: number[];
  private burstCenters: THREE.Vector3[];
  private burstRadii: number[];
  private burstAmps: number[];
  private bursts: ActiveGwBurst[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.wellPositions = Array.from({ length: MAX_WELLS }, () => new THREE.Vector3());
    this.wellWeights = new Array(MAX_WELLS).fill(0);
    this.burstCenters = Array.from({ length: MAX_GW_BURSTS }, () => new THREE.Vector3());
    this.burstRadii = new Array(MAX_GW_BURSTS).fill(0);
    this.burstAmps = new Array(MAX_GW_BURSTS).fill(0);

    const geo = new THREE.PlaneGeometry(2, 2, 128, 128);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uGridScale: { value: 600 },
        uGridOffset: { value: new THREE.Vector2(0, 0) },
        uWellCount: { value: 0 },
        uWellPositions: { value: this.wellPositions },
        uWellWeights: { value: this.wellWeights },
        uMaxDepth: { value: 90 },
        // Live inspiral gravitational waves
        uGwActive: { value: 0 },
        uGwCenter: { value: new THREE.Vector3() },
        uGwPhase: { value: 0 },
        uGwAmp: { value: 0 },
        // Expanding merger shockwaves
        uBurstCount: { value: 0 },
        uBurstCenters: { value: this.burstCenters },
        uBurstRadii: { value: this.burstRadii },
        uBurstAmps: { value: this.burstAmps },
      },
      vertexShader: /* glsl */ `
        uniform float uGridScale;
        uniform int uWellCount;
        uniform vec3 uWellPositions[${MAX_WELLS}];
        uniform float uWellWeights[${MAX_WELLS}];
        uniform float uMaxDepth;

        uniform float uGwActive;
        uniform vec3 uGwCenter;
        uniform float uGwPhase;
        uniform float uGwAmp;

        uniform int uBurstCount;
        uniform vec3 uBurstCenters[${MAX_GW_BURSTS}];
        uniform float uBurstRadii[${MAX_GW_BURSTS}];
        uniform float uBurstAmps[${MAX_GW_BURSTS}];

        varying vec2 vLocalUv;
        varying float vDepthNorm;
        varying float vWaveCrest;
        varying vec2 vWorldXZ;

        void main() {
          vLocalUv = position.xz;
          vec3 wp = vec3(position.x * uGridScale, 0.0, position.z * uGridScale);
          vWorldXZ = wp.xz;

          float soft = max(4.5, uGridScale * 0.032);
          float depth = 0.0;
          for (int i = 0; i < ${MAX_WELLS}; i++) {
            if (i >= uWellCount) break;
            vec2 d = wp.xz - uWellPositions[i].xz;
            float r2 = dot(d, d) + soft * soft;
            float invR = inversesqrt(r2);
            depth += uWellWeights[i] * invR * uGridScale * 0.14;
          }

          float cappedDepth = uMaxDepth * (1.0 - exp(-depth / max(uMaxDepth, 1.0)));
          wp.y -= cappedDepth;
          vDepthNorm = clamp(cappedDepth / max(uMaxDepth * 0.72, 1.0), 0.0, 1.0);

          // 1. Live quadrupole two-arm spiral gravitational waves radiating from inspiraling binary BH/NS!
          float waveDisp = 0.0;
          float waveHighlight = 0.0;
          if (uGwActive > 0.5) {
            vec2 rel = wp.xz - uGwCenter.xz;
            float r = length(rel);
            float theta = atan(rel.y, rel.x);
            float k = 19.0 / max(uGridScale, 1.0);
            float spiral = cos(2.0 * (theta - uGwPhase) - r * k);
            float env = smoothstep(uGridScale * 0.04, uGridScale * 0.14, r) * exp(-r / max(uGridScale * 0.65, 1.0));
            float amp = uMaxDepth * 0.16 * uGwAmp * env;
            waveDisp += spiral * amp;
            waveHighlight += max(0.0, spiral) * env * uGwAmp * 1.1;
          }

          // 2. Expanding annular merger ringdown shockwaves!
          for (int b = 0; b < ${MAX_GW_BURSTS}; b++) {
            if (b >= uBurstCount) break;
            float r = length(wp.xz - uBurstCenters[b].xz);
            float dr = r - uBurstRadii[b];
            float width = max(8.0, uGridScale * 0.045);
            float ring = exp(-(dr * dr) / (width * width)) * cos(dr * 3.8 / width);
            waveDisp += ring * uMaxDepth * 0.24 * uBurstAmps[b];
            waveHighlight += abs(ring) * uBurstAmps[b] * 1.5;
          }

          wp.y += waveDisp;
          vWaveCrest = clamp(waveHighlight, 0.0, 1.2);

          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGridScale;
        uniform vec2 uGridOffset;

        varying vec2 vLocalUv;
        varying float vDepthNorm;
        varying float vWaveCrest;
        varying vec2 vWorldXZ;

        void main() {
          float rad = length(vLocalUv);
          if (rad > 1.0) discard;

          float cellSize = uGridScale / 18.0;
          vec2 gCoord = (vWorldXZ + uGridOffset) / max(cellSize, 0.001);
          vec2 frac = abs(fract(gCoord - 0.5) - 0.5);
          float lineDist = min(frac.x, frac.y);

          float minorLine = 1.0 - smoothstep(0.018, 0.048, lineDist);
          vec2 majorCoord = gCoord * 0.25;
          vec2 majorFrac = abs(fract(majorCoord - 0.5) - 0.5);
          float majorLine = 1.0 - smoothstep(0.008, 0.022, min(majorFrac.x, majorFrac.y));

          float grid = max(minorLine * 0.62, majorLine * 0.95);
          float wellFill = vDepthNorm * vDepthNorm * 0.28 + vWaveCrest * 0.22;
          float radialFade = smoothstep(1.0, 0.52, rad);

          vec3 flatCol = vec3(0.16, 0.62, 0.92);
          vec3 midCol = vec3(0.28, 0.92, 0.85);
          vec3 deepCol = vec3(1.0, 0.58, 0.20);
          vec3 extremeCol = vec3(1.15, 0.25, 0.62);
          vec3 gwViolet = vec3(0.72, 0.45, 1.45);

          vec3 col = mix(flatCol, midCol, smoothstep(0.0, 0.35, vDepthNorm));
          col = mix(col, deepCol, smoothstep(0.35, 0.72, vDepthNorm));
          col = mix(col, extremeCol, smoothstep(0.72, 1.0, vDepthNorm));
          col = mix(col, gwViolet, clamp(vWaveCrest * 0.85, 0.0, 0.88));

          float alpha = clamp((grid * (0.42 + vDepthNorm * 0.58 + vWaveCrest * 0.45) + wellFill) * radialFade, 0.0, 0.95);
          if (alpha < 0.01) discard;

          gl_FragColor = vec4(col * (1.0 + vDepthNorm * 0.45 + vWaveCrest * 0.55), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.scene.add(this.mesh);
  }

  public triggerMergerWave(centerMeters: Vec3): void {
    if (this.bursts.length >= MAX_GW_BURSTS) {
      this.bursts.shift();
    }
    this.bursts.push({
      centerMeters: { ...centerMeters },
      age: 0,
      maxAge: 5.5,
      speedScenePerSec: 110,
    });
  }

  public sync(
    visible: boolean,
    bodies: CelestialBody[],
    originMeters: Vec3,
    camera: THREE.PerspectiveCamera,
    gwSource: GravitationalWaveSource,
    dtReal: number
  ): void {
    // Always advance merger bursts so they finish cleanly
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age += dtReal;
      if (this.bursts[i].age >= this.bursts[i].maxAge) {
        this.bursts.splice(i, 1);
      }
    }

    this.mesh.visible = visible;
    if (!visible) return;

    const camDist = camera.position.length();
    const gridScale = Math.max(24, Math.min(9500, camDist * 1.45));
    const maxDepth = gridScale * 0.24;

    const ranked = bodies
      .filter((b) => b.alive && b.mass > 1e20)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, MAX_WELLS);

    for (let i = 0; i < ranked.length; i++) {
      const b = ranked[i];
      this.wellPositions[i].set(
        (b.position.x - originMeters.x) * METERS_TO_SCENE,
        (b.position.y - originMeters.y) * METERS_TO_SCENE,
        (b.position.z - originMeters.z) * METERS_TO_SCENE
      );

      const logEarth = Math.max(0.1, Math.log10(Math.max(1, b.mass / M_EARTH)) + 1.0);
      const bhBoost = b.category === 'black_hole' ? 2.4 : b.category === 'star' ? 1.35 : 0.48;
      this.wellWeights[i] = Math.pow(logEarth, 1.35) * bhBoost * 0.12;
    }

    const u = this.material.uniforms;
    u.uGridScale.value = gridScale;
    u.uMaxDepth.value = maxDepth;
    u.uWellCount.value = ranked.length;
    u.uGridOffset.value.set(
      (originMeters.x * METERS_TO_SCENE) % (gridScale / 4.5),
      (originMeters.z * METERS_TO_SCENE) % (gridScale / 4.5)
    );

    // Sync spiral gravitational wave source
    u.uGwActive.value = gwSource.active ? 1.0 : 0.0;
    if (gwSource.active) {
      u.uGwCenter.value.set(
        (gwSource.center.x - originMeters.x) * METERS_TO_SCENE,
        (gwSource.center.y - originMeters.y) * METERS_TO_SCENE,
        (gwSource.center.z - originMeters.z) * METERS_TO_SCENE
      );
      u.uGwPhase.value = gwSource.phase;
      u.uGwAmp.value = gwSource.amplitude;
    }

    // Sync expanding merger bursts
    u.uBurstCount.value = this.bursts.length;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      this.burstCenters[i].set(
        (b.centerMeters.x - originMeters.x) * METERS_TO_SCENE,
        (b.centerMeters.y - originMeters.y) * METERS_TO_SCENE,
        (b.centerMeters.z - originMeters.z) * METERS_TO_SCENE
      );
      this.burstRadii[i] = b.age * Math.max(b.speedScenePerSec, gridScale * 0.22);
      this.burstAmps[i] = Math.pow(1 - b.age / b.maxAge, 1.4);
    }
  }

  public dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
