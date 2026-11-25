import {
  BodySnapshot,
  CelestialBody,
  CmeWave,
  CollisionEvent,
  GravitationalWaveSource,
  SimStepEvents,
  SpawnTemplate,
  SupernovaEvent,
  TidalStreamLink,
  Vec3,
} from '../types/cosmos';
import { AU, DAY, M_SUN, schwarzschildRadius } from './constants';
import { DebrisSystem } from './debrisSystem';
import { GalaxySystem } from './galaxySystem';
import { computeAccelerations, findDominantBody, verletSubStep } from './integrator';
import { getSpectralClass, stepStellarEvolution, triggerSupernova } from './stellar';
import { computeDensity, stepThermodynamics } from './thermodynamics';
import { cloneVec3, distVec3, lenVec3 } from './vec3';

const MAX_TRAIL_POINTS = 360;
const MAX_SUBSTEPS_PER_FRAME = 180;

let idCounter = 1;
export function nextBodyId(prefix = 'body'): string {
  return `${prefix}_${idCounter++}`;
}

export class SimulationEngine {
  public bodies: CelestialBody[] = [];
  public debris = new DebrisSystem();
  public galaxy = new GalaxySystem();
  public simTime = 0;
  public timeScale = 15 * DAY;
  public paused = false;
  public autoThermo = true;
  public recentCollisions: CollisionEvent[] = [];
  public cmeWaves: CmeWave[] = [];
  public tidalStreams: TidalStreamLink[] = [];
  public gwSource: GravitationalWaveSource = {
    active: false,
    center: { x: 0, y: 0, z: 0 },
    phase: 0,
    amplitude: 0,
    separationMeters: AU,
  };

  private trailAccumulator = 0;
  private lastMinTau = Infinity;

  public loadBodies(bodies: CelestialBody[], defaultTimeScale: number, initialSimTime = 0): void {
    this.bodies = bodies;
    this.debris.clear();
    this.galaxy.clear();
    this.simTime = initialSimTime;
    this.timeScale = defaultTimeScale;
    this.paused = false;
    this.recentCollisions = [];
    this.cmeWaves = [];
    this.tidalStreams = [];
    this.trailAccumulator = 0;
    this.lastMinTau = computeAccelerations(this.bodies);
    // Compute initial equilibrium temperatures & habitability immediately
    stepThermodynamics(this.bodies, 0, false);
  }

  public addBody(body: CelestialBody): CelestialBody {
    this.bodies.push(body);
    this.lastMinTau = computeAccelerations(this.bodies);
    stepThermodynamics(this.bodies, 0, false);
    return body;
  }

  public spawnFromTemplate(
    template: SpawnTemplate,
    position: Vec3,
    velocity: Vec3,
    customName?: string
  ): CelestialBody {
    const existingCount = this.bodies.filter((b) => b.name.startsWith(template.name)).length;
    const name =
      customName ?? (existingCount > 0 ? `${template.name} #${existingCount + 1}` : template.name);

    const body: CelestialBody = {
      id: nextBodyId(template.id),
      name,
      category: template.category,
      mass: template.mass,
      radius: template.radius,
      position: cloneVec3(position),
      velocity: cloneVec3(velocity),
      acceleration: { x: 0, y: 0, z: 0 },
      temperature: template.temperature,
      luminosity: template.luminosity,
      albedo: template.albedo,
      greenhouse: template.greenhouse,
      waterFraction: template.waterFraction,
      atmosphereDensity: template.atmosphereDensity,
      impactHeat: 0,
      rocheStress: 0,
      accretionFlare: 0,
      rotationPeriod: template.rotationPeriod,
      rotationAngle: Math.random() * Math.PI * 2,
      axialTilt: template.axialTilt,
      color: template.color,
      secondaryColor: template.secondaryColor,
      atmosphereColor: template.atmosphereColor,
      hasRings: template.hasRings,
      ringInner: template.ringInner,
      ringOuter: template.ringOuter,
      ringColor: template.ringColor,
      seed: Math.random() * 1000,
      trail: [cloneVec3(position)],
      alive: true,
    };

    return this.addBody(body);
  }

  public detonateSupernova(id: string): SupernovaEvent | null {
    const star = this.getBody(id);
    if (!star || star.category !== 'star') return null;
    const ev = triggerSupernova(star, this.bodies, this.debris, this.simTime);
    this.lastMinTau = computeAccelerations(this.bodies);
    stepThermodynamics(this.bodies, 0, false);
    return ev;
  }

  /**
   * Launches a 3D Coronal Mass Ejection (CME) from a star:
   * - `randomRegion = true`: erupts from a random 3D active sunspot region in the ±34° solar active belt (360° longitude)!
   * - `randomRegion = false`: aims toward Earth / targetBodyId (with subtle ±5° active-region variation) to test magnetosphere & G5 auroras.
   */
  public launchCME(
    starId?: string,
    targetBodyId?: string,
    randomRegion = false
  ): CmeWave | null {
    const star =
      (starId ? this.getBody(starId) : null) ??
      this.bodies.find((b) => b.alive && b.category === 'star' && !b.isWhiteDwarf) ??
      null;
    if (!star) return null;

    let dir: Vec3 = { x: 1, y: 0, z: 0 };

    if (randomRegion) {
      // Authentic solar butterfly-diagram sunspot active latitude belt (±6° to ±34° N/S, any 0..360° longitude!)
      const hemi = Math.random() < 0.5 ? 1 : -1;
      const latRad = hemi * ((6 + Math.random() * 28) * Math.PI) / 180;
      const lonRad = Math.random() * Math.PI * 2;
      const cosLat = Math.cos(latRad);
      dir = {
        x: cosLat * Math.cos(lonRad),
        y: Math.sin(latRad),
        z: cosLat * Math.sin(lonRad),
      };
    } else {
      let target: CelestialBody | null = targetBodyId ? this.getBody(targetBodyId) : null;
      if (!target) {
        target =
          this.bodies.find((b) => b.alive && b.name.includes('地球')) ??
          this.bodies.find((b) => b.alive && b.category === 'rocky' && b.atmosphereDensity > 0.15) ??
          this.bodies.find((b) => b.alive && b.id !== star.id && b.category !== 'star') ??
          null;
      }

      if (target) {
        const dx = target.position.x - star.position.x;
        const dy = target.position.y - star.position.y;
        const dz = target.position.z - star.position.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 1) {
          // Subtle natural ±5° active-region offset so repeated targeted bursts aren't carbon-identical
          const jitterYaw = (Math.random() - 0.5) * 0.14;
          const jitterPitch = (Math.random() - 0.5) * 0.16;
          const bx = dx / d;
          const by = dy / d;
          const bz = dz / d;
          const cosY = Math.cos(jitterYaw);
          const sinY = Math.sin(jitterYaw);
          const rx = bx * cosY - bz * sinY;
          const rz = bx * sinY + bz * cosY;
          const ry = by + jitterPitch;
          const len = Math.hypot(rx, ry, rz) || 1;
          dir = { x: rx / len, y: ry / len, z: rz / len };
        }
      }
    }

    const wave: CmeWave = {
      id: nextBodyId('cme'),
      starId: star.id,
      starName: star.name,
      origin: cloneVec3(star.position),
      direction: dir,
      radiusMeters: Math.max(star.radius * 2.5, 0.04 * AU),
      maxRadiusMeters: 2.4 * AU,
      halfAngleRad: 0.56,
      intensity: 1.25,
      color: star.atmosphereColor || '#ff9c38',
      hitBodyIds: [],
    };
    this.cmeWaves.push(wave);
    if (this.cmeWaves.length > 6) this.cmeWaves.shift();
    return wave;
  }

  public removeBody(id: string): void {
    this.bodies = this.bodies.filter((b) => b.id !== id);
    this.lastMinTau = computeAccelerations(this.bodies);
  }

  public getBody(id: string | null): CelestialBody | null {
    if (!id) return null;
    return this.bodies.find((b) => b.id === id && b.alive) ?? null;
  }

  public clearTrails(): void {
    for (const b of this.bodies) {
      b.trail = [cloneVec3(b.position)];
    }
  }

  private spawnCatastrophicFragment = (
    parent: CelestialBody,
    velOffset: Vec3,
    massFrac: number
  ): void => {
    const fragMass = Math.max(1e20, parent.mass * massFrac);
    const fragRadius = Math.max(3.5e5, parent.radius * Math.cbrt(massFrac));
    const dirLen = Math.max(lenVec3(velOffset), 1);
    const offsetDist = parent.radius * 1.45 + fragRadius * 1.2;

    const frag: CelestialBody = {
      id: nextBodyId('frag'),
      name: `${parent.name} 碎片`,
      category: 'asteroid',
      mass: fragMass,
      radius: fragRadius,
      position: {
        x: parent.position.x + (velOffset.x / dirLen) * offsetDist,
        y: parent.position.y + (velOffset.y / dirLen) * offsetDist,
        z: parent.position.z + (velOffset.z / dirLen) * offsetDist,
      },
      velocity: {
        x: parent.velocity.x + velOffset.x,
        y: parent.velocity.y + velOffset.y,
        z: parent.velocity.z + velOffset.z,
      },
      acceleration: { x: 0, y: 0, z: 0 },
      temperature: Math.min(2600, Math.max(1200, parent.temperature + 900)),
      luminosity: 0,
      albedo: 0.14,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0.95,
      rocheStress: 0,
      rotationPeriod: (4 + Math.random() * 14) * 3600,
      rotationAngle: Math.random() * Math.PI * 2,
      axialTilt: Math.random() * 0.6,
      color: parent.secondaryColor || '#8c7a6b',
      secondaryColor: '#52463d',
      atmosphereColor: '#000000',
      seed: Math.random() * 1000,
      trail: [],
      alive: true,
    };
    this.bodies.push(frag);
  };

  /**
   * Advances simulation by dtRealSeconds:
   * - Symplectic Velocity Verlet N-body integration + adaptive sub-stepping
   * - Collisions, fragmentation, Roche tidal tearing
   * - Orbiting debris/ring particle system
   * - Multi-star thermodynamics & real-time climate evolution
   * - Stellar stability, supernovas & black hole accretion
   */
  public step(dtRealSeconds: number): SimStepEvents {
    const events: SimStepEvents = {
      collisions: [],
      tidalDisruptions: [],
      supernovas: [],
      kilonovas: [],
      cmeImpacts: [],
    };
    if (this.paused || (this.bodies.length === 0 && this.debris.particles.length === 0)) {
      this.updateGravitationalWaveSource();
      this.refreshTidalStreamsOnly();
      return events;
    }

    const clampedReal = Math.min(dtRealSeconds, 0.05);
    const totalSimDt = clampedReal * this.timeScale;
    if (totalSimDt <= 0) return events;

    const maxSafeDt = Number.isFinite(this.lastMinTau)
      ? Math.max(60, this.lastMinTau * 0.045)
      : totalSimDt;

    const subSteps = Math.max(
      1,
      Math.min(MAX_SUBSTEPS_PER_FRAME, Math.ceil(totalSimDt / maxSafeDt))
    );
    const subDt = totalSimDt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      this.lastMinTau = verletSubStep(
        this.bodies,
        this.debris,
        subDt,
        this.simTime + (s + 1) * subDt,
        events.collisions,
        events.tidalDisruptions,
        events.kilonovas,
        this.spawnCatastrophicFragment
      );
    }

    // Step orbiting debris/ring particles & galaxy collision stars
    const debrisSteps = Math.min(12, Math.max(1, Math.ceil(subSteps / 6)));
    const debrisDt = totalSimDt / debrisSteps;
    for (let d = 0; d < debrisSteps; d++) {
      this.debris.step(debrisDt, this.bodies);
    }

    if (this.galaxy.stars.length > 0) {
      const galaxySteps = Math.min(6, Math.max(1, Math.ceil(subSteps / 12)));
      const galaxyDt = totalSimDt / galaxySteps;
      for (let g = 0; g < galaxySteps; g++) {
        this.galaxy.step(galaxyDt, this.bodies);
      }
    }

    this.simTime += totalSimDt;

    // Multi-star thermodynamics & stellar/black-hole evolution
    stepThermodynamics(this.bodies, totalSimDt, this.autoThermo);
    stepStellarEvolution(this.bodies, this.debris, totalSimDt, this.simTime, events.supernovas);

    // Stage 5 High-Energy Physics: Solar CME -> Earth Magnetosphere/Aurora, Black Hole TDE & Roche-Lobe Bridges
    this.stepHighEnergyEvents(clampedReal, totalSimDt, events);

    // Prune absorbed/shredded bodies
    if (
      events.collisions.length > 0 ||
      events.tidalDisruptions.length > 0 ||
      events.supernovas.length > 0
    ) {
      this.bodies = this.bodies.filter((b) => b.alive);
      this.lastMinTau = computeAccelerations(this.bodies);
      if (events.collisions.length > 0) {
        this.recentCollisions.push(...events.collisions);
        if (this.recentCollisions.length > 20) {
          this.recentCollisions.splice(0, this.recentCollisions.length - 20);
        }
      }
    }

    // Record orbital trails smoothly
    this.trailAccumulator += clampedReal;
    if (this.trailAccumulator >= 0.032) {
      this.trailAccumulator = 0;
      for (const b of this.bodies) {
        if (!b.alive) continue;
        const last = b.trail[b.trail.length - 1];
        if (!last || distVec3(last, b.position) > Math.max(b.radius * 0.5, AU * 0.0005)) {
          b.trail.push(cloneVec3(b.position));
          if (b.trail.length > MAX_TRAIL_POINTS) {
            b.trail.shift();
          }
        }
      }
    }

    // Update active compact-binary gravitational wave emitter for SpacetimeGrid
    this.updateGravitationalWaveSource();

    return events;
  }

  public updateGravitationalWaveSource(): void {
    let bestAmp = 0;
    let bestCenter: Vec3 = { x: 0, y: 0, z: 0 };
    let bestPhase = 0;
    let bestSep = AU;

    const compact = this.bodies.filter(
      (b) => b.alive && (b.category === 'black_hole' || b.category === 'neutron_star')
    );

    for (let i = 0; i < compact.length; i++) {
      for (let j = i + 1; j < compact.length; j++) {
        const a = compact[i];
        const b = compact[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (sep > 2.2 * AU || sep < 1e6) continue;

        const rAU = sep / AU;
        const amp = Math.min(1.0, 0.45 / Math.pow(Math.max(0.18, rAU), 1.15));
        if (amp > bestAmp) {
          bestAmp = amp;
          const totalM = a.mass + b.mass;
          bestCenter = {
            x: (a.position.x * a.mass + b.position.x * b.mass) / totalM,
            y: (a.position.y * a.mass + b.position.y * b.mass) / totalM,
            z: (a.position.z * a.mass + b.position.z * b.mass) / totalM,
          };
          bestPhase = Math.atan2(dz, dx);
          bestSep = sep;
        }
      }
    }

    this.gwSource.active = bestAmp > 0.05;
    this.gwSource.center = bestCenter;
    this.gwSource.phase = bestPhase;
    this.gwSource.amplitude = bestAmp;
    this.gwSource.separationMeters = bestSep;
  }

  private refreshTidalStreamsOnly(): void {
    const links: TidalStreamLink[] = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const donor = this.bodies[i];
      if (!donor.alive || donor.category !== 'star' || donor.isWhiteDwarf) continue;
      for (let j = 0; j < this.bodies.length; j++) {
        if (i === j) continue;
        const acc = this.bodies[j];
        if (!acc.alive) continue;
        const isBH = acc.category === 'black_hole';
        const isCompact = Boolean(acc.isWhiteDwarf) || acc.category === 'neutron_star';
        if (!isBH && !isCompact) continue;

        const d = distVec3(donor.position, acc.position);
        const maxDist = isBH ? 0.78 * AU : 0.68 * AU;
        if (d >= maxDist) continue;
        const intensity = Math.min(1, Math.max(0.12, (maxDist - d) / (maxDist * 0.68)));
        links.push({
          kind: isBH ? 'tde' : 'roche_bridge',
          donorId: donor.id,
          accretorId: acc.id,
          intensity,
          color: donor.color,
        });
      }
    }
    this.tidalStreams = links;
  }

  private stepHighEnergyEvents(realDt: number, simDt: number, events: SimStepEvents): void {
    // 1. Decay transient magnetosphere bow-shock flashes & relativistic blazar jets
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (b.magnetosphereFlash && b.magnetosphereFlash > 0.002) {
        b.magnetosphereFlash *= Math.exp(-realDt * 0.16);
        if (b.magnetosphereFlash < 0.004) b.magnetosphereFlash = 0;
      }
      if (b.blazarJetPower && b.blazarJetPower > 0.002) {
        b.blazarJetPower *= Math.exp(-realDt * 0.055);
        if (b.blazarJetPower < 0.004) b.blazarJetPower = 0;
      }
    }

    // 2. Step expanding 3D Coronal Mass Ejection (CME) solar-wind shockfronts
    const survivingCmes: CmeWave[] = [];
    for (const cme of this.cmeWaves) {
      // Smooth dramatic ~4.5-6s real-time transit across 1 AU (coupled gently to physical ~2000 km/s speed)
      const physDr = 2.1e6 * simDt;
      const dr = Math.min(0.26 * AU * realDt, Math.max(0.17 * AU * realDt, physDr));
      const prevR = cme.radiusMeters;
      cme.radiusMeters += dr;

      // Update wave origin if parent star moved slightly
      const parentStar = this.getBody(cme.starId);
      if (parentStar) {
        cme.origin = cloneVec3(parentStar.position);
      }

      // Check CME shockfront arrival at planets!
      const cosHalf = Math.cos(cme.halfAngleRad);
      for (const target of this.bodies) {
        if (!target.alive || target.id === cme.starId || target.category === 'star') continue;
        if (cme.hitBodyIds.includes(target.id)) continue;

        const dx = target.position.x - cme.origin.x;
        const dy = target.position.y - cme.origin.y;
        const dz = target.position.z - cme.origin.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e6) continue;

        // Did the expanding shell cross this body's orbital radius inside the CME cone?
        if (dist >= prevR * 0.85 && dist <= cme.radiusMeters + 0.04 * AU) {
          const cosAng = (dx * cme.direction.x + dy * cme.direction.y + dz * cme.direction.z) / dist;
          if (cosAng >= cosHalf) {
            cme.hitBodyIds.push(target.id);
            const isEarthLike = target.name.includes('地球') || target.auroraIntensity !== undefined;
            if (isEarthLike && target.atmosphereDensity > 0.12) {
              target.magnetosphereFlash = 1.0;
              target.auroraIntensity = 1.5; // Auto-ignite G5 Kp 9 Superstorm Aurora!
            } else if (target.category === 'rocky' || target.category === 'gas_giant' || target.category === 'ice_giant') {
              target.magnetosphereFlash = Math.max(target.magnetosphereFlash ?? 0, 0.72);
              if (target.atmosphereDensity > 0.1) {
                target.impactHeat = Math.min(0.35, target.impactHeat + 0.08);
              }
            }
            events.cmeImpacts.push({
              position: cloneVec3(target.position),
              starName: cme.starName,
              targetName: target.name,
              targetId: target.id,
              hasAurora: isEarthLike && target.atmosphereDensity > 0.12,
              timestamp: this.simTime,
            });
          }
        }
      }

      if (cme.radiusMeters < cme.maxRadiusMeters) {
        survivingCmes.push(cme);
      }
    }
    this.cmeWaves = survivingCmes;

    // 3. Evaluate Active Black Hole TDE Spaghettification & Close Binary Roche-Lobe Mass Transfer Bridges
    const activeLinks: TidalStreamLink[] = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const donor = this.bodies[i];
      if (!donor.alive || donor.category !== 'star' || donor.isWhiteDwarf) continue;

      for (let j = 0; j < this.bodies.length; j++) {
        if (i === j) continue;
        const acc = this.bodies[j];
        if (!acc.alive) continue;

        const isBH = acc.category === 'black_hole';
        const isWD = Boolean(acc.isWhiteDwarf);
        const isNS = acc.category === 'neutron_star';
        if (!isBH && !isWD && !isNS) continue;

        const d = distVec3(donor.position, acc.position);
        const maxDist = isBH ? 0.78 * AU : 0.68 * AU;
        if (d >= maxDist) continue;

        const intensity = Math.min(1, Math.max(0.15, (maxDist - d) / (maxDist * 0.68)));
        activeLinks.push({
          kind: isBH ? 'tde' : 'roche_bridge',
          donorId: donor.id,
          accretorId: acc.id,
          intensity,
          color: donor.color,
        });

        donor.rocheStress = Math.max(donor.rocheStress ?? 0, intensity);

        if (isBH) {
          // Gradual Tidal Disruption (Spaghettification) + Relativistic Blazar Jet Ignition!
          const stripFrac = Math.min(0.18, (0.04 + intensity * 0.075) * realDt);
          const massLost = donor.mass * stripFrac;
          donor.mass = Math.max(0.05 * M_SUN, donor.mass - massLost);
          donor.radius *= Math.cbrt(Math.max(0.4, 1 - stripFrac));
          donor.temperature = Math.min(28000, donor.temperature + intensity * 380 * realDt);

          acc.mass += massLost * 0.68;
          acc.radius = Math.max(acc.radius, schwarzschildRadius(acc.mass));
          acc.accretionFlare = Math.min(1.0, (acc.accretionFlare ?? 0) + intensity * 0.65 * realDt + 0.15);
          acc.blazarJetPower = Math.min(1.0, (acc.blazarJetPower ?? 0) + (0.35 + intensity * 0.65) * realDt);

          if (Math.random() < 0.45 + intensity * 0.45) {
            this.debris.spawnRocheStream(donor, acc, Math.round(4 + intensity * 8), false);
          }

          // Final total disruption once stripped down or diving into the event horizon
          if (donor.mass <= 0.20 * M_SUN || d < 0.065 * AU) {
            this.debris.spawnRocheStream(donor, acc, 280, true);
            acc.mass += donor.mass * 0.65;
            acc.radius = Math.max(acc.radius, schwarzschildRadius(acc.mass));
            acc.accretionFlare = 1.0;
            acc.blazarJetPower = 1.0;
            donor.alive = false;
            events.tidalDisruptions.push({
              position: cloneVec3(donor.position),
              victimName: donor.name,
              primaryName: acc.name,
              isBlackHole: true,
              timestamp: this.simTime,
            });
            break;
          }
        } else {
          // Roche-Lobe Overflow Mass Transfer from Donor Red Giant -> White Dwarf / Neutron Star!
          const transferRate = isWD ? 0.0085 * M_SUN : 0.005 * M_SUN;
          const massXfer = Math.min(donor.mass * 0.15, transferRate * intensity * realDt);
          donor.mass = Math.max(0.25 * M_SUN, donor.mass - massXfer);
          acc.mass += massXfer;
          acc.impactHeat = Math.min(1.0, Math.max(acc.impactHeat, 0.35 + intensity * 0.55));

          if (Math.random() < 0.35 + intensity * 0.35) {
            this.debris.spawnRocheStream(donor, acc, Math.round(3 + intensity * 5), false);
          }

          // Chandrasekhar Limit (1.44 M_sun) -> Type Ia Thermonuclear Supernova!
          if (isWD && acc.mass >= 1.44 * M_SUN) {
            const blastPos = cloneVec3(acc.position);
            const blastVel = cloneVec3(acc.velocity);
            const wdName = acc.name;
            acc.alive = false;
            this.debris.spawnSupernovaShell(blastPos, blastVel, acc.radius, '#b8ecff');

            // Realistic slight shock kick to the surviving donor star
            const dx = donor.position.x - blastPos.x;
            const dy = donor.position.y - blastPos.y;
            const dz = donor.position.z - blastPos.z;
            const distKick = Math.max(Math.hypot(dx, dy, dz), 1);
            donor.velocity.x += (dx / distKick) * 9500;
            donor.velocity.y += (dy / distKick) * 9500;
            donor.velocity.z += (dz / distKick) * 9500;
            donor.impactHeat = 1.0;

            events.supernovas.push({
              position: blastPos,
              starName: wdName,
              remnantCategory: 'none',
              remnantId: '',
              color: '#c4f0ff',
              timestamp: this.simTime,
              isTypeIa: true,
            });
            break;
          }
        }
      }
    }
    this.tidalStreams = activeLinks;
  }

  public getBodySnapshots(): BodySnapshot[] {
    return this.bodies
      .filter((b) => b.alive)
      .map((b) => {
        const dominant = findDominantBody(this.bodies, b.position, b.id);
        const speed = lenVec3(b.velocity);
        const distAU = dominant ? distVec3(b.position, dominant.position) / AU : null;
        return {
          id: b.id,
          name: b.name,
          category: b.category,
          mass: b.mass,
          radius: b.radius,
          densityKgM3: computeDensity(b.mass, b.radius),
          speed,
          temperature: b.temperature,
          equilibriumTemp: b.equilibriumTemp ?? b.temperature,
          luminosity: b.luminosity,
          albedo: b.albedo,
          greenhouse: b.greenhouse,
          waterFraction: b.waterFraction,
          atmosphereDensity: b.atmosphereDensity,
          impactHeat: b.impactHeat,
          rocheStress: b.rocheStress ?? 0,
          accretionFlare: b.accretionFlare ?? 0,
          habitability: b.habitability ?? 0,
          auroraIntensity: b.auroraIntensity,
          magnetosphereFlash: b.magnetosphereFlash ?? 0,
          blazarJetPower: b.blazarJetPower ?? 0,
          isWhiteDwarf: b.isWhiteDwarf,
          isGravitationalLens: b.isGravitationalLens,
          lensShear: b.lensShear,
          galaxyType: b.galaxyType,
          galaxyDustOpacity: b.galaxyDustOpacity,
          galaxySpectrumMode: b.galaxySpectrumMode,
          nebulaType: b.nebulaType,
          nebulaSpectrumMode: b.nebulaSpectrumMode,
          nebulaIrPenetration: b.nebulaIrPenetration,
          nebulaDensity: b.nebulaDensity,
          jupiterTorus: b.jupiterTorus,
          volcanicIo: b.volcanicIo,
          rotationPeriod: b.rotationPeriod,
          axialTiltDeg: (b.axialTilt * 180) / Math.PI,
          spectralClass: b.category === 'star' ? getSpectralClass(b.temperature) : null,
          distanceToPrimaryAU: distAU,
          primaryName: dominant ? dominant.name : null,
          color: b.color,
        };
      });
  }
}
