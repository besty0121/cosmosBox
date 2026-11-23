import * as THREE from 'three';
import { METERS_TO_SCENE } from '../physics/constants';
import { DebrisParticle, Vec3 } from '../types/cosmos';

const MAX_RENDER_DEBRIS = 2200;

/**
 * High-performance GPU Points Shader Renderer for orbiting collision ejecta,
 * Roche tidal streams / newborn planetary rings, and expanding supernova nebulae.
 */
export class DebrisRenderer {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private glows: Float32Array;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.positions = new Float32Array(MAX_RENDER_DEBRIS * 3);
    this.colors = new Float32Array(MAX_RENDER_DEBRIS * 3);
    this.sizes = new Float32Array(MAX_RENDER_DEBRIS);
    this.glows = new Float32Array(MAX_RENDER_DEBRIS);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(this.glows, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aGlow;
        uniform float uPixelRatio;

        varying vec3 vColor;
        varying float vGlow;

        void main() {
          vColor = aColor;
          vGlow = aGlow;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          float dist = max(1.0, -mvPos.z);
          float atten = clamp(420.0 / dist, 0.65, 5.5);
          gl_PointSize = clamp(aSize * atten * uPixelRatio, 1.8, 22.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vGlow;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;

          // Crisp rocky core for cool debris, soft glowing plasma cloud for hot/supernova ejecta
          float edgeFade = smoothstep(1.0, 0.35, d);
          float core = exp(-d * d * mix(11.0, 5.2, vGlow));
          float halo = exp(-d * 3.4) * (0.24 + 0.48 * vGlow);
          float alpha = clamp((core + halo) * edgeFade, 0.0, 1.0);
          vec3 hotCore = mix(vColor, vec3(1.0, 0.96, 0.88), core * vGlow * 0.65);
          gl_FragColor = vec4(hotCore * (1.0 + vGlow * 0.85), alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.scene.add(this.points);
  }

  public sync(particles: DebrisParticle[], originMeters: Vec3): void {
    const count = Math.min(particles.length, MAX_RENDER_DEBRIS);
    const geo = this.points.geometry;

    if (count === 0) {
      geo.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const i3 = i * 3;
      this.positions[i3] = (p.position.x - originMeters.x) * METERS_TO_SCENE;
      this.positions[i3 + 1] = (p.position.y - originMeters.y) * METERS_TO_SCENE;
      this.positions[i3 + 2] = (p.position.z - originMeters.z) * METERS_TO_SCENE;

      const lifeFade = 1 - Math.pow(Math.min(1, p.age / p.maxAge), 2.5);

      if (p.kind === 'supernova') {
        this.colors[i3] = p.baseColor[0] * 1.45 * lifeFade;
        this.colors[i3 + 1] = p.baseColor[1] * 1.45 * lifeFade;
        this.colors[i3 + 2] = p.baseColor[2] * 1.45 * lifeFade;
        this.sizes[i] = p.size * (2.6 + (p.age / p.maxAge) * 2.4);
        this.glows[i] = 0.95 * lifeFade;
      } else {
        // Blend between cool rock/ice color and incandescent magma glow based on temperature
        const heat = Math.max(0, Math.min(1, (p.temperature - 550) / 1900));
        const hotR = 1.35;
        const hotG = 0.42 + heat * 0.52;
        const hotB = 0.08 + heat * heat * 0.35;

        this.colors[i3] = (p.baseColor[0] * (1 - heat) + hotR * heat) * lifeFade;
        this.colors[i3 + 1] = (p.baseColor[1] * (1 - heat) + hotG * heat) * lifeFade;
        this.colors[i3 + 2] = (p.baseColor[2] * (1 - heat) + hotB * heat) * lifeFade;
        this.sizes[i] = p.size * (1.8 + heat * 1.4);
        this.glows[i] = heat * 0.88;
      }
    }

    geo.setDrawRange(0, count);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aGlow as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
