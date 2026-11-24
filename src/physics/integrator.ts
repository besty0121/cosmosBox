import {
  CelestialBody,
  CollisionEvent,
  KilonovaEvent,
  TidalDisruptionEvent,
  Vec3,
} from '../types/cosmos';
import { resolveCollisions, resolveRocheTidalTearing } from './collision';
import { AU, G } from './constants';
import { DebrisSystem } from './debrisSystem';
import { cloneVec3, crossVec3, distVec3, lenVec3, normalizeVec3, subVec3 } from './vec3';

/**
 * Computes pairwise Newtonian gravitational accelerations in-place.
 * Returns the minimum dynamical timescale tau_min across all pairs for adaptive sub-stepping.
 */
export function computeAccelerations(bodies: CelestialBody[]): number {
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    bodies[i].acceleration.x = 0;
    bodies[i].acceleration.y = 0;
    bodies[i].acceleration.z = 0;
  }

  let minTauSq = Infinity;

  for (let i = 0; i < n; i++) {
    const bi = bodies[i];
    if (!bi.alive) continue;
    for (let j = i + 1; j < n; j++) {
      const bj = bodies[j];
      if (!bj.alive) continue;
      // Cosmological gravitational-lensing background sources lie billions of light-years behind the lens
      // (skip local close-range Newtonian collapse between foreground lens & distant background galaxy)
      if (
        (bi.isGravitationalLens && bj.isLensSource) ||
        (bj.isGravitationalLens && bi.isLensSource) ||
        (bi.galaxyType && bj.galaxyType)
      ) {
        continue;
      }

      const dx = bj.position.x - bi.position.x;
      const dy = bj.position.y - bi.position.y;
      const dz = bj.position.z - bi.position.z;

      const distSq = dx * dx + dy * dy + dz * dz;
      const softR = Math.max(bi.radius + bj.radius, 1e5) * 0.05;
      const softDistSq = distSq + softR * softR;
      const dist = Math.sqrt(softDistSq);
      const invDist3 = 1 / (softDistSq * dist);

      const gInvDist3 = G * invDist3;
      const fi = gInvDist3 * bj.mass;
      const fj = gInvDist3 * bi.mass;

      bi.acceleration.x += dx * fi;
      bi.acceleration.y += dy * fi;
      bi.acceleration.z += dz * fi;

      bj.acceleration.x -= dx * fj;
      bj.acceleration.y -= dy * fj;
      bj.acceleration.z -= dz * fj;

      const totalMass = bi.mass + bj.mass;
      if (totalMass > 0) {
        const tauSq = (softDistSq * dist) / (G * totalMass);
        if (tauSq < minTauSq) {
          minTauSq = tauSq;
        }
      }
    }
  }

  return Number.isFinite(minTauSq) ? Math.sqrt(minTauSq) : Infinity;
}

/**
 * Symplectic Velocity Verlet single sub-step + collision & Roche tidal tearing resolution.
 */
export function verletSubStep(
  bodies: CelestialBody[],
  debris: DebrisSystem,
  dt: number,
  simTime: number,
  collisionsOut: CollisionEvent[],
  tidalOut: TidalDisruptionEvent[],
  kilonovasOut: KilonovaEvent[],
  spawnFragment?: (parent: CelestialBody, velOffset: Vec3, massFrac: number) => void
): number {
  const n = bodies.length;
  const halfDt = 0.5 * dt;

  // 1. Half-step velocity & full-step position
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (!b.alive) continue;

    b.velocity.x += b.acceleration.x * halfDt;
    b.velocity.y += b.acceleration.y * halfDt;
    b.velocity.z += b.acceleration.z * halfDt;

    b.position.x += b.velocity.x * dt;
    b.position.y += b.velocity.y * dt;
    b.position.z += b.velocity.z * dt;

    if (Math.abs(b.rotationPeriod) > 0.05) {
      b.rotationAngle = (b.rotationAngle + (2 * Math.PI * dt) / b.rotationPeriod) % (2 * Math.PI);
    }

    if (b.impactHeat > 0) {
      b.impactHeat = Math.max(0, b.impactHeat - dt / (40 * 86400));
    }
  }

  // 2. Recompute accelerations at new positions
  const minTau = computeAccelerations(bodies);

  // 3. Complete second half-step velocity
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (!b.alive) continue;

    b.velocity.x += b.acceleration.x * halfDt;
    b.velocity.y += b.acceleration.y * halfDt;
    b.velocity.z += b.acceleration.z * halfDt;
  }

  // 3b. Relativistic gravitational-wave energy loss for close compact binaries (BH/NS inspiral!)
  for (let i = 0; i < n; i++) {
    const a = bodies[i];
    if (!a.alive || (a.category !== 'black_hole' && a.category !== 'neutron_star')) continue;
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j];
      if (!b.alive || (b.category !== 'black_hole' && b.category !== 'neutron_star')) continue;

      const d = distVec3(a.position, b.position);
      if (d > 1.35 * AU || d < 1e7) continue;

      // Smooth sandbox-scaled quadrupole radiation reaction damping relative velocity so close pairs inspiral & merge!
      const totalM = a.mass + b.mass;
      const comVx = (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalM;
      const comVy = (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalM;
      const comVz = (a.velocity.z * a.mass + b.velocity.z * b.mass) / totalM;

      const rAU = d / AU;
      // Stronger damping as separation shrinks (1 / r^2.4)
      const dampRate = Math.min(0.35, (dt / (22 * 86400)) / Math.pow(Math.max(0.12, rAU), 2.1));
      const keep = Math.max(0.85, 1 - dampRate);

      a.velocity.x = comVx + (a.velocity.x - comVx) * keep;
      a.velocity.y = comVy + (a.velocity.y - comVy) * keep;
      a.velocity.z = comVz + (a.velocity.z - comVz) * keep;

      b.velocity.x = comVx + (b.velocity.x - comVx) * keep;
      b.velocity.y = comVy + (b.velocity.y - comVy) * keep;
      b.velocity.z = comVz + (b.velocity.z - comVz) * keep;
    }
  }

  // 4. Resolve physical collisions, kilonovas & Roche limit tidal tearing
  resolveCollisions(bodies, debris, simTime, collisionsOut, kilonovasOut, spawnFragment);
  resolveRocheTidalTearing(bodies, debris, dt, simTime, tidalOut);

  return minTau;
}

/**
 * Finds the gravitationally dominant body at a given position (excluding optional id).
 */
export function findDominantBody(
  bodies: CelestialBody[],
  pos: Vec3,
  excludeId?: string
): CelestialBody | null {
  let best: CelestialBody | null = null;
  let bestAccel = -1;

  for (const b of bodies) {
    if (!b.alive || b.id === excludeId) continue;
    const d = distVec3(pos, b.position);
    if (d < 1e3) continue;
    const accel = (G * b.mass) / (d * d);
    if (accel > bestAccel) {
      bestAccel = accel;
      best = b;
    }
  }
  return best;
}

/**
 * Computes a stable circular orbital velocity vector around a target body in the XZ plane.
 */
export function computeCircularOrbitVelocity(
  spawnPos: Vec3,
  primary: CelestialBody | null,
  orbitNormal: Vec3 = { x: 0, y: 1, z: 0 }
): Vec3 {
  if (!primary) return { x: 0, y: 0, z: 0 };

  const rel = subVec3(spawnPos, primary.position);
  const r = lenVec3(rel);
  if (r < primary.radius * 1.05) {
    return cloneVec3(primary.velocity);
  }

  const tangent = normalizeVec3(crossVec3(orbitNormal, rel));
  const speed = Math.sqrt((G * primary.mass) / r);

  return {
    x: primary.velocity.x + tangent.x * speed,
    y: primary.velocity.y + tangent.y * speed,
    z: primary.velocity.z + tangent.z * speed,
  };
}

/**
 * Predicts the future 3D trajectory of a candidate body in the current N-body system.
 */
export function predictTrajectory(
  existingBodies: CelestialBody[],
  spawnPos: Vec3,
  spawnVel: Vec3,
  spawnMass: number,
  steps = 160
): Vec3[] {
  const alive = existingBodies.filter((b) => b.alive);
  if (alive.length === 0) {
    const pts: Vec3[] = [cloneVec3(spawnPos)];
    const dt = 86400 * 5;
    for (let i = 1; i <= 40; i++) {
      pts.push({
        x: spawnPos.x + spawnVel.x * dt * i,
        y: spawnPos.y + spawnVel.y * dt * i,
        z: spawnPos.z + spawnVel.z * dt * i,
      });
    }
    return pts;
  }

  const dominant = findDominantBody(alive, spawnPos);
  let period = 365.25 * 86400;
  if (dominant) {
    const r = Math.max(distVec3(spawnPos, dominant.position), dominant.radius * 2);
    period = 2 * Math.PI * Math.sqrt((r * r * r) / (G * (dominant.mass + spawnMass)));
    period = Math.max(86400 * 0.5, Math.min(period * 1.15, 365.25 * 86400 * 25));
  }

  const dt = period / steps;

  const simBodies = alive.map((b) => ({
    mass: b.mass,
    radius: b.radius,
    px: b.position.x,
    py: b.position.y,
    pz: b.position.z,
    vx: b.velocity.x,
    vy: b.velocity.y,
    vz: b.velocity.z,
    ax: 0,
    ay: 0,
    az: 0,
  }));

  let px = spawnPos.x;
  let py = spawnPos.y;
  let pz = spawnPos.z;
  let vx = spawnVel.x;
  let vy = spawnVel.y;
  let vz = spawnVel.z;

  const points: Vec3[] = [cloneVec3(spawnPos)];
  const n = simBodies.length;

  const computeTestAccel = (x: number, y: number, z: number) => {
    let ax = 0;
    let ay = 0;
    let az = 0;
    let collided = false;
    for (let i = 0; i < n; i++) {
      const b = simBodies[i];
      const dx = b.px - x;
      const dy = b.py - y;
      const dz = b.pz - z;
      const dSq = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(dSq + 1e10);
      if (d < b.radius * 1.05) {
        collided = true;
      }
      const f = (G * b.mass) / (dSq * d + 1e12);
      ax += dx * f;
      ay += dy * f;
      az += dz * f;
    }
    return { ax, ay, az, collided };
  };

  let cur = computeTestAccel(px, py, pz);
  const advanceExisting = n <= 16;
  const subPerSample = 2;
  const subDt = dt / subPerSample;

  for (let s = 0; s < steps; s++) {
    let hit = false;
    for (let k = 0; k < subPerSample; k++) {
      vx += cur.ax * 0.5 * subDt;
      vy += cur.ay * 0.5 * subDt;
      vz += cur.az * 0.5 * subDt;
      px += vx * subDt;
      py += vy * subDt;
      pz += vz * subDt;

      if (advanceExisting && n > 1) {
        for (let i = 0; i < n; i++) {
          simBodies[i].ax = 0;
          simBodies[i].ay = 0;
          simBodies[i].az = 0;
        }
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const bi = simBodies[i];
            const bj = simBodies[j];
            const dx = bj.px - bi.px;
            const dy = bj.py - bi.py;
            const dz = bj.pz - bi.pz;
            const dSq = dx * dx + dy * dy + dz * dz + 1e14;
            const d = Math.sqrt(dSq);
            const gInv = G / (dSq * d);
            bi.ax += dx * gInv * bj.mass;
            bi.ay += dy * gInv * bj.mass;
            bi.az += dz * gInv * bj.mass;
            bj.ax -= dx * gInv * bi.mass;
            bj.ay -= dy * gInv * bi.mass;
            bj.az -= dz * gInv * bi.mass;
          }
        }
        for (let i = 0; i < n; i++) {
          const b = simBodies[i];
          b.vx += b.ax * subDt;
          b.vy += b.ay * subDt;
          b.vz += b.az * subDt;
          b.px += b.vx * subDt;
          b.py += b.vy * subDt;
          b.pz += b.vz * subDt;
        }
      }

      cur = computeTestAccel(px, py, pz);
      vx += cur.ax * 0.5 * subDt;
      vy += cur.ay * 0.5 * subDt;
      vz += cur.az * 0.5 * subDt;

      if (cur.collided) {
        hit = true;
        break;
      }
    }

    points.push({ x: px, y: py, z: pz });
    if (hit) break;
  }

  return points;
}
