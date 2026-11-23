import { CelestialBody } from '../types/cosmos';
import { DAY, G, SIGMA_SB } from './constants';
import { distVec3 } from './vec3';

/**
 * Computes radiative equilibrium temperature (K) for a non-luminous body receiving
 * energy from ALL stars (and hot neutron stars) in the system, accounting for
 * Bond albedo, atmospheric greenhouse warming, and tidal heating.
 */
export function computeEquilibriumTemperature(
  body: CelestialBody,
  radiators: CelestialBody[]
): number {
  if (body.category === 'star' || body.category === 'black_hole' || body.category === 'neutron_star') {
    return body.temperature;
  }

  let totalFlux = 0; // W / m^2
  for (const star of radiators) {
    if (!star.alive || star.id === body.id || star.luminosity <= 0) continue;
    const d = Math.max(distVec3(body.position, star.position), star.radius * 1.15);
    totalFlux += star.luminosity / (4 * Math.PI * d * d);
  }

  // Cosmic microwave background floor (~3 K, plus slight internal geothermal floor ~32 K)
  const internalFlux = SIGMA_SB * Math.pow(body.category === 'gas_giant' ? 85 : 34, 4);
  const absorbedFlux = (totalFlux * (1 - Math.max(0, Math.min(0.95, body.albedo)))) / 4;

  // Runaway radiative-convective greenhouse amplification:
  // Earth (g=0.38, A=0.306) -> 288 K; g=1.5 -> ~540 K (oceans boil); g=2.2 (Venus) -> ~725 K; g=2.6 -> ~930 K (magma)
  const g = Math.max(0, body.greenhouse);
  const runaway = g > 0.45 ? Math.pow(g - 0.45, 3.1) * 16.0 : 0;
  const greenhouseBoost = 1 + g * 1.72 + runaway;

  // Tidal heating contribution when undergoing strong Roche stress
  const tidalFlux = (body.rocheStress ?? 0) * (body.rocheStress ?? 0) * 18000;

  const t4 = (absorbedFlux * greenhouseBoost + internalFlux + tidalFlux) / SIGMA_SB;
  return Math.max(3, Math.min(8000, Math.pow(Math.max(t4, 81), 0.25)));
}

/**
 * Computes a 0..100 habitability index for rocky planets based on surface temperature,
 * liquid water availability, and atmospheric pressure.
 */
export function computeHabitability(body: CelestialBody): number {
  if (body.category !== 'rocky') return 0;

  // Optimal temperature ~288 K (15°C), viable 238 K .. 338 K; extreme heat/cold kills habitability outright
  const tempDiff = Math.abs(body.temperature - 288);
  const tempScore = Math.max(0, 1 - Math.pow(tempDiff / 52, 2));
  if (tempScore <= 0.02) return 0;

  // Optimal water fraction ~0.55 - 0.80
  const waterScore =
    body.waterFraction <= 0.02
      ? 0
      : Math.max(0, 1 - Math.pow((body.waterFraction - 0.65) / 0.65, 2));

  // Optimal atmosphere ~0.6 - 1.4 atm
  const atmoScore =
    body.atmosphereDensity <= 0.05
      ? 0
      : Math.max(0, 1 - Math.pow((body.atmosphereDensity - 1.0) / 1.15, 2));

  // Penalize active impact/tidal magma catastrophes
  const hazardPenalty = Math.max(0, 1 - body.impactHeat * 1.5 - (body.rocheStress ?? 0));

  return Math.round(
    Math.max(0, Math.min(100, tempScore * (50 + waterScore * 28 + atmoScore * 22))) * hazardPenalty
  );
}

/**
 * Evolves planetary temperatures, ocean boil-off / condensation, and habitability
 * smoothly over simulated time dt (seconds).
 */
export function stepThermodynamics(bodies: CelestialBody[], dt: number, enabled: boolean): void {
  const radiators = bodies.filter(
    (b) => b.alive && (b.category === 'star' || b.category === 'neutron_star') && b.luminosity > 0
  );

  for (const body of bodies) {
    if (!body.alive) continue;

    if (body.category === 'star' || body.category === 'black_hole' || body.category === 'neutron_star') {
      body.equilibriumTemp = body.temperature;
      body.habitability = 0;
      continue;
    }

    const eqTemp = computeEquilibriumTemperature(body, radiators);
    body.equilibriumTemp = eqTemp;

    if (enabled && dt > 0) {
      // Snappy yet physical thermal inertia (~8-20 sim days) so climate experiments visibly transform in 2-4 seconds
      const baseTau =
        (6 + body.atmosphereDensity * 6 + body.waterFraction * 6) * DAY;
      const hotBoost = body.temperature > 550 ? Math.min(8, Math.pow(body.temperature / 550, 2)) : 1;
      const rate = Math.min(1, (dt * hotBoost) / baseTau);

      body.temperature += (eqTemp - body.temperature) * rate;

      // Extreme runaway heat (> 520 K) gradually boils & strips liquid water away
      if (body.temperature > 520 && body.waterFraction > 0) {
        const boilRate = Math.min(1, ((body.temperature - 520) / 600) * (dt / (45 * DAY)));
        body.waterFraction = Math.max(0, body.waterFraction - boilRate * 0.35);
      }
    }

    // Gentle orbital tidal heating if very close to a giant body
    if (enabled && body.rocheStress && body.rocheStress > 0.2) {
      body.impactHeat = Math.min(1, Math.max(body.impactHeat, (body.rocheStress - 0.2) * 0.85));
    }

    body.habitability = computeHabitability(body);
  }
}

/**
 * Helper to compute average density in kg/m^3.
 */
export function computeDensity(massKg: number, radiusM: number): number {
  const vol = (4 / 3) * Math.PI * radiusM * radiusM * radiusM;
  return vol > 0 ? massKg / vol : 0;
}

/**
 * Computes the fluid Roche limit (or relativistic tidal disruption radius for black holes)
 * of a smaller body orbiting a more massive primary.
 */
export function computeRocheLimit(primary: CelestialBody, secondary: CelestialBody): number {
  if (primary.category === 'black_hole') {
    // Tidal disruption radius r_t = R_s * (M_bh / M_body)^(1/3)
    const rt = secondary.radius * Math.cbrt(primary.mass / Math.max(secondary.mass, 1e10));
    // Ensure a dramatic visual tidal zone around stellar black holes
    const rs = (2 * G * primary.mass) / (2.99792458e8 * 2.99792458e8);
    return Math.max(rt * 1.15, rs * 160);
  }

  const rhoP = computeDensity(primary.mass, primary.radius);
  const rhoS = Math.max(100, computeDensity(secondary.mass, secondary.radius));
  // Fluid Roche limit: d = 2.44 * R_primary * (rho_primary / rho_secondary)^(1/3)
  return 2.44 * primary.radius * Math.cbrt(rhoP / rhoS);
}
