import * as THREE from 'three';
import { METERS_TO_SCENE } from '../physics/constants';
import { GalaxyStarParticle } from '../physics/galaxySystem';
import { Vec3 } from '../types/cosmos';

const MAX_GALAXY_STARS = 4000;

/**
 * High-performance GPU Points Shader Renderer for the Spiral Galaxy Collision preset.
 * Renders thousands of multi-spectral spiral arm stars & glowing H-II star-forming knots at 60 FPS!
 */
export class GalaxyRenderer {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.positions = new Float32Array(MAX_GALAXY_STARS * 3);
    this.colors = new Float32Array(MAX_GALAXY_STARS * 3);
    this.sizes = new Float32Array(MAX_GALAXY_STARS);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;

        void main() {
          vColor = aColor;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          float dist = max(1.0, -mvPos.z);
          float atten = clamp(950.0 / dist, 0.85, 4.0);
          gl_PointSize = clamp(aSize * atten * uPixelRatio, 1.8, 16.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;
          float core = exp(-d * d * 7.5);
          float halo = exp(-d * 2.8) * 0.48;
          float alpha = clamp(core + halo, 0.0, 1.0);
          vec3 col = mix(vColor, vec3(1.0, 0.98, 0.94), core * 0.45);
          gl_FragColor = vec4(col * 1.15, alpha * 0.9);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  public sync(stars: GalaxyStarParticle[], originMeters: Vec3): void {
    const count = Math.min(stars.length, MAX_GALAXY_STARS);
    const geo = this.points.geometry;
    if (count === 0) {
      geo.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < count; i++) {
      const s = stars[i];
      const i3 = i * 3;
      this.positions[i3] = (s.position.x - originMeters.x) * METERS_TO_SCENE;
      this.positions[i3 + 1] = (s.position.y - originMeters.y) * METERS_TO_SCENE;
      this.positions[i3 + 2] = (s.position.z - originMeters.z) * METERS_TO_SCENE;

      this.colors[i3] = s.color[0];
      this.colors[i3 + 1] = s.color[1];
      this.colors[i3 + 2] = s.color[2];
      this.sizes[i] = s.size;
    }

    geo.setDrawRange(0, count);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
