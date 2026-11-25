import * as THREE from 'three';
import { METERS_TO_SCENE } from '../physics/constants';
import {
  CelestialBody,
  DirectorEasing,
  DirectorKeyframe,
  DirectorScriptFile,
  GalaxySpectrumMode,
  NebulaSpectrumMode,
  Vec3,
} from '../types/cosmos';

export interface DirectorAstroPatch {
  nebulaSpectrumMode?: NebulaSpectrumMode;
  nebulaIrPenetration?: number;
  galaxySpectrumMode?: GalaxySpectrumMode;
  galaxyDustOpacity?: number;
  auroraIntensity?: number;
  lensShear?: number;
}

export interface DirectorSample {
  originMeters: Vec3;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
  timeScale: number;
  activeIndex: number;
  totalDuration: number;
  finished: boolean;
  astroPatch: DirectorAstroPatch;
}

let keyframeCounter = 1;

export function nextDirectorKeyframeId(): string {
  return `kf_${Date.now().toString(36)}_${keyframeCounter++}`;
}

export function computeDirectorTotalDuration(keyframes: DirectorKeyframe[]): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) {
    return Math.max(2, keyframes[0].holdSec);
  }
  let total = Math.max(0, keyframes[0].holdSec);
  for (let i = 1; i < keyframes.length; i++) {
    total += Math.max(0.25, keyframes[i].durationSec) + Math.max(0, keyframes[i].holdSec);
  }
  return total;
}

export function applyDirectorEasing(t: number, easing: DirectorEasing): number {
  const x = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'linear':
      return x;
    case 'smoothstep':
      return x * x * (3 - 2 * x);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'cinematicSlow':
    default:
      return x * x * x * (x * (x * 6 - 15) + 10);
  }
}

export function resolveKeyframeAnchorMeters(
  kf: DirectorKeyframe,
  bodies: CelestialBody[]
): Vec3 {
  if (kf.anchorBodyId) {
    const byId = bodies.find((b) => b.alive && b.id === kf.anchorBodyId);
    if (byId) return { ...byId.position };
  }
  if (kf.anchorBodyName) {
    const byName = bodies.find((b) => b.alive && b.name === kf.anchorBodyName);
    if (byName) return { ...byName.position };
  }
  return { ...kf.originMeters };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function lerpSegmentPoint(
  a: THREE.Vector3,
  b: THREE.Vector3,
  ta: number,
  tb: number,
  t: number
): THREE.Vector3 {
  const span = tb - ta;
  if (Math.abs(span) < 1e-6) return a.clone();
  return a.clone().lerp(b, (t - ta) / span);
}

/**
 * Centripetal Catmull-Rom spline evaluation (alpha = 0.5, Barry-Goldman algorithm)
 * avoids cusps and self-intersections even when consecutive keyframe chords differ sharply in length.
 */
export function evalCentripetalCatmullRom(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  u: number
): THREE.Vector3 {
  if (p1.distanceTo(p2) < 1e-4) return p1.clone();

  const wp0 = p0.clone();
  const wp3 = p3.clone();
  if (wp0.distanceTo(p1) < 1e-4) {
    wp0.copy(p1).multiplyScalar(2).sub(p2);
  }
  if (p2.distanceTo(wp3) < 1e-4) {
    wp3.copy(p2).multiplyScalar(2).sub(p1);
  }

  const d01 = Math.max(1e-4, wp0.distanceTo(p1));
  const d12 = Math.max(1e-4, p1.distanceTo(p2));
  const d23 = Math.max(1e-4, p2.distanceTo(wp3));

  const t0 = 0;
  const t1 = t0 + Math.sqrt(d01);
  const t2 = t1 + Math.sqrt(d12);
  const t3 = t2 + Math.sqrt(d23);
  const t = t1 + (t2 - t1) * Math.max(0, Math.min(1, u));

  const a1 = lerpSegmentPoint(wp0, p1, t0, t1, t);
  const a2 = lerpSegmentPoint(p1, p2, t1, t2, t);
  const a3 = lerpSegmentPoint(p2, wp3, t2, t3, t);

  const b1 = lerpSegmentPoint(a1, a2, t0, t2, t);
  const b2 = lerpSegmentPoint(a2, a3, t1, t3, t);

  return lerpSegmentPoint(b1, b2, t1, t2, t);
}

function buildStaticSample(
  kf: DirectorKeyframe,
  activeIndex: number,
  totalDuration: number,
  finished: boolean,
  bodies: CelestialBody[]
): DirectorSample {
  return {
    originMeters: resolveKeyframeAnchorMeters(kf, bodies),
    position: new THREE.Vector3(kf.position.x, kf.position.y, kf.position.z),
    quaternion: new THREE.Quaternion(...kf.quaternion).normalize(),
    fov: kf.fov,
    timeScale: kf.timeScale,
    activeIndex,
    totalDuration,
    finished,
    astroPatch: {
      nebulaSpectrumMode: kf.nebulaSpectrumMode,
      nebulaIrPenetration: kf.nebulaIrPenetration,
      galaxySpectrumMode: kf.galaxySpectrumMode,
      galaxyDustOpacity: kf.galaxyDustOpacity,
      auroraIntensity: kf.auroraIntensity,
      lensShear: kf.lensShear,
    },
  };
}

function interpOptionalNumber(
  a: number | undefined,
  b: number | undefined,
  u: number
): number | undefined {
  if (a !== undefined && b !== undefined) return THREE.MathUtils.lerp(a, b, u);
  if (a !== undefined || b !== undefined) return u < 0.5 ? a : b;
  return undefined;
}

export function sampleDirectorPose(
  keyframes: DirectorKeyframe[],
  tSec: number,
  bodies: CelestialBody[]
): DirectorSample {
  if (keyframes.length === 0) {
    return {
      originMeters: { x: 0, y: 0, z: 0 },
      position: new THREE.Vector3(0, 120, 260),
      quaternion: new THREE.Quaternion(),
      fov: 48,
      timeScale: 86400,
      activeIndex: 0,
      totalDuration: 0,
      finished: true,
      astroPatch: {},
    };
  }

  const totalDuration = computeDirectorTotalDuration(keyframes);
  if (keyframes.length === 1) {
    return buildStaticSample(keyframes[0], 0, totalDuration, tSec >= totalDuration - 1e-5, bodies);
  }

  const clampedT = Math.max(0, Math.min(tSec, totalDuration));
  const finished = tSec >= totalDuration - 1e-5;

  const hold0 = Math.max(0, keyframes[0].holdSec);
  if (clampedT <= hold0) {
    return buildStaticSample(keyframes[0], 0, totalDuration, finished, bodies);
  }

  let cursor = hold0;
  for (let i = 1; i < keyframes.length; i++) {
    const kfA = keyframes[i - 1];
    const kfB = keyframes[i];
    const transDur = Math.max(0.25, kfB.durationSec);
    const holdDur = Math.max(0, kfB.holdSec);

    if (clampedT <= cursor + transDur) {
      const rawU = Math.max(0, Math.min(1, (clampedT - cursor) / transDur));
      const u = applyDirectorEasing(rawU, kfB.easing);

      const anchorA = resolveKeyframeAnchorMeters(kfA, bodies);
      const anchorB = resolveKeyframeAnchorMeters(kfB, bodies);
      const originMeters = lerpVec3(anchorA, anchorB, u);

      const toLocal = (idx: number): THREE.Vector3 => {
        const kf = keyframes[idx];
        const anc = resolveKeyframeAnchorMeters(kf, bodies);
        return new THREE.Vector3(
          (anc.x - originMeters.x) * METERS_TO_SCENE + kf.position.x,
          (anc.y - originMeters.y) * METERS_TO_SCENE + kf.position.y,
          (anc.z - originMeters.z) * METERS_TO_SCENE + kf.position.z
        );
      };

      const p0 = toLocal(Math.max(0, i - 2));
      const p1 = toLocal(i - 1);
      const p2 = toLocal(i);
      const p3 = toLocal(Math.min(keyframes.length - 1, i + 1));
      const position = evalCentripetalCatmullRom(p0, p1, p2, p3, u);

      const qA = new THREE.Quaternion(...kfA.quaternion).normalize();
      const qB = new THREE.Quaternion(...kfB.quaternion).normalize();
      if (qA.dot(qB) < 0) {
        qB.set(-qB.x, -qB.y, -qB.z, -qB.w);
      }
      qA.slerp(qB, u).normalize();

      const fov = THREE.MathUtils.lerp(kfA.fov, kfB.fov, u);
      const logA = Math.log(Math.max(1, kfA.timeScale));
      const logB = Math.log(Math.max(1, kfB.timeScale));
      const timeScale = Math.exp(THREE.MathUtils.lerp(logA, logB, u));

      const astroPatch: DirectorAstroPatch = {
        nebulaSpectrumMode: u < 0.5 ? kfA.nebulaSpectrumMode : kfB.nebulaSpectrumMode,
        nebulaIrPenetration: interpOptionalNumber(
          kfA.nebulaIrPenetration,
          kfB.nebulaIrPenetration,
          u
        ),
        galaxySpectrumMode: u < 0.5 ? kfA.galaxySpectrumMode : kfB.galaxySpectrumMode,
        galaxyDustOpacity: interpOptionalNumber(kfA.galaxyDustOpacity, kfB.galaxyDustOpacity, u),
        auroraIntensity: interpOptionalNumber(kfA.auroraIntensity, kfB.auroraIntensity, u),
        lensShear: interpOptionalNumber(kfA.lensShear, kfB.lensShear, u),
      };

      return {
        originMeters,
        position,
        quaternion: qA,
        fov,
        timeScale,
        activeIndex: u < 0.5 ? i - 1 : i,
        totalDuration,
        finished,
        astroPatch,
      };
    }

    cursor += transDur;
    if (clampedT <= cursor + holdDur || i === keyframes.length - 1) {
      return buildStaticSample(kfB, i, totalDuration, finished, bodies);
    }
    cursor += holdDur;
  }

  return buildStaticSample(
    keyframes[keyframes.length - 1],
    keyframes.length - 1,
    totalDuration,
    true,
    bodies
  );
}

function makeLookQuat(
  pos: THREE.Vector3,
  target: THREE.Vector3,
  up = new THREE.Vector3(0, 1, 0)
): [number, number, number, number] {
  const m = new THREE.Matrix4().lookAt(pos, target, up);
  const q = new THREE.Quaternion().setFromRotationMatrix(m).normalize();
  return [q.x, q.y, q.z, q.w];
}

function createStoryboardShot(
  name: string,
  pos: THREE.Vector3,
  target: THREE.Vector3,
  anchorBody: CelestialBody | undefined,
  fallbackOrigin: Vec3,
  timeScale: number,
  opts: {
    durationSec?: number;
    holdSec?: number;
    easing?: DirectorEasing;
    fov?: number;
    astro?: DirectorAstroPatch;
  } = {}
): DirectorKeyframe {
  return {
    id: nextDirectorKeyframeId(),
    name,
    durationSec: opts.durationSec ?? 4.5,
    holdSec: opts.holdSec ?? 0.4,
    easing: opts.easing ?? 'cinematicSlow',
    anchorBodyId: anchorBody?.id ?? null,
    anchorBodyName: anchorBody?.name ?? null,
    position: { x: pos.x, y: pos.y, z: pos.z },
    originMeters: anchorBody ? { ...anchorBody.position } : { ...fallbackOrigin },
    quaternion: makeLookQuat(pos, target),
    fov: opts.fov ?? 48,
    timeScale: Math.max(1, timeScale),
    ...opts.astro,
  };
}

export function buildScenarioStoryboard(
  scenarioId: string,
  bodies: CelestialBody[],
  currentCamPos: THREE.Vector3,
  currentOriginMeters: Vec3,
  currentFocusBodyId: string | null,
  currentTimeScale: number
): DirectorKeyframe[] {
  const alive = bodies.filter((b) => b.alive);
  if (alive.length === 0) return [];

  const ts = Math.max(1, currentTimeScale);

  if (scenarioId === 'pillars_of_creation') {
    const pillars = alive.find((b) => b.nebulaType === 'pillars_of_creation') ?? alive[0];
    const origin = { ...pillars.position };
    return [
      createStoryboardShot(
        '经典正面全景',
        new THREE.Vector3(2, -6, 268),
        new THREE.Vector3(2, -10, 0),
        pillars,
        origin,
        ts,
        {
          durationSec: 4.0,
          holdSec: 0.8,
          fov: 48,
        }
      ),
      createStoryboardShot(
        '穿行柱间峡谷',
        new THREE.Vector3(-14, -26, 106),
        new THREE.Vector3(10, 4, 0),
        pillars,
        origin,
        ts,
        {
          durationSec: 4.8,
          holdSec: 0.4,
          fov: 45,
        }
      ),
      createStoryboardShot(
        'ESO MUSE 3D 纵深',
        new THREE.Vector3(228, 12, 34),
        new THREE.Vector3(0, -8, 4),
        pillars,
        origin,
        ts,
        {
          durationSec: 4.8,
          holdSec: 0.3,
          fov: 48,
        }
      ),
      createStoryboardShot(
        '高空斜侧回望',
        new THREE.Vector3(-48, 18, 250),
        new THREE.Vector3(2, -8, 0),
        pillars,
        origin,
        ts,
        {
          durationSec: 4.5,
          holdSec: 1.0,
          fov: 46,
        }
      ),
    ];
  }

  if (scenarioId === 'andromeda_galaxy') {
    const m31 = alive.find((b) => b.galaxyType === 'andromeda') ?? alive[0];
    const origin = { ...m31.position };
    const zero = new THREE.Vector3(0, 0, 0);
    const galQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.0, -0.56, 'ZYX'));
    const facePos = new THREE.Vector3(0, 1, 0.04)
      .normalize()
      .applyQuaternion(galQuat)
      .multiplyScalar(255);
    const edgePos = new THREE.Vector3(0, 0.025, 1)
      .normalize()
      .applyQuaternion(galQuat)
      .multiplyScalar(245);
    const corePos = new THREE.Vector3(0.14, 0.42, 0.89)
      .normalize()
      .applyQuaternion(galQuat)
      .multiplyScalar(56);

    return [
      createStoryboardShot('地球 77° 经典全貌', new THREE.Vector3(0, 0, 243), zero, m31, origin, ts, {
        durationSec: 4.0,
        holdSec: 0.8,
        fov: 48,
      }),
      createStoryboardShot('俯视旋臂全景', facePos, zero, m31, origin, ts, {
        durationSec: 4.6,
        holdSec: 0.4,
        fov: 46,
      }),
      createStoryboardShot('侧视尘埃银盘', edgePos, zero, m31, origin, ts, {
        durationSec: 4.6,
        holdSec: 0.4,
        fov: 48,
      }),
      createStoryboardShot('银核特写推镜', corePos, zero, m31, origin, ts, {
        durationSec: 4.2,
        holdSec: 1.0,
        fov: 40,
      }),
    ];
  }

  if (scenarioId === 'einstein_ring_lensing') {
    const lens = alive.find((b) => b.isGravitationalLens) ?? alive[0];
    const src = alive.find((b) => b.isLensSource);
    const origin = { ...lens.position };
    const zero = new THREE.Vector3(0, 0, 0);
    const sightDir = new THREE.Vector3();
    if (src) {
      sightDir.set(
        lens.position.x - src.position.x,
        lens.position.y - src.position.y,
        lens.position.z - src.position.z
      );
    }
    if (sightDir.lengthSq() < 1e-6) {
      sightDir.copy(currentCamPos);
    }
    if (sightDir.lengthSq() < 1e-4) {
      sightDir.set(0, 0, 1);
    }
    sightDir.normalize();

    const rawDist = currentCamPos.length();
    const baseDist = THREE.MathUtils.clamp(rawDist > 10 ? rawDist : 147, 70, 240);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, sightDir).normalize();
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);

    const pos1 = sightDir.clone().multiplyScalar(baseDist);
    const pos2 = sightDir
      .clone()
      .multiplyScalar(baseDist * 0.88)
      .addScaledVector(right, baseDist * 0.06);
    const pos3 = sightDir
      .clone()
      .applyAxisAngle(up, (36 * Math.PI) / 180)
      .multiplyScalar(baseDist * 0.96);

    return [
      createStoryboardShot('360° 爱因斯坦环', pos1, zero, lens, origin, ts, {
        durationSec: 4.0,
        holdSec: 1.0,
        fov: 44,
        astro: { lensShear: 0.0 },
      }),
      createStoryboardShot('剪切演化 · 爱因斯坦十字', pos2, zero, lens, origin, ts, {
        durationSec: 4.8,
        holdSec: 1.0,
        fov: 40,
        astro: { lensShear: 0.24 },
      }),
      createStoryboardShot('引力透镜侧翼纵深', pos3, zero, lens, origin, ts, {
        durationSec: 4.4,
        holdSec: 0.6,
        fov: 48,
        astro: { lensShear: 0.12 },
      }),
    ];
  }

  if (scenarioId === 'earth_aurora' || scenarioId === 'solar_cme_storm') {
    const earth =
      alive.find((b) => b.name.includes('地球') || b.auroraIntensity !== undefined) ?? alive[0];
    const origin = { ...earth.position };
    const zero = new THREE.Vector3(0, 0, 0);
    const baseDist =
      scenarioId === 'earth_aurora'
        ? THREE.MathUtils.clamp(currentCamPos.length() || 3.2, 2.4, 5.2)
        : 3.4;

    return [
      createStoryboardShot(
        '晨昏线轨道全景',
        new THREE.Vector3(baseDist * 0.45, baseDist * 0.32, baseDist * 0.86),
        zero,
        earth,
        origin,
        ts,
        { durationSec: 4.0, holdSec: 0.8, fov: 48, astro: { auroraIntensity: 0.45 } }
      ),
      createStoryboardShot(
        '北极圈 G5 极光大爆发',
        new THREE.Vector3(-baseDist * 0.28, baseDist * 0.82, baseDist * 0.44),
        zero,
        earth,
        origin,
        ts,
        { durationSec: 4.8, holdSec: 1.0, fov: 44, astro: { auroraIntensity: 1.5 } }
      ),
      createStoryboardShot(
        '暗夜磁层环绕',
        new THREE.Vector3(-baseDist * 0.88, -baseDist * 0.24, -baseDist * 0.48),
        zero,
        earth,
        origin,
        ts,
        { durationSec: 4.4, holdSec: 0.8, fov: 48, astro: { auroraIntensity: 1.3 } }
      ),
    ];
  }

  const focusBody =
    (currentFocusBodyId ? alive.find((b) => b.id === currentFocusBodyId) : undefined) ?? alive[0];
  const origin = focusBody ? { ...focusBody.position } : { ...currentOriginMeters };
  const zero = new THREE.Vector3(0, 0, 0);
  const baseDir = currentCamPos.clone();
  const rawDist = baseDir.length();
  const baseDist = rawDist > 0.2 ? rawDist : 160;
  if (rawDist > 1e-4) baseDir.normalize();
  else baseDir.set(0.25, 0.54, 0.8).normalize();

  const upAxis = new THREE.Vector3(0, 1, 0);
  const pos1 = baseDir.clone().multiplyScalar(baseDist * 1.12);
  const pos2 = baseDir
    .clone()
    .applyAxisAngle(upAxis, (65 * Math.PI) / 180)
    .setY(Math.max(-0.3, Math.min(0.45, baseDir.y * 0.45)))
    .normalize()
    .multiplyScalar(baseDist * 0.58);
  const pos3 = baseDir
    .clone()
    .applyAxisAngle(upAxis, (145 * Math.PI) / 180)
    .setY(Math.sin((32 * Math.PI) / 180))
    .normalize()
    .multiplyScalar(baseDist * 1.05);

  return [
    createStoryboardShot('全景建置', pos1, zero, focusBody, origin, ts, {
      durationSec: 4.0,
      holdSec: 0.6,
      fov: 48,
    }),
    createStoryboardShot('低轨抵近环绕', pos2, zero, focusBody, origin, ts, {
      durationSec: 4.4,
      holdSec: 0.4,
      fov: 44,
    }),
    createStoryboardShot('高空俯瞰拉远', pos3, zero, focusBody, origin, ts, {
      durationSec: 4.4,
      holdSec: 0.8,
      fov: 50,
    }),
  ];
}

export function serializeDirectorScript(
  scenarioId: string,
  keyframes: DirectorKeyframe[]
): string {
  const payload: DirectorScriptFile = {
    version: 1,
    scenarioId,
    exportedAt: Date.now(),
    keyframes,
  };
  return JSON.stringify(payload, null, 2);
}

const VALID_EASINGS: Set<string> = new Set([
  'cinematicSlow',
  'easeInOut',
  'smoothstep',
  'linear',
]);

function isFiniteVec3(v: unknown): v is Vec3 {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.x === 'number' &&
    Number.isFinite(obj.x) &&
    typeof obj.y === 'number' &&
    Number.isFinite(obj.y) &&
    typeof obj.z === 'number' &&
    Number.isFinite(obj.z)
  );
}

function isFiniteQuat(q: unknown): q is [number, number, number, number] {
  return (
    Array.isArray(q) &&
    q.length === 4 &&
    q.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export function parseDirectorScript(text: string): DirectorKeyframe[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1 || !Array.isArray(obj.keyframes)) return null;

    const valid: DirectorKeyframe[] = [];
    for (const raw of obj.keyframes) {
      if (!raw || typeof raw !== 'object') return null;
      const kf = raw as Record<string, unknown>;
      if (
        typeof kf.name !== 'string' ||
        typeof kf.durationSec !== 'number' ||
        !Number.isFinite(kf.durationSec) ||
        typeof kf.holdSec !== 'number' ||
        !Number.isFinite(kf.holdSec) ||
        typeof kf.easing !== 'string' ||
        !VALID_EASINGS.has(kf.easing) ||
        !isFiniteVec3(kf.position) ||
        !isFiniteVec3(kf.originMeters) ||
        !isFiniteQuat(kf.quaternion) ||
        typeof kf.fov !== 'number' ||
        !Number.isFinite(kf.fov) ||
        typeof kf.timeScale !== 'number' ||
        !Number.isFinite(kf.timeScale)
      ) {
        return null;
      }
      valid.push({
        id: typeof kf.id === 'string' && kf.id ? kf.id : nextDirectorKeyframeId(),
        name: kf.name.slice(0, 48),
        durationSec: Math.max(0.25, Math.min(60, kf.durationSec)),
        holdSec: Math.max(0, Math.min(30, kf.holdSec)),
        easing: kf.easing as DirectorEasing,
        anchorBodyId: typeof kf.anchorBodyId === 'string' ? kf.anchorBodyId : null,
        anchorBodyName: typeof kf.anchorBodyName === 'string' ? kf.anchorBodyName : null,
        position: { x: kf.position.x, y: kf.position.y, z: kf.position.z },
        originMeters: {
          x: kf.originMeters.x,
          y: kf.originMeters.y,
          z: kf.originMeters.z,
        },
        quaternion: [...kf.quaternion],
        fov: Math.max(20, Math.min(90, kf.fov)),
        timeScale: Math.max(1, kf.timeScale),
        nebulaSpectrumMode:
          typeof kf.nebulaSpectrumMode === 'string'
            ? (kf.nebulaSpectrumMode as NebulaSpectrumMode)
            : undefined,
        nebulaIrPenetration:
          typeof kf.nebulaIrPenetration === 'number' && Number.isFinite(kf.nebulaIrPenetration)
            ? kf.nebulaIrPenetration
            : undefined,
        galaxySpectrumMode:
          typeof kf.galaxySpectrumMode === 'string'
            ? (kf.galaxySpectrumMode as GalaxySpectrumMode)
            : undefined,
        galaxyDustOpacity:
          typeof kf.galaxyDustOpacity === 'number' && Number.isFinite(kf.galaxyDustOpacity)
            ? kf.galaxyDustOpacity
            : undefined,
        auroraIntensity:
          typeof kf.auroraIntensity === 'number' && Number.isFinite(kf.auroraIntensity)
            ? kf.auroraIntensity
            : undefined,
        lensShear:
          typeof kf.lensShear === 'number' && Number.isFinite(kf.lensShear)
            ? kf.lensShear
            : undefined,
      });
    }
    return valid;
  } catch {
    return null;
  }
}
