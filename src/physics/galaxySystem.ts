import * as THREE from 'three';
import { CelestialBody, Vec3 } from '../types/cosmos';
import { G } from './constants';

export interface GalaxyStarParticle {
  position: Vec3;
  velocity: Vec3;
  color: [number, number, number];
  size: number;
}

/**
 * Lightweight gravitational star-particle engine for the Spiral Galaxy Collision preset.
 * Thousands of massless test stars orbit under the exact N-body gravity of the massive galactic cores
 * (with softened Hernquist-like core potential to prevent central singularities), forming authentic
 * spiral arms, tidal bridges, and galactic tails at 60 FPS!
 */
export class GalaxySystem {
  public stars: GalaxyStarParticle[] = [];

  public clear(): void {
    this.stars.length = 0;
  }

  /**
   * Generates a logarithmic 2-arm spiral disk of stars orbiting a galactic core.
   */
  public spawnSpiralDisk(
    core: CelestialBody,
    count: number,
    innerRadiusM: number,
    outerRadiusM: number,
    tiltXDeg: number,
    tiltZDeg: number,
    spinDir: 1 | -1,
    coreHue: 'warm' | 'cool'
  ): void {
    const rotEuler = new THREE.Euler(
      (tiltXDeg * Math.PI) / 180,
      0,
      (tiltZDeg * Math.PI) / 180
    );
    const rotQuat = new THREE.Quaternion().setFromEuler(rotEuler);
    const localP = new THREE.Vector3();
    const localV = new THREE.Vector3();

    const coreCol = new THREE.Color(coreHue === 'warm' ? '#ffe0a8' : '#d6e9ff');
    const armCol = new THREE.Color(coreHue === 'warm' ? '#80bfff' : '#96d8ff');
    const h2Col = new THREE.Color(coreHue === 'warm' ? '#ff6fa5' : '#ff8c66');
    const tmpCol = new THREE.Color();

    // Softening length matching the core's dark-matter/bulge scale
    const soft = innerRadiusM * 2.4;

    for (let i = 0; i < count; i++) {
      // Exponential disk density profile
      const u = Math.pow(Math.random(), 1.45);
      const r = innerRadiusM + u * (outerRadiusM - innerRadiusM);

      // 2 logarithmic spiral arms + stochastic scatter
      const arm = i % 2;
      const wind = 3.8 * Math.log(1 + r / (innerRadiusM * 1.6));
      const spread = (Math.random() - 0.5) * (0.55 + u * 1.15);
      const angle = arm * Math.PI + wind * spinDir + spread;

      // Thin vertical scale height thicker near bulge
      const zThick = (1 - u * 0.72) * innerRadiusM * 0.42;
      const yOff = (Math.random() + Math.random() - 1) * zThick;

      localP.set(Math.cos(angle) * r, yOff, Math.sin(angle) * r);

      // Circular velocity under softened core potential: v = sqrt(G * M * r^2 / (r^2 + soft^2)^(3/2))
      const denom = Math.pow(r * r + soft * soft, 1.5);
      const vMag = Math.sqrt((G * core.mass * r * r) / denom) * (0.94 + Math.random() * 0.12);
      const tx = -Math.sin(angle) * spinDir;
      const tz = Math.cos(angle) * spinDir;
      localV.set(tx * vMag, 0, tz * vMag);

      localP.applyQuaternion(rotQuat);
      localV.applyQuaternion(rotQuat);

      // Color gradient: warm golden galactic bulge -> crisp blue spiral arms -> scattered H-II rose knots
      const isKnot = u > 0.18 && Math.abs(spread) < 0.25 && Math.random() < 0.08;
      if (isKnot) {
        tmpCol.copy(h2Col);
      } else {
        tmpCol.copy(coreCol).lerp(armCol, Math.min(1, Math.pow(u, 0.75) * 1.15));
      }
      const brightness = 0.55 + Math.random() * 0.65;

      this.stars.push({
        position: {
          x: core.position.x + localP.x,
          y: core.position.y + localP.y,
          z: core.position.z + localP.z,
        },
        velocity: {
          x: core.velocity.x + localV.x,
          y: core.velocity.y + localV.y,
          z: core.velocity.z + localV.z,
        },
        color: [tmpCol.r * brightness, tmpCol.g * brightness, tmpCol.b * brightness],
        size: isKnot ? 2.4 + Math.random() * 1.8 : 1.0 + Math.pow(Math.random(), 2.2) * 2.1,
      });
    }
  }

  /**
   * Advances all galaxy stars under the softened gravity of all massive bodies (galactic cores).
   */
  public step(dt: number, cores: CelestialBody[]): void {
    const nStars = this.stars.length;
    if (nStars === 0 || dt <= 0) return;

    const attractors = cores.filter((b) => b.alive && b.mass > 1e28);
    const nCore = attractors.length;
    if (nCore === 0) return;

    // Softening prevents central cusp slingshots while preserving crisp tidal tails
    const softSq = 2.6e10 * 2.6e10;

    for (let i = 0; i < nStars; i++) {
      const s = this.stars[i];
      let ax = 0;
      let ay = 0;
      let az = 0;

      for (let j = 0; j < nCore; j++) {
        const c = attractors[j];
        const dx = c.position.x - s.position.x;
        const dy = c.position.y - s.position.y;
        const dz = c.position.z - s.position.z;
        const dSq = dx * dx + dy * dy + dz * dz + softSq;
        const invDist3 = 1 / (dSq * Math.sqrt(dSq));
        const f = G * c.mass * invDist3;
        ax += dx * f;
        ay += dy * f;
        az += dz * f;
      }

      s.velocity.x += ax * dt;
      s.velocity.y += ay * dt;
      s.velocity.z += az * dt;

      s.position.x += s.velocity.x * dt;
      s.position.y += s.velocity.y * dt;
      s.position.z += s.velocity.z * dt;
    }
  }
}
