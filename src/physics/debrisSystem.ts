import * as THREE from 'three';
import { CelestialBody, DebrisParticle, Vec3 } from '../types/cosmos';
import { DAY, G, schwarzschildRadius, YEAR } from './constants';

const MAX_DEBRIS = 2200;

export class DebrisSystem {
  public particles: DebrisParticle[] = [];

  public clear(): void {
    this.particles.length = 0;
  }

  private pushParticle(p: DebrisParticle): void {
    if (this.particles.length >= MAX_DEBRIS) {
      // Recycle oldest particle slot
      this.particles.shift();
    }
    this.particles.push(p);
  }

  /**
   * Spawns a dramatic cone/cloud of incandescent impact ejecta from a planetary collision.
   */
  public spawnImpactCloud(
    origin: Vec3,
    baseVelocity: Vec3,
    ejectaSpeed: number,
    spawnRadius: number,
    colorHex: string,
    count: number,
    initialTemp = 2600
  ): void {
    const c = new THREE.Color(colorHex);
    const actualCount = Math.min(count, 260);

    for (let i = 0; i < actualCount; i++) {
      // Random spherical direction biased slightly toward the orbital plane so debris can form rings
      const theta = Math.random() * Math.PI * 2;
      const zSpread = (Math.random() - 0.5) * 1.1;
      const cosPhi = Math.sqrt(Math.max(0.05, 1 - zSpread * zSpread));
      const dx = Math.cos(theta) * cosPhi;
      const dy = zSpread * 0.55;
      const dz = Math.sin(theta) * cosPhi;

      const speedMul = 0.28 + Math.pow(Math.random(), 1.35) * 1.15;
      const vMag = ejectaSpeed * speedMul;
      const offsetR = spawnRadius * (1.05 + Math.random() * 0.7);

      this.pushParticle({
        position: {
          x: origin.x + dx * offsetR,
          y: origin.y + dy * offsetR,
          z: origin.z + dz * offsetR,
        },
        velocity: {
          x: baseVelocity.x + dx * vMag,
          y: baseVelocity.y + dy * vMag,
          z: baseVelocity.z + dz * vMag,
        },
        baseColor: [c.r, c.g, c.b],
        temperature: initialTemp * (0.65 + Math.random() * 0.6),
        size: 0.45 + Math.random() * 1.15,
        age: 0,
        maxAge: (45 + Math.random() * 180) * DAY,
        kind: 'impact',
        alive: true,
      });
    }
  }

  /**
   * Spawns tidal stream / planetary ring particles torn off a body inside the Roche limit!
   * Particles inherit orbital velocity plus gentle tidal shear so they naturally stretch into
   * gorgeous luminous arcs & swirling rings around planets or black holes!
   */
  public spawnRocheStream(
    victim: CelestialBody,
    primary: CelestialBody,
    count: number,
    isFinalDisruption: boolean
  ): void {
    const c = new THREE.Color(victim.category === 'star' ? victim.color : victim.secondaryColor || victim.color);
    const dx = victim.position.x - primary.position.x;
    const dy = victim.position.y - primary.position.y;
    const dz = victim.position.z - primary.position.z;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e4);
    const rx = dx / dist;
    const ry = dy / dist;
    const rz = dz / dist;

    // Approximate orbital tangent speed for natural ring dispersion
    const vOrb = Math.sqrt((G * primary.mass) / dist);
    const actualCount = Math.min(count, isFinalDisruption ? 340 : 28);

    for (let i = 0; i < actualCount; i++) {
      // Inner and outer Lagrange tidal lobes (L1 toward primary, L2 away from primary)
      const side = Math.random() < 0.55 ? -1 : 1;
      const radialJitter = (Math.random() - 0.5) * 0.8 + side * (0.6 + Math.random() * 0.9);
      const perpAngle = Math.random() * Math.PI * 2;
      const spreadR = Math.max(victim.radius * (isFinalDisruption ? 1.8 : 1.15), dist * 0.015);

      const px = victim.position.x + rx * radialJitter * spreadR + Math.cos(perpAngle) * spreadR * 0.5;
      const py = victim.position.y + ry * radialJitter * spreadR + (Math.random() - 0.5) * spreadR * 0.35;
      const pz = victim.position.z + rz * radialJitter * spreadR + Math.sin(perpAngle) * spreadR * 0.5;

      // Differential Keplerian shear velocity so tidal stream winds into an authentic ring
      const shear = (Math.random() - 0.5) * vOrb * (isFinalDisruption ? 0.14 : 0.07);
      const radialKick = side * vOrb * (0.02 + Math.random() * 0.04);

      const temp =
        primary.category === 'black_hole'
          ? 3400 + Math.random() * 4500
          : victim.category === 'star'
            ? victim.temperature
            : Math.max(victim.temperature, 450 + Math.random() * 900);

      this.pushParticle({
        position: { x: px, y: py, z: pz },
        velocity: {
          x: victim.velocity.x + rx * radialKick + (Math.random() - 0.5) * shear,
          y: victim.velocity.y + (Math.random() - 0.5) * shear * 0.35,
          z: victim.velocity.z + rz * radialKick + (Math.random() - 0.5) * shear,
        },
        baseColor: [c.r, c.g, c.b],
        temperature: temp,
        size: isFinalDisruption ? 0.55 + Math.random() * 1.25 : 0.45 + Math.random() * 0.8,
        age: 0,
        maxAge: (1.5 + Math.random() * 4.0) * YEAR,
        kind: 'roche',
        alive: true,
      });
    }
  }

  /**
   * Spawns a blazing expanding supernova nebula shell!
   */
  public spawnSupernovaShell(
    origin: Vec3,
    baseVelocity: Vec3,
    starRadius: number,
    starColorHex: string
  ): void {
    const primaryC = new THREE.Color(starColorHex);
    const cyanC = new THREE.Color('#6de8ff');
    const roseC = new THREE.Color('#ff5e8a');
    const goldC = new THREE.Color('#ffbe55');
    const count = 420;

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(theta);

      // High-velocity supernova shock front (~300 - 1400 km/s scaled for scenic solar-system expansion)
      const speed = (1.2e5 + Math.random() * 4.5e5);
      const r0 = starRadius * (1.2 + Math.random() * 0.8);

      const palettePick = Math.random();
      const col =
        palettePick < 0.35
          ? primaryC
          : palettePick < 0.65
            ? cyanC
            : palettePick < 0.85
              ? roseC
              : goldC;

      this.pushParticle({
        position: {
          x: origin.x + dx * r0,
          y: origin.y + dy * r0,
          z: origin.z + dz * r0,
        },
        velocity: {
          x: baseVelocity.x + dx * speed,
          y: baseVelocity.y + dy * speed,
          z: baseVelocity.z + dz * speed,
        },
        baseColor: [col.r, col.g, col.b],
        temperature: 14000 + Math.random() * 12000,
        size: 0.9 + Math.random() * 1.9,
        age: 0,
        maxAge: (120 + Math.random() * 240) * DAY,
        kind: 'supernova',
        alive: true,
      });
    }
  }

  /**
   * Spawns a vibrant blue-violet -> crimson r-process Kilonova ejecta cloud from a Neutron Star merger!
   */
  public spawnKilonovaCloud(origin: Vec3, baseVelocity: Vec3): void {
    const violetC = new THREE.Color('#a26bff');
    const cyanC = new THREE.Color('#5ceeff');
    const crimsonC = new THREE.Color('#ff3d6e');
    const goldC = new THREE.Color('#ffd366');
    const count = 420;

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(theta);

      // Polar lanthanide-free blue-cyan ejecta vs equatorial crimson-gold heavy-element torus!
      const isPolar = Math.abs(dy) > 0.55;
      const col = isPolar
        ? Math.random() < 0.55
          ? cyanC
          : violetC
        : Math.random() < 0.65
          ? crimsonC
          : goldC;

      const speed = (1.5e5 + Math.random() * 4.8e5) * (isPolar ? 1.25 : 0.85);
      const r0 = 1.5e8 * (0.4 + Math.random() * 0.8);

      this.pushParticle({
        position: {
          x: origin.x + dx * r0,
          y: origin.y + dy * r0,
          z: origin.z + dz * r0,
        },
        velocity: {
          x: baseVelocity.x + dx * speed,
          y: baseVelocity.y + dy * speed,
          z: baseVelocity.z + dz * speed,
        },
        baseColor: [col.r, col.g, col.b],
        temperature: 18000 + Math.random() * 14000,
        size: 1.0 + Math.random() * 2.1,
        age: 0,
        maxAge: (110 + Math.random() * 220) * DAY,
        kind: 'supernova',
        alive: true,
      });
    }
  }

  /**
   * Advances all debris particles under the real gravitational field of alive celestial bodies.
   * Lightweight symplectic kick-drift with radiative cooling and accretion capture.
   */
  public step(dt: number, bodies: CelestialBody[]): void {
    if (this.particles.length === 0 || dt <= 0) return;

    // Collect significant gravitational attractors once per step
    const attractors = bodies.filter((b) => b.alive && b.mass > 1e20);
    const nAtt = attractors.length;
    const coolingRate = dt / (22 * DAY);

    let writeIdx = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) continue;

      let ax = 0;
      let ay = 0;
      let az = 0;
      let captured = false;

      if (p.kind !== 'supernova') {
        for (let j = 0; j < nAtt; j++) {
          const b = attractors[j];
          const dx = b.position.x - p.position.x;
          const dy = b.position.y - p.position.y;
          const dz = b.position.z - p.position.z;
          const dSq = dx * dx + dy * dy + dz * dz;
          const captureR =
            b.category === 'black_hole'
              ? Math.max(b.radius * 3.5, schwarzschildRadius(b.mass) * 4.5, 1.8e8)
              : b.radius * 1.02;

          if (dSq <= captureR * captureR) {
            captured = true;
            if (b.category === 'black_hole') {
              b.accretionFlare = Math.min(1, (b.accretionFlare ?? 0) + 0.015);
            }
            break;
          }

          const softSq = dSq + b.radius * b.radius * 0.25;
          const d = Math.sqrt(softSq);
          const f = (G * b.mass) / (softSq * d);
          ax += dx * f;
          ay += dy * f;
          az += dz * f;
        }
      }

      if (captured) continue;

      p.velocity.x += ax * dt;
      p.velocity.y += ay * dt;
      p.velocity.z += az * dt;

      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;

      // Radiative cooling toward space ambient
      if (p.kind === 'supernova') {
        p.temperature = Math.max(2500, p.temperature * Math.exp(-coolingRate * 0.18));
      } else {
        p.temperature = Math.max(120, 120 + (p.temperature - 120) * Math.exp(-coolingRate));
      }

      this.particles[writeIdx++] = p;
    }

    this.particles.length = writeIdx;
  }
}
