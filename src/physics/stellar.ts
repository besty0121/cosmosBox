import { CelestialBody, SupernovaEvent } from '../types/cosmos';
import { L_SUN, M_SUN, R_SUN, schwarzschildRadius, temperatureToHex } from './constants';
import { DebrisSystem } from './debrisSystem';
import { cloneVec3, distVec3, normalizeVec3, subVec3 } from './vec3';

/**
 * Returns astrophysical Morgan-Keenan spectral class string for a star based on temperature (K).
 */
export function getSpectralClass(tempK: number): string {
  if (tempK >= 30000) return 'O 型蓝超巨星';
  if (tempK >= 10000) return 'B 型蓝巨星';
  if (tempK >= 7500) return 'A 型蓝白主序星';
  if (tempK >= 6000) return 'F 型黄白主序星';
  if (tempK >= 5200) return 'G 型黄矮星';
  if (tempK >= 3700) return 'K 型橙矮星';
  return 'M 型红矮星';
}

/**
 * Updates a star's main-sequence radius, luminosity, temperature, and spectral colors from its mass.
 */
export function syncStarFromMass(star: CelestialBody): void {
  if (star.category !== 'star') return;
  const mRatio = Math.max(0.08, star.mass / M_SUN);

  // Piecewise astrophysical mass-luminosity relation
  if (mRatio < 0.43) {
    star.luminosity = L_SUN * 0.23 * Math.pow(mRatio, 2.3);
  } else if (mRatio < 2.0) {
    star.luminosity = L_SUN * Math.pow(mRatio, 3.8);
  } else {
    star.luminosity = L_SUN * 1.4 * Math.pow(mRatio, 3.5);
  }

  star.radius = R_SUN * (mRatio < 1 ? Math.pow(mRatio, 0.8) : Math.pow(mRatio, 0.58));
  star.temperature = Math.max(2500, Math.min(38000, 5778 * Math.pow(mRatio, 0.52)));
  star.color = temperatureToHex(star.temperature);
  star.secondaryColor = temperatureToHex(Math.max(2200, star.temperature * 0.72));
  star.atmosphereColor = temperatureToHex(Math.max(2600, star.temperature * 0.86));
}

/**
 * Triggers a dramatic supernova explosion on a star:
 * - Spawns an expanding glowing nebula ejecta shell
 * - Blasts nearby planets with radiation heat + radial shock impulse
 * - Collapses the core into either a Neutron Star (< 8 M_sun) or a Black Hole (>= 8 M_sun)!
 */
export function triggerSupernova(
  star: CelestialBody,
  allBodies: CelestialBody[],
  debris: DebrisSystem,
  simTime: number
): SupernovaEvent {
  const progenitorMass = star.mass;
  const progenitorColor = star.color;
  const pos = cloneVec3(star.position);
  const vel = cloneVec3(star.velocity);

  // 1. Spawn expanding colorful supernova remnant nebula
  debris.spawnSupernovaShell(pos, vel, star.radius, progenitorColor);

  // 2. Blast nearby planets with thermal flash & shockwave push
  for (const other of allBodies) {
    if (!other.alive || other.id === star.id) continue;
    const d = Math.max(distVec3(other.position, pos), star.radius * 2);
    const dir = normalizeVec3(subVec3(other.position, pos));

    // Shock impulse inversely proportional to distance^2
    const dv = Math.min(25000, (1.2e25 / (d * d)) * (progenitorMass / M_SUN));
    other.velocity.x += dir.x * dv;
    other.velocity.y += dir.y * dv;
    other.velocity.z += dir.z * dv;

    // Intense radiative flash scorches inner system planets
    if (other.category !== 'black_hole' && other.category !== 'star') {
      const heatSpike = Math.min(3200, (1.8e25 / (d * d)) * (progenitorMass / M_SUN));
      other.temperature = Math.min(6000, other.temperature + heatSpike);
      other.impactHeat = Math.min(1, other.impactHeat + Math.min(1, heatSpike / 500));
      if (heatSpike > 600) {
        other.waterFraction *= 0.2;
        other.atmosphereDensity *= 0.35;
      }
    }
  }

  // 3. Core collapse into Black Hole (>= 8 M_sun) or Neutron Star (< 8 M_sun)
  const becomesBlackHole = progenitorMass >= 8 * M_SUN;
  const remnantName = star.name.replace(/（.*）/, '');

  if (becomesBlackHole) {
    star.category = 'black_hole';
    star.name = `${remnantName}（超新星黑洞）`;
    star.mass = Math.max(3.2 * M_SUN, progenitorMass * 0.42);
    star.radius = schwarzschildRadius(star.mass);
    star.temperature = 0;
    star.luminosity = 0;
    star.accretionFlare = 1.0;
    star.color = '#000000';
    star.secondaryColor = '#ff7b29';
    star.atmosphereColor = '#ff9d4d';
  } else {
    star.category = 'neutron_star';
    star.name = `${remnantName}（中子星）`;
    star.mass = Math.max(1.4 * M_SUN, Math.min(2.2 * M_SUN, progenitorMass * 0.45));
    star.radius = 1.2e4; // ~12 km real neutron star radius
    star.temperature = 450000;
    star.luminosity = 0.08 * L_SUN;
    star.rotationPeriod = 0.25; // fast pulsar spin
    star.color = '#d4f3ff';
    star.secondaryColor = '#66c2ff';
    star.atmosphereColor = '#7de2ff';
  }

  return {
    position: pos,
    starName: remnantName,
    remnantCategory: becomesBlackHole ? 'black_hole' : 'neutron_star',
    remnantId: star.id,
    color: progenitorColor,
    timestamp: simTime,
  };
}

/**
 * Checks stellar stability thresholds & black hole accretion flare cooling each physics frame.
 */
export function stepStellarEvolution(
  bodies: CelestialBody[],
  debris: DebrisSystem,
  dt: number,
  simTime: number,
  supernovasOut: SupernovaEvent[]
): void {
  for (const body of bodies) {
    if (!body.alive) continue;

    // Cool down black hole accretion flare gracefully over simulated weeks
    if (body.category === 'black_hole' && body.accretionFlare && body.accretionFlare > 0) {
      body.accretionFlare = Math.max(0, body.accretionFlare - dt / (60 * 86400));
    }

    // Automatic pair-instability / core-collapse supernova if a star grows past 28 M_sun
    if (body.category === 'star' && body.mass >= 28 * M_SUN) {
      const ev = triggerSupernova(body, bodies, debris, simTime);
      supernovasOut.push(ev);
    }

    // Automatic collapse if a neutron star exceeds Tolman-Oppenheimer-Volkoff limit (~2.8 M_sun)
    if (body.category === 'neutron_star' && body.mass >= 2.8 * M_SUN) {
      body.category = 'black_hole';
      body.name = body.name.replace('中子星', '坍缩黑洞');
      body.radius = schwarzschildRadius(body.mass);
      body.luminosity = 0;
      body.temperature = 0;
      body.accretionFlare = 0.9;
      body.color = '#000000';
      body.secondaryColor = '#ff7b29';
      body.atmosphereColor = '#ff9d4d';
    }
  }
}
