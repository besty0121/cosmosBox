import * as THREE from 'three';
import { AU, L_SUN, METERS_TO_SCENE, R_EARTH, R_SUN } from '../physics/constants';
import { CelestialBody, ScaleMode, Vec3 } from '../types/cosmos';
import {
  createAtmosphereMaterial,
  createBlackHoleLensingMaterial,
  createCloudLayerMaterial,
  createCometComaMaterial,
  createCometParticleStreamMaterial,
  createCometRibbonMaterial,
  createEarthAuroraMaterial,
  createProminenceMaterial,
  createPulsarJetMaterial,
  createRingMaterial,
  createSolarCoronaMaterial,
  createStarMaterial,
  createTexturedEarthMaterial,
  createTexturedGasGiantMaterial,
  createTexturedRockyMaterial,
  MAX_OCCLUDERS,
  MAX_STAR_LIGHTS,
} from './shaders/bodyShaders';
import { PlanetTextures, textureAtlas } from './TextureAtlas';

const SHARED_SPHERE_GEO = new THREE.SphereGeometry(1, 64, 48);
const SHARED_CLOUD_GEO = new THREE.SphereGeometry(1.012, 48, 36);
const SHARED_ATMO_GEO = new THREE.SphereGeometry(1.058, 40, 32);
const SHARED_BH_VOLUME_GEO = new THREE.SphereGeometry(15.0, 36, 24);
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
const SHARED_PROMINENCE_GEO = buildProminenceCurtainGeometry();

// Single lightweight outer bounding sphere for true single-pass 3D volumetric raymarched Earth aurora!
// Eliminates all shell slicing, plastic ribbon edges, and overdraw — raymarches real 90-450km thermosphere volume.
const SHARED_EARTH_AURORA_GEO = new THREE.SphereGeometry(1.09, 48, 36);

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
  ringMesh?: THREE.Mesh;
  coronaMesh?: THREE.Mesh;
  prominenceGroup?: THREE.Group;
  blackHoleVolume?: THREE.Mesh;
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
  const realRadius = Math.max(body.radius * METERS_TO_SCENE, 0.00015);
  if (scaleMode === 'real') {
    return realRadius;
  }

  let playableRadius: number;
  if (body.category === 'black_hole') {
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

  constructor(scene: THREE.Scene, textures: PlanetTextures) {
    this.scene = scene;
    this.textures = textures;

    const selGeo = new THREE.RingGeometry(1.36, 1.44, 72);
    const selMat = new THREE.MeshBasicMaterial({
      color: '#5ce1ff',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.selectionRing = new THREE.Mesh(selGeo, selMat);
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  }

  public getPickables(): THREE.Object3D[] {
    return this.pickables;
  }

  public getVisual(id: string): BodyVisual | undefined {
    return this.visuals.get(id);
  }

  public sync(
    bodies: CelestialBody[],
    originMeters: Vec3,
    camera: THREE.PerspectiveCamera,
    scaleMode: ScaleMode,
    showTrails: boolean,
    selectedId: string | null,
    elapsedTime: number
  ): void {
    const aliveIds = new Set<string>();
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

      if (vis.coronaMesh) {
        const coronaScale = r * (body.category === 'neutron_star' ? 4.4 : 4.8);
        vis.coronaMesh.scale.set(coronaScale, coronaScale, 1);
        vis.coronaMesh.quaternion.copy(camera.quaternion);
        const cMat = vis.coronaMesh.material as THREE.ShaderMaterial;
        cMat.uniforms.uTime.value = elapsedTime;
        cMat.uniforms.uColor.value.set(body.atmosphereColor || body.color);
      }

      if (vis.prominenceGroup) {
        vis.prominenceGroup.scale.setScalar(r);
        vis.prominenceGroup.rotation.y = body.rotationAngle * 0.85;
        vis.prominenceGroup.children.forEach((child) => {
          const m = (child as THREE.Mesh).material as THREE.ShaderMaterial;
          if (m.uniforms?.uTime) m.uniforms.uTime.value = elapsedTime;
          if (m.uniforms?.uColor) m.uniforms.uColor.value.set(body.secondaryColor || '#ff5518');
          if (m.uniforms?.uStarWorldPos) m.uniforms.uStarWorldPos.value.copy(vis.renderedPos);
        });
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
        body.category === 'black_hole' ? r * 4.2 : r * 1.45,
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
        syncStarLights(vis.surfaceMaterial, occCount);
      }

      vis.trailLine.visible = showTrails && body.trail.length > 1;
      if (vis.trailLine.visible) {
        const trail = body.trail;
        const count = Math.min(trail.length, MAX_TRAIL_VERTS);
        const startIdx = trail.length - count;
        this.tempColor.set(body.category === 'black_hole' ? '#ff8b3d' : body.color);

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

    if (selectedVis) {
      this.selectionRing.visible = true;
      this.selectionRing.position.copy(selectedVis.renderedPos);
      this.selectionRing.quaternion.copy(camera.quaternion);
      const camDist = camera.position.distanceTo(selectedVis.renderedPos);
      const baseMult = selectedVis.category === 'black_hole' ? 4.5 : 1.18;
      const ringScale = Math.max(selectedVis.renderedRadius * baseMult, camDist * 0.024);
      this.selectionRing.scale.setScalar(ringScale);
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

    if (body.category === 'star' || body.category === 'neutron_star') {
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

    // Organic asymmetric 3D wispy H-alpha solar prominence curtains (hedgerows, eruptive plumes & torn filaments!)
    let prominenceGroup: THREE.Group | undefined;
    if (body.category === 'star') {
      prominenceGroup = new THREE.Group();
      const curtainCount = 6;
      for (let i = 0; i < curtainCount; i++) {
        const variant = i % 3;
        const promMat = createProminenceMaterial(
          body.secondaryColor || '#ff5518',
          this.textures.sun,
          body.seed + i * 23.4,
          variant
        );
        const curtain = new THREE.Mesh(SHARED_PROMINENCE_GEO, promMat);
        const az = ((i * 60 + body.seed * 17) % 360) * (Math.PI / 180);
        const lat = (((i % 2 === 0 ? 1 : -1) * (16 + (i * 13) % 34)) * Math.PI) / 180;
        curtain.rotation.set(lat, az, ((i * 53) % 160 - 80) * (Math.PI / 180));
        const widthScale = 0.78 + ((i * 29) % 7) * 0.06;
        const heightScale = 0.88 + ((i * 17) % 5) * 0.06;
        curtain.scale.set(widthScale, heightScale, 1.0);
        curtain.renderOrder = 1;
        prominenceGroup.add(curtain);
      }
      tiltGroup.add(prominenceGroup);
    }

    let blackHoleVolume: THREE.Mesh | undefined;
    if (body.category === 'black_hole') {
      const bhMat = createBlackHoleLensingMaterial(body, this.textures);
      blackHoleVolume = new THREE.Mesh(SHARED_BH_VOLUME_GEO, bhMat);
      blackHoleVolume.renderOrder = 3;
      tiltGroup.add(blackHoleVolume);
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
      ringMesh,
      coronaMesh,
      prominenceGroup,
      blackHoleVolume,
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
