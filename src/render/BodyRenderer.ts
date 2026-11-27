import * as THREE from 'three';
import { AU, L_SUN, M_SUN, METERS_TO_SCENE, R_EARTH, R_SUN } from '../physics/constants';
import { CelestialBody, CmeWave, ScaleMode, Vec3 } from '../types/cosmos';
import {
  createAndromedaStarsMaterial,
  createAndromedaVolumeMaterial,
  createAtmosphereMaterial,
  createBlackHoleLensingMaterial,
  createCloudLayerMaterial,
  createCometComaMaterial,
  createCometParticleStreamMaterial,
  createCometRibbonMaterial,
  createDwarfEllipticalMaterial,
  createDwarfEllipticalStarsMaterial,
  createEarthAuroraMaterial,
  createGravitationalLensMaterial,
  createIoSurfaceMaterial,
  createJupiterAuroraMaterial,
  createNgc6611ClusterMaterial,
  createPillarsBackdropMaterial,
  createPillarsStarsMaterial,
  createPillarsVolumeMaterial,
  createProminenceMaterial,
  createPulsarJetMaterial,
  createRingMaterial,
  createSolarCoronaMaterial,
  createSourceGalaxyBulgeMaterial,
  createSourceGalaxyDiscMaterial,
  createSourceGalaxyStarsMaterial,
  createStarMaterial,
  createTexturedEarthMaterial,
  createTexturedGasGiantMaterial,
  createTexturedRockyMaterial,
  createWormholeMaterial,
  MAX_OCCLUDERS,
  MAX_STAR_LIGHTS,
} from './shaders/bodyShaders';
import { PILLARS_BCENTER, PILLARS_BSIZE } from './PillarsBaker';
import { PlanetTextures, textureAtlas } from './TextureAtlas';

const SHARED_SPHERE_GEO = new THREE.SphereGeometry(1, 64, 48);
const SHARED_CLOUD_GEO = new THREE.SphereGeometry(1.012, 48, 36);
const SHARED_ATMO_GEO = new THREE.SphereGeometry(1.058, 40, 32);
const SHARED_BH_VOLUME_GEO = new THREE.SphereGeometry(15.0, 36, 24);
const SHARED_WORMHOLE_GEO = new THREE.SphereGeometry(7.5, 48, 36);
const SHARED_PICK_GEO = new THREE.SphereGeometry(1, 10, 8);
const SHARED_CORONA_GEO = new THREE.PlaneGeometry(1, 1);
const MAX_TRAIL_VERTS = 360;

// High-detail irregular bilobed Rosetta-67P-inspired craggy comet nucleus geometry (NOT a smooth marble!)
function buildCometNucleusGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 56, 40);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Elongated bilobed "rubber duck" waist pinch along X + terraced rugged cliffs & impact pits
    const pinch = 1.0 - 0.40 * Math.exp(-x * x * 7.8);
    const asymLobe = x > 0 ? 1.16 : 0.86;
    const ridge1 = 0.095 * Math.sin(x * 5.2 + y * 3.8);
    const ridge2 = 0.070 * Math.cos(y * 7.4 - z * 6.1);
    const ridge3 = 0.042 * Math.sin(z * 11.5 + x * 8.7);
    const micro = 0.022 * Math.cos(x * 18.0 - y * 15.5 + z * 13.0);
    // Subtle concave depression (like Rosetta 67P's Hatmehit basin)
    const pit = -0.09 * Math.exp(-((x - 0.45) * (x - 0.45) + (y - 0.35) * (y - 0.35) + (z - 0.5) * (z - 0.5)) * 6.5);
    const crags = ridge1 + ridge2 + ridge3 + micro + pit;
    pos.setXYZ(
      i,
      x * 1.48 * asymLobe + crags * x,
      y * 0.82 * pinch + crags * y,
      z * 0.76 * pinch + crags * z
    );
  }
  geo.computeVertexNormals();
  return geo;
}
const SHARED_COMET_NUCLEUS_GEO = buildCometNucleusGeometry();

// Axial ribbon plane (uv.x in [0..1] across width, uv.y in [0..1] along length)
// Vertex shader dynamically billboards ribbon width toward camera around the curved tail spline!
const SHARED_COMET_RIBBON_GEO = new THREE.PlaneGeometry(1, 1, 6, 48);

// 640-particle GPU-computed comet outgassing jets & delicate micro-ice/plasma glints (zero CPU loop!)
function buildCometParticleGeometry(): THREE.BufferGeometry {
  const count = 640;
  const dummyPos = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    // 35% delicate micro-dust glints, 20% straight blue ion glints, 45% sunward Rosetta-67P fountain jets
    const kind = r < 0.35 ? 0 : r < 0.55 ? 1 : 2;
    params[i * 4] = Math.random(); // phase
    params[i * 4 + 1] = Math.pow(Math.random(), 0.72); // radial spread
    params[i * 4 + 2] = Math.random() * Math.PI * 2; // azimuth
    params[i * 4 + 3] = kind;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  return geo;
}
const SHARED_COMET_PARTICLES_GEO = buildCometParticleGeometry();

// Wide curved radial plasma-curtain geometry (r=0.97 -> r=1.52) so wispy tendrils fade out
// well before the quad boundary -> ZERO geometric border clipping!
function buildProminenceCurtainGeometry(): THREE.BufferGeometry {
  const segX = 16;
  const segY = 8;
  const geo = new THREE.PlaneGeometry(1.0, 0.55, segX, segY);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i); // [-0.5 .. 0.5]
    const ly = pos.getY(i) + 0.275; // [0 .. 0.55] altitude above base
    const angle = lx * 1.05;
    const r = 0.97 + ly;
    const zTwist = Math.sin(lx * Math.PI * 1.5) * 0.09 * (ly / 0.55);
    pos.setXYZ(i, Math.sin(angle) * r, Math.cos(angle) * r, zTwist);
  }
  geo.computeVertexNormals();
  return geo;
}
export const SHARED_PROMINENCE_GEO = buildProminenceCurtainGeometry();

// Single lightweight outer bounding sphere for true single-pass 3D volumetric raymarched Earth aurora!
// Eliminates all shell slicing, plastic ribbon edges, and overdraw — raymarches real 90-450km thermosphere volume.
const SHARED_EARTH_AURORA_GEO = new THREE.SphereGeometry(1.09, 48, 36);
const SHARED_JUPITER_AURORA_GEO = new THREE.SphereGeometry(1.038, 48, 36);
const SHARED_LENS_VOLUME_GEO = new THREE.SphereGeometry(22.0, 48, 32);
const SHARED_SOURCE_GALAXY_DISC_GEO = new THREE.PlaneGeometry(5.6, 5.6);
const SHARED_SOURCE_GALAXY_BULGE_GEO = new THREE.SphereGeometry(0.95, 32, 24);

function buildSourceGalaxyStarsGeometry(count = 1400): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  let s = 9021;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const gauss = () => (rand() + rand() + rand() - 1.5) * 0.66;

  const colBlue = new THREE.Color('#72b8ff');
  const colRose = new THREE.Color('#ff66b2');
  const colGold = new THREE.Color('#ffd28a');
  const tmpCol = new THREE.Color();

  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let z: number;

    if (i < count * 0.25) {
      // 25% golden-ivory bulge stars with genuine 3D spheroid vertical thickness
      const r = Math.pow(rand(), 1.8) * 0.85;
      const ang = rand() * Math.PI * 2;
      x = Math.cos(ang) * r;
      y = Math.sin(ang) * r;
      z = gauss() * 0.28 * (1.0 - 0.45 * (r / 0.85));
      tmpCol.copy(colGold);
      sizes[i] = 1.0 + rand() * 1.1;
    } else {
      // 75% spiral-arm stars aligned directly with twin logarithmic spiral arms
      const armIdx = i % 2;
      const rNorm = 0.09 + Math.pow(rand(), 1.15) * 0.66; // -> 0.25..2.10 in world plane units
      const rPlane = rNorm * 2.8;
      const armAngle = armIdx * Math.PI + Math.log(Math.max(rNorm, 0.04)) * 2.6 + gauss() * 0.34;
      x = Math.cos(armAngle) * rPlane;
      y = Math.sin(armAngle) * rPlane;
      z = gauss() * 0.14 * (1.0 - 0.35 * rNorm);

      if (rand() < 0.18) {
        tmpCol.copy(colRose);
        sizes[i] = 1.5 + rand() * 1.5;
      } else {
        tmpCol.copy(colBlue);
        if (rNorm < 0.3) {
          tmpCol.lerp(colGold, (0.3 - rNorm) / 0.3);
        }
        sizes[i] = 1.2 + rand() * 1.5;
      }
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aStarCol', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aStarSize', new THREE.BufferAttribute(sizes, 1));
  return geo;
}

const SHARED_SOURCE_GALAXY_STARS_GEO = buildSourceGalaxyStarsGeometry(1400);
const SHARED_ANDROMEDA_VOLUME_GEO = new THREE.SphereGeometry(10.5, 44, 30);
const SHARED_DWARF_ELLIPTICAL_GEO = new THREE.SphereGeometry(5.2, 32, 22);

function createGalaxyPrng(seed: number) {
  let s = seed | 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => (rand() + rand() + rand() - 1.5) * 0.66;
  return { rand, gauss };
}

function buildAndromedaStarsGeometry(count = 40000): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const pops = new Float32Array(count);

  const { rand, gauss } = createGalaxyPrng(1031);

  const colBulgePeach = new THREE.Color('#ffd3a6');
  const colBulgeIvory = new THREE.Color('#fff2de');
  const colWarmDisk = new THREE.Color('#ffc996');
  const colArmCobalt = new THREE.Color('#7eb8ff');
  const colSapphire = new THREE.Color('#cce4ff');
  const colH2Ruby = new THREE.Color('#ff3c6e');
  const tmpCol = new THREE.Color();

  // Pre-build 160 compact OB star-cloud micro-associations aligned to M31's flocculent arms & patchy 10 kpc ring
  const microClusters: Array<{ x: number; z: number; sigma: number; rNorm: number }> = [];
  for (let k = 0; k < 160; k++) {
    const onRing = k % 3 !== 0;
    const rN = onRing ? Math.min(0.86, Math.max(0.42, 0.60 + gauss() * 0.11)) : 0.24 + Math.pow(rand(), 0.95) * 0.62;
    const logR = Math.log(rN + 0.11);
    let ang: number;
    if (onRing && rand() < 0.45) {
      ang = rand() * Math.PI * 2;
    } else if (k % 2 === 0) {
      ang = (9.4 * logR + 2.2) * 0.5 + (k % 4 === 0 ? 0 : Math.PI) + gauss() * 0.22;
    } else {
      ang = (13.8 * logR - 0.7) / 3.0 + (k % 3) * ((Math.PI * 2) / 3) + gauss() * 0.22;
    }
    const rScene = rN * 9.4;
    microClusters.push({
      x: Math.cos(ang) * rScene,
      z: Math.sin(ang) * rScene,
      sigma: 0.10 + rand() * 0.18,
      rNorm: rN,
    });
  }

  // Exact arm tangent at NGC 206 (-0.56 * 9.4, +0.09 * 9.4) matching AndromedaBaker
  const ngcCenterX = -5.264;
  const ngcCenterZ = 0.846;
  const ngcTangX = -0.34;
  const ngcTangZ = -0.94;
  const ngcPerpX = -ngcTangZ;
  const ngcPerpZ = ngcTangX;

  const nBulgeEnd = Math.round(count * (5500 / 40000));
  const nArmEnd = nBulgeEnd + Math.round(count * (26000 / 40000));
  const nNgcEnd = nArmEnd + Math.round(count * (450 / 40000));
  const nClusterEnd = nNgcEnd + Math.round(count * (4500 / 40000));

  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let z: number;
    let pop = 0;

    if (i < nBulgeEnd) {
      if (i < 18) {
        // Mayall II (G1): brightest globular cluster in M31 outer halo
        x = 5.6 + gauss() * 0.14;
        y = -1.35 + gauss() * 0.10;
        z = 3.2 + gauss() * 0.14;
        tmpCol.copy(colBulgeIvory);
        sizes[i] = 0.72 + rand() * 0.75;
      } else {
        // 3D warm triaxial bulge, thick disk, and inner halo sparkle (gentle core distribution prevents 1px HDR spike)
        const r = Math.pow(rand(), 1.55) * 3.4;
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        const bx = Math.sin(phi) * Math.cos(theta) * r * 1.16;
        const by = Math.cos(phi) * r * 0.56;
        const bz = Math.sin(phi) * Math.sin(theta) * r * 0.94;
        const cosBar = Math.cos(0.35);
        const sinBar = Math.sin(0.35);
        x = bx * cosBar - bz * sinBar;
        y = by;
        z = bx * sinBar + bz * cosBar;
        tmpCol.copy(colBulgePeach).lerp(colBulgeIvory, Math.max(0, 1 - r / 1.55));
        sizes[i] = 0.42 + Math.pow(rand(), 2.2) * 0.85;
      }
      pop = 0;
    } else if (i < nArmEnd) {
      // Flocculent multi-arm + patchy 10 kpc ring + continuous warm disk field stars
      const pick = rand();
      const useRing = pick < 0.34;
      const useM3 = pick >= 0.34 && pick < 0.62;
      const rNorm = useRing
        ? Math.min(0.89, Math.max(0.40, 0.60 + gauss() * 0.12))
        : 0.10 + Math.pow(rand(), 1.15) * 0.83;
      const rPlane = rNorm * 9.4;
      const logR = Math.log(rNorm + 0.11);
      let ang: number;
      if (useRing && rand() < 0.38) {
        ang = rand() * Math.PI * 2;
      } else if (useM3) {
        const arm = i % 3;
        ang = (13.8 * logR - 0.7) / 3.0 + arm * ((Math.PI * 2) / 3) + gauss() * 0.28;
      } else {
        const arm = i % 2;
        ang = (9.4 * logR + 2.2) * 0.5 + arm * Math.PI + gauss() * 0.26;
      }
      x = Math.cos(ang) * rPlane;
      y = gauss() * (rNorm < 0.35 ? 0.18 : 0.12) * (1.0 - 0.35 * rNorm);
      z = Math.sin(ang) * rPlane;
      tmpCol.copy(colArmCobalt).lerp(colSapphire, rand() * 0.65);
      if (rNorm < 0.42) {
        tmpCol.lerp(colWarmDisk, ((0.42 - rNorm) / 0.42) * 0.82);
      }
      sizes[i] = 0.42 + Math.pow(rand(), 2.6) * 0.94;
      pop = 1;
    } else if (i < nNgcEnd) {
      // Frothy arm-aligned NGC 206 OB super-association (450 dispersed OB knots prevent sub-pixel bloom clipping)
      const uT = gauss() * 0.56;
      const vP = gauss() * 0.24;
      x = ngcCenterX + uT * ngcTangX + vP * ngcPerpX;
      y = gauss() * 0.08;
      z = ngcCenterZ + uT * ngcTangZ + vP * ngcPerpZ;
      tmpCol.copy(colSapphire).lerp(colArmCobalt, rand() * 0.45);
      sizes[i] = 0.44 + Math.pow(rand(), 2.1) * 0.88;
      pop = 1;
    } else if (i < nClusterEnd) {
      // Compact powdery OB micro-clusters studded along 10 kpc ring & flocculent ridges
      const mc = microClusters[i % microClusters.length];
      x = mc.x + gauss() * mc.sigma;
      y = gauss() * 0.075;
      z = mc.z + gauss() * mc.sigma;
      tmpCol.copy(colSapphire).lerp(colArmCobalt, rand() * 0.52);
      if (mc.rNorm < 0.40) {
        tmpCol.lerp(colBulgeIvory, ((0.40 - mc.rNorm) / 0.40) * 0.58);
      }
      sizes[i] = 0.46 + Math.pow(rand(), 2.0) * 0.94;
      pop = 1;
    } else {
      // Crisp ruby-rose H-II emission knots hugging outer 10 kpc ring & arm borders
      const onRing = rand() < 0.60;
      const rNorm = onRing
        ? Math.min(0.86, Math.max(0.42, 0.60 + gauss() * 0.11))
        : 0.26 + Math.pow(rand(), 0.95) * 0.58;
      const rPlane = rNorm * 9.4;
      const logR = Math.log(rNorm + 0.11);
      const ang = onRing && rand() < 0.35
        ? rand() * Math.PI * 2
        : (9.4 * logR + 2.2) * 0.5 + (i % 2) * Math.PI - 0.08 + gauss() * 0.18;
      x = Math.cos(ang) * rPlane;
      y = gauss() * 0.06;
      z = Math.sin(ang) * rPlane;
      tmpCol.copy(colH2Ruby);
      sizes[i] = 0.50 + Math.pow(rand(), 1.8) * 0.95;
      pop = 2;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
    pops[i] = pop;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aStarCol', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aStarSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aStarPop', new THREE.BufferAttribute(pops, 1));
  return geo;
}

function buildDwarfEllipticalStarsGeometry(count: number, isM110: boolean): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const { rand } = createGalaxyPrng(isM110 ? 2051 : 2211);
  const colIvory = new THREE.Color('#fff2d6');
  const colGold = new THREE.Color('#f0c88c');
  const colSilver = new THREE.Color('#dbe4f8');
  const colYoungBlue = new THREE.Color('#95beff');
  const tmpCol = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = Math.pow(rand(), isM110 ? 1.45 : 2.15) * 0.86;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const sx = isM110 ? 2.4 : 4.0;
    const sy = isM110 ? 4.3 : 3.4;
    const sz = isM110 ? 2.4 : 3.3;

    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r * sx;
    positions[i * 3 + 1] = Math.cos(phi) * r * sy;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r * sz;

    if (isM110 && r < 0.38 && rand() < 0.24) {
      tmpCol.copy(colYoungBlue);
      sizes[i] = 1.0 + rand() * 1.1;
    } else {
      tmpCol.copy(isM110 ? colSilver : colGold).lerp(colIvory, 1.0 - r * 0.7);
      sizes[i] = 0.85 + rand() * 1.05;
    }
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aStarCol', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aStarSize', new THREE.BufferAttribute(sizes, 1));
  return geo;
}

const SHARED_ANDROMEDA_STARS_GEO = buildAndromedaStarsGeometry(40000);
const SHARED_M32_STARS_GEO = buildDwarfEllipticalStarsGeometry(360, false);
const SHARED_M110_STARS_GEO = buildDwarfEllipticalStarsGeometry(460, true);
const SHARED_PILLARS_BOX_GEO = new THREE.BoxGeometry(
  PILLARS_BSIZE.x,
  PILLARS_BSIZE.y,
  PILLARS_BSIZE.z
).translate(PILLARS_BCENTER.x, PILLARS_BCENTER.y, PILLARS_BCENTER.z);
const SHARED_PILLARS_BACKDROP_GEO = new THREE.SphereGeometry(13.2, 28, 18);

function buildPillarsStarsGeometries(): {
  bgGeo: THREE.BufferGeometry;
  fgGeo: THREE.BufferGeometry;
} {
  const { rand, gauss } = createGalaxyPrng(6611);

  const colProtoRuby = new THREE.Color('#ff2e4c');
  const colProtoGold = new THREE.Color('#ffb85c');
  const colHhCrimson = new THREE.Color('#ff3e1a');
  const colFieldWhite = new THREE.Color('#f4f7ff');
  const colFieldBlue = new THREE.Color('#9ec4ff');
  const colFieldGold = new THREE.Color('#ffdca8');
  const tmpCol = new THREE.Color();

  // Sample along tilted diagonal ESO MUSE pillar capsule segments (matching evalPillarsCoarseSDF)
  const sampleSegment = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    ra: number,
    rb: number,
    radialSpread = 0.65
  ) => {
    const h = rand();
    const rMax = (ra + (rb - ra) * h) * radialSpread;
    const rad = Math.cbrt(rand()) * rMax;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    return [
      ax + (bx - ax) * h + Math.sin(ph) * Math.cos(th) * rad,
      ay + (by - ay) * h + Math.cos(ph) * rad,
      az + (bz - az) * h + Math.sin(ph) * Math.sin(th) * rad,
    ];
  };

  // Layer 1 (renderOrder = 1): M16 background/cavity starfield naturally occluded by opaque HST columns
  const bgCount = 2600;
  const bgPos = new Float32Array(bgCount * 3);
  const bgCol = new Float32Array(bgCount * 3);
  const bgSize = new Float32Array(bgCount);
  const bgPop = new Float32Array(bgCount);

  for (let i = 0; i < bgCount; i++) {
    const r3 = 2.6 + Math.cbrt(rand()) * 9.4;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    const x = r3 * Math.sin(ph) * Math.cos(th);
    const y = r3 * Math.cos(ph);
    const z = r3 * Math.sin(ph) * Math.sin(th) - 1.4; // gently bias behind foreground dust
    const s = rand();
    tmpCol.copy(s < 0.34 ? colFieldBlue : s < 0.72 ? colFieldWhite : colFieldGold);
    const isHero = i >= bgCount - 16;

    bgPos[i * 3] = x;
    bgPos[i * 3 + 1] = y;
    bgPos[i * 3 + 2] = z;
    bgCol[i * 3] = tmpCol.r;
    bgCol[i * 3 + 1] = tmpCol.g;
    bgCol[i * 3 + 2] = tmpCol.b;
    bgSize[i] = isHero ? 2.15 + rand() * 1.15 : 0.42 + Math.pow(rand(), 3.2) * 1.15;
    bgPop[i] = 2;
  }

  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
  bgGeo.setAttribute('aStarCol', new THREE.BufferAttribute(bgCol, 3));
  bgGeo.setAttribute('aStarSize', new THREE.BufferAttribute(bgSize, 1));
  bgGeo.setAttribute('aStarPop', new THREE.BufferAttribute(bgPop, 1));

  // Layer 2 (renderOrder = 3): Embedded protostars (pop 0), HH knots (pop 1) & foreground hero stars (pop 2)
  const fgCount = 1350;
  const fgPos = new Float32Array(fgCount * 3);
  const fgCol = new Float32Array(fgCount * 3);
  const fgSize = new Float32Array(fgCount);
  const fgPop = new Float32Array(fgCount);

  const nEmbeddedEnd = 900;
  const nHhEnd = 1120;

  for (let i = 0; i < fgCount; i++) {
    let x: number;
    let y: number;
    let z: number;
    let pop = 2;

    if (i < nEmbeddedEnd) {
      const pPick = rand();
      let pt: number[];
      if (pPick < 0.40) {
        pt = rand() < 0.55
          ? sampleSegment(-0.12, 0.80, 0.42, 2.38, 4.95, 1.92, 0.78, 0.40)
          : sampleSegment(-2.10, -3.45, -0.75, -0.12, 0.80, 0.42, 1.22, 0.80);
      } else if (pPick < 0.72) {
        pt = rand() < 0.60
          ? sampleSegment(1.85, -0.35, 0.05, 3.75, 2.95, -0.82, 0.64, 0.34)
          : sampleSegment(0.05, -4.05, 0.75, 1.85, -0.35, 0.05, 1.06, 0.66);
      } else if (pPick < 0.88) {
        pt = sampleSegment(1.85, -5.25, 1.25, 4.58, 0.15, -0.88, 0.88, 0.26);
      } else {
        pt = sampleSegment(-3.65, -5.25, 2.02, -1.95, -1.62, 2.36, 0.92, 0.28);
      }
      [x, y, z] = pt;
      tmpCol.copy(rand() < 0.58 ? colProtoRuby : colProtoGold);
      const isHero = i < 20;
      fgSize[i] = isHero ? 2.15 + rand() * 1.15 : 0.78 + Math.pow(rand(), 1.8) * 1.15;
      pop = 0;
    } else if (i < nHhEnd) {
      const kPick = rand();
      if (kPick < 0.45) {
        x = 3.66 + gauss() * 0.18;
        y = 2.82 + gauss() * 0.18;
        z = -0.78 + gauss() * 0.16;
      } else if (kPick < 0.78) {
        x = -2.02 + gauss() * 0.17;
        y = -1.78 + gauss() * 0.17;
        z = 2.34 + gauss() * 0.15;
      } else {
        x = 4.52 + gauss() * 0.15;
        y = 0.06 + gauss() * 0.15;
        z = -0.84 + gauss() * 0.14;
      }
      tmpCol.copy(colHhCrimson).lerp(colProtoGold, rand() * 0.32);
      fgSize[i] = 0.75 + Math.pow(rand(), 1.6) * 1.10;
      pop = 1;
    } else {
      // Bright sparkling JWST/HST foreground & ionizing NGC 6611 corner stars outside the dust shaft core
      if (rand() < 0.24) {
        x = -4.6 + gauss() * 2.0;
        y = 5.6 + gauss() * 1.7;
        z = 3.2 + gauss() * 1.4;
        tmpCol.copy(colFieldBlue).lerp(colFieldWhite, rand() * 0.6);
      } else {
        const rad = 5.8 + Math.cbrt(rand()) * 5.8;
        const th = rand() * Math.PI * 2;
        const ph = Math.acos(2 * rand() - 1);
        x = rad * Math.sin(ph) * Math.cos(th);
        y = rad * Math.cos(ph);
        z = rad * Math.sin(ph) * Math.sin(th);
        if (z < 2.4) z = 2.4 + Math.abs(z) * 0.45;
        const s = rand();
        tmpCol.copy(s < 0.36 ? colFieldBlue : s < 0.74 ? colFieldWhite : colFieldGold);
      }
      const isSpikedHero = i >= fgCount - 28;
      fgSize[i] = isSpikedHero ? 2.25 + rand() * 1.45 : 0.62 + Math.pow(rand(), 2.5) * 1.18;
      pop = 2;
    }

    fgPos[i * 3] = x;
    fgPos[i * 3 + 1] = y;
    fgPos[i * 3 + 2] = z;
    fgCol[i * 3] = tmpCol.r;
    fgCol[i * 3 + 1] = tmpCol.g;
    fgCol[i * 3 + 2] = tmpCol.b;
    fgPop[i] = pop;
  }

  const fgGeo = new THREE.BufferGeometry();
  fgGeo.setAttribute('position', new THREE.BufferAttribute(fgPos, 3));
  fgGeo.setAttribute('aStarCol', new THREE.BufferAttribute(fgCol, 3));
  fgGeo.setAttribute('aStarSize', new THREE.BufferAttribute(fgSize, 1));
  fgGeo.setAttribute('aStarPop', new THREE.BufferAttribute(fgPop, 1));

  return { bgGeo, fgGeo };
}

function buildNgc6611StarsGeometry(count = 480): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const { rand } = createGalaxyPrng(6612);
  const colOB = new THREE.Color('#9ec8ff');
  const colWhite = new THREE.Color('#f4f8ff');
  const colGold = new THREE.Color('#ffe0ad');
  const tmpCol = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = Math.pow(rand(), 1.45) * 4.8;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(ph) * Math.cos(th);
    positions[i * 3 + 1] = r * Math.cos(ph);
    positions[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);

    const isHero = i < 18;
    tmpCol.copy(rand() < 0.72 ? colOB : rand() < 0.85 ? colWhite : colGold);
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
    sizes[i] = isHero ? 2.0 + rand() * 1.4 : 0.65 + Math.pow(rand(), 2.4) * 1.1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aStarCol', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aStarSize', new THREE.BufferAttribute(sizes, 1));
  return geo;
}

const { bgGeo: SHARED_PILLARS_BG_STARS_GEO, fgGeo: SHARED_PILLARS_FG_STARS_GEO } =
  buildPillarsStarsGeometries();
const SHARED_NGC6611_STARS_GEO = buildNgc6611StarsGeometry(480);

interface ProminenceSlot {
  mesh: THREE.Mesh;
  bornAt: number;
  duration: number;
  cooldown: number;
}

export interface BodyVisual {
  bodyId: string;
  category: CelestialBody['category'];
  root: THREE.Group;
  tiltGroup: THREE.Group;
  surfaceMesh: THREE.Mesh;
  surfaceMaterial: THREE.Material;
  cloudMesh?: THREE.Mesh;
  atmosphereMesh?: THREE.Mesh;
  auroraMesh?: THREE.Mesh;
  jupiterAuroraMesh?: THREE.Mesh;
  lensVolume?: THREE.Mesh;
  sourceGalaxyGroup?: THREE.Group;
  andromedaGroup?: THREE.Group;
  andromedaVolume?: THREE.Mesh;
  andromedaStars?: THREE.Points;
  dwarfGalaxyGroup?: THREE.Group;
  dwarfVolume?: THREE.Mesh;
  dwarfStars?: THREE.Points;
  pillarsGroup?: THREE.Group;
  pillarsBackdrop?: THREE.Mesh;
  pillarsVolume?: THREE.Mesh;
  pillarsBgStars?: THREE.Points;
  pillarsStars?: THREE.Points;
  ngcClusterPoints?: THREE.Points;
  ringMesh?: THREE.Mesh;
  coronaMesh?: THREE.Mesh;
  prominenceGroup?: THREE.Group;
  prominenceSlots?: ProminenceSlot[];
  smoothFlarePower?: number;
  flareScrollAccum?: number;
  lastFlareDirWorld?: THREE.Vector3;
  lastFlareAge?: number;
  blackHoleVolume?: THREE.Mesh;
  wormholeVolume?: THREE.Mesh;
  pulsarJets?: THREE.Group;
  cometComa?: THREE.Mesh;
  cometIonTail?: THREE.Mesh;
  cometDustTail?: THREE.Mesh;
  cometParticles?: THREE.Points;
  pickMesh: THREE.Mesh;
  trailLine: THREE.Line;
  trailPositions: Float32Array;
  trailColors: Float32Array;
  renderedPos: THREE.Vector3;
  renderedRadius: number;
}

export function computeVisualRadius(
  body: CelestialBody,
  scaleMode: ScaleMode,
  cameraDistToBody: number
): number {
  if (body.galaxyType === 'andromeda') return 13.5;
  if (body.galaxyType === 'dwarf_elliptical_compact') return 2.4;
  if (body.galaxyType === 'dwarf_elliptical_diffuse') return 4.2;
  if (body.nebulaType === 'pillars_of_creation') return 12.5;
  if (body.nebulaType === 'ngc6611_cluster') return 3.2;

  const realRadius = Math.max(body.radius * METERS_TO_SCENE, 0.00015);
  if (body.isWormhole) {
    return scaleMode === 'real' ? Math.max(realRadius, 1.2) : 2.35;
  }
  if (scaleMode === 'real') {
    return realRadius;
  }

  let playableRadius: number;
  if (body.isGravitationalLens) {
    playableRadius = 2.6;
  } else if (body.isLensSource) {
    playableRadius = 6.5;
  } else if (body.category === 'black_hole') {
    // Wide 12.2x Gargantua accretion disk spans ~18 scene units at r = 1.45
    playableRadius = 1.45 * Math.pow(Math.max(0.25, body.mass / (12 * 1.98847e30)), 0.14);
  } else if (body.category === 'neutron_star') {
    playableRadius = 1.5;
  } else if (body.category === 'star') {
    const rSunRatio = Math.max(0.1, body.radius / R_SUN);
    playableRadius = 5.6 * Math.pow(rSunRatio, 0.34);
  } else {
    const rEarthRatio = Math.max(0.05, body.radius / R_EARTH);
    playableRadius = 0.92 * Math.pow(rEarthRatio, 0.42);
  }

  const zoomBlend = THREE.MathUtils.smoothstep(cameraDistToBody, 0.8, 14.0);
  const closeRadius = Math.max(realRadius * 4.5, playableRadius * 0.24);
  return THREE.MathUtils.lerp(closeRadius, playableRadius, zoomBlend);
}

export class BodyRenderer {
  private visuals = new Map<string, BodyVisual>();
  private scene: THREE.Scene;
  private textures: PlanetTextures;
  private pickables: THREE.Object3D[] = [];
  private selectionRing: THREE.Mesh;
  private tempNormal = new THREE.Vector3();
  private tempOffset = new THREE.Vector3();
  private tempColor = new THREE.Color();
  private lastElapsedTime = 0;
  private lastSelectedId: string | null = null;
  private selectedAtTime = 0;
  private tempAntiSolar = new THREE.Vector3();
  private tempAntiVel = new THREE.Vector3();
  private tempTailTarget = new THREE.Vector3();
  private tempCurveVec = new THREE.Vector3();
  private tempInvQuat = new THREE.Quaternion();
  private starPosPool = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3());
  private starColPool = Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color());
  private starRadPool = new Array(MAX_STAR_LIGHTS).fill(5.0);
  private starLumPool = new Array(MAX_STAR_LIGHTS).fill(L_SUN);
  private occPosPool = Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector3());
  private occRadPool = new Array(MAX_OCCLUDERS).fill(0);
  private occAtmoPool = new Array(MAX_OCCLUDERS).fill(0);
  private bodyLookup = new Map<string, CelestialBody>();
  private transitWormholeId: string | null = null;
  private transitWormholeBoost = 0;

  constructor(scene: THREE.Scene, textures: PlanetTextures) {
    this.scene = scene;
    this.textures = textures;

    // Refined aerospace / planetarium-grade minimal 4-corner targeting reticle (fwidth 1.2px hairline!)
    // Replaces the harsh thick neon-cyan solid ring with delicate tapered corner brackets that auto-fade on close-up.
    const selGeo = new THREE.PlaneGeometry(3.2, 3.2);
    const selMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 1.0 },
        uSelectAge: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = position.xy; // [-1.6 .. +1.6]
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uFade;
        uniform float uSelectAge;
        varying vec2 vPos;

        void main() {
          if (uFade < 0.01) discard;
          float r = length(vPos);
          // Crisp constant ~1.25px screen-space hairline width regardless of zoom level!
          float px = max(fwidth(r), 0.0025);

          // Gentle subtle contraction animation on fresh click (0.35s)
          float intro = 1.0 + 0.09 * exp(-uSelectAge * 9.0);
          float ringR = 1.26 * intro;

          // 4 razor-crisp curved corner brackets at 45°, 135°, 225°, 315° (~26° arc, tapered ends, ZERO fuzzy bloom!)
          float ang = atan(vPos.y, vPos.x);
          float qAng = abs(mod(ang + 3.14159265, 1.5707963) - 0.78539816);
          float bracketSpan = smoothstep(0.28, 0.14, qAng);

          float distRing = abs(r - ringR);
          float arcLine = (1.0 - smoothstep(px * 0.25, px * 1.15, distRing)) * bracketSpan;

          // 4 ultra-fine outward corner ticks at exact 45° diagonals
          float tickRad = smoothstep(ringR - px * 0.5, ringR + px * 0.5, r) * smoothstep(ringR + 0.095, ringR + 0.055, r);
          float tickLine = (1.0 - smoothstep(px * 0.25, px * 1.10, qAng * max(r, 0.2))) * tickRad * 0.72;

          float shape = max(arcLine, tickLine);
          if (shape < 0.01) discard;

          // Subtle calm breathing + soft flash on initial click
          float breath = 0.90 + 0.10 * sin(uTime * 2.0);
          float clickBoost = 1.0 + 0.35 * exp(-uSelectAge * 5.0);

          vec3 col = vec3(0.68, 0.86, 0.98);
          float alpha = clamp(shape * 0.42 * breath * clickBoost * uFade, 0.0, 0.58);
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.selectionRing = new THREE.Mesh(selGeo, selMat);
    this.selectionRing.renderOrder = 20;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  }

  public getPickables(): THREE.Object3D[] {
    return this.pickables;
  }

  public getVisual(id: string): BodyVisual | undefined {
    return this.visuals.get(id);
  }

  public setWormholeTransitState(bodyId: string | null, boost: number): void {
    this.transitWormholeId = bodyId;
    this.transitWormholeBoost = boost;
  }

  public sync(
    bodies: CelestialBody[],
    originMeters: Vec3,
    camera: THREE.PerspectiveCamera,
    scaleMode: ScaleMode,
    showTrails: boolean,
    selectedId: string | null,
    elapsedTime: number,
    cmeWaves: CmeWave[] = [],
    graphicsQuality: 'high' | 'fast' = 'high'
  ): void {
    const aliveIds = new Set<string>();
    const syncDt = Math.min(0.05, Math.max(0, elapsedTime - this.lastElapsedTime));
    this.lastElapsedTime = elapsedTime;
    this.bodyLookup.clear();

    let starCount = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.alive) continue;
      this.bodyLookup.set(b.id, b);
      if (b.category === 'star' && starCount < MAX_STAR_LIGHTS) {
        this.starPosPool[starCount].set(
          (b.position.x - originMeters.x) * METERS_TO_SCENE,
          (b.position.y - originMeters.y) * METERS_TO_SCENE,
          (b.position.z - originMeters.z) * METERS_TO_SCENE
        );
        this.starColPool[starCount].set(b.color);
        const camDistStar = camera.position.distanceTo(this.starPosPool[starCount]);
        this.starRadPool[starCount] = computeVisualRadius(b, scaleMode, camDistStar);
        this.starLumPool[starCount] = b.luminosity;
        starCount++;
      }
    }

    for (const body of bodies) {
      if (!body.alive) continue;
      aliveIds.add(body.id);

      const existing = this.visuals.get(body.id);
      if (!existing || existing.category !== body.category) {
        if (existing) this.disposeVisual(existing);
        this.visuals.set(body.id, this.createVisual(body));
      }
    }

    for (const [id, vis] of this.visuals.entries()) {
      if (!aliveIds.has(id)) {
        this.disposeVisual(vis);
        this.visuals.delete(id);
      }
    }

    this.pickables.length = 0;

    for (const body of bodies) {
      if (!body.alive) continue;
      const vis = this.visuals.get(body.id)!;

      vis.renderedPos.set(
        (body.position.x - originMeters.x) * METERS_TO_SCENE,
        (body.position.y - originMeters.y) * METERS_TO_SCENE,
        (body.position.z - originMeters.z) * METERS_TO_SCENE
      );

      const camDist = camera.position.distanceTo(vis.renderedPos);
      vis.renderedRadius = computeVisualRadius(body, scaleMode, camDist);
    }

    if (scaleMode === 'playable') {
      for (const body of bodies) {
        if (!body.alive || !body.parentId) continue;
        const parent = this.bodyLookup.get(body.parentId);
        if (!parent || !parent.alive) continue;
        const vis = this.visuals.get(body.id);
        const parentVis = this.visuals.get(parent.id);
        if (!vis || !parentVis) continue;

        this.tempOffset.subVectors(vis.renderedPos, parentVis.renderedPos);
        const dist = this.tempOffset.length();
        const minSep = (parentVis.renderedRadius + vis.renderedRadius) * 1.85;
        if (dist > 1e-6 && dist < minSep) {
          this.tempOffset.multiplyScalar(minSep / dist);
          vis.renderedPos.copy(parentVis.renderedPos).add(this.tempOffset);
        }
      }
    }

    let selectedVis: BodyVisual | null = null;

    const syncStarLights = (mat: THREE.ShaderMaterial, occCount = 0) => {
      const u = mat.uniforms;
      if (!u.uStarCount) return;
      u.uStarCount.value = starCount;
      for (let i = 0; i < starCount; i++) {
        u.uStarPositions.value[i].copy(this.starPosPool[i]);
        if (u.uStarColors) u.uStarColors.value[i].copy(this.starColPool[i]);
        if (u.uStarRadii) u.uStarRadii.value[i] = this.starRadPool[i];
      }
      if (u.uOccluderCount) {
        u.uOccluderCount.value = occCount;
        for (let k = 0; k < occCount; k++) {
          u.uOccluderPositions.value[k].copy(this.occPosPool[k]);
          u.uOccluderRadii.value[k] = this.occRadPool[k];
          u.uOccluderHasAtmo.value[k] = this.occAtmoPool[k];
        }
      }
    };

    for (const body of bodies) {
      if (!body.alive) continue;
      const vis = this.visuals.get(body.id)!;
      if (body.id === selectedId) selectedVis = vis;

      // Collect up to 4 nearest non-star occluders for real-time Solar Eclipse & Blood Moon Lunar Eclipse!
      let occCount = 0;
      if (body.category !== 'star' && body.category !== 'black_hole' && starCount > 0) {
        // Find nearby bodies (moons, planets) that could cast an eclipse shadow on this body
        for (let j = 0; j < bodies.length && occCount < MAX_OCCLUDERS; j++) {
          const other = bodies[j];
          if (!other.alive || other.id === body.id || other.category === 'star') continue;
          const oVis = this.visuals.get(other.id);
          if (!oVis) continue;
          const distSq = vis.renderedPos.distanceToSquared(oVis.renderedPos);
          // Only nearby neighbors (< 120 scene units) can produce meaningful eclipses
          if (distSq < 120 * 120 && distSq > 1e-6) {
            this.occPosPool[occCount].copy(oVis.renderedPos);
            this.occRadPool[occCount] = oVis.renderedRadius;
            this.occAtmoPool[occCount] =
              other.category === 'rocky' && other.atmosphereDensity >= 0.45 ? 1.0 : 0.0;
            occCount++;
          }
        }
      }

      vis.root.position.copy(vis.renderedPos);
      vis.tiltGroup.rotation.z = body.axialTilt;
      vis.surfaceMesh.rotation.y = body.rotationAngle;

      const r = vis.renderedRadius;
      vis.surfaceMesh.scale.setScalar(r);

      this.tempNormal.set(0, 1, 0).applyEuler(vis.tiltGroup.rotation).normalize();

      if (vis.cloudMesh) {
        vis.cloudMesh.visible = body.atmosphereDensity > 0.12;
        vis.cloudMesh.scale.setScalar(r);
        vis.cloudMesh.rotation.y = body.rotationAngle;
        const cMat = vis.cloudMesh.material as THREE.ShaderMaterial;
        cMat.uniforms.uTime.value = elapsedTime;
        cMat.uniforms.uAtmosphere.value = body.atmosphereDensity;
        cMat.uniforms.uTemperature.value = body.temperature;
        syncStarLights(cMat, occCount);
      }

      if (vis.atmosphereMesh) {
        vis.atmosphereMesh.scale.setScalar(r);
        vis.atmosphereMesh.visible = body.atmosphereDensity > 0.05;
        const aMat = vis.atmosphereMesh.material as THREE.ShaderMaterial;
        aMat.uniforms.uIntensity.value = Math.min(1.15, body.atmosphereDensity * 0.75);
        syncStarLights(aMat);
      }

      if (vis.auroraMesh) {
        const auroraVal = body.auroraIntensity ?? 0.78;
        const hasAurora = auroraVal > 0.01 && body.atmosphereDensity > 0.15;
        vis.auroraMesh.visible = hasAurora;
        if (hasAurora) {
          vis.auroraMesh.scale.setScalar(r);
          vis.auroraMesh.rotation.y = body.rotationAngle;
          vis.root.updateMatrixWorld(true);

          let solarWind = 1.0;
          let primaryStarIdx = -1;
          if (starCount > 0) {
            let bestFlux = 0;
            for (let sIdx = 0; sIdx < starCount; sIdx++) {
              const dScene = Math.max(0.5, vis.renderedPos.distanceTo(this.starPosPool[sIdx]));
              const dAU = dScene / (AU * METERS_TO_SCENE);
              const flux = (this.starLumPool[sIdx] / L_SUN) / Math.max(0.04, dAU * dAU);
              if (flux > bestFlux) {
                bestFlux = flux;
                primaryStarIdx = sIdx;
              }
            }
            solarWind = THREE.MathUtils.clamp(Math.pow(Math.max(bestFlux, 0.05), 0.35), 0.65, 1.55);
          }

          const auMat = vis.auroraMesh.material as THREE.ShaderMaterial;
          auMat.uniforms.uTime.value = elapsedTime;
          auMat.uniforms.uAuroraIntensity.value = auroraVal;
          auMat.uniforms.uAtmosphere.value = body.atmosphereDensity;
          auMat.uniforms.uSolarWind.value = solarWind;
          auMat.uniforms.uHasStar.value = primaryStarIdx >= 0 ? 1.0 : 0.0;
          auMat.uniforms.uInvModelMatrix.value.copy(vis.auroraMesh.matrixWorld).invert();

          if (primaryStarIdx >= 0) {
            // Transform world-space Earth->Sun direction into Earth's local frame (zero per-step cost in shader!)
            this.tempOffset
              .subVectors(this.starPosPool[primaryStarIdx], vis.renderedPos)
              .normalize()
              .transformDirection(auMat.uniforms.uInvModelMatrix.value)
              .normalize();
            auMat.uniforms.uSunDirLocal.value.copy(this.tempOffset);
          }
        }
      }

      if (body.hasRings && !vis.ringMesh && body.ringInner && body.ringOuter) {
        const ringGeo = new THREE.RingGeometry(body.ringInner, body.ringOuter, 128);
        const ringMat = createRingMaterial(
          body.ringColor ?? '#dfd0ad',
          body.ringInner,
          body.ringOuter,
          this.textures.saturnRing
        );
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        vis.tiltGroup.add(ringMesh);
        vis.ringMesh = ringMesh;
      }

      if (vis.ringMesh) {
        vis.ringMesh.scale.setScalar(r);
        const rMat = vis.ringMesh.material as THREE.ShaderMaterial;
        rMat.uniforms.uBodyWorldPos.value.copy(vis.renderedPos);
        rMat.uniforms.uBodyRadius.value = r;
        syncStarLights(rMat);
      }

      // Compute freshest active CME eruption state on this star with C2-smooth cubic fade-out
      // and strictly monotonic cumulative scroll (ZERO abrupt A->B 1-frame snap when an eruption finishes!)
      let targetFlarePower = 0;
      let targetFlareAge = vis.lastFlareAge ?? 1.0;
      const flareDirWorld = vis.lastFlareDirWorld ?? this.tempAntiSolar.set(1, 0, 0);
      if (body.category === 'star' && cmeWaves.length > 0) {
        let freshestProg = 1.0;
        let freshestWave: CmeWave | null = null;
        for (const w of cmeWaves) {
          if (w.starId !== body.id) continue;
          const prog = Math.min(1, w.radiusMeters / w.maxRadiusMeters);
          if (prog < 0.48 && prog < freshestProg) {
            freshestProg = prog;
            freshestWave = w;
          }
        }
        if (freshestWave) {
          targetFlareAge = Math.min(1, freshestProg / 0.46);
          // Silky C2 ease-in + cubic zero-slope ease-out tail (eliminates vertical cliff drop!)
          const attack = Math.min(1, targetFlareAge / 0.06);
          const rem = Math.max(0, 1 - targetFlareAge);
          const smoothRelease = rem * rem * (3 - 2 * rem) * rem;
          targetFlarePower = attack * smoothRelease * freshestWave.intensity;
          if (!vis.lastFlareDirWorld) vis.lastFlareDirWorld = new THREE.Vector3(1, 0, 0);
          vis.lastFlareDirWorld
            .set(freshestWave.direction.x, freshestWave.direction.y, freshestWave.direction.z)
            .normalize();
        }
      }

      const prevPower = vis.smoothFlarePower ?? 0;
      const chaseRate = targetFlarePower > prevPower ? 12.0 : 2.8;
      const starFlarePower = prevPower + (targetFlarePower - prevPower) * Math.min(1, syncDt * chaseRate);
      vis.smoothFlarePower = starFlarePower < 0.0008 && targetFlarePower === 0 ? 0 : starFlarePower;
      const starFlareAge = targetFlarePower > 0.0005 ? targetFlareAge : Math.min(1, (vis.lastFlareAge ?? 1) + syncDt * 0.35);
      vis.lastFlareAge = starFlareAge;
      const starEruptScroll = (vis.flareScrollAccum ?? 0) + syncDt * vis.smoothFlarePower * 0.42;
      vis.flareScrollAccum = starEruptScroll;
      if (vis.lastFlareDirWorld) {
        flareDirWorld.copy(vis.lastFlareDirWorld);
      }

      if (vis.coronaMesh) {
        const coronaScale = r * (body.category === 'neutron_star' ? 4.4 : 4.8);
        vis.coronaMesh.scale.set(coronaScale, coronaScale, 1);
        vis.coronaMesh.quaternion.copy(camera.quaternion);
        const cMat = vis.coronaMesh.material as THREE.ShaderMaterial;
        cMat.uniforms.uTime.value = elapsedTime;
        cMat.uniforms.uColor.value.set(body.atmosphereColor || body.color);
        if (cMat.uniforms.uFlarePower) {
          cMat.uniforms.uFlarePower.value = vis.smoothFlarePower;
          cMat.uniforms.uFlareAge.value = starFlareAge;
          if (cMat.uniforms.uEruptScroll) cMat.uniforms.uEruptScroll.value = starEruptScroll;
          if (vis.smoothFlarePower > 0.001) {
            this.tempInvQuat.copy(camera.quaternion).invert();
            this.tempTailTarget.copy(flareDirWorld).applyQuaternion(this.tempInvQuat);
            cMat.uniforms.uFlareDir2D.value.set(this.tempTailTarget.x, this.tempTailTarget.y);
          }
        }
      }

      if (vis.prominenceGroup && vis.prominenceSlots) {
        vis.prominenceGroup.scale.setScalar(r);
        vis.prominenceGroup.rotation.y = body.rotationAngle * 0.85;
        for (const slot of vis.prominenceSlots) {
          const age = elapsedTime - slot.bornAt;
          const totalCycle = slot.duration + slot.cooldown;
          if (age >= totalCycle) {
            // Respawn this solar prominence at a brand-new random 3D active region on the Sun!
            slot.bornAt = elapsedTime;
            slot.duration = 9.0 + Math.random() * 9.0;
            slot.cooldown = 2.0 + Math.random() * 5.5;
            const az = Math.random() * Math.PI * 2;
            const hemi = Math.random() < 0.5 ? 1 : -1;
            const lat = hemi * ((8 + Math.random() * 36) * Math.PI) / 180;
            const roll = ((Math.random() - 0.5) * 150 * Math.PI) / 180;
            slot.mesh.rotation.set(lat, az, roll);
            slot.mesh.scale.set(0.72 + Math.random() * 0.44, 0.78 + Math.random() * 0.42, 1.0);
            const mat = slot.mesh.material as THREE.ShaderMaterial;
            if (mat.uniforms?.uSeed) mat.uniforms.uSeed.value = Math.random() * 200;
            if (mat.uniforms?.uVariant) mat.uniforms.uVariant.value = Math.floor(Math.random() * 3);
          }

          const liveAge = elapsedTime - slot.bornAt;
          const life = liveAge / slot.duration;
          const isActive = liveAge >= 0 && life <= 1.0;
          slot.mesh.visible = isActive;
          if (!isActive) continue;

          // Smooth organic birth (0 -> 0.25) -> outward billow -> slow fade out (0.62 -> 1.0)
          const fadeIn = Math.min(1, life / 0.25);
          const fadeOut = life > 0.62 ? Math.max(0, (1.0 - life) / 0.38) : 1.0;
          const smoothIn = fadeIn * fadeIn * (3 - 2 * fadeIn);
          const smoothOut = fadeOut * fadeOut * (3 - 2 * fadeOut);
          const lifeAlpha = smoothIn * smoothOut;

          const m = slot.mesh.material as THREE.ShaderMaterial;
          if (m.uniforms?.uTime) m.uniforms.uTime.value = elapsedTime;
          if (m.uniforms?.uColor) m.uniforms.uColor.value.set(body.secondaryColor || '#ff5518');
          if (m.uniforms?.uStarWorldPos) m.uniforms.uStarWorldPos.value.copy(vis.renderedPos);
          if (m.uniforms?.uLifeProgress) m.uniforms.uLifeProgress.value = life;
          if (m.uniforms?.uLifeAlpha) m.uniforms.uLifeAlpha.value = lifeAlpha;
          if (m.uniforms?.uSurgePower) m.uniforms.uSurgePower.value = vis.smoothFlarePower;
          if (m.uniforms?.uSurgeAge) m.uniforms.uSurgeAge.value = starFlareAge;
          if (m.uniforms?.uEruptScroll) m.uniforms.uEruptScroll.value = starEruptScroll;
          if (m.uniforms?.uFlareDirWorld) m.uniforms.uFlareDirWorld.value.copy(flareDirWorld);
        }
      }

      if (vis.jupiterAuroraMesh) {
        const jupAurora = body.auroraIntensity ?? 1.15;
        vis.jupiterAuroraMesh.visible = jupAurora > 0.01;
        if (vis.jupiterAuroraMesh.visible) {
          vis.jupiterAuroraMesh.scale.setScalar(r);
          vis.root.updateMatrixWorld(true);
          const jaMat = vis.jupiterAuroraMesh.material as THREE.ShaderMaterial;
          jaMat.uniforms.uTime.value = elapsedTime;
          jaMat.uniforms.uIntensity.value = jupAurora;

          // Live-track volcanic Io's orbital direction into Jupiter's frame for the glowing Io auroral footprint & tail!
          const ioBody = bodies.find((b) => b.alive && b.volcanicIo);
          const ioVis = ioBody ? this.visuals.get(ioBody.id) : undefined;
          if (ioVis) {
            jaMat.uniforms.uHasIo.value = 1.0;
            this.tempInvQuat.setFromRotationMatrix(vis.tiltGroup.matrixWorld).invert();
            this.tempOffset
              .subVectors(ioVis.renderedPos, vis.renderedPos)
              .normalize()
              .applyQuaternion(this.tempInvQuat)
              .normalize();
            jaMat.uniforms.uIoDirLocal.value.copy(this.tempOffset);
          } else {
            jaMat.uniforms.uHasIo.value = 0.0;
          }
        }
      }

      if (vis.lensVolume) {
        vis.lensVolume.scale.setScalar(r);
        const lMat = vis.lensVolume.material as THREE.ShaderMaterial;
        lMat.uniforms.uTime.value = elapsedTime;
        lMat.uniforms.uLensCenter.value.copy(vis.renderedPos);
        lMat.uniforms.uLensShear.value = body.lensShear ?? 0.0;

        const camDistLens = Math.max(8.0, camera.position.distanceTo(vis.renderedPos));
        const sphereR = 22.0 * r;
        const maxAngle = Math.min(1.18, Math.atan2(sphereR * 0.96, Math.max(sphereR * 0.35, camDistLens)));
        lMat.uniforms.uMaxAngle.value = Math.max(0.28, maxAngle);

        // Exact GR Einstein Radius scaling: theta_E ∝ sqrt(M / D_L)! Editing lens mass expands/contracts the ring live!
        const massScale = Math.sqrt(Math.max(0.15, body.mass / (1.0e12 * M_SUN)));
        const distScale = Math.sqrt(92.0 / Math.max(24.0, camDistLens));
        lMat.uniforms.uEinsteinRadius.value = THREE.MathUtils.clamp(0.195 * massScale * distScale, 0.075, 0.38);

        // Live 3D direction from foreground lens to background source galaxy/quasar!
        const srcBody = bodies.find((b) => b.alive && b.isLensSource);
        const srcVis = srcBody ? this.visuals.get(srcBody.id) : undefined;
        if (srcVis) {
          this.tempOffset.subVectors(srcVis.renderedPos, vis.renderedPos).normalize();
          lMat.uniforms.uSourceDirWorld.value.copy(this.tempOffset);
        } else {
          lMat.uniforms.uSourceDirWorld.value.set(0, 0, -1);
        }
      }

      if (vis.sourceGalaxyGroup) {
        const camDistSrc = camera.position.distanceTo(vis.renderedPos);
        // Strictly hidden when viewing the foreground lens 160 AU away so it never leaks into the Einstein Ring!
        vis.sourceGalaxyGroup.visible = camDistSrc < 2500;
        if (vis.sourceGalaxyGroup.visible) {
          vis.sourceGalaxyGroup.scale.setScalar(r);
          vis.sourceGalaxyGroup.children.forEach((child) => {
            const mat = (child as THREE.Mesh | THREE.Points).material as THREE.ShaderMaterial;
            if (mat.uniforms?.uTime) mat.uniforms.uTime.value = elapsedTime;
          });
        }
      }

      if (vis.andromedaGroup && vis.andromedaVolume && vis.andromedaStars) {
        vis.andromedaGroup.scale.setScalar(r);
        vis.root.updateMatrixWorld(true);
        const modeVal =
          body.galaxySpectrumMode === 'infrared'
            ? 1.0
            : body.galaxySpectrumMode === 'ultraviolet'
              ? 2.0
              : 0.0;
        const pxRatio = Math.min(window.devicePixelRatio || 1, 1.25);

        const volMat = vis.andromedaVolume.material as THREE.ShaderMaterial;
        volMat.uniforms.uTime.value = elapsedTime;
        volMat.uniforms.uDustOpacity.value = body.galaxyDustOpacity ?? 1.0;
        volMat.uniforms.uSpectrumMode.value = modeVal;
        volMat.uniforms.uInvModelMatrix.value.copy(vis.andromedaVolume.matrixWorld).invert();

        const starMat = vis.andromedaStars.material as THREE.ShaderMaterial;
        starMat.uniforms.uTime.value = elapsedTime;
        starMat.uniforms.uSpectrumMode.value = modeVal;
        starMat.uniforms.uPixelRatio.value = pxRatio;
        starMat.uniforms.uDustOpacity.value = body.galaxyDustOpacity ?? 1.0;
        starMat.uniforms.uInvModelMatrix.value.copy(vis.andromedaStars.matrixWorld).invert();
      }

      if (vis.dwarfGalaxyGroup && vis.dwarfVolume && vis.dwarfStars) {
        vis.dwarfGalaxyGroup.scale.setScalar(r);
        vis.root.updateMatrixWorld(true);
        const pxRatio = Math.min(window.devicePixelRatio || 1, 1.25);

        const dMat = vis.dwarfVolume.material as THREE.ShaderMaterial;
        dMat.uniforms.uTime.value = elapsedTime;
        dMat.uniforms.uInvModelMatrix.value.copy(vis.dwarfVolume.matrixWorld).invert();

        const dsMat = vis.dwarfStars.material as THREE.ShaderMaterial;
        dsMat.uniforms.uPixelRatio.value = pxRatio;
      }

      if (vis.pillarsGroup && vis.pillarsVolume && vis.pillarsStars) {
        vis.pillarsGroup.scale.setScalar(r);
        vis.root.updateMatrixWorld(true);
        const nebModeVal =
          body.nebulaSpectrumMode === 'jwst_nircam'
            ? 1.0
            : body.nebulaSpectrumMode === 'jwst_miri'
              ? 2.0
              : 0.0;
        const irVal =
          body.nebulaIrPenetration ?? (body.nebulaSpectrumMode === 'jwst_nircam' ? 0.92 : 0.0);
        const densVal = body.nebulaDensity ?? 1.0;
        const pxRatio = Math.min(window.devicePixelRatio || 1, 1.25);

        if (vis.pillarsBackdrop) {
          const pBgMat = vis.pillarsBackdrop.material as THREE.ShaderMaterial;
          pBgMat.uniforms.uSpectrumMode.value = nebModeVal;
          pBgMat.uniforms.uIrPenetration.value = irVal;
          pBgMat.uniforms.uInvModelMatrix.value.copy(vis.pillarsBackdrop.matrixWorld).invert();
        }

        const pVolMat = vis.pillarsVolume.material as THREE.ShaderMaterial;
        pVolMat.uniforms.uTime.value = elapsedTime;
        pVolMat.uniforms.uSpectrumMode.value = nebModeVal;
        pVolMat.uniforms.uIrPenetration.value = irVal;
        pVolMat.uniforms.uDensityScale.value = densVal;
        pVolMat.uniforms.uMaxSteps.value = graphicsQuality === 'fast' ? 16.0 : 24.0;
        pVolMat.uniforms.uInvModelMatrix.value.copy(vis.pillarsVolume.matrixWorld).invert();

        for (const starLayer of [vis.pillarsBgStars, vis.pillarsStars]) {
          if (!starLayer) continue;
          const pStarMat = starLayer.material as THREE.ShaderMaterial;
          pStarMat.uniforms.uTime.value = elapsedTime;
          pStarMat.uniforms.uSpectrumMode.value = nebModeVal;
          pStarMat.uniforms.uIrPenetration.value = irVal;
          pStarMat.uniforms.uPixelRatio.value = pxRatio;
        }
      }

      if (vis.ngcClusterPoints) {
        vis.ngcClusterPoints.scale.setScalar(r);
        const nMat = vis.ngcClusterPoints.material as THREE.ShaderMaterial;
        nMat.uniforms.uTime.value = elapsedTime;
        nMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 1.25);
      }

      if (vis.blackHoleVolume) {
        vis.blackHoleVolume.scale.setScalar(r);
        vis.root.updateMatrixWorld(true);
        const bhMat = vis.blackHoleVolume.material as THREE.ShaderMaterial;
        bhMat.uniforms.uTime.value = elapsedTime;
        bhMat.uniforms.uFlare.value = body.accretionFlare ?? 0;
        bhMat.uniforms.uInvModelMatrix.value.copy(vis.blackHoleVolume.matrixWorld).invert();
        bhMat.uniforms.uModelRotMatrix.value.setFromMatrix4(vis.blackHoleVolume.matrixWorld);
      }

      if (vis.wormholeVolume) {
        vis.wormholeVolume.scale.setScalar(r);
        vis.root.updateMatrixWorld(true);
        const whMat = vis.wormholeVolume.material as THREE.ShaderMaterial;
        whMat.uniforms.uTime.value = elapsedTime;
        whMat.uniforms.uThroatRadius.value = body.wormholeThroatScale ?? 1.55;
        whMat.uniforms.uThroatLength.value = body.wormholeLength ?? 1.0;
        const destId = body.wormholeDestination ?? 'pillars_of_creation';
        whMat.uniforms.uDestMode.value =
          destId === 'pillars_of_creation'
            ? 0.0
            : destId === 'andromeda_galaxy'
              ? 1.0
              : destId === 'black_hole_tde'
                ? 2.0
                : 3.0;
        whMat.uniforms.uTransitBoost.value =
          body.id === this.transitWormholeId ? this.transitWormholeBoost : 0.0;
        whMat.uniforms.uInvModelMatrix.value.copy(vis.wormholeVolume.matrixWorld).invert();
        whMat.uniforms.uModelRotMatrix.value.setFromMatrix4(vis.wormholeVolume.matrixWorld);

        // Reflect nearest bright neighbor planet/star onto outer Einstein ring
        let bestScore = 0;
        let bestNeighbor: CelestialBody | null = null;
        let bestNeighborVis: BodyVisual | null = null;
        let bestDist = 0;
        for (let j = 0; j < bodies.length; j++) {
          const other = bodies[j];
          if (!other.alive || other.id === body.id || other.isWormhole) continue;
          const oVis = this.visuals.get(other.id);
          if (!oVis) continue;
          const dist = vis.renderedPos.distanceTo(oVis.renderedPos);
          if (dist < 1e-3 || dist > 80) continue;
          const effR = oVis.renderedRadius * (other.hasRings ? 2.1 : 1.15);
          const ang = effR / dist;
          if (ang > bestScore) {
            bestScore = ang;
            bestNeighbor = other;
            bestNeighborVis = oVis;
            bestDist = dist;
          }
        }
        if (bestNeighbor && bestNeighborVis && bestDist > 1e-3) {
          this.tempOffset
            .subVectors(bestNeighborVis.renderedPos, vis.renderedPos)
            .normalize()
            .transformDirection(whMat.uniforms.uInvModelMatrix.value)
            .normalize();
          whMat.uniforms.uNeighborDir.value.copy(this.tempOffset);
          whMat.uniforms.uNeighborAngRad.value = Math.atan2(
            bestNeighborVis.renderedRadius * (bestNeighbor.hasRings ? 2.1 : 1.15),
            bestDist
          );
          whMat.uniforms.uNeighborColor.value.set(bestNeighbor.color);
        } else {
          whMat.uniforms.uNeighborAngRad.value = 0.0;
        }
      }

      if (vis.pulsarJets) {
        vis.pulsarJets.scale.setScalar(r);
        vis.pulsarJets.rotation.y = elapsedTime * 5.2;
        vis.pulsarJets.children.forEach((child) => {
          const mat = (child as THREE.Mesh).material as THREE.ShaderMaterial;
          if (mat.uniforms?.uTime) mat.uniforms.uTime.value = elapsedTime;
        });
      }

      // Astrophotography-grade Dual-Tail Comet update:
      // Asymmetric C2 green/cyan Coma + Axial Camera-Facing Ion/Dust Gossamer Ribbons + 820 GPU Mist Particles!
      if (vis.cometComa && vis.cometIonTail && vis.cometDustTail && vis.cometParticles) {
        let bestFlux = 0;
        let primaryStarIdx = -1;
        for (let sIdx = 0; sIdx < starCount; sIdx++) {
          const dScene = Math.max(0.5, vis.renderedPos.distanceTo(this.starPosPool[sIdx]));
          const dAU = dScene / (AU * METERS_TO_SCENE);
          const flux = (this.starLumPool[sIdx] / L_SUN) / Math.max(0.02, dAU * dAU);
          if (flux > bestFlux) {
            bestFlux = flux;
            primaryStarIdx = sIdx;
          }
        }

        // Sublimation wakes up around ~3.0 AU and blazes near perihelion
        const activity = THREE.MathUtils.clamp((Math.sqrt(bestFlux) - 0.25) * 0.92, 0.0, 1.35);

        const cometCamDist = camera.position.distanceTo(vis.renderedPos);
        // Smooth Rosetta-67P close-up factor: 0 afar (blazing astrophotograph coma), 1 zoomed in (crystal-clear dark rock!)
        const rawClose = THREE.MathUtils.clamp(1.0 - (cometCamDist - r * 5.5) / Math.max(r * 22.0, 2.0), 0.0, 1.0);
        const closeUp = rawClose * rawClose * (3.0 - 2.0 * rawClose);

        const comaScale = Math.max(r * (8.5 + activity * 24.0), 2.8 + activity * 5.2);
        vis.cometComa.visible = activity > 0.02;
        vis.cometComa.scale.set(comaScale, comaScale, 1);
        vis.cometComa.quaternion.copy(camera.quaternion);
        // Push coma billboard slightly behind the 3D nucleus along camera ray when close up so it never slices the rock!
        this.tempNormal.subVectors(vis.renderedPos, camera.position).normalize();
        vis.cometComa.position.copy(this.tempNormal).multiplyScalar(r * 2.2 * closeUp);
        const comaMat = vis.cometComa.material as THREE.ShaderMaterial;
        comaMat.uniforms.uTime.value = elapsedTime;
        comaMat.uniforms.uActivity.value = activity;
        comaMat.uniforms.uCloseUp.value = closeUp;

        if (primaryStarIdx >= 0 && activity > 0.03) {
          this.tempAntiSolar.subVectors(vis.renderedPos, this.starPosPool[primaryStarIdx]).normalize();

          // Project anti-solar vector into camera 2D billboard plane so coma bow-shock compresses sunward!
          this.tempInvQuat.copy(camera.quaternion).invert();
          this.tempTailTarget.copy(this.tempAntiSolar).applyQuaternion(this.tempInvQuat);
          comaMat.uniforms.uAntiSolar2D.value.set(this.tempTailTarget.x, this.tempTailTarget.y);

          // Anti-velocity orbital drag direction (curves the dust tail smoothly along the orbit!)
          this.tempAntiVel.set(-body.velocity.x, -body.velocity.y, -body.velocity.z);
          if (this.tempAntiVel.lengthSq() > 1) {
            this.tempAntiVel.normalize();
          } else {
            this.tempAntiVel.copy(this.tempAntiSolar);
          }
          // Extract lateral orbital-lag component perpendicular to antiSolar for graceful parabolic dust curving
          const dotAV = this.tempAntiVel.dot(this.tempAntiSolar);
          this.tempCurveVec
            .copy(this.tempAntiVel)
            .addScaledVector(this.tempAntiSolar, -dotAV);
          if (this.tempCurveVec.lengthSq() > 1e-4) {
            this.tempCurveVec.normalize();
          } else {
            this.tempCurveVec.set(0, 0, 1);
          }

          const tailLen = Math.max(r * 22, 18 + activity * 64);
          // Optically-thin gas column depth drops cleanly to zero when orbiting right next to the nucleus
          // (authentic ESA Rosetta physics: eliminates close-up ribbon bowtie pinch & whiteout!).
          const farTailMask = THREE.MathUtils.clamp(1.0 - closeUp * 1.32, 0.0, 1.0);
          const tailActivity = activity * farTailMask * farTailMask;

          // 1. Type I Straight Multi-Streamer Electric Cobalt-Blue Ion Tail (world-space axial billboard!)
          vis.cometIonTail.visible = tailActivity > 0.012;
          const ionMat = vis.cometIonTail.material as THREE.ShaderMaterial;
          ionMat.uniforms.uTime.value = elapsedTime;
          ionMat.uniforms.uActivity.value = tailActivity;
          ionMat.uniforms.uLength.value = tailLen * 1.18;
          ionMat.uniforms.uWidthBase.value = Math.max(r * 1.1, 0.48);
          ionMat.uniforms.uWidthTip.value = tailLen * 0.085;
          ionMat.uniforms.uStartWorld.value.copy(vis.renderedPos);
          ionMat.uniforms.uDirMain.value.copy(this.tempAntiSolar);
          ionMat.uniforms.uCurveDir.value.copy(this.tempCurveVec);

          // 2. Type II Curved Silky Golden-Ivory Dust Fan (arcs gracefully toward anti-velocity!)
          vis.cometDustTail.visible = tailActivity > 0.012;
          const dustMat = vis.cometDustTail.material as THREE.ShaderMaterial;
          dustMat.uniforms.uTime.value = elapsedTime;
          dustMat.uniforms.uActivity.value = tailActivity;
          dustMat.uniforms.uLength.value = tailLen * 0.94;
          dustMat.uniforms.uWidthBase.value = Math.max(r * 2.8, 1.55);
          dustMat.uniforms.uWidthTip.value = tailLen * 0.29;
          dustMat.uniforms.uStartWorld.value.copy(vis.renderedPos);
          dustMat.uniforms.uDirMain.value.copy(this.tempAntiSolar);
          dustMat.uniforms.uCurveDir.value.copy(this.tempCurveVec);

          // 3. 640 GPU-Computed Sunward Outgassing Fountain Jets & Delicate Micro-Ice Sparkle!
          vis.cometParticles.visible = true;
          const pMat = vis.cometParticles.material as THREE.ShaderMaterial;
          pMat.uniforms.uTime.value = elapsedTime;
          pMat.uniforms.uActivity.value = activity * (1.0 - 0.35 * closeUp);
          pMat.uniforms.uLength.value = tailLen;
          pMat.uniforms.uNucleusRadius.value = r;
          pMat.uniforms.uStartWorld.value.copy(vis.renderedPos);
          pMat.uniforms.uDirMain.value.copy(this.tempAntiSolar);
          pMat.uniforms.uCurveDir.value.copy(this.tempCurveVec);
        } else {
          vis.cometIonTail.visible = false;
          vis.cometDustTail.visible = false;
          vis.cometParticles.visible = false;
        }
      }

      const camDist = camera.position.distanceTo(vis.renderedPos);
      const pickRadius = Math.max(
        body.galaxyType
          ? r * 2.2
          : body.nebulaType
            ? r * 3.5
            : body.isWormhole
              ? r * (body.wormholeThroatScale ?? 1.55) * 1.2
              : body.category === 'black_hole'
                ? r * 4.2
                : r * 1.45,
        camDist * 0.022
      );
      vis.pickMesh.scale.setScalar(pickRadius);
      this.pickables.push(vis.pickMesh);

      if (vis.surfaceMaterial instanceof THREE.ShaderMaterial) {
        const u = vis.surfaceMaterial.uniforms;
        if (u.uTime) u.uTime.value = elapsedTime;
        if (u.uTemperature) u.uTemperature.value = body.temperature;
        if (u.uWaterFraction) u.uWaterFraction.value = body.waterFraction;
        if (u.uAtmosphere) u.uAtmosphere.value = body.atmosphereDensity;
        if (u.uImpactHeat) u.uImpactHeat.value = body.impactHeat;
        if (u.uAuroraIntensity) u.uAuroraIntensity.value = body.auroraIntensity ?? 0.78;
        if (u.uColorPrimary) u.uColorPrimary.value.set(body.color);
        if (u.uColorSecondary) u.uColorSecondary.value.set(body.secondaryColor);
        if (u.uHasRings) u.uHasRings.value = body.hasRings ? 1.0 : 0.0;
        if (u.uBodyWorldPos) u.uBodyWorldPos.value.copy(vis.renderedPos);
        if (u.uBodyRadius) u.uBodyRadius.value = r;
        if (u.uRingNormal) u.uRingNormal.value.copy(this.tempNormal);
        if (u.uFlarePower) {
          u.uFlarePower.value = vis.smoothFlarePower ?? 0;
          u.uFlareAge.value = starFlareAge;
          if ((vis.smoothFlarePower ?? 0) > 0.001) {
            // Transform world CME direction into the star's rotated local sphere coordinates!
            vis.surfaceMesh.updateMatrixWorld(true);
            this.tempInvQuat.setFromRotationMatrix(vis.surfaceMesh.matrixWorld).invert();
            this.tempOffset.copy(flareDirWorld).applyQuaternion(this.tempInvQuat).normalize();
            u.uFlareDirLocal.value.copy(this.tempOffset);
          }
        }
        syncStarLights(vis.surfaceMaterial, occCount);
      }

      const whSpeedSq =
        body.velocity.x * body.velocity.x +
        body.velocity.y * body.velocity.y +
        body.velocity.z * body.velocity.z;
      vis.trailLine.visible =
        showTrails &&
        body.trail.length > 1 &&
        !body.isLensSource &&
        !body.isGravitationalLens &&
        !body.galaxyType &&
        !body.nebulaType &&
        !(body.isWormhole && whSpeedSq < 1);
      if (vis.trailLine.visible) {
        const trail = body.trail;
        const count = Math.min(trail.length, MAX_TRAIL_VERTS);
        const startIdx = trail.length - count;
        this.tempColor.set(
          body.isWormhole ? '#68d8ff' : body.category === 'black_hole' ? '#ff8b3d' : body.color
        );

        for (let i = 0; i < count; i++) {
          const pt = trail[startIdx + i];
          const i3 = i * 3;
          vis.trailPositions[i3] = (pt.x - originMeters.x) * METERS_TO_SCENE;
          vis.trailPositions[i3 + 1] = (pt.y - originMeters.y) * METERS_TO_SCENE;
          vis.trailPositions[i3 + 2] = (pt.z - originMeters.z) * METERS_TO_SCENE;

          const fade = Math.pow(i / Math.max(count - 1, 1), 2.1) * 0.56;
          vis.trailColors[i3] = this.tempColor.r * fade;
          vis.trailColors[i3 + 1] = this.tempColor.g * fade;
          vis.trailColors[i3 + 2] = this.tempColor.b * fade;
        }

        const geo = vis.trailLine.geometry;
        geo.setDrawRange(0, count);
        (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    if (selectedId !== this.lastSelectedId) {
      this.lastSelectedId = selectedId;
      this.selectedAtTime = elapsedTime;
    }

    const selectedBody = selectedId ? this.bodyLookup.get(selectedId) : undefined;
    if (
      selectedVis &&
      !selectedBody?.isGravitationalLens &&
      !selectedBody?.isLensSource &&
      !selectedBody?.galaxyType &&
      !selectedBody?.nebulaType
    ) {
      const camDist = Math.max(0.1, camera.position.distanceTo(selectedVis.renderedPos));
      const baseMult = selectedBody?.isWormhole
        ? (selectedBody.wormholeThroatScale ?? 1.55) * 1.18
        : selectedVis.category === 'black_hole'
          ? 3.8
          : 1.14;
      const ringScale = Math.max(selectedVis.renderedRadius * baseMult, camDist * 0.022);
      // Smoothly fade reticle away when zoomed very close to inspect auroras / prominences / surface detail!
      const angularHalfSize = (ringScale * 1.26) / camDist;
      const closeFade = 1.0 - THREE.MathUtils.smoothstep(angularHalfSize, 0.20, 0.46);

      this.selectionRing.visible = closeFade > 0.02;
      if (this.selectionRing.visible) {
        this.selectionRing.position.copy(selectedVis.renderedPos);
        this.selectionRing.quaternion.copy(camera.quaternion);
        this.selectionRing.scale.setScalar(ringScale);
        const selMat = this.selectionRing.material as THREE.ShaderMaterial;
        selMat.uniforms.uTime.value = elapsedTime;
        selMat.uniforms.uFade.value = closeFade;
        selMat.uniforms.uSelectAge.value = Math.max(0, elapsedTime - this.selectedAtTime);
      }
    } else {
      this.selectionRing.visible = false;
    }
  }

  private createVisual(body: CelestialBody): BodyVisual {
    const root = new THREE.Group();
    const tiltGroup = new THREE.Group();
    root.add(tiltGroup);

    const profile = textureAtlas.resolvePlanetProfile(body);
    let surfaceMaterial: THREE.Material;
    let useEarthClouds = false;

    if (
      body.isGravitationalLens ||
      body.isLensSource ||
      body.galaxyType ||
      body.nebulaType ||
      body.isWormhole
    ) {
      surfaceMaterial = new THREE.MeshBasicMaterial({ visible: false });
    } else if (body.volcanicIo) {
      surfaceMaterial = createIoSurfaceMaterial(body, this.textures);
    } else if (body.category === 'star' || body.category === 'neutron_star') {
      surfaceMaterial = createStarMaterial(body, this.textures);
    } else if (body.category === 'black_hole') {
      surfaceMaterial = new THREE.MeshBasicMaterial({ visible: false });
    } else if (body.category === 'gas_giant' || body.category === 'ice_giant') {
      const gasMap =
        profile === 'saturn'
          ? this.textures.saturn
          : profile === 'uranus'
            ? this.textures.uranus
            : profile === 'neptune'
              ? this.textures.neptune
              : this.textures.jupiter;
      surfaceMaterial = createTexturedGasGiantMaterial(body, gasMap);
    } else if (profile === 'earth') {
      surfaceMaterial = createTexturedEarthMaterial(body, this.textures);
      useEarthClouds = true;
    } else {
      let rockyMap = this.textures.moon;
      let tint = '#ffffff';
      let bump = 0.75;
      if (body.category === 'comet') {
        rockyMap = this.textures.moon;
        tint = '#454340'; // authentic Rosetta-67P charcoal-dark carbonaceous nucleus!
        bump = 1.35;
      } else if (profile === 'mercury') {
        rockyMap = this.textures.mercury;
        bump = 0.85;
      } else if (profile === 'venus') {
        rockyMap = this.textures.venus;
        bump = 0.22;
      } else if (profile === 'mars') {
        rockyMap = this.textures.mars;
        bump = 0.65;
      } else if (profile === 'ice') {
        rockyMap = this.textures.moon;
        tint = '#bfe4ff';
        bump = 0.55;
      } else if (profile === 'lava') {
        rockyMap = this.textures.mercury;
        tint = '#8f5a46';
        bump = 0.85;
      }
      surfaceMaterial = createTexturedRockyMaterial(body, rockyMap, tint, bump);
    }

    const surfaceMesh = new THREE.Mesh(
      body.category === 'comet' ? SHARED_COMET_NUCLEUS_GEO : SHARED_SPHERE_GEO,
      surfaceMaterial
    );
    tiltGroup.add(surfaceMesh);

    let cloudMesh: THREE.Mesh | undefined;
    let auroraMesh: THREE.Mesh | undefined;
    if (useEarthClouds) {
      const cloudMat = createCloudLayerMaterial(body, this.textures);
      cloudMesh = new THREE.Mesh(SHARED_CLOUD_GEO, cloudMat);
      cloudMesh.visible = body.atmosphereDensity > 0.12;
      tiltGroup.add(cloudMesh);

      const auroraMat = createEarthAuroraMaterial(body);
      auroraMesh = new THREE.Mesh(SHARED_EARTH_AURORA_GEO, auroraMat);
      auroraMesh.renderOrder = 3;
      auroraMesh.visible = (body.auroraIntensity ?? 0.78) > 0.01 && body.atmosphereDensity > 0.15;
      tiltGroup.add(auroraMesh);
    }

    let jupiterAuroraMesh: THREE.Mesh | undefined;
    if (body.jupiterTorus) {
      const jaMat = createJupiterAuroraMaterial();
      jupiterAuroraMesh = new THREE.Mesh(SHARED_JUPITER_AURORA_GEO, jaMat);
      jupiterAuroraMesh.renderOrder = 3;
      tiltGroup.add(jupiterAuroraMesh);
    }

    let lensVolume: THREE.Mesh | undefined;
    if (body.isGravitationalLens) {
      const lMat = createGravitationalLensMaterial();
      lensVolume = new THREE.Mesh(SHARED_LENS_VOLUME_GEO, lMat);
      lensVolume.frustumCulled = false;
      lensVolume.renderOrder = 3;
      root.add(lensVolume);
    }

    let sourceGalaxyGroup: THREE.Group | undefined;
    if (body.isLensSource) {
      sourceGalaxyGroup = new THREE.Group();
      sourceGalaxyGroup.rotation.set(-0.46, 0.24, 0.18);

      const discMesh = new THREE.Mesh(
        SHARED_SOURCE_GALAXY_DISC_GEO,
        createSourceGalaxyDiscMaterial()
      );
      discMesh.renderOrder = 2;
      sourceGalaxyGroup.add(discMesh);

      const bulgeMesh = new THREE.Mesh(
        SHARED_SOURCE_GALAXY_BULGE_GEO,
        createSourceGalaxyBulgeMaterial()
      );
      bulgeMesh.scale.set(1.0, 1.0, 0.58);
      bulgeMesh.renderOrder = 3;
      sourceGalaxyGroup.add(bulgeMesh);

      const starsPoints = new THREE.Points(
        SHARED_SOURCE_GALAXY_STARS_GEO,
        createSourceGalaxyStarsMaterial()
      );
      starsPoints.renderOrder = 3;
      sourceGalaxyGroup.add(starsPoints);

      root.add(sourceGalaxyGroup);
    }

    let andromedaGroup: THREE.Group | undefined;
    let andromedaVolume: THREE.Mesh | undefined;
    let andromedaStars: THREE.Points | undefined;
    if (body.galaxyType === 'andromeda') {
      const maps = textureAtlas.getAndromedaMaps();
      if (maps) {
        andromedaGroup = new THREE.Group();
        andromedaGroup.rotation.order = 'ZYX';
        andromedaGroup.rotation.set(0.25, 0.0, -0.56);

        andromedaVolume = new THREE.Mesh(
          SHARED_ANDROMEDA_VOLUME_GEO,
          createAndromedaVolumeMaterial(maps)
        );
        andromedaVolume.renderOrder = 2;
        andromedaVolume.frustumCulled = false;
        andromedaGroup.add(andromedaVolume);

        andromedaStars = new THREE.Points(
          SHARED_ANDROMEDA_STARS_GEO,
          createAndromedaStarsMaterial(maps)
        );
        andromedaStars.renderOrder = 3;
        andromedaStars.frustumCulled = false;
        andromedaGroup.add(andromedaStars);

        root.add(andromedaGroup);
      }
    }

    let dwarfGalaxyGroup: THREE.Group | undefined;
    let dwarfVolume: THREE.Mesh | undefined;
    let dwarfStars: THREE.Points | undefined;
    if (
      body.galaxyType === 'dwarf_elliptical_compact' ||
      body.galaxyType === 'dwarf_elliptical_diffuse'
    ) {
      const isM110 = body.galaxyType === 'dwarf_elliptical_diffuse';
      dwarfGalaxyGroup = new THREE.Group();
      if (isM110) {
        dwarfGalaxyGroup.rotation.set(0.08, 0.18, 0.14);
      }

      dwarfVolume = new THREE.Mesh(
        SHARED_DWARF_ELLIPTICAL_GEO,
        createDwarfEllipticalMaterial(isM110)
      );
      dwarfVolume.renderOrder = 2;
      dwarfVolume.frustumCulled = false;
      dwarfGalaxyGroup.add(dwarfVolume);

      dwarfStars = new THREE.Points(
        isM110 ? SHARED_M110_STARS_GEO : SHARED_M32_STARS_GEO,
        createDwarfEllipticalStarsMaterial()
      );
      dwarfStars.renderOrder = 3;
      dwarfStars.frustumCulled = false;
      dwarfGalaxyGroup.add(dwarfStars);

      root.add(dwarfGalaxyGroup);
    }

    let pillarsGroup: THREE.Group | undefined;
    let pillarsBackdrop: THREE.Mesh | undefined;
    let pillarsVolume: THREE.Mesh | undefined;
    let pillarsBgStars: THREE.Points | undefined;
    let pillarsStars: THREE.Points | undefined;
    if (body.nebulaType === 'pillars_of_creation') {
      const pMaps = textureAtlas.getPillarsMaps();
      if (pMaps) {
        pillarsGroup = new THREE.Group();

        pillarsBackdrop = new THREE.Mesh(
          SHARED_PILLARS_BACKDROP_GEO,
          createPillarsBackdropMaterial(pMaps.cloudNoiseMap)
        );
        pillarsBackdrop.renderOrder = 1;
        pillarsBackdrop.frustumCulled = false;
        pillarsGroup.add(pillarsBackdrop);

        pillarsBgStars = new THREE.Points(
          SHARED_PILLARS_BG_STARS_GEO,
          createPillarsStarsMaterial()
        );
        pillarsBgStars.renderOrder = 2;
        pillarsBgStars.frustumCulled = false;
        pillarsGroup.add(pillarsBgStars);

        pillarsVolume = new THREE.Mesh(
          SHARED_PILLARS_BOX_GEO,
          createPillarsVolumeMaterial(pMaps)
        );
        pillarsVolume.renderOrder = 3;
        pillarsVolume.frustumCulled = false;
        pillarsGroup.add(pillarsVolume);

        pillarsStars = new THREE.Points(
          SHARED_PILLARS_FG_STARS_GEO,
          createPillarsStarsMaterial()
        );
        pillarsStars.renderOrder = 4;
        pillarsStars.frustumCulled = false;
        pillarsGroup.add(pillarsStars);

        root.add(pillarsGroup);
      }
    }

    let ngcClusterPoints: THREE.Points | undefined;
    if (body.nebulaType === 'ngc6611_cluster') {
      ngcClusterPoints = new THREE.Points(
        SHARED_NGC6611_STARS_GEO,
        createNgc6611ClusterMaterial()
      );
      ngcClusterPoints.renderOrder = 3;
      ngcClusterPoints.frustumCulled = false;
      root.add(ngcClusterPoints);
    }

    let atmosphereMesh: THREE.Mesh | undefined;
    if (
      body.category !== 'star' &&
      body.category !== 'black_hole' &&
      body.atmosphereColor &&
      body.atmosphereColor !== '#000000'
    ) {
      const atmoMat = createAtmosphereMaterial(
        body.atmosphereColor,
        Math.max(body.atmosphereDensity, 0.3)
      );
      atmosphereMesh = new THREE.Mesh(SHARED_ATMO_GEO, atmoMat);
      tiltGroup.add(atmosphereMesh);
    }

    let ringMesh: THREE.Mesh | undefined;
    if (body.hasRings && body.ringInner && body.ringOuter) {
      const ringGeo = new THREE.RingGeometry(body.ringInner, body.ringOuter, 128);
      const ringMat = createRingMaterial(
        body.ringColor ?? '#dfd0ad',
        body.ringInner,
        body.ringOuter,
        this.textures.saturnRing
      );
      ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      tiltGroup.add(ringMesh);
    }

    let coronaMesh: THREE.Mesh | undefined;
    if (body.category === 'star' || body.category === 'neutron_star') {
      const coronaMat = createSolarCoronaMaterial(
        body.atmosphereColor || body.color,
        body.seed,
        this.textures.sun
      );
      coronaMesh = new THREE.Mesh(SHARED_CORONA_GEO, coronaMat);
      coronaMesh.renderOrder = 2;
      root.add(coronaMesh);
    }

    // Organic asymmetric 3D wispy H-alpha solar prominences with randomized spawn -> rise -> fade lifecycles!
    let prominenceGroup: THREE.Group | undefined;
    let prominenceSlots: ProminenceSlot[] | undefined;
    if (body.category === 'star') {
      prominenceGroup = new THREE.Group();
      prominenceSlots = [];
      const curtainCount = 6;
      for (let i = 0; i < curtainCount; i++) {
        const variant = i % 3;
        const promMat = createProminenceMaterial(
          body.secondaryColor || '#ff5518',
          this.textures.sun,
          body.seed + i * 23.4 + Math.random() * 50,
          variant
        );
        const curtain = new THREE.Mesh(SHARED_PROMINENCE_GEO, promMat);
        const az = Math.random() * Math.PI * 2;
        const hemi = i % 2 === 0 ? 1 : -1;
        const lat = hemi * ((10 + Math.random() * 34) * Math.PI) / 180;
        curtain.rotation.set(lat, az, ((Math.random() - 0.5) * 140 * Math.PI) / 180);
        curtain.scale.set(0.76 + Math.random() * 0.36, 0.80 + Math.random() * 0.36, 1.0);
        curtain.renderOrder = 1;
        prominenceGroup.add(curtain);

        const duration = 9.0 + Math.random() * 8.0;
        const cooldown = 2.0 + Math.random() * 5.0;
        // Stagger initial phases so only ~2-3 prominences are gently emerging/fading at once instead of 6 static ones
        const initialOffset = (i / curtainCount) * (duration + cooldown);
        prominenceSlots.push({
          mesh: curtain,
          bornAt: -initialOffset,
          duration,
          cooldown,
        });
      }
      tiltGroup.add(prominenceGroup);
    }

    let blackHoleVolume: THREE.Mesh | undefined;
    if (body.category === 'black_hole' && !body.isGravitationalLens && !body.isWormhole) {
      const bhMat = createBlackHoleLensingMaterial(body, this.textures);
      blackHoleVolume = new THREE.Mesh(SHARED_BH_VOLUME_GEO, bhMat);
      blackHoleVolume.renderOrder = 3;
      tiltGroup.add(blackHoleVolume);
    }

    let wormholeVolume: THREE.Mesh | undefined;
    if (body.isWormhole) {
      const whMat = createWormholeMaterial(body, this.textures);
      wormholeVolume = new THREE.Mesh(SHARED_WORMHOLE_GEO, whMat);
      wormholeVolume.renderOrder = 3;
      wormholeVolume.frustumCulled = false;
      tiltGroup.add(wormholeVolume);
    }

    let pulsarJets: THREE.Group | undefined;
    if (body.category === 'neutron_star') {
      pulsarJets = new THREE.Group();
      const jetGeo = new THREE.ConeGeometry(0.45, 11.0, 24, 1, true);
      const jetMat = createPulsarJetMaterial();
      const topJet = new THREE.Mesh(jetGeo, jetMat);
      topJet.position.y = 6.2;
      topJet.rotation.x = Math.PI;
      const botJet = new THREE.Mesh(jetGeo, jetMat);
      botJet.position.y = -6.2;
      pulsarJets.add(topJet, botJet);
      pulsarJets.rotation.z = 0.42;
      tiltGroup.add(pulsarJets);
    }

    let cometComa: THREE.Mesh | undefined;
    let cometIonTail: THREE.Mesh | undefined;
    let cometDustTail: THREE.Mesh | undefined;
    let cometParticles: THREE.Points | undefined;
    if (body.category === 'comet') {
      cometComa = new THREE.Mesh(SHARED_CORONA_GEO, createCometComaMaterial(this.textures.earthClouds));
      cometComa.renderOrder = 3;
      root.add(cometComa);

      // World-space axial billboard ribbons & GPU particle stream added directly to scene (zero parent-transform skew!)
      cometIonTail = new THREE.Mesh(
        SHARED_COMET_RIBBON_GEO,
        createCometRibbonMaterial(false, this.textures.earthClouds)
      );
      cometIonTail.frustumCulled = false;
      cometIonTail.renderOrder = 2;
      this.scene.add(cometIonTail);

      cometDustTail = new THREE.Mesh(
        SHARED_COMET_RIBBON_GEO,
        createCometRibbonMaterial(true, this.textures.earthClouds)
      );
      cometDustTail.frustumCulled = false;
      cometDustTail.renderOrder = 1;
      this.scene.add(cometDustTail);

      cometParticles = new THREE.Points(
        SHARED_COMET_PARTICLES_GEO,
        createCometParticleStreamMaterial()
      );
      cometParticles.frustumCulled = false;
      cometParticles.renderOrder = 2;
      this.scene.add(cometParticles);
    }

    const pickMesh = new THREE.Mesh(
      SHARED_PICK_GEO,
      new THREE.MeshBasicMaterial({ visible: false })
    );
    pickMesh.userData.bodyId = body.id;
    root.add(pickMesh);

    const trailPositions = new Float32Array(MAX_TRAIL_VERTS * 3);
    const trailColors = new Float32Array(MAX_TRAIL_VERTS * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    trailGeo.setDrawRange(0, 0);

    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.frustumCulled = false;

    this.scene.add(root);
    this.scene.add(trailLine);

    return {
      bodyId: body.id,
      category: body.category,
      root,
      tiltGroup,
      surfaceMesh,
      surfaceMaterial,
      cloudMesh,
      atmosphereMesh,
      auroraMesh,
      jupiterAuroraMesh,
      lensVolume,
      sourceGalaxyGroup,
      andromedaGroup,
      andromedaVolume,
      andromedaStars,
      dwarfGalaxyGroup,
      dwarfVolume,
      dwarfStars,
      pillarsGroup,
      pillarsBackdrop,
      pillarsVolume,
      pillarsBgStars,
      pillarsStars,
      ngcClusterPoints,
      ringMesh,
      coronaMesh,
      prominenceGroup,
      prominenceSlots,
      blackHoleVolume,
      wormholeVolume,
      pulsarJets,
      cometComa,
      cometIonTail,
      cometDustTail,
      cometParticles,
      pickMesh,
      trailLine,
      trailPositions,
      trailColors,
      renderedPos: new THREE.Vector3(),
      renderedRadius: 1,
    };
  }

  private disposeVisual(vis: BodyVisual): void {
    this.scene.remove(vis.root);
    this.scene.remove(vis.trailLine);
    vis.surfaceMaterial.dispose();
    if (vis.cloudMesh) (vis.cloudMesh.material as THREE.Material).dispose();
    if (vis.atmosphereMesh) (vis.atmosphereMesh.material as THREE.Material).dispose();
    if (vis.auroraMesh) (vis.auroraMesh.material as THREE.Material).dispose();
    if (vis.jupiterAuroraMesh) (vis.jupiterAuroraMesh.material as THREE.Material).dispose();
    if (vis.lensVolume) (vis.lensVolume.material as THREE.Material).dispose();
    for (const grp of [vis.sourceGalaxyGroup, vis.andromedaGroup, vis.dwarfGalaxyGroup, vis.pillarsGroup]) {
      grp?.traverse((child) => {
        const obj = child as THREE.Mesh | THREE.Points;
        if (obj.material) (obj.material as THREE.Material).dispose();
      });
    }
    if (vis.ngcClusterPoints) {
      (vis.ngcClusterPoints.material as THREE.Material).dispose();
    }
    if (vis.ringMesh) {
      vis.ringMesh.geometry.dispose();
      (vis.ringMesh.material as THREE.Material).dispose();
    }
    if (vis.coronaMesh) (vis.coronaMesh.material as THREE.Material).dispose();
    if (vis.prominenceGroup) {
      vis.prominenceGroup.children.forEach((child) => {
        ((child as THREE.Mesh).material as THREE.Material).dispose();
      });
    }
    if (vis.blackHoleVolume) (vis.blackHoleVolume.material as THREE.Material).dispose();
    if (vis.wormholeVolume) (vis.wormholeVolume.material as THREE.Material).dispose();
    if (vis.pulsarJets) {
      vis.pulsarJets.children.forEach((child) => {
        const m = child as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
    }
    if (vis.cometComa) (vis.cometComa.material as THREE.Material).dispose();
    if (vis.cometIonTail) {
      this.scene.remove(vis.cometIonTail);
      (vis.cometIonTail.material as THREE.Material).dispose();
    }
    if (vis.cometDustTail) {
      this.scene.remove(vis.cometDustTail);
      (vis.cometDustTail.material as THREE.Material).dispose();
    }
    if (vis.cometParticles) {
      this.scene.remove(vis.cometParticles);
      (vis.cometParticles.material as THREE.Material).dispose();
    }
    (vis.pickMesh.material as THREE.Material).dispose();
    vis.trailLine.geometry.dispose();
    (vis.trailLine.material as THREE.Material).dispose();
  }

  public disposeAll(): void {
    for (const vis of this.visuals.values()) {
      this.disposeVisual(vis);
    }
    this.visuals.clear();
    this.scene.remove(this.selectionRing);
  }
}
