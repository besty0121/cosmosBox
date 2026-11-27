import * as THREE from 'three';

const STAR_COUNT = 1200;

/**
 * Pure 3D Straight-Perspective Starlight-Needle Tunnel FX:
 * - Renders 2,200 screen-space-slim 3D stars rushing straight from ahead (-Z) past camera (+Z),
 *   stretching smoothly into needle-thin light streaks during acceleration and contracting cleanly
 *   back to crisp pinpoints upon emergence into the destination universe.
 * - Zero cylindrical caustics, zero concentric plastic rings, zero chopped confetti wedges, and
 *   calibrated below UnrealBloomPass HDR blowout threshold so streaks stay razor-sharp.
 */
export class WormholeTunnelFX {
  private group: THREE.Group;
  private starStreakMesh: THREE.Mesh;
  private starMaterial: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, _milkyWayTex?: THREE.Texture) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.frustumCulled = false;
    scene.add(this.group);

    // 1. 2,200 Straight-Perspective Hairline 3D Starlight Needles
    const starGeo = this.buildStarStreakGeometry();
    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTravel: { value: 0 },
        uWarp: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        attribute vec3 aStarColor;
        attribute vec2 aCorner;
        attribute float aSize;

        uniform float uTravel;
        uniform float uWarp;

        varying vec2 vUv;
        varying vec3 vColor;
        varying float vDistFade;

        void main() {
          vUv = vec2(aCorner.x * 0.5 + 0.5, aCorner.y);

          // Pure straight-line 3D forward travel along +Z toward/past camera (-135 -> +15)
          float zHead = -135.0 + fract(aSeed.z + uTravel * aSeed.w) * 150.0;
          float streakLen = mix(0.65, 28.0 * aSeed.w, uWarp * uWarp);
          float zTail = zHead - streakLen;

          if (zTail >= -0.45) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vDistFade = 0.0;
            vColor = vec3(0.0);
            return;
          }

          float zPos = mix(min(zTail, -0.45), min(zHead, -0.35), aCorner.y);
          vec3 centerPos = vec3(cos(aSeed.x) * aSeed.y, sin(aSeed.x) * aSeed.y, zPos);
          vec3 radialPerp = vec3(-sin(aSeed.x), cos(aSeed.x), 0.0);

          // Constant small angular half-width -> crisp 1.5-3px anti-aliased light needles at any depth
          float pxAngle = mix(0.0018, 0.0036, aSize);
          float halfW = (-zPos) * pxAngle * mix(0.45, 1.0, aCorner.y);
          vec3 localPos = centerPos + radialPerp * (aCorner.x * halfW);

          vDistFade = smoothstep(-135.0, -82.0, zPos) * (1.0 - smoothstep(-1.8, -0.35, zPos) * 0.45);

          // Subtle relativistic blueshift capped strictly <= 0.88 to prevent UnrealBloom blowout
          vec3 blueshift = mix(aStarColor, vec3(0.50, 0.76, 0.88), clamp(uWarp * 0.42, 0.0, 0.5));
          vColor = min(mix(blueshift, vec3(0.82, 0.86, 0.88), aCorner.y * uWarp * 0.38), vec3(0.88));

          gl_Position = projectionMatrix * modelViewMatrix * vec4(localPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;

        varying vec2 vUv;
        varying vec3 vColor;
        varying float vDistFade;

        void main() {
          if (vDistFade < 0.01 || uOpacity < 0.005) discard;

          float wq = (vUv.x - 0.5) * 3.4;
          float across = exp(-wq * wq);

          // Smooth trailing tail AND rounded glowing tip (zero chopped flat edges!)
          float tailFade = pow(max(1e-4, vUv.y), 1.45);
          float tipRound = 1.0 - smoothstep(0.86, 1.0, vUv.y);
          float along = tailFade * tipRound * 1.35;

          float alpha = clamp(across * along * vDistFade * uOpacity * 0.64, 0.0, 0.68);
          if (alpha < 0.004) discard;

          gl_FragColor = vec4(vColor * (0.78 + 0.32 * vUv.y), alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.starStreakMesh = new THREE.Mesh(starGeo, this.starMaterial);
    this.starStreakMesh.frustumCulled = false;
    this.starStreakMesh.renderOrder = 16;
    this.group.add(this.starStreakMesh);
  }

  private buildStarStreakGeometry(): THREE.BufferGeometry {
    const vertsPerQuad = 4;
    const indicesPerQuad = 6;
    const seeds = new Float32Array(STAR_COUNT * vertsPerQuad * 4);
    const colors = new Float32Array(STAR_COUNT * vertsPerQuad * 3);
    const corners = new Float32Array(STAR_COUNT * vertsPerQuad * 2);
    const sizes = new Float32Array(STAR_COUNT * vertsPerQuad);
    const positions = new Float32Array(STAR_COUNT * vertsPerQuad * 3);
    const indices = new Uint32Array(STAR_COUNT * indicesPerQuad);

    const palette = [
      new THREE.Color('#7ec4ff'),
      new THREE.Color('#a6e4ff'),
      new THREE.Color('#edf5ff'),
      new THREE.Color('#ffffff'),
      new THREE.Color('#ffe4b8'),
      new THREE.Color('#c4b2ff'),
    ];

    let s = 42791;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    const cornerCoords: [number, number][] = [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ];

    for (let i = 0; i < STAR_COUNT; i++) {
      const ang = rand() * Math.PI * 2;
      const radius = 1.45 + Math.pow(rand(), 1.0) * 24.0;
      const zPhase = rand();
      const speed = 0.65 + rand() * 1.25;
      const starSize = 0.55 + rand() * 0.45;

      const c = palette[Math.floor(rand() * palette.length)];
      const mag = 0.44 + Math.pow(rand(), 2.2) * 0.48;

      const baseV = i * vertsPerQuad;
      for (let v = 0; v < vertsPerQuad; v++) {
        const idx = baseV + v;
        seeds[idx * 4] = ang;
        seeds[idx * 4 + 1] = radius;
        seeds[idx * 4 + 2] = zPhase;
        seeds[idx * 4 + 3] = speed;

        colors[idx * 3] = Math.min(0.92, c.r * mag);
        colors[idx * 3 + 1] = Math.min(0.92, c.g * mag);
        colors[idx * 3 + 2] = Math.min(0.94, c.b * mag);

        corners[idx * 2] = cornerCoords[v][0];
        corners[idx * 2 + 1] = cornerCoords[v][1];
        sizes[idx] = starSize;
      }

      const baseI = i * indicesPerQuad;
      indices[baseI] = baseV;
      indices[baseI + 1] = baseV + 1;
      indices[baseI + 2] = baseV + 2;
      indices[baseI + 3] = baseV;
      indices[baseI + 4] = baseV + 2;
      indices[baseI + 5] = baseV + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aStarColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  public setActive(active: boolean): void {
    this.group.visible = active;
  }

  public sync(
    camera: THREE.PerspectiveCamera,
    travel: number,
    warpIntensity: number,
    opacity: number,
    _flashIntensity = 0
  ): void {
    this.group.visible = opacity > 0.005;
    if (!this.group.visible) return;

    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);

    this.starMaterial.uniforms.uTravel.value = travel;
    this.starMaterial.uniforms.uWarp.value = warpIntensity;
    this.starMaterial.uniforms.uOpacity.value = opacity;
  }

  public dispose(): void {
    this.group.parent?.remove(this.group);
    this.starStreakMesh.geometry.dispose();
    this.starMaterial.dispose();
  }
}
