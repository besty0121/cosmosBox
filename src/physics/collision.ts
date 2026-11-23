import {
  CelestialBody,
  CollisionEvent,
  KilonovaEvent,
  TidalDisruptionEvent,
} from '../types/cosmos';
import { G, M_SUN, schwarzschildRadius } from './constants';
import { DebrisSystem } from './debrisSystem';
import { syncStarFromMass } from './stellar';
import { computeRocheLimit } from './thermodynamics';
import { cloneVec3, distVec3, lenVec3, subVec3 } from './vec3';

/**
 * Resolves physical pairwise collisions with:
 * - Mass & momentum conservation
 * - Kinetic impact energy -> surface heating, magma glow & water vaporization
 * - High-energy incandescent debris cloud ejection (orbiting under real N-body gravity)
 * - Catastrophic fragmentation when specific impact energy exceeds binding energy
 * - Planetary ring creation on oblique/catastrophic rocky impacts
 * - Black hole accretion flare & stellar hydrogen ignition
 */
export function resolveCollisions(
  bodies: CelestialBody[],
  debris: DebrisSystem,
  simTime: number,
  collisionsOut: CollisionEvent[],
  kilonovasOut: KilonovaEvent[],
  spawnFragment?: (parent: CelestialBody, velOffset: { x: number; y: number; z: number }, massFrac: number) => void
): void {
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    const a = bodies[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j];
      if (!b.alive) continue;

      const d = distVec3(a.position, b.position);
      const ra =
        a.category === 'black_hole'
          ? Math.max(a.radius, schwarzschildRadius(a.mass) * 3.5, 4.5e9)
          : a.category === 'neutron_star'
            ? Math.max(a.radius, 2.2e9)
            : a.radius;
      const rb =
        b.category === 'black_hole'
          ? Math.max(b.radius, schwarzschildRadius(b.mass) * 3.5, 4.5e9)
          : b.category === 'neutron_star'
            ? Math.max(b.radius, 2.2e9)
            : b.radius;

      if (d > (ra + rb) * 0.98) continue;

      // Determine survivor (black hole > neutron star > heavier body)
      const rank = (body: CelestialBody) =>
        body.category === 'black_hole' ? 3 : body.category === 'neutron_star' ? 2 : 1;

      let survivor = a;
      let absorbed = b;
      if (rank(b) > rank(a) || (rank(b) === rank(a) && b.mass > a.mass)) {
        survivor = b;
        absorbed = a;
      }

      const isCompactMerger =
        (survivor.category === 'black_hole' || survivor.category === 'neutron_star') &&
        (absorbed.category === 'black_hole' || absorbed.category === 'neutron_star');
      const isNeutronMerger =
        survivor.category === 'neutron_star' && absorbed.category === 'neutron_star';

      const totalMass = survivor.mass + absorbed.mass;
      const relVel = subVec3(survivor.velocity, absorbed.velocity);
      const relSpeed = lenVec3(relVel);
      const reducedMass = (survivor.mass * absorbed.mass) / totalMass;
      const impactEnergy = 0.5 * reducedMass * relSpeed * relSpeed;

      // Gravitational binding energy estimate of the combined system: U ~ 3/5 * G * M^2 / R
      const combinedR = Math.cbrt(
        survivor.radius * survivor.radius * survivor.radius +
          absorbed.radius * absorbed.radius * absorbed.radius
      );
      const bindingEnergy = (0.6 * G * totalMass * totalMass) / Math.max(combinedR, 1e4);
      const energyRatio = impactEnergy / Math.max(bindingEnergy, 1);
      const massRatio = absorbed.mass / Math.max(survivor.mass, 1);

      // Center of mass & linear momentum conservation
      const comPos = {
        x: (survivor.position.x * survivor.mass + absorbed.position.x * absorbed.mass) / totalMass,
        y: (survivor.position.y * survivor.mass + absorbed.position.y * absorbed.mass) / totalMass,
        z: (survivor.position.z * survivor.mass + absorbed.position.z * absorbed.mass) / totalMass,
      };
      const comVel = {
        x: (survivor.velocity.x * survivor.mass + absorbed.velocity.x * absorbed.mass) / totalMass,
        y: (survivor.velocity.y * survivor.mass + absorbed.velocity.y * absorbed.mass) / totalMass,
        z: (survivor.velocity.z * survivor.mass + absorbed.velocity.z * absorbed.mass) / totalMass,
      };

      const isCatastrophic =
        survivor.category !== 'black_hole' &&
        survivor.category !== 'star' &&
        survivor.category !== 'neutron_star' &&
        energyRatio > 0.35 &&
        massRatio > 0.08;

      // Eject incandescent impact debris particles!
      const escapeVel = Math.sqrt((2 * G * totalMass) / Math.max(combinedR, 1e4));
      const ejectaSpeed = Math.max(escapeVel * 0.55, Math.min(relSpeed * 0.65, escapeVel * 2.2));
      const debrisCount =
        survivor.category === 'black_hole'
          ? 140
          : isCatastrophic
            ? 240
            : Math.max(45, Math.min(180, Math.round(55 + Math.log10(Math.max(impactEnergy, 1e22)) * 4)));

      const debrisColor =
        absorbed.category === 'star'
          ? absorbed.color
          : absorbed.waterFraction > 0.5
            ? '#bfe6ff'
            : absorbed.color;

      debris.spawnImpactCloud(
        comPos,
        comVel,
        ejectaSpeed,
        Math.max(survivor.radius, combinedR),
        debrisColor,
        debrisCount,
        survivor.category === 'black_hole' ? 4800 : 2200 + Math.min(2400, energyRatio * 1800)
      );

      // Spawn 2 macro rocky fragments on catastrophic rocky collisions (when body count is reasonable)
      if (isCatastrophic && spawnFragment && bodies.length < 36) {
        const fragMassFrac = Math.min(0.14, massRatio * 0.35);
        for (let k = 0; k < 2; k++) {
          const ang = Math.random() * Math.PI * 2;
          const kick = escapeVel * (1.15 + Math.random() * 0.5);
          spawnFragment(
            survivor,
            {
              x: Math.cos(ang) * kick,
              y: (Math.random() - 0.5) * kick * 0.35,
              z: Math.sin(ang) * kick,
            },
            fragMassFrac
          );
        }
      }

      // Apply merged state to survivor
      survivor.position = comPos;
      survivor.velocity = comVel;
      survivor.mass = isCatastrophic ? totalMass * 0.88 : totalMass;

      if (survivor.category === 'black_hole') {
        survivor.radius = Math.max(survivor.radius, schwarzschildRadius(survivor.mass));
        survivor.accretionFlare = Math.min(1, (survivor.accretionFlare ?? 0) + (isCompactMerger ? 1.0 : 0.65));
      } else if (survivor.category === 'neutron_star') {
        if (isNeutronMerger) {
          // Binary Neutron Star Merger -> Kilonova explosion & collapse into a newborn Black Hole!
          survivor.category = 'black_hole';
          survivor.name = `${survivor.name.replace(/（.*）/, '')}（千新星并合黑洞）`;
          survivor.radius = schwarzschildRadius(survivor.mass);
          survivor.luminosity = 0;
          survivor.temperature = 0;
          survivor.accretionFlare = 1.0;
          survivor.color = '#000000';
          survivor.secondaryColor = '#a66bff';
          survivor.atmosphereColor = '#8d7aff';
          debris.spawnKilonovaCloud(comPos, comVel);
        } else {
          survivor.impactHeat = 1;
        }
      } else {
        survivor.radius = isCatastrophic ? combinedR * 0.94 : combinedR;

        // Kinetic heating: specific heat ~ 950 J/(kg*K), ~25% retained as thermal energy
        const deltaTemp = Math.min(6500, (impactEnergy * 0.25) / (survivor.mass * 950));
        survivor.temperature = Math.min(35000, survivor.temperature + deltaTemp);
        survivor.impactHeat = Math.min(1, survivor.impactHeat + Math.min(1, deltaTemp / 420 + 0.42));

        // Vaporize oceans & strip atmosphere on extreme planetary impacts
        if (deltaTemp > 380 && survivor.category === 'rocky') {
          const loss = Math.min(0.85, (deltaTemp - 300) / 1400);
          survivor.waterFraction = Math.max(0, survivor.waterFraction * (1 - loss));
          survivor.atmosphereDensity = Math.max(0, survivor.atmosphereDensity * (1 - loss * 0.5));
        }

        // Giant oblique impacts can leave a glowing debris ring around surviving planets!
        if (
          isCatastrophic &&
          !survivor.hasRings &&
          (survivor.category === 'rocky' || survivor.category === 'gas_giant' || survivor.category === 'ice_giant')
        ) {
          survivor.hasRings = true;
          survivor.ringInner = 1.45;
          survivor.ringOuter = 2.45;
          survivor.ringColor = '#d4b48c';
        }

        // Check hydrogen-burning ignition threshold (~0.075 M_sun)
        if (survivor.category !== 'star' && survivor.mass >= 0.075 * M_SUN) {
          survivor.category = 'star';
          syncStarFromMass(survivor);
        } else if (survivor.category === 'star') {
          syncStarFromMass(survivor);
        }
      }

      absorbed.alive = false;

      if (isCompactMerger) {
        kilonovasOut.push({
          position: cloneVec3(comPos),
          nameA: survivor.name,
          nameB: absorbed.name,
          remnantId: survivor.id,
          isBlackHoleMerger: !isNeutronMerger,
          timestamp: simTime,
        });
      }

      collisionsOut.push({
        position: cloneVec3(comPos),
        survivorId: survivor.id,
        survivorName: survivor.name,
        absorbedName: absorbed.name,
        impactEnergy,
        combinedRadius: survivor.radius,
        color: absorbed.category === 'star' ? absorbed.color : '#ff8c42',
        timestamp: simTime,
        catastrophic: isCatastrophic,
      });
    }
  }
}

/**
 * Evaluates Roche Limit & Black Hole Tidal Disruption across all pairs!
 * Bodies venturing inside a massive primary's Roche limit experience escalating tidal stress,
 * glow with magma cracks, continuously shed glowing debris streams, and ultimately disintegrate
 * into an orbiting planetary ring or tidal accretion stream!
 */
export function resolveRocheTidalTearing(
  bodies: CelestialBody[],
  debris: DebrisSystem,
  dt: number,
  simTime: number,
  tidalEventsOut: TidalDisruptionEvent[]
): void {
  const n = bodies.length;

  // Reset stress before evaluating current frame
  for (let i = 0; i < n; i++) {
    bodies[i].rocheStress = 0;
  }

  for (let i = 0; i < n; i++) {
    const victim = bodies[i];
    if (!victim.alive) continue;
    // Black holes & neutron stars do not tidally disrupt from normal planets/stars
    if (victim.category === 'black_hole' || victim.category === 'neutron_star') continue;
    // White dwarfs are degenerate compact stars; stars near black holes are handled by gradual TDE spaghettification
    if (victim.isWhiteDwarf) continue;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const primary = bodies[j];
      if (!primary.alive) continue;
      // Stars torn by black holes are handled by gradual TDE spaghettification stream in SimulationEngine
      if (victim.category === 'star' && primary.category === 'black_hole') continue;
      // Primary must be significantly heavier to tear victim apart
      if (primary.mass < victim.mass * 12) continue;

      const d = distVec3(victim.position, primary.position);
      const rocheLimit = computeRocheLimit(primary, victim);
      if (d >= rocheLimit) continue;

      // Stress climbs from 0 at rocheLimit to 1 at 0.75 * rocheLimit
      const stress = Math.min(1, Math.max(0, (rocheLimit - d) / (rocheLimit * 0.25)));
      victim.rocheStress = Math.max(victim.rocheStress ?? 0, stress);

      // Tidal heating & progressive mass stripping (snappy timescale so close encounters shred visibly within seconds)
      const tearRate = (0.18 + stress * 1.45) * (dt / (0.65 * 86400));
      const massLost = Math.min(victim.mass * 0.45, victim.mass * tearRate);

      if (massLost > 0 && Math.random() < Math.min(0.92, 0.35 + stress * 0.6)) {
        debris.spawnRocheStream(victim, primary, Math.round(8 + stress * 18), false);
      }

      victim.mass -= massLost;
      victim.radius *= Math.cbrt(Math.max(0.25, 1 - tearRate));
      victim.temperature = Math.min(5500, victim.temperature + stress * 650 * (dt / 86400));
      victim.impactHeat = Math.min(1, Math.max(victim.impactHeat, stress * 0.95));

      if (primary.category === 'black_hole') {
        primary.accretionFlare = Math.min(1, (primary.accretionFlare ?? 0) + stress * 0.12);
      }

      // Total Tidal Disruption when deep inside Roche zone (< 0.82 * rocheLimit) or shredded below threshold
      if (d < rocheLimit * 0.82 || victim.radius < 1.15e6) {
        debris.spawnRocheStream(victim, primary, 300, true);

        // If shredded around a planet, leave behind a newly formed icy/rocky planetary ring!
        if (
          !primary.hasRings &&
          (primary.category === 'rocky' ||
            primary.category === 'gas_giant' ||
            primary.category === 'ice_giant')
        ) {
          primary.hasRings = true;
          primary.ringInner = 1.35;
          primary.ringOuter = 2.45;
          primary.ringColor = victim.waterFraction > 0.35 ? '#cfe4f2' : victim.color;
        }

        if (primary.category === 'black_hole') {
          primary.mass += victim.mass * 0.65;
          primary.radius = Math.max(primary.radius, schwarzschildRadius(primary.mass));
          primary.accretionFlare = 1.0;
        }

        victim.alive = false;
        tidalEventsOut.push({
          position: cloneVec3(victim.position),
          victimName: victim.name,
          primaryName: primary.name,
          isBlackHole: primary.category === 'black_hole',
          timestamp: simTime,
        });
        break;
      }
    }
  }
}
