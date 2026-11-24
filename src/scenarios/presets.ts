import {
  AU,
  DAY,
  G,
  HOUR,
  L_SUN,
  M_EARTH,
  M_JUPITER,
  M_MOON,
  M_SATURN,
  M_SUN,
  R_EARTH,
  R_JUPITER,
  R_MOON,
  R_SATURN,
  R_SUN,
  schwarzschildRadius,
} from '../physics/constants';
import { nextBodyId } from '../physics/SimulationEngine';
import { CelestialBody, ScenarioDefinition } from '../types/cosmos';

interface OrbitSpec {
  semiMajorAU: number;
  eccentricity: number;
  inclinationDeg: number;
  phaseDeg: number;
}

function makeOrbitingBody(
  partial: Omit<CelestialBody, 'id' | 'position' | 'velocity' | 'acceleration' | 'rotationAngle' | 'trail' | 'alive' | 'seed'>,
  parent: CelestialBody,
  orbit: OrbitSpec
): CelestialBody {
  const a = orbit.semiMajorAU * AU;
  const e = orbit.eccentricity;
  const inc = (orbit.inclinationDeg * Math.PI) / 180;
  const phase = (orbit.phaseDeg * Math.PI) / 180;

  // Start at perihelion rotated by phase for clean elliptical orbits
  const r = a * (1 - e);
  const vMag = Math.sqrt(G * (parent.mass + partial.mass) * (2 / r - 1 / a));

  const cosP = Math.cos(phase);
  const sinP = Math.sin(phase);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);

  // Position in orbital plane rotated by phase & inclination
  const localX = r * cosP;
  const localZ = r * sinP;
  const posX = parent.position.x + localX;
  const posY = parent.position.y + localZ * sinI;
  const posZ = parent.position.z + localZ * cosI;

  // Tangent velocity perpendicular to radial vector (counter-clockwise in XZ from +Y)
  const localVx = -vMag * sinP;
  const localVz = vMag * cosP;
  const velX = parent.velocity.x + localVx;
  const velY = parent.velocity.y + localVz * sinI;
  const velZ = parent.velocity.z + localVz * cosI;

  return {
    ...partial,
    id: nextBodyId(partial.category),
    position: { x: posX, y: posY, z: posZ },
    velocity: { x: velX, y: velY, z: velZ },
    acceleration: { x: 0, y: 0, z: 0 },
    rotationAngle: Math.random() * Math.PI * 2,
    seed: Math.random() * 1000,
    trail: [{ x: posX, y: posY, z: posZ }],
    parentId: parent.id,
    alive: true,
  };
}

/**
 * Zeroes out net linear momentum of the system so the barycenter stays stationary.
 */
function centerMomentum(bodies: CelestialBody[]): CelestialBody[] {
  let totalMass = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (const b of bodies) {
    totalMass += b.mass;
    px += b.mass * b.velocity.x;
    py += b.mass * b.velocity.y;
    pz += b.mass * b.velocity.z;
  }
  if (totalMass <= 0) return bodies;
  const vxOff = px / totalMass;
  const vyOff = py / totalMass;
  const vzOff = pz / totalMass;
  for (const b of bodies) {
    b.velocity.x -= vxOff;
    b.velocity.y -= vyOff;
    b.velocity.z -= vzOff;
  }
  return bodies;
}

function createSolarSystem(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: (7.25 * Math.PI) / 180,
    color: '#fff1c4',
    secondaryColor: '#ff9d2e',
    atmosphereColor: '#ffbe44',
    seed: 12.34,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  const mercury = makeOrbitingBody(
    {
      name: '水星',
      category: 'rocky',
      mass: 3.3011e23,
      radius: 2.4397e6,
      temperature: 440,
      luminosity: 0,
      albedo: 0.088,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 58.65 * DAY,
      axialTilt: 0.0005,
      color: '#9b958e',
      secondaryColor: '#69625b',
      atmosphereColor: '#000000',
    },
    sun,
    { semiMajorAU: 0.387, eccentricity: 0.205, inclinationDeg: 7.0, phaseDeg: 25 }
  );

  const venus = makeOrbitingBody(
    {
      name: '金星',
      category: 'rocky',
      mass: 4.8675e24,
      radius: 6.0518e6,
      temperature: 737,
      luminosity: 0,
      albedo: 0.76,
      greenhouse: 2.2,
      waterFraction: 0,
      atmosphereDensity: 1.8,
      impactHeat: 0,
      rotationPeriod: -243 * DAY,
      axialTilt: (177.3 * Math.PI) / 180,
      color: '#e5be75',
      secondaryColor: '#c99044',
      atmosphereColor: '#f5d28c',
    },
    sun,
    { semiMajorAU: 0.723, eccentricity: 0.007, inclinationDeg: 3.4, phaseDeg: 115 }
  );

  const earth = makeOrbitingBody(
    {
      name: '地球',
      category: 'rocky',
      mass: M_EARTH,
      radius: R_EARTH,
      temperature: 288,
      luminosity: 0,
      albedo: 0.306,
      greenhouse: 0.38,
      waterFraction: 0.71,
      atmosphereDensity: 1.0,
      auroraIntensity: 0.78,
      impactHeat: 0,
      rotationPeriod: DAY,
      axialTilt: (23.44 * Math.PI) / 180,
      color: '#1e6ec7',
      secondaryColor: '#3f9656',
      atmosphereColor: '#60b8ff',
    },
    sun,
    { semiMajorAU: 1.0, eccentricity: 0.0167, inclinationDeg: 0.0, phaseDeg: 215 }
  );

  const moon = makeOrbitingBody(
    {
      name: '月球',
      category: 'moon',
      mass: M_MOON,
      radius: R_MOON,
      temperature: 220,
      luminosity: 0,
      albedo: 0.12,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 27.32 * DAY,
      axialTilt: (6.68 * Math.PI) / 180,
      color: '#b0b3b8',
      secondaryColor: '#72757c',
      atmosphereColor: '#000000',
    },
    earth,
    { semiMajorAU: 3.844e8 / AU, eccentricity: 0.0549, inclinationDeg: 5.14, phaseDeg: 40 }
  );

  const mars = makeOrbitingBody(
    {
      name: '火星',
      category: 'rocky',
      mass: 6.4171e23,
      radius: 3.3895e6,
      temperature: 210,
      luminosity: 0,
      albedo: 0.25,
      greenhouse: 0.05,
      waterFraction: 0.02,
      atmosphereDensity: 0.18,
      impactHeat: 0,
      rotationPeriod: 24.62 * HOUR,
      axialTilt: (25.19 * Math.PI) / 180,
      color: '#c75a36',
      secondaryColor: '#8d361d',
      atmosphereColor: '#e08963',
    },
    sun,
    { semiMajorAU: 1.524, eccentricity: 0.0934, inclinationDeg: 1.85, phaseDeg: 310 }
  );

  const jupiter = makeOrbitingBody(
    {
      name: '木星',
      category: 'gas_giant',
      mass: M_JUPITER,
      radius: R_JUPITER,
      temperature: 165,
      luminosity: 0,
      albedo: 0.503,
      greenhouse: 0.2,
      waterFraction: 0,
      atmosphereDensity: 1.4,
      impactHeat: 0,
      rotationPeriod: 9.93 * HOUR,
      axialTilt: (3.13 * Math.PI) / 180,
      color: '#d9a774',
      secondaryColor: '#9c5a37',
      atmosphereColor: '#f0cca0',
    },
    sun,
    { semiMajorAU: 5.204, eccentricity: 0.0489, inclinationDeg: 1.3, phaseDeg: 68 }
  );

  const saturn = makeOrbitingBody(
    {
      name: '土星',
      category: 'gas_giant',
      mass: M_SATURN,
      radius: R_SATURN,
      temperature: 134,
      luminosity: 0,
      albedo: 0.342,
      greenhouse: 0.15,
      waterFraction: 0,
      atmosphereDensity: 1.2,
      impactHeat: 0,
      rotationPeriod: 10.7 * HOUR,
      axialTilt: (26.73 * Math.PI) / 180,
      color: '#e6cf9b',
      secondaryColor: '#b3955d',
      atmosphereColor: '#f3dfb4',
      hasRings: true,
      ringInner: 1.28,
      ringOuter: 2.35,
      ringColor: '#dfd0ad',
    },
    sun,
    { semiMajorAU: 9.582, eccentricity: 0.0565, inclinationDeg: 2.49, phaseDeg: 162 }
  );

  const uranus = makeOrbitingBody(
    {
      name: '天王星',
      category: 'ice_giant',
      mass: 8.681e25,
      radius: 2.5362e7,
      temperature: 76,
      luminosity: 0,
      albedo: 0.3,
      greenhouse: 0.1,
      waterFraction: 0,
      atmosphereDensity: 1.1,
      impactHeat: 0,
      rotationPeriod: -17.24 * HOUR,
      axialTilt: (97.77 * Math.PI) / 180,
      color: '#88d8e3',
      secondaryColor: '#5db3c7',
      atmosphereColor: '#a6ecf5',
      hasRings: true,
      ringInner: 1.6,
      ringOuter: 1.95,
      ringColor: '#7cb5bf',
    },
    sun,
    { semiMajorAU: 19.2, eccentricity: 0.0457, inclinationDeg: 0.77, phaseDeg: 255 }
  );

  const neptune = makeOrbitingBody(
    {
      name: '海王星',
      category: 'ice_giant',
      mass: 1.02413e26,
      radius: 2.4622e7,
      temperature: 72,
      luminosity: 0,
      albedo: 0.29,
      greenhouse: 0.1,
      waterFraction: 0,
      atmosphereDensity: 1.1,
      impactHeat: 0,
      rotationPeriod: 16.11 * HOUR,
      axialTilt: (28.32 * Math.PI) / 180,
      color: '#3f6be8',
      secondaryColor: '#2445ad',
      atmosphereColor: '#6699ff',
    },
    sun,
    { semiMajorAU: 30.05, eccentricity: 0.0113, inclinationDeg: 1.77, phaseDeg: 340 }
  );

  return centerMomentum([sun, mercury, venus, earth, moon, mars, jupiter, saturn, uranus, neptune]);
}

function createThreeBody(): CelestialBody[] {
  // Chaotic yet long-lived 3-star system inspired by Trisolaris
  const starA: CelestialBody = {
    id: nextBodyId('star'),
    name: '半人马 A（蓝白恒星）',
    category: 'star',
    mass: 1.25 * M_SUN,
    radius: 1.15 * R_SUN,
    position: { x: -0.95 * AU, y: 0.08 * AU, z: -0.35 * AU },
    velocity: { x: 6500, y: 1200, z: 18500 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 8600,
    luminosity: 2.2 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 12 * DAY,
    rotationAngle: 0,
    axialTilt: 0.1,
    color: '#cfe4ff',
    secondaryColor: '#7eb7ff',
    atmosphereColor: '#8cc0ff',
    seed: 101,
    trail: [{ x: -0.95 * AU, y: 0.08 * AU, z: -0.35 * AU }],
    alive: true,
  };

  const starB: CelestialBody = {
    id: nextBodyId('star'),
    name: '半人马 B（黄矮星）',
    category: 'star',
    mass: 1.0 * M_SUN,
    radius: R_SUN,
    position: { x: 1.05 * AU, y: -0.05 * AU, z: -0.25 * AU },
    velocity: { x: -7200, y: -2200, z: -15800 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5600,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 22 * DAY,
    rotationAngle: 0,
    axialTilt: 0.15,
    color: '#ffefc2',
    secondaryColor: '#ff9d2e',
    atmosphereColor: '#ffbe44',
    seed: 202,
    trail: [{ x: 1.05 * AU, y: -0.05 * AU, z: -0.25 * AU }],
    alive: true,
  };

  const starC: CelestialBody = {
    id: nextBodyId('star'),
    name: '比邻星 C（红矮星）',
    category: 'star',
    mass: 0.55 * M_SUN,
    radius: 0.62 * R_SUN,
    position: { x: 0.05 * AU, y: 0.22 * AU, z: 1.45 * AU },
    velocity: { x: 11200, y: -1500, z: -5200 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 3300,
    luminosity: 0.12 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 35 * DAY,
    rotationAngle: 0,
    axialTilt: 0.08,
    color: '#ff7847',
    secondaryColor: '#ff3d1f',
    atmosphereColor: '#ff6633',
    seed: 303,
    trail: [{ x: 0.05 * AU, y: 0.22 * AU, z: 1.45 * AU }],
    alive: true,
  };

  const trisolaris = makeOrbitingBody(
    {
      name: '三体行星',
      category: 'rocky',
      mass: 1.15 * M_EARTH,
      radius: 1.05 * R_EARTH,
      temperature: 295,
      luminosity: 0,
      albedo: 0.28,
      greenhouse: 0.35,
      waterFraction: 0.55,
      atmosphereDensity: 1.0,
      impactHeat: 0,
      rotationPeriod: 31 * HOUR,
      axialTilt: 0.4,
      color: '#2c7ec4',
      secondaryColor: '#7a9e48',
      atmosphereColor: '#66ccff',
    },
    starB,
    { semiMajorAU: 0.42, eccentricity: 0.08, inclinationDeg: 6.0, phaseDeg: 85 }
  );

  return centerMomentum([starA, starB, starC, trisolaris]);
}

function createBinarySystem(): CelestialBody[] {
  const m1 = 1.1 * M_SUN;
  const m2 = 0.85 * M_SUN;
  const sep = 0.45 * AU;
  const totalM = m1 + m2;
  const r1 = (sep * m2) / totalM;
  const r2 = (sep * m1) / totalM;
  const omega = Math.sqrt((G * totalM) / (sep * sep * sep));

  const star1: CelestialBody = {
    id: nextBodyId('star'),
    name: '主星 Alpha',
    category: 'star',
    mass: m1,
    radius: 1.06 * R_SUN,
    position: { x: -r1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: -omega * r1 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 6200,
    luminosity: 1.4 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 19 * DAY,
    rotationAngle: 0,
    axialTilt: 0.05,
    color: '#fff7e0',
    secondaryColor: '#ffbe55',
    atmosphereColor: '#ffd27d',
    seed: 11,
    trail: [{ x: -r1, y: 0, z: 0 }],
    alive: true,
  };

  const star2: CelestialBody = {
    id: nextBodyId('star'),
    name: '伴星 Beta',
    category: 'star',
    mass: m2,
    radius: 0.82 * R_SUN,
    position: { x: r2, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: omega * r2 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 4400,
    luminosity: 0.45 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 28 * DAY,
    rotationAngle: 0,
    axialTilt: 0.08,
    color: '#ffad66',
    secondaryColor: '#ff6422',
    atmosphereColor: '#ff8a44',
    seed: 22,
    trail: [{ x: r2, y: 0, z: 0 }],
    alive: true,
  };

  // Virtual barycenter anchor to build stable circumbinary planets
  const barycenter: CelestialBody = {
    ...star1,
    id: 'barycenter',
    mass: totalM,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };

  const tatooine = makeOrbitingBody(
    {
      name: '双日荒漠星',
      category: 'rocky',
      mass: 0.9 * M_EARTH,
      radius: 0.96 * R_EARTH,
      temperature: 345,
      luminosity: 0,
      albedo: 0.34,
      greenhouse: 0.25,
      waterFraction: 0.08,
      atmosphereDensity: 0.85,
      impactHeat: 0,
      rotationPeriod: 23 * HOUR,
      axialTilt: 0.2,
      color: '#d9a462',
      secondaryColor: '#a66b38',
      atmosphereColor: '#f2c794',
    },
    barycenter,
    { semiMajorAU: 1.35, eccentricity: 0.03, inclinationDeg: 1.5, phaseDeg: 40 }
  );

  const eden = makeOrbitingBody(
    {
      name: '环联星海洋世界',
      category: 'rocky',
      mass: 1.6 * M_EARTH,
      radius: 1.18 * R_EARTH,
      temperature: 286,
      luminosity: 0,
      albedo: 0.28,
      greenhouse: 0.42,
      waterFraction: 0.82,
      atmosphereDensity: 1.2,
      impactHeat: 0,
      rotationPeriod: 28 * HOUR,
      axialTilt: 0.3,
      color: '#1b6fc9',
      secondaryColor: '#369964',
      atmosphereColor: '#6bc4ff',
    },
    barycenter,
    { semiMajorAU: 2.05, eccentricity: 0.02, inclinationDeg: 0.8, phaseDeg: 195 }
  );

  const giant = makeOrbitingBody(
    {
      name: '蓝环气态巨星',
      category: 'gas_giant',
      mass: 1.4 * M_JUPITER,
      radius: 1.08 * R_JUPITER,
      temperature: 148,
      luminosity: 0,
      albedo: 0.45,
      greenhouse: 0.2,
      waterFraction: 0,
      atmosphereDensity: 1.4,
      impactHeat: 0,
      rotationPeriod: 11 * HOUR,
      axialTilt: 0.42,
      color: '#6ca0dc',
      secondaryColor: '#3d69a8',
      atmosphereColor: '#8dc2ff',
      hasRings: true,
      ringInner: 1.35,
      ringOuter: 2.25,
      ringColor: '#a4c8eb',
    },
    barycenter,
    { semiMajorAU: 4.1, eccentricity: 0.04, inclinationDeg: 2.2, phaseDeg: 310 }
  );

  return centerMomentum([star1, star2, tatooine, eden, giant]);
}

function createAsteroidImpact(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: 0.12,
    color: '#fff1c4',
    secondaryColor: '#ff9d2e',
    atmosphereColor: '#ffbe44',
    seed: 12.34,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  const earth = makeOrbitingBody(
    {
      name: '地球',
      category: 'rocky',
      mass: M_EARTH,
      radius: R_EARTH,
      temperature: 288,
      luminosity: 0,
      albedo: 0.306,
      greenhouse: 0.38,
      waterFraction: 0.71,
      atmosphereDensity: 1.0,
      auroraIntensity: 0.78,
      impactHeat: 0,
      rotationPeriod: DAY,
      axialTilt: (23.44 * Math.PI) / 180,
      color: '#1e6ec7',
      secondaryColor: '#3f9656',
      atmosphereColor: '#60b8ff',
    },
    sun,
    { semiMajorAU: 1.0, eccentricity: 0.01, inclinationDeg: 0, phaseDeg: 210 }
  );

  const moon = makeOrbitingBody(
    {
      name: '月球',
      category: 'moon',
      mass: M_MOON,
      radius: R_MOON,
      temperature: 220,
      luminosity: 0,
      albedo: 0.12,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 27.32 * DAY,
      axialTilt: 0.11,
      color: '#b0b3b8',
      secondaryColor: '#72757c',
      atmosphereColor: '#000000',
    },
    earth,
    { semiMajorAU: 3.844e8 / AU, eccentricity: 0.04, inclinationDeg: 4.5, phaseDeg: 110 }
  );

  // Giant Theia/Chicxulub-class hypervelocity impactor aimed straight at Earth (~1.4e9 m away, hits in ~2.5s!)
  const impactOffset = { x: 1.1e9, y: 0.18e9, z: 0.82e9 };
  const impactPos = {
    x: earth.position.x + impactOffset.x,
    y: earth.position.y + impactOffset.y,
    z: earth.position.z + impactOffset.z,
  };
  const dist = Math.hypot(impactOffset.x, impactOffset.y, impactOffset.z);
  const relSpeed = 14800; // 14.8 km/s hypervelocity collision
  const asteroid: CelestialBody = {
    id: nextBodyId('asteroid'),
    name: '灭世小行星·阿波菲斯',
    category: 'asteroid',
    mass: 0.12 * M_EARTH,
    radius: 0.44 * R_EARTH,
    position: impactPos,
    velocity: {
      x: earth.velocity.x - (impactOffset.x / dist) * relSpeed,
      y: earth.velocity.y - (impactOffset.y / dist) * relSpeed,
      z: earth.velocity.z - (impactOffset.z / dist) * relSpeed,
    },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 480,
    luminosity: 0,
    albedo: 0.08,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0.45,
    rotationPeriod: 6 * HOUR,
    rotationAngle: 0,
    axialTilt: 0.3,
    color: '#917464',
    secondaryColor: '#593e32',
    atmosphereColor: '#000000',
    seed: 777,
    trail: [impactPos],
    alive: true,
  };

  return centerMomentum([sun, earth, moon, asteroid]);
}

function createBlackHoleDevour(): CelestialBody[] {
  const bodies = createSolarSystem().slice(0, 8); // Sun through Saturn for crisp drama

  const bhMass = 16 * M_SUN;
  const bhPos = { x: -2.6 * AU, y: 0.25 * AU, z: 1.9 * AU };
  const rogueBH: CelestialBody = {
    id: nextBodyId('black_hole'),
    name: '流浪黑洞·卡冈图雅',
    category: 'black_hole',
    mass: bhMass,
    radius: schwarzschildRadius(bhMass),
    position: bhPos,
    velocity: { x: 24500, y: -1800, z: -15800 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 0,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    accretionFlare: 0.35,
    rotationPeriod: 0.01,
    rotationAngle: 0,
    axialTilt: 0.32,
    color: '#000000',
    secondaryColor: '#ff7b29',
    atmosphereColor: '#ff9d4d',
    seed: 999,
    trail: [bhPos],
    alive: true,
  };

  return centerMomentum([...bodies, rogueBH]);
}

function createSaturnRingBirth(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: 0.12,
    color: '#fff1c4',
    secondaryColor: '#ff9d2e',
    atmosphereColor: '#ffbe44',
    seed: 12.34,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  // Young Saturn starts WITHOUT rings!
  const youngSaturn = makeOrbitingBody(
    {
      name: '年轻土星',
      category: 'gas_giant',
      mass: M_SATURN,
      radius: R_SATURN,
      temperature: 142,
      luminosity: 0,
      albedo: 0.36,
      greenhouse: 0.15,
      waterFraction: 0,
      atmosphereDensity: 1.2,
      impactHeat: 0,
      rotationPeriod: 10.7 * HOUR,
      axialTilt: (26.73 * Math.PI) / 180,
      color: '#e6cf9b',
      secondaryColor: '#b3955d',
      atmosphereColor: '#f3dfb4',
      hasRings: false,
    },
    sun,
    { semiMajorAU: 9.5, eccentricity: 0.02, inclinationDeg: 1.5, phaseDeg: 160 }
  );

  // Low-density icy moon spiraling into Young Saturn's fluid Roche limit (~1.32e8 m)
  // Starts near apoapsis (~1.24e8 m) so you watch ~2 seconds of tidal magma cracking & stream shedding before total disruption!
  const doomedMoon = makeOrbitingBody(
    {
      name: '冰卫星·洛希体',
      category: 'rocky',
      mass: 1.65e22,
      radius: 1.68e6,
      temperature: 110,
      luminosity: 0,
      albedo: 0.72,
      greenhouse: 0,
      waterFraction: 0.92,
      atmosphereDensity: 0.05,
      impactHeat: 0,
      rotationPeriod: 14 * HOUR,
      axialTilt: 0.1,
      color: '#cce9f7',
      secondaryColor: '#98c4dc',
      atmosphereColor: '#88d4ff',
    },
    youngSaturn,
    { semiMajorAU: 1.16e8 / AU, eccentricity: 0.08, inclinationDeg: 6.0, phaseDeg: 35 }
  );

  // Second outer shepherd moon safely outside Roche limit for visual scale
  const titan = makeOrbitingBody(
    {
      name: '土卫六·泰坦',
      category: 'rocky',
      mass: 1.345e23,
      radius: 2.575e6,
      temperature: 94,
      luminosity: 0,
      albedo: 0.22,
      greenhouse: 0.45,
      waterFraction: 0.15,
      atmosphereDensity: 1.45,
      impactHeat: 0,
      rotationPeriod: 15.9 * DAY,
      axialTilt: 0.05,
      color: '#d99e4e',
      secondaryColor: '#9e6828',
      atmosphereColor: '#f0b965',
    },
    youngSaturn,
    { semiMajorAU: 1.22e9 / AU, eccentricity: 0.03, inclinationDeg: 1.2, phaseDeg: 225 }
  );

  return centerMomentum([sun, youngSaturn, doomedMoon, titan]);
}

function createGalaxyCollision(): CelestialBody[] {
  const mMilky = 36 * M_SUN;
  const mAndromeda = 28 * M_SUN;

  const coreA: CelestialBody = {
    id: nextBodyId('galaxy_core'),
    name: '银河系银心',
    category: 'black_hole',
    mass: mMilky,
    radius: schwarzschildRadius(mMilky),
    position: { x: -2.1 * AU, y: -0.25 * AU, z: -0.7 * AU },
    velocity: { x: 46000, y: 4000, z: 26000 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 0,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    accretionFlare: 0.55,
    rotationPeriod: 0.01,
    rotationAngle: 0,
    axialTilt: 0.38,
    color: '#ffe0a8',
    secondaryColor: '#ff9640',
    atmosphereColor: '#ffd285',
    seed: 1001,
    trail: [{ x: -2.1 * AU, y: -0.25 * AU, z: -0.7 * AU }],
    alive: true,
  };

  const coreB: CelestialBody = {
    id: nextBodyId('galaxy_core'),
    name: '仙女座星系银心',
    category: 'black_hole',
    mass: mAndromeda,
    radius: schwarzschildRadius(mAndromeda),
    position: { x: 2.3 * AU, y: 0.35 * AU, z: 0.85 * AU },
    velocity: { x: -58000, y: -5200, z: -32000 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 0,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    accretionFlare: 0.45,
    rotationPeriod: 0.01,
    rotationAngle: 0,
    axialTilt: -0.45,
    color: '#9ecaff',
    secondaryColor: '#5c9eff',
    atmosphereColor: '#88c0ff',
    seed: 2002,
    trail: [{ x: 2.3 * AU, y: 0.35 * AU, z: 0.85 * AU }],
    alive: true,
  };

  return centerMomentum([coreA, coreB]);
}

function createEclipseTheater(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: 0.0,
    color: '#fff1c4',
    secondaryColor: '#ff9d2e',
    atmosphereColor: '#ffbe44',
    seed: 12.34,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  const earth = makeOrbitingBody(
    {
      name: '地球',
      category: 'rocky',
      mass: M_EARTH,
      radius: R_EARTH,
      temperature: 288,
      luminosity: 0,
      albedo: 0.306,
      greenhouse: 0.38,
      waterFraction: 0.71,
      atmosphereDensity: 1.0,
      auroraIntensity: 0.78,
      impactHeat: 0,
      rotationPeriod: DAY,
      axialTilt: 0.08,
      color: '#1e6ec7',
      secondaryColor: '#3f9656',
      atmosphereColor: '#60b8ff',
    },
    sun,
    { semiMajorAU: 1.0, eccentricity: 0.0, inclinationDeg: 0.0, phaseDeg: 270 }
  );

  // Zero orbital inclination & Earth at (0, 0, -1 AU) so default camera (+Z) looks straight at Earth's
  // sunlit day face! Moon starts at phaseDeg=78 and sweeps dead-center across Sun-Earth line (90 deg) in ~2.2s!
  const moon = makeOrbitingBody(
    {
      name: '月球',
      category: 'moon',
      mass: M_MOON,
      radius: R_MOON,
      temperature: 220,
      luminosity: 0,
      albedo: 0.12,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 27.32 * DAY,
      axialTilt: 0.02,
      color: '#b0b3b8',
      secondaryColor: '#72757c',
      atmosphereColor: '#000000',
    },
    earth,
    { semiMajorAU: 3.844e8 / AU, eccentricity: 0.0, inclinationDeg: 0.0, phaseDeg: 78 }
  );

  return centerMomentum([sun, earth, moon]);
}

function createCometPerihelion(): CelestialBody[] {
  const base = createSolarSystem().slice(0, 6); // Sun, Mercury, Venus, Earth, Moon, Mars
  const sun = base[0];

  // High-eccentricity Halley/NEOWISE-class Great Comet diving from ~1.25 AU toward 0.24 AU perihelion!
  const a = 1.45 * AU;
  const e = 0.84;
  // Place on active inner-system inbound leg (~1.12 AU) so dual tails are already blazing on frame 1!
  const r = 1.12 * AU;
  const vMag = Math.sqrt(G * M_SUN * (2 / r - 1 / a));
  const cosNu = (a * (1 - e * e) / r - 1) / e;
  const clampedCos = Math.max(-1, Math.min(1, cosNu));
  const nu = -Math.acos(clampedCos); // negative true anomaly = inbound toward perihelion!

  const posX = r * Math.cos(nu);
  const posZ = r * Math.sin(nu);
  // Flight path angle gamma for exact Keplerian inbound ellipse
  const h = Math.sqrt(G * M_SUN * a * (1 - e * e));
  const vTheta = h / r;
  const vRadial = -Math.sqrt(Math.max(0, vMag * vMag - vTheta * vTheta));

  const urx = Math.cos(nu);
  const urz = Math.sin(nu);
  const utx = -Math.sin(nu);
  const utz = Math.cos(nu);

  const comet: CelestialBody = {
    id: nextBodyId('comet'),
    name: '哈雷大彗星',
    category: 'comet',
    mass: 2.2e14,
    radius: 3.8e5,
    position: { x: posX, y: 0.08 * AU, z: posZ },
    velocity: {
      x: vRadial * urx + vTheta * utx,
      y: -1800,
      z: vRadial * urz + vTheta * utz,
    },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 145,
    luminosity: 0,
    albedo: 0.05,
    greenhouse: 0,
    waterFraction: 0.9,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 52 * HOUR,
    rotationAngle: 0,
    axialTilt: 0.2,
    color: '#8ee6ff',
    secondaryColor: '#eef8ff',
    atmosphereColor: '#4cc3ff',
    seed: 424,
    trail: [{ x: posX, y: 0.08 * AU, z: posZ }],
    parentId: sun.id,
    alive: true,
  };

  return centerMomentum([...base, comet]);
}

function createBinaryBlackHoleMerger(): CelestialBody[] {
  const m1 = 24 * M_SUN;
  const m2 = 18 * M_SUN;
  const totalM = m1 + m2;
  const sep = 0.76 * AU;
  const r1 = (sep * m2) / totalM;
  const r2 = (sep * m1) / totalM;
  const omega = Math.sqrt((G * totalM) / (sep * sep * sep));

  const bh1: CelestialBody = {
    id: nextBodyId('black_hole'),
    name: '黑洞 Alpha (24 M☉)',
    category: 'black_hole',
    mass: m1,
    radius: schwarzschildRadius(m1),
    position: { x: -r1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: -omega * r1 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 0,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    accretionFlare: 0.35,
    rotationPeriod: 0.01,
    rotationAngle: 0,
    axialTilt: 0.22,
    color: '#000000',
    secondaryColor: '#ff7b29',
    atmosphereColor: '#ff9d4d',
    seed: 801,
    trail: [{ x: -r1, y: 0, z: 0 }],
    alive: true,
  };

  const bh2: CelestialBody = {
    id: nextBodyId('black_hole'),
    name: '黑洞 Beta (18 M☉)',
    category: 'black_hole',
    mass: m2,
    radius: schwarzschildRadius(m2),
    position: { x: r2, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: omega * r2 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 0,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    accretionFlare: 0.3,
    rotationPeriod: 0.01,
    rotationAngle: 0,
    axialTilt: -0.26,
    color: '#000000',
    secondaryColor: '#7a5cff',
    atmosphereColor: '#9c7dff',
    seed: 802,
    trail: [{ x: r2, y: 0, z: 0 }],
    alive: true,
  };

  return centerMomentum([bh1, bh2]);
}

function createKilonovaMerger(): CelestialBody[] {
  const m1 = 1.65 * M_SUN;
  const m2 = 1.45 * M_SUN;
  const totalM = m1 + m2;
  const sep = 0.55 * AU;
  const r1 = (sep * m2) / totalM;
  const r2 = (sep * m1) / totalM;
  const omega = Math.sqrt((G * totalM) / (sep * sep * sep));

  const ns1: CelestialBody = {
    id: nextBodyId('neutron_star'),
    name: '脉冲星 PSR-A',
    category: 'neutron_star',
    mass: m1,
    radius: 1.2e4,
    position: { x: -r1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: -omega * r1 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 480000,
    luminosity: 0.08 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 0.25,
    rotationAngle: 0,
    axialTilt: 0.35,
    color: '#d4f3ff',
    secondaryColor: '#66c2ff',
    atmosphereColor: '#7de2ff',
    seed: 901,
    trail: [{ x: -r1, y: 0, z: 0 }],
    alive: true,
  };

  const ns2: CelestialBody = {
    id: nextBodyId('neutron_star'),
    name: '脉冲星 PSR-B',
    category: 'neutron_star',
    mass: m2,
    radius: 1.2e4,
    position: { x: r2, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: omega * r2 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 440000,
    luminosity: 0.08 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 0.3,
    rotationAngle: 0,
    axialTilt: -0.4,
    color: '#e0d6ff',
    secondaryColor: '#9c78ff',
    atmosphereColor: '#b38aff',
    seed: 902,
    trail: [{ x: r2, y: 0, z: 0 }],
    alive: true,
  };

  return centerMomentum([ns1, ns2]);
}

function createEarthAuroraTheater(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: 0.12,
    color: '#fff1cc',
    secondaryColor: '#ff7a18',
    atmosphereColor: '#ffaa33',
    seed: 101,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  // Placed at phase 112° so default camera (+0.25, +0.54, +0.92) looks right across Earth's twilight-nightside
  // North Magnetic Polar Oval with a golden sunrise crescent on the right and Black Marble city lights below!
  const earth = makeOrbitingBody(
    {
      name: '地球',
      category: 'rocky',
      mass: M_EARTH,
      radius: R_EARTH,
      temperature: 288,
      luminosity: 0,
      albedo: 0.306,
      greenhouse: 0.38,
      waterFraction: 0.71,
      atmosphereDensity: 1.0,
      auroraIntensity: 1.25, // G4-G5 geomagnetic storm for vibrant emerald + crimson 3D curtains!
      impactHeat: 0,
      rotationPeriod: DAY,
      axialTilt: (18.0 * Math.PI) / 180,
      color: '#1e6ec7',
      secondaryColor: '#3f9656',
      atmosphereColor: '#60b8ff',
    },
    sun,
    { semiMajorAU: 1.0, eccentricity: 0.0167, inclinationDeg: 0.0, phaseDeg: 112 }
  );
  // Orient northern Europe & North America nightside cities cleanly beneath the glowing Borealis oval
  earth.rotationAngle = 3.85;

  const moon = makeOrbitingBody(
    {
      name: '月球',
      category: 'moon',
      mass: M_MOON,
      radius: R_MOON,
      temperature: 220,
      luminosity: 0,
      albedo: 0.12,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 27.32 * DAY,
      axialTilt: (6.68 * Math.PI) / 180,
      color: '#b0b3b8',
      secondaryColor: '#72757c',
      atmosphereColor: '#000000',
    },
    earth,
    { semiMajorAU: 3.844e8 / AU, eccentricity: 0.0549, inclinationDeg: 5.14, phaseDeg: 210 }
  );

  return centerMomentum([sun, earth, moon]);
}

function createSolarCmeStorm(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: 0.12,
    color: '#fff1cc',
    secondaryColor: '#ff7a18',
    atmosphereColor: '#ffaa33',
    seed: 101,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  // Placed at 0.72 AU to the right of the Sun so BOTH Sun + flying CME shockfront + Earth fit cleanly in frame!
  const earth = makeOrbitingBody(
    {
      name: '地球',
      category: 'rocky',
      mass: M_EARTH,
      radius: R_EARTH,
      temperature: 288,
      luminosity: 0,
      albedo: 0.306,
      greenhouse: 0.38,
      waterFraction: 0.71,
      atmosphereDensity: 1.0,
      auroraIntensity: 0.32, // Starts quiet so CME impact explosion to G5 Kp 9 is unmistakable!
      impactHeat: 0,
      rotationPeriod: DAY,
      axialTilt: (23.44 * Math.PI) / 180,
      color: '#1e6ec7',
      secondaryColor: '#3f9656',
      atmosphereColor: '#60b8ff',
    },
    sun,
    { semiMajorAU: 0.72, eccentricity: 0.016, inclinationDeg: 0.0, phaseDeg: 14 }
  );

  const moon = makeOrbitingBody(
    {
      name: '月球',
      category: 'moon',
      mass: M_MOON,
      radius: R_MOON,
      temperature: 220,
      luminosity: 0,
      albedo: 0.12,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 27.32 * DAY,
      axialTilt: (6.68 * Math.PI) / 180,
      color: '#b0b3b8',
      secondaryColor: '#72757c',
      atmosphereColor: '#000000',
    },
    earth,
    { semiMajorAU: 3.844e8 / AU, eccentricity: 0.0549, inclinationDeg: 5.14, phaseDeg: 135 }
  );

  return centerMomentum([sun, earth, moon]);
}

function createBlackHoleTde(): CelestialBody[] {
  const bhMass = 18 * M_SUN;
  const bh: CelestialBody = {
    id: nextBodyId('bh'),
    name: '卡冈图雅黑洞',
    category: 'black_hole',
    mass: bhMass,
    radius: schwarzschildRadius(bhMass),
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 0,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    accretionFlare: 0.55,
    blazarJetPower: 0.48,
    rotationPeriod: 0.5,
    rotationAngle: 0,
    axialTilt: 0.26,
    color: '#000000',
    secondaryColor: '#ff9640',
    atmosphereColor: '#ffae52',
    seed: 512,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  // Victim star plunging inside the 0.78 AU TDE spaghettification zone on frame 1!
  const victimStar = makeOrbitingBody(
    {
      name: '被撕裂恒星·天狼伴星',
      category: 'star',
      mass: 1.25 * M_SUN,
      radius: 1.18 * R_SUN,
      temperature: 5400,
      luminosity: 1.15 * L_SUN,
      albedo: 0,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0,
      impactHeat: 0.25,
      rotationPeriod: 12 * DAY,
      axialTilt: 0.1,
      color: '#ffbe6e',
      secondaryColor: '#ff6f24',
      atmosphereColor: '#ff9c3b',
    },
    bh,
    { semiMajorAU: 0.68, eccentricity: 0.28, inclinationDeg: 6.0, phaseDeg: 18 }
  );

  return centerMomentum([bh, victimStar]);
}

function createRocheTypeIaBinary(): CelestialBody[] {
  const redGiantMass = 2.4 * M_SUN;
  const wdMass = 1.34 * M_SUN; // 93% of 1.44 M_sun Chandrasekhar limit!
  const sep = 0.48 * AU;
  const totalMass = redGiantMass + wdMass;
  const r1 = sep * (wdMass / totalMass);
  const r2 = sep * (redGiantMass / totalMass);
  const vOrb = Math.sqrt((G * totalMass) / sep);
  const v1 = vOrb * (wdMass / totalMass);
  const v2 = vOrb * (redGiantMass / totalMass);

  const redGiant: CelestialBody = {
    id: nextBodyId('star'),
    name: '红巨星·伴星',
    category: 'star',
    mass: redGiantMass,
    radius: 3.1 * R_SUN,
    position: { x: -r1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: -v1 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 3650,
    luminosity: 12 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 18 * DAY,
    rotationAngle: 0,
    axialTilt: 0.08,
    color: '#ff6f36',
    secondaryColor: '#c92d14',
    atmosphereColor: '#ff8a47',
    seed: 611,
    trail: [{ x: -r1, y: 0, z: 0 }],
    alive: true,
  };

  const whiteDwarf: CelestialBody = {
    id: nextBodyId('wd'),
    name: '致密白矮星·天狼B',
    category: 'star',
    isWhiteDwarf: true,
    mass: wdMass,
    radius: 0.28 * R_SUN,
    position: { x: r2, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: v2 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 23500,
    luminosity: 0.35 * L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0.45,
    rotationPeriod: 0.8 * DAY,
    rotationAngle: 0,
    axialTilt: 0.05,
    color: '#dcf4ff',
    secondaryColor: '#6ec4ff',
    atmosphereColor: '#88d8ff',
    seed: 612,
    trail: [{ x: r2, y: 0, z: 0 }],
    alive: true,
  };

  return centerMomentum([redGiant, whiteDwarf]);
}

function createJupiterIoTorus(): CelestialBody[] {
  const sun: CelestialBody = {
    id: nextBodyId('sun'),
    name: '太阳',
    category: 'star',
    mass: M_SUN,
    radius: R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 5778,
    luminosity: L_SUN,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    rotationPeriod: 25.4 * DAY,
    rotationAngle: 0,
    axialTilt: 0.12,
    color: '#fff1c1',
    secondaryColor: '#ff8a1f',
    atmosphereColor: '#ffaa44',
    seed: 101,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  // Jupiter orbiting at 5.2 AU at a dramatic oblique sunlight phase so UV polar aurora & Io plumes shine!
  const jupiter = makeOrbitingBody(
    {
      name: '木星',
      category: 'gas_giant',
      mass: M_JUPITER,
      radius: R_JUPITER,
      temperature: 165,
      luminosity: 0,
      albedo: 0.52,
      greenhouse: 0.25,
      waterFraction: 0,
      atmosphereDensity: 1.8,
      impactHeat: 0,
      auroraIntensity: 1.25,
      jupiterTorus: true,
      rotationPeriod: 9.93 * HOUR,
      axialTilt: 0.055,
      color: '#d8b48a',
      secondaryColor: '#a66b46',
      atmosphereColor: '#66a8ff',
    },
    sun,
    { semiMajorAU: 5.2, eccentricity: 0.01, inclinationDeg: 0, phaseDeg: 142 }
  );

  // 1:2:4 Laplace-resonant Galilean trio squeezing Io via tidal heating!
  const io = makeOrbitingBody(
    {
      name: '木卫一 (Io)',
      category: 'moon',
      mass: 1.21 * M_MOON,
      radius: 1.05 * R_MOON,
      temperature: 130,
      luminosity: 0,
      albedo: 0.63,
      greenhouse: 0,
      waterFraction: 0,
      atmosphereDensity: 0.02,
      impactHeat: 0.35,
      volcanicIo: true,
      rotationPeriod: 1.77 * DAY,
      axialTilt: 0.01,
      color: '#e8c448',
      secondaryColor: '#c44b14',
      atmosphereColor: '#ffaa44',
      parentId: jupiter.id,
    },
    jupiter,
    { semiMajorAU: 0.021, eccentricity: 0.004, inclinationDeg: 0.2, phaseDeg: 32 }
  );

  const europa = makeOrbitingBody(
    {
      name: '木卫二 (欧罗巴)',
      category: 'moon',
      mass: 0.65 * M_MOON,
      radius: 0.90 * R_MOON,
      temperature: 102,
      luminosity: 0,
      albedo: 0.67,
      greenhouse: 0,
      waterFraction: 0.4,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 3.55 * DAY,
      axialTilt: 0.01,
      color: '#d8e4f0',
      secondaryColor: '#8ea2b8',
      atmosphereColor: '#000000',
      parentId: jupiter.id,
    },
    jupiter,
    { semiMajorAU: 0.034, eccentricity: 0.009, inclinationDeg: 0.5, phaseDeg: 148 }
  );

  const ganymede = makeOrbitingBody(
    {
      name: '木卫三 (盖尼米德)',
      category: 'moon',
      mass: 2.02 * M_MOON,
      radius: 1.52 * R_MOON,
      temperature: 110,
      luminosity: 0,
      albedo: 0.43,
      greenhouse: 0,
      waterFraction: 0.1,
      atmosphereDensity: 0,
      impactHeat: 0,
      rotationPeriod: 7.15 * DAY,
      axialTilt: 0.01,
      color: '#b4aa9c',
      secondaryColor: '#6f665a',
      atmosphereColor: '#000000',
      parentId: jupiter.id,
    },
    jupiter,
    { semiMajorAU: 0.054, eccentricity: 0.002, inclinationDeg: 0.3, phaseDeg: 256 }
  );

  return centerMomentum([sun, jupiter, io, europa, ganymede]);
}

function createEinsteinRingLensing(): CelestialBody[] {
  const lensMass = 1.0e12 * M_SUN;
  const foregroundLens: CelestialBody = {
    id: nextBodyId('lens'),
    name: '前景引力透镜星系团',
    category: 'black_hole',
    mass: lensMass,
    radius: 0.15 * R_SUN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 4800,
    luminosity: 0,
    albedo: 0,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    isGravitationalLens: true,
    lensShear: 0.0,
    rotationPeriod: 1000 * DAY,
    rotationAngle: 0,
    axialTilt: 0,
    color: '#ffe2ad',
    secondaryColor: '#ffaa55',
    atmosphereColor: '#77aaff',
    seed: 901,
    trail: [{ x: 0, y: 0, z: 0 }],
    alive: true,
  };

  // Cosmological background grand-design spiral galaxy + active quasar aligned cleanly behind the lens!
  // Gentle transverse cosmological drift slowly glides through exact beta = 0 Einstein Ring symmetry.
  const backgroundSource: CelestialBody = {
    id: nextBodyId('src'),
    name: '遥远背景旋涡星系 (z≈3.2)',
    category: 'rocky',
    mass: 1e20,
    radius: 0.1 * R_EARTH,
    position: { x: -1.6 * AU, y: 0.35 * AU, z: -160 * AU },
    velocity: { x: 9.5e5, y: -1.8e5, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    temperature: 300,
    luminosity: 0,
    albedo: 0.5,
    greenhouse: 0,
    waterFraction: 0,
    atmosphereDensity: 0,
    impactHeat: 0,
    isLensSource: true,
    rotationPeriod: 100 * DAY,
    rotationAngle: 0,
    axialTilt: 0,
    color: '#72b8ff',
    secondaryColor: '#ff70b8',
    atmosphereColor: '#000000',
    seed: 902,
    trail: [],
    alive: true,
  };

  return [foregroundLens, backgroundSource];
}

function createEmptySandbox(): CelestialBody[] {
  return [];
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'solar_system',
    name: '太阳系',
    description: '真实天文数据的太阳系八大行星与月球，探索行星公转与引力扰动。',
    defaultTimeScale: 15 * DAY,
    defaultCameraDistanceAU: 3.4,
    defaultFocusBodyName: '太阳',
    createBodies: createSolarSystem,
  },
  {
    id: 'jupiter_io_torus',
    name: '🌋 木星—木卫一火山与等离子体环',
    description: 'NASA 朱诺号实测级木星电磁奇观：木卫一在 1:2:4 潮汐共振下喷发伞状硫磺火山羽流，滋养发光等离子体环，并通过 40 万伏磁通量管直连木星南北极点亮电光蓝极光足点与拖尾！',
    defaultTimeScale: 1.6 * DAY,
    defaultCameraDistanceAU: 0.068,
    defaultFocusBodyName: '木星',
    defaultCameraAngles: { azimuthDeg: 22, elevationDeg: 26 },
    createBodies: createJupiterIoTorus,
  },
  {
    id: 'einstein_ring_lensing',
    name: '⏳ 引力透镜：爱因斯坦环与十字',
    description: 'JWST / 哈勃实拍级广义相对论强引力透镜：自由拖拽视角或调节透镜椭率与质量，实时把遥远背景星系弯折成完美 360° 爱因斯坦环、四重爱因斯坦十字与漫天星系团弧！',
    defaultTimeScale: 0.8 * DAY,
    defaultCameraDistanceAU: 0.92,
    defaultFocusBodyName: '前景引力透镜星系团',
    defaultCameraAngles: { azimuthDeg: 0, elevationDeg: 0 },
    createBodies: createEinsteinRingLensing,
  },
  {
    id: 'earth_aurora',
    name: '🌌 地球极光与地磁暴奇观',
    description: '国际空间站高纬夜半球轨道视角，近距离观赏地球南北磁极 3D 立体翠绿/绯红极光幕帘与城市夜灯。',
    defaultTimeScale: 0.04 * DAY,
    defaultCameraDistanceAU: 0.016,
    defaultFocusBodyName: '地球',
    createBodies: createEarthAuroraTheater,
  },
  {
    id: 'solar_cme_storm',
    name: '☀️ 太阳风暴冲击地球磁层',
    description: '太阳向地球定向抛射超级日冕物质抛射 (CME) 磁云，实时见证风暴撞击点亮地球弓形磁层护盾并引爆 G5 级极光！',
    defaultTimeScale: 0.22 * DAY,
    defaultCameraDistanceAU: 1.05,
    defaultFocusBodyName: '太阳',
    autoLaunchCme: true,
    createBodies: createSolarCmeStorm,
  },
  {
    id: 'black_hole_tde',
    name: '🕳️ 黑洞潮汐撕裂恒星 (TDE)',
    description: '恒星近距掠过卡冈图雅黑洞，被潮汐力拉成炽热螺旋等离子体流带（意大利面化），并点燃双极相对论性耀变体喷流！',
    defaultTimeScale: 1.4 * DAY,
    defaultCameraDistanceAU: 1.05,
    defaultFocusBodyName: '卡冈图雅黑洞',
    createBodies: createBlackHoleTde,
  },
  {
    id: 'roche_type_ia',
    name: '🌟 双星吸积气桥与 Ia 型超新星',
    description: '致密白矮星持续从伴星红巨星抽吸发光气桥，质量突破 1.44 M☉ 钱德拉塞卡极限后引爆毁灭性 Ia 型热核超新星！',
    defaultTimeScale: 2.0 * DAY,
    defaultCameraDistanceAU: 0.85,
    defaultFocusBodyName: '致密白矮星·天狼B',
    createBodies: createRocheTypeIaBinary,
  },
  {
    id: 'eclipse_theater',
    name: '🌑 日全食与血月奇观',
    description: '精准对齐日地月交点，近距离观赏月球本影扫过地球大陆，以及月球陷入地球大气红影化作血月。',
    defaultTimeScale: 0.4 * DAY,
    defaultCameraDistanceAU: 0.024,
    defaultFocusBodyName: '地球',
    createBodies: createEclipseTheater,
  },
  {
    id: 'comet_perihelion',
    name: '☄️ 哈雷大彗星掠日',
    description: '冰彗星高速冲向太阳近日点，受太阳风与辐射压爆发翠绿 C2 彗发、多射线湛蓝离子尾与弯曲丝绸尘埃尾。',
    defaultTimeScale: 2.5 * DAY,
    defaultCameraDistanceAU: 0.62,
    defaultFocusBodyName: '哈雷大彗星',
    createBodies: createCometPerihelion,
  },
  {
    id: 'binary_bh_merger',
    name: '🌀 双黑洞并合引力波',
    description: '两颗卡冈图雅黑洞近距旋进并合，在 3D 时空网格上激荡出壮观的螺旋引力波涟漪与 LIGO 啁啾激波。',
    defaultTimeScale: 2.2 * DAY,
    defaultCameraDistanceAU: 1.8,
    defaultShowGravityGrid: true,
    createBodies: createBinaryBlackHoleMerger,
  },
  {
    id: 'kilonova_merger',
    name: '💥 双中子星千新星并合',
    description: '双脉冲中子星引力波旋进相撞，触发蓝紫/赤红重元素千新星爆发并坍缩为新生黑洞。',
    defaultTimeScale: 4.5 * DAY,
    defaultCameraDistanceAU: 1.6,
    defaultShowGravityGrid: true,
    createBodies: createKilonovaMerger,
  },
  {
    id: 'three_body',
    name: '三体恒星系',
    description: '三颗恒星的混沌引力之舞，观察三体行星在恒纪元与乱纪元间的命运（试试降落到三体行星看三日凌空！）。',
    defaultTimeScale: 12 * DAY,
    defaultCameraDistanceAU: 3.8,
    createBodies: createThreeBody,
  },
  {
    id: 'binary_stars',
    name: '双星与环联星系',
    description: '密近双星相互绕转，滋养外围环联星荒漠与海洋世界。',
    defaultTimeScale: 10 * DAY,
    defaultCameraDistanceAU: 4.0,
    createBodies: createBinarySystem,
  },
  {
    id: 'asteroid_impact',
    name: '☄️ 小行星撞地球',
    description: '一颗巨型撞击体以 14.8 km/s 高速直击地球，近距离目击熔岩爆发与碎片云抛射。',
    defaultTimeScale: 0.45 * DAY,
    defaultCameraDistanceAU: 0.065,
    defaultFocusBodyName: '地球',
    createBodies: createAsteroidImpact,
  },
  {
    id: 'black_hole_devour',
    name: '🕳️ 黑洞吞噬恒星系',
    description: '16 倍太阳质量的流浪黑洞闯入太阳系，撕裂行星轨道并触发吸积盘耀发。',
    defaultTimeScale: 10 * DAY,
    defaultCameraDistanceAU: 3.6,
    defaultFocusBodyName: '流浪黑洞·卡冈图雅',
    createBodies: createBlackHoleDevour,
  },
  {
    id: 'saturn_ring_birth',
    name: '🪐 土星环潮汐形成',
    description: '冰卫星闯入年轻土星的洛希极限，实时见证潮汐撕裂并诞生璀璨土星光环。',
    defaultTimeScale: 0.25 * DAY,
    defaultCameraDistanceAU: 0.032,
    defaultFocusBodyName: '年轻土星',
    createBodies: createSaturnRingBirth,
  },
  {
    id: 'galaxy_collision',
    name: '🌌 星系碰撞（3200 恒星）',
    description: '银河系与仙女座旋涡星系交汇碰撞，3200 颗恒星粒子在潮汐引力下拉出壮丽潮汐尾。',
    defaultTimeScale: 24 * DAY,
    defaultCameraDistanceAU: 7.2,
    createBodies: createGalaxyCollision,
    setupGalaxy: (spawnSpiralDisk, bodies) => {
      if (bodies.length >= 2) {
        spawnSpiralDisk(bodies[0], 1650, 0.16 * AU, 1.95 * AU, 24, 14, 1, 'warm');
        spawnSpiralDisk(bodies[1], 1550, 0.15 * AU, 1.75 * AU, -32, -18, -1, 'cool');
      }
    },
  },
  {
    id: 'empty',
    name: '空白深空',
    description: '从零开始自由创造属于你的恒星、行星与黑洞系统。',
    defaultTimeScale: 7 * DAY,
    defaultCameraDistanceAU: 3.0,
    createBodies: createEmptySandbox,
  },
];
