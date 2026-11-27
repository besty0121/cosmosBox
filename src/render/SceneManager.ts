import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { cosmosAudio } from '../audio/CosmosAudio';
import {
  AU,
  METERS_TO_SCENE,
  SCENE_TO_METERS,
  SCENE_UNITS_PER_AU,
} from '../physics/constants';
import {
  computeCircularOrbitVelocity,
  findDominantBody,
  predictTrajectory,
} from '../physics/integrator';
import { SimulationEngine } from '../physics/SimulationEngine';
import {
  CameraMode,
  CelestialBody,
  CmeImpactEvent,
  CollisionEvent,
  DirectorFps,
  DirectorKeyframe,
  DirectorRecordingResult,
  DirectorResolution,
  DirectorVideoFormat,
  KilonovaEvent,
  LaunchMode,
  ScaleMode,
  ScreenLabel,
  SpawnTemplate,
  SupernovaEvent,
  TidalDisruptionEvent,
  Vec3,
} from '../types/cosmos';
import { BodyRenderer } from './BodyRenderer';
import { DebrisRenderer } from './DebrisRenderer';
import {
  buildScenarioStoryboard,
  computeDirectorTotalDuration,
  DirectorAstroPatch,
  nextDirectorKeyframeId,
  resolveKeyframeAnchorMeters,
  sampleDirectorPose,
} from './DirectorEngine';
import { GalaxyRenderer } from './GalaxyRenderer';
import { HighEnergyRenderer } from './HighEnergyRenderer';
import { ScienceOverlays } from './overlays/ScienceOverlays';
import { SpacetimeGrid } from './overlays/SpacetimeGrid';
import { textureAtlas } from './TextureAtlas';
import { VideoRecorder } from './VideoRecorder';

export type GraphicsQuality = 'high' | 'fast';

export const FLIGHT_GEARS = [0.25, 1.2, 5, 20, 75, 240, 750, 2400] as const;
export const FLIGHT_GEAR_LABELS = [
  '微距泊船',
  '近地巡航',
  '卫星轨道',
  '行星巡游',
  '内太阳系',
  '外太阳系',
  '星际跃迁',
  '星系超光速',
] as const;

interface ShockwaveFX {
  mesh: THREE.Mesh;
  worldPosMeters: Vec3;
  age: number;
  maxAge: number;
  maxScale: number;
  isSphere?: boolean;
}

export interface SceneCallbacks {
  onSelectBody: (id: string | null) => void;
  onSpawnedBody: (body: CelestialBody) => void;
  onCollision: (event: CollisionEvent) => void;
  onTidalDisruption: (event: TidalDisruptionEvent) => void;
  onSupernova: (event: SupernovaEvent) => void;
  onKilonova: (event: KilonovaEvent) => void;
  onCmeImpact: (event: CmeImpactEvent) => void;
  onCameraModeChange: (mode: CameraMode, targetName?: string | null) => void;
  onTelemetryTick: (fps: number) => void;
  onFlightTelemetry?: (gearIndex: number, speedUnits: number) => void;
  onLabelsUpdate: (labels: ScreenLabel[]) => void;
  onDirectorTelemetry?: (
    timeSec: number,
    totalSec: number,
    activeIndex: number,
    playing: boolean
  ) => void;
  onDirectorFinished?: (wasRecording: boolean) => void;
  onRecordingStateChange?: (
    recording: boolean,
    elapsedSec: number,
    result?: DirectorRecordingResult,
    errorMsg?: string,
    activeFormat?: DirectorVideoFormat,
    fallbackFrom?: DirectorVideoFormat
  ) => void;
}

export class SceneManager {
  private container: HTMLElement;
  private engine: SimulationEngine;
  private callbacks: SceneCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private bodyRenderer: BodyRenderer;
  private debrisRenderer: DebrisRenderer;
  private galaxyRenderer: GalaxyRenderer;
  private highEnergyRenderer: HighEnergyRenderer;
  private spacetimeGrid: SpacetimeGrid;
  private scienceOverlays: ScienceOverlays;
  private starfield: THREE.Points;

  // State synced from store
  public graphicsQuality: GraphicsQuality = 'high';
  public scaleMode: ScaleMode = 'playable';
  public showTrails = true;
  public showGravityGrid = false;
  public showHabitableZone = false;
  public showVectors = false;
  public showRocheLimits = false;
  public showLabels = false;
  public showSpaceWeatherField = true;
  public selectedBodyId: string | null = null;
  public focusBodyId: string | null = null;
  public cameraMode: CameraMode = 'orbit';
  public spawnActive = false;
  public spawnTemplate: SpawnTemplate | null = null;
  public launchMode: LaunchMode = 'orbit';

  // Surface First-Person View state
  private surfaceBodyId: string | null = null;
  private surfaceLon = 0.5; // local longitude offset relative to sub-solar direction (rad)
  private surfaceLat = 0.24; // local latitude (rad)
  private surfaceYaw = 0; // look yaw around surface normal
  private surfacePitch = -0.18; // slightly below horizon so curved sunlit planet limb fills lower third!
  private isDraggingSurface = false;
  private lastSurfacePointer = new THREE.Vector2();

  // Cinematic Auto-Tour state
  private tourIndex = 0;
  private tourElapsed = 0;
  private tourDurationPerStop = 9.5;
  private tourAzimuth = 0;
  private tourOriginOffset: Vec3 = { x: 0, y: 0, z: 0 };
  private tourCurrentBodyId: string | null = null;

  // 6-DOF Free-Flight Spacecraft state
  private flightVelocity = new THREE.Vector3();
  private flightGearIndex = 3;
  private flightKeys = new Set<string>();
  private isDraggingFlightLook = false;
  private isDraggingFlightRoll = false;
  private lastFlightPointer = new THREE.Vector2();
  private flightThrustVec = new THREE.Vector3();
  private flightForward = new THREE.Vector3();
  private flightRight = new THREE.Vector3();
  private flightUp = new THREE.Vector3();

  // Keyframe Director & Clean MP4/WebM Video Recording state
  private directorKeyframes: DirectorKeyframe[] = [];
  private directorTimeSec = 0;
  private directorPlaying = false;
  private directorLoop = false;
  private directorRecordOnPlay = false;
  private recordingSizeLock: { width: number; height: number } | null = null;
  private recordingActualFormat: DirectorVideoFormat = 'mp4';
  private videoRecorder = new VideoRecorder();

  // Floating origin in SI meters (tracks focused body for zero float jitter)
  private originMeters: Vec3 = { x: 0, y: 0, z: 0 };

  // Spawn preview visuals
  private spawnPlaneGrid: THREE.PolarGridHelper;
  private ghostSphere: THREE.Mesh;
  private predictionLine: THREE.Line;
  private predictionBuffer = new Float32Array(200 * 3);
  private slingshotArrow: THREE.Line;
  private slingshotBuffer = new Float32Array(3 * 3);
  private hoverWorldMeters: Vec3 | null = null;
  private dragStartWorldMeters: Vec3 | null = null;
  private isDraggingSlingshot = false;
  private pointerDownScreen = new THREE.Vector2();

  // Collision FX
  private shockwaves: ShockwaveFX[] = [];

  // Raycaster & loop bookkeeping
  private raycaster = new THREE.Raycaster();
  private rafId = 0;
  private lastFrameTime = 0;
  private elapsedTime = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private telemetryTimer = 0;
  private labelTimer = 0;
  private tempProj = new THREE.Vector3();
  private disposed = false;

  constructor(container: HTMLElement, engine: SimulationEngine, callbacks: SceneCallbacks) {
    this.container = container;
    this.engine = engine;
    this.callbacks = callbacks;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Cap pixel ratio at 1.25 in high mode to avoid 4x Retina fillrate bottlenecks on laptops
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.05, 80000);
    this.camera.position.set(0, 260, 420);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 1.15;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 24000;

    // Half-resolution bloom with tuned threshold so Sun surface granules stay rich & detailed while active rims glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2))),
      0.38,
      0.48,
      0.98
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Initialize real 2K NASA / ESO planetary & Milky Way texture atlas (instant local load, zero runtime noise cost!)
    const textures = textureAtlas.init(this.renderer);
    this.scene.background = textures.milkyWay;
    this.scene.backgroundIntensity = 0.58;
    this.starfield = this.createStarfield();
    this.scene.add(this.starfield);

    this.bodyRenderer = new BodyRenderer(this.scene, textures);
    this.debrisRenderer = new DebrisRenderer(this.scene);
    this.galaxyRenderer = new GalaxyRenderer(this.scene);
    this.highEnergyRenderer = new HighEnergyRenderer(this.scene);
    this.spacetimeGrid = new SpacetimeGrid(this.scene);
    this.scienceOverlays = new ScienceOverlays(this.scene);

    // Spawn reference plane & preview meshes
    this.spawnPlaneGrid = new THREE.PolarGridHelper(900, 16, 10, 96, 0x2a6c9e, 0x133352);
    const gridMat = this.spawnPlaneGrid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.28;
    this.spawnPlaneGrid.visible = false;
    this.scene.add(this.spawnPlaneGrid);

    this.ghostSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshBasicMaterial({
        color: '#6ce2ff',
        transparent: true,
        opacity: 0.45,
        wireframe: false,
      })
    );
    this.ghostSphere.visible = false;
    this.scene.add(this.ghostSphere);

    const predGeo = new THREE.BufferGeometry();
    predGeo.setAttribute('position', new THREE.BufferAttribute(this.predictionBuffer, 3));
    predGeo.setDrawRange(0, 0);
    this.predictionLine = new THREE.Line(
      predGeo,
      new THREE.LineBasicMaterial({
        color: '#5ce1ff',
        transparent: true,
        opacity: 0.85,
      })
    );
    this.predictionLine.frustumCulled = false;
    this.predictionLine.visible = false;
    this.scene.add(this.predictionLine);

    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.BufferAttribute(this.slingshotBuffer, 3));
    arrowGeo.setDrawRange(0, 0);
    this.slingshotArrow = new THREE.Line(
      arrowGeo,
      new THREE.LineBasicMaterial({
        color: '#ffaa44',
        transparent: true,
        opacity: 0.95,
      })
    );
    this.slingshotArrow.frustumCulled = false;
    this.slingshotArrow.visible = false;
    this.scene.add(this.slingshotArrow);

    this.bindEvents();
    this.lastFrameTime = performance.now();
    this.animate();
  }

  public frameScenario(
    distanceAU: number,
    focusBodyName?: string,
    cameraAngles?: { azimuthDeg: number; elevationDeg: number }
  ): void {
    this.exitSpecialCameraMode(false);
    this.originMeters = { x: 0, y: 0, z: 0 };
    if (focusBodyName) {
      const target = this.engine.bodies.find((b) => b.name === focusBodyName);
      this.focusBodyId = target ? target.id : null;
      this.selectedBodyId = target ? target.id : null;
      if (target) {
        this.originMeters = { ...target.position };
      }
    } else {
      this.focusBodyId = null;
      this.selectedBodyId = null;
    }

    const dist = Math.max(distanceAU, 0.015) * SCENE_UNITS_PER_AU;
    this.controls.target.set(0, 0, 0);
    if (cameraAngles) {
      const az = (cameraAngles.azimuthDeg * Math.PI) / 180;
      const el = (cameraAngles.elevationDeg * Math.PI) / 180;
      const cosEl = Math.cos(el);
      this.camera.position.set(
        dist * cosEl * Math.sin(az),
        dist * Math.sin(el),
        dist * cosEl * Math.cos(az)
      );
    } else {
      this.camera.position.set(dist * 0.25, dist * 0.54, dist * 0.92);
    }
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  public enterSurfaceView(bodyId: string): boolean {
    const body = this.engine.getBody(bodyId);
    if (!body || body.category === 'star' || body.category === 'black_hole') return false;

    this.setSpawnMode(false, null, this.launchMode);
    this.cameraMode = 'surface';
    this.surfaceBodyId = bodyId;
    this.focusBodyId = bodyId;
    this.selectedBodyId = bodyId;
    this.originMeters = { ...body.position };
    this.controls.enabled = false;

    // Stand near the sunlit twilight limb with curved horizon cleanly framing the lower third!
    this.surfaceLon = 0.72;
    this.surfaceLat = 0.24;
    this.surfaceYaw = Math.PI * 0.55;
    this.surfacePitch = -0.34;

    this.callbacks.onCameraModeChange('surface', body.name);
    return true;
  }

  public cycleSurfaceSpot(): void {
    if (this.cameraMode !== 'surface') return;
    const body = this.engine.getBody(this.surfaceBodyId);
    const isEarth = body && (body.name.includes('地球') || body.auroraIntensity !== undefined);
    if (isEarth) {
      // Cycle between: twilight mid-lat -> Arctic Aurora night sky -> equatorial night -> Antarctic Aurora night sky
      if (this.surfaceLat < 0.6 && this.surfaceLat > -0.6 && this.surfaceLon < 2.2) {
        this.surfaceLat = 0.96; // ~55°N looking north into the glowing Borealis curtains!
        this.surfaceLon = Math.PI;
        this.surfaceYaw = Math.PI * 0.5;
        this.surfacePitch = 0.06;
      } else if (this.surfaceLat >= 0.6) {
        this.surfaceLat = -0.96; // ~55°S looking south into the glowing Australis curtains!
        this.surfaceLon = Math.PI;
        this.surfaceYaw = -Math.PI * 0.5;
        this.surfacePitch = 0.06;
      } else {
        this.surfaceLat = 0.24;
        this.surfaceLon = 0.72;
        this.surfaceYaw = Math.PI * 0.55;
        this.surfacePitch = -0.34;
      }
      return;
    }
    this.surfaceLon += Math.PI * 0.5;
  }

  public startCinematicTour(): void {
    if (this.engine.bodies.length === 0) return;
    this.setSpawnMode(false, null, this.launchMode);
    this.flightKeys.clear();
    this.flightVelocity.set(0, 0, 0);
    this.cameraMode = 'cinematic';
    this.surfaceBodyId = null;
    this.controls.enabled = false;
    this.camera.up.set(0, 1, 0);
    this.tourIndex = 0;
    this.tourElapsed = 0;
    this.tourAzimuth = Math.atan2(this.camera.position.z, this.camera.position.x);
    this.tourOriginOffset = { x: 0, y: 0, z: 0 };
    this.advanceCinematicTarget(true);
  }

  private getNearestVisualDistance(): { clearance: number; centerDist: number } {
    let minClearance = Infinity;
    let minCenterDist = Infinity;
    for (const b of this.engine.bodies) {
      if (!b.alive) continue;
      const vis = this.bodyRenderer.getVisual(b.id);
      if (!vis) continue;
      const dCenter = this.camera.position.distanceTo(vis.renderedPos);
      const effectiveR =
        b.galaxyType || b.nebulaType
          ? vis.renderedRadius * 9.5
          : Math.max(vis.renderedRadius, 0.25);
      const clearance = Math.max(0.05, dCenter - effectiveR);
      if (clearance < minClearance) minClearance = clearance;
      if (dCenter < minCenterDist) minCenterDist = dCenter;
    }
    return {
      clearance: Number.isFinite(minClearance) ? minClearance : 120,
      centerDist: Number.isFinite(minCenterDist) ? minCenterDist : 160,
    };
  }

  public startFreeFlight(): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.setSpawnMode(false, null, this.launchMode);
    this.cameraMode = 'flight';
    this.surfaceBodyId = null;
    this.focusBodyId = null;
    this.isDraggingSurface = false;
    this.isDraggingFlightLook = false;
    this.isDraggingFlightRoll = false;
    this.flightKeys.clear();
    this.flightVelocity.set(0, 0, 0);
    this.controls.enabled = false;

    const { clearance } = this.getNearestVisualDistance();
    if (clearance < 12) this.flightGearIndex = 1;
    else if (clearance < 60) this.flightGearIndex = 2;
    else if (clearance < 220) this.flightGearIndex = 3;
    else if (clearance < 700) this.flightGearIndex = 4;
    else this.flightGearIndex = 5;

    this.callbacks.onCameraModeChange('flight', null);
    this.callbacks.onFlightTelemetry?.(this.flightGearIndex, 0);
  }

  public shiftFlightGear(delta: 1 | -1): void {
    this.setFlightGear(this.flightGearIndex + delta);
  }

  public setFlightGear(index: number): void {
    this.flightGearIndex = Math.max(0, Math.min(FLIGHT_GEARS.length - 1, Math.round(index)));
    this.callbacks.onFlightTelemetry?.(this.flightGearIndex, this.flightVelocity.length());
  }

  public exitSpecialCameraMode(notify = true): void {
    if (this.cameraMode === 'orbit') return;
    const prevMode = this.cameraMode;
    const prevBodyId = this.surfaceBodyId ?? this.tourCurrentBodyId;
    this.cameraMode = 'orbit';
    this.surfaceBodyId = null;
    this.isDraggingSurface = false;
    this.isDraggingFlightLook = false;
    this.isDraggingFlightRoll = false;
    this.flightKeys.clear();
    this.flightVelocity.set(0, 0, 0);
    this.camera.up.set(0, 1, 0);
    this.controls.enabled = true;

    if (prevMode === 'director') {
      this.directorPlaying = false;
      const shouldStopRec = this.directorRecordOnPlay && this.videoRecorder.isRecording();
      this.directorRecordOnPlay = false;
      if (Math.abs(this.camera.fov - 48) > 0.05) {
        this.camera.fov = 48;
        this.camera.updateProjectionMatrix();
      }
      const { centerDist } = this.getNearestVisualDistance();
      const targetDist = THREE.MathUtils.clamp(centerDist * 0.75, 12, 280);
      this.flightForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      this.controls.target.copy(this.camera.position).addScaledVector(this.flightForward, targetDist);
      this.controls.update();
      if (shouldStopRec) {
        void this.stopVideoRecording();
      }
    } else if (prevMode === 'surface' && prevBodyId) {
      // Pull back gracefully to orbital view around the body we just lifted off from
      this.focusOnBody(prevBodyId, true);
    } else if (prevMode === 'flight') {
      const { centerDist } = this.getNearestVisualDistance();
      const targetDist = THREE.MathUtils.clamp(centerDist * 0.75, 24, 280);
      this.flightForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      this.controls.target.copy(this.camera.position).addScaledVector(this.flightForward, targetDist);
      this.controls.update();
    } else {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
    if (notify) {
      this.callbacks.onCameraModeChange('orbit', null);
    }
  }

  public captureCurrentKeyframe(name?: string): DirectorKeyframe {
    const alive = this.engine.bodies.filter((b) => b.alive);
    const anchorBody =
      (this.focusBodyId ? this.engine.getBody(this.focusBodyId) : null) ??
      (this.selectedBodyId ? this.engine.getBody(this.selectedBodyId) : null);

    const originMeters: Vec3 = anchorBody ? { ...anchorBody.position } : { ...this.originMeters };
    const relPos = new THREE.Vector3(
      (this.originMeters.x - originMeters.x) * METERS_TO_SCENE + this.camera.position.x,
      (this.originMeters.y - originMeters.y) * METERS_TO_SCENE + this.camera.position.y,
      (this.originMeters.z - originMeters.z) * METERS_TO_SCENE + this.camera.position.z
    );

    const pillars = alive.find((b) => b.nebulaType === 'pillars_of_creation');
    const andromeda = alive.find((b) => b.galaxyType === 'andromeda');
    const earth = alive.find((b) => b.name.includes('地球') || b.auroraIntensity !== undefined);
    const lens = alive.find((b) => b.isGravitationalLens);

    return {
      id: nextDirectorKeyframeId(),
      name: name ?? `机位`,
      durationSec: 4.5,
      holdSec: 0.4,
      easing: 'cinematicSlow',
      anchorBodyId: anchorBody?.id ?? null,
      anchorBodyName: anchorBody?.name ?? null,
      position: { x: relPos.x, y: relPos.y, z: relPos.z },
      originMeters,
      quaternion: [
        this.camera.quaternion.x,
        this.camera.quaternion.y,
        this.camera.quaternion.z,
        this.camera.quaternion.w,
      ],
      fov: Math.round(this.camera.fov * 10) / 10,
      timeScale: Math.max(1, this.engine.timeScale),
      ...(pillars
        ? {
            nebulaSpectrumMode: pillars.nebulaSpectrumMode,
            nebulaIrPenetration: pillars.nebulaIrPenetration,
          }
        : {}),
      ...(andromeda
        ? {
            galaxySpectrumMode: andromeda.galaxySpectrumMode,
            galaxyDustOpacity: andromeda.galaxyDustOpacity,
          }
        : {}),
      ...(earth && earth.auroraIntensity !== undefined
        ? { auroraIntensity: earth.auroraIntensity }
        : {}),
      ...(lens && lens.lensShear !== undefined ? { lensShear: lens.lensShear } : {}),
    };
  }

  public previewDirectorKeyframe(kf: DirectorKeyframe): void {
    this.exitSpecialCameraMode(false);
    this.cameraMode = 'orbit';
    this.surfaceBodyId = null;
    this.controls.enabled = true;

    const anchor = resolveKeyframeAnchorMeters(kf, this.engine.bodies);
    const matchedAnchor =
      (kf.anchorBodyId ? this.engine.getBody(kf.anchorBodyId) : null) ??
      (kf.anchorBodyName
        ? this.engine.bodies.find((b) => b.alive && b.name === kf.anchorBodyName) ?? null
        : null);
    this.focusBodyId = matchedAnchor?.id ?? null;
    this.originMeters = { ...anchor };

    this.camera.position.set(kf.position.x, kf.position.y, kf.position.z);
    this.camera.quaternion.set(...kf.quaternion).normalize();
    this.camera.up.set(0, 1, 0);
    if (Math.abs(this.camera.fov - kf.fov) > 0.05) {
      this.camera.fov = kf.fov;
      this.camera.updateProjectionMatrix();
    }
    this.engine.timeScale = Math.max(1, kf.timeScale);
    this.applyDirectorAstroPatch(kf);

    const { centerDist } = this.getNearestVisualDistance();
    const targetDist = THREE.MathUtils.clamp(centerDist * 0.85, 2, 320);
    this.flightForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    this.controls.target.copy(this.camera.position).addScaledVector(this.flightForward, targetDist);
    this.controls.update();
    this.callbacks.onCameraModeChange('orbit', null);
  }

  public generateScenarioStoryboard(scenarioId: string): DirectorKeyframe[] {
    return buildScenarioStoryboard(
      scenarioId,
      this.engine.bodies,
      this.camera.position,
      this.originMeters,
      this.focusBodyId,
      this.engine.timeScale
    );
  }

  public setDirectorKeyframes(keyframes: DirectorKeyframe[]): void {
    this.directorKeyframes = keyframes;
  }

  public startDirectorPlayback(
    keyframes: DirectorKeyframe[],
    options: {
      loop?: boolean;
      startTimeSec?: number;
      record?: {
        format: DirectorVideoFormat;
        resolution: DirectorResolution;
        fps: DirectorFps;
        includeAudio: boolean;
        filenamePrefix: string;
      };
    } = {}
  ): boolean {
    if (keyframes.length < 2) return false;
    this.exitSpecialCameraMode(false);
    this.setSpawnMode(false, null, this.launchMode);
    this.flightKeys.clear();
    this.flightVelocity.set(0, 0, 0);

    const total = computeDirectorTotalDuration(keyframes);
    this.directorKeyframes = keyframes;
    this.directorTimeSec = Math.max(0, Math.min(options.startTimeSec ?? 0, Math.max(0, total - 0.01)));
    this.directorPlaying = true;
    this.directorLoop = Boolean(options.loop) && !options.record;
    this.directorRecordOnPlay = Boolean(options.record);
    this.cameraMode = 'director';
    this.surfaceBodyId = null;
    this.focusBodyId = null;
    this.controls.enabled = false;

    this.applyDirectorSample(this.directorTimeSec);

    if (options.record) {
      const ok = this.beginCanvasRecording(options.record);
      if (!ok) {
        this.directorPlaying = false;
        this.directorRecordOnPlay = false;
        this.exitSpecialCameraMode(true);
        return false;
      }
    }

    this.callbacks.onCameraModeChange('director', null);
    const activeSample = sampleDirectorPose(
      this.directorKeyframes,
      this.directorTimeSec,
      this.engine.bodies
    );
    this.callbacks.onDirectorTelemetry?.(
      this.directorTimeSec,
      total,
      activeSample.activeIndex,
      true
    );
    return true;
  }

  public pauseDirectorPlayback(): void {
    if (this.cameraMode !== 'director') return;
    this.directorPlaying = false;
    const total = computeDirectorTotalDuration(this.directorKeyframes);
    const sample = sampleDirectorPose(this.directorKeyframes, this.directorTimeSec, this.engine.bodies);
    this.callbacks.onDirectorTelemetry?.(this.directorTimeSec, total, sample.activeIndex, false);
  }

  public resumeDirectorPlayback(): void {
    if (this.cameraMode !== 'director' || this.directorKeyframes.length < 2) return;
    const total = computeDirectorTotalDuration(this.directorKeyframes);
    if (this.directorTimeSec >= total - 0.02) {
      this.directorTimeSec = 0;
    }
    this.directorPlaying = true;
    const sample = sampleDirectorPose(this.directorKeyframes, this.directorTimeSec, this.engine.bodies);
    this.callbacks.onDirectorTelemetry?.(this.directorTimeSec, total, sample.activeIndex, true);
  }

  public seekDirectorTime(timeSec: number, keyframes?: DirectorKeyframe[]): void {
    if (keyframes) {
      this.directorKeyframes = keyframes;
    }
    if (this.directorKeyframes.length === 0) return;
    const total = computeDirectorTotalDuration(this.directorKeyframes);
    this.directorTimeSec = Math.max(0, Math.min(timeSec, total));
    if (this.cameraMode !== 'director') {
      this.exitSpecialCameraMode(false);
      this.cameraMode = 'director';
      this.directorPlaying = false;
      this.directorRecordOnPlay = false;
      this.controls.enabled = false;
      this.callbacks.onCameraModeChange('director', null);
    }
    const sample = this.applyDirectorSample(this.directorTimeSec);
    this.callbacks.onDirectorTelemetry?.(
      this.directorTimeSec,
      total,
      sample.activeIndex,
      this.directorPlaying
    );
  }

  public startFreeRecording(opts: {
    format: DirectorVideoFormat;
    resolution: DirectorResolution;
    fps: DirectorFps;
    includeAudio: boolean;
    filenamePrefix: string;
  }): boolean {
    if (this.videoRecorder.isRecording()) return false;
    this.directorRecordOnPlay = false;
    return this.beginCanvasRecording(opts);
  }

  public async stopVideoRecording(): Promise<DirectorRecordingResult | null> {
    this.directorRecordOnPlay = false;
    const result = await this.videoRecorder.stop();
    this.unlockRecordingResolution();
    this.callbacks.onRecordingStateChange?.(
      false,
      0,
      result ?? undefined,
      undefined,
      result?.format ?? this.recordingActualFormat,
      result?.fallbackFrom
    );
    return result;
  }

  public isVideoRecording(): boolean {
    return this.videoRecorder.isRecording();
  }

  private beginCanvasRecording(opts: {
    format: DirectorVideoFormat;
    resolution: DirectorResolution;
    fps: DirectorFps;
    includeAudio: boolean;
    filenamePrefix: string;
  }): boolean {
    const { width, height } = this.lockRecordingResolution(opts.resolution, opts.format);
    const audioStream = opts.includeAudio ? cosmosAudio.getMediaStream() : null;
    try {
      const { actualFormat, fallbackFrom } = this.videoRecorder.start({
        canvas: this.renderer.domElement,
        format: opts.format,
        fps: opts.fps,
        width,
        height,
        filenamePrefix: opts.filenamePrefix,
        audioStream,
      });
      this.recordingActualFormat = actualFormat;
      this.callbacks.onRecordingStateChange?.(true, 0, undefined, undefined, actualFormat, fallbackFrom);
      return true;
    } catch (err) {
      this.unlockRecordingResolution();
      const msg = err instanceof Error ? err.message : '启动视频录制失败';
      this.callbacks.onRecordingStateChange?.(false, 0, undefined, msg);
      return false;
    }
  }

  private lockRecordingResolution(
    resolution: DirectorResolution,
    format: DirectorVideoFormat
  ): { width: number; height: number } {
    const dom = this.renderer.domElement;
    let width = resolution === '1080p' ? 1920 : 1280;
    let height = resolution === '1080p' ? 1080 : 720;

    if (resolution === 'viewport') {
      const needsEven = format === 'mp4' && (dom.width % 2 !== 0 || dom.height % 2 !== 0);
      if (!needsEven) {
        return { width: dom.width, height: dom.height };
      }
      width = Math.max(2, dom.width - (dom.width % 2));
      height = Math.max(2, dom.height - (dom.height % 2));
    }

    this.recordingSizeLock = { width, height };
    dom.style.objectFit = 'contain';
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(Math.floor(width / 2), Math.floor(height / 2));
    if (this.graphicsQuality === 'fast') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
    return { width, height };
  }

  private unlockRecordingResolution(): void {
    if (!this.recordingSizeLock) return;
    this.recordingSizeLock = null;
    this.renderer.domElement.style.objectFit = '';
    this.setGraphicsQuality(this.graphicsQuality);
    this.handleResize();
  }

  private applyDirectorAstroPatch(patch: DirectorAstroPatch): void {
    if (
      patch.nebulaSpectrumMode !== undefined ||
      patch.nebulaIrPenetration !== undefined
    ) {
      const pillars = this.engine.bodies.find(
        (b) => b.alive && b.nebulaType === 'pillars_of_creation'
      );
      if (pillars) {
        if (patch.nebulaSpectrumMode !== undefined) {
          pillars.nebulaSpectrumMode = patch.nebulaSpectrumMode;
        }
        if (patch.nebulaIrPenetration !== undefined) {
          pillars.nebulaIrPenetration = patch.nebulaIrPenetration;
        }
      }
    }
    if (
      patch.galaxySpectrumMode !== undefined ||
      patch.galaxyDustOpacity !== undefined
    ) {
      const andromeda = this.engine.bodies.find(
        (b) => b.alive && b.galaxyType === 'andromeda'
      );
      if (andromeda) {
        if (patch.galaxySpectrumMode !== undefined) {
          andromeda.galaxySpectrumMode = patch.galaxySpectrumMode;
        }
        if (patch.galaxyDustOpacity !== undefined) {
          andromeda.galaxyDustOpacity = patch.galaxyDustOpacity;
        }
      }
    }
    if (patch.auroraIntensity !== undefined) {
      const earth = this.engine.bodies.find(
        (b) => b.alive && (b.name.includes('地球') || b.auroraIntensity !== undefined)
      );
      if (earth) {
        earth.auroraIntensity = patch.auroraIntensity;
      }
    }
    if (patch.lensShear !== undefined) {
      const lens = this.engine.bodies.find((b) => b.alive && b.isGravitationalLens);
      if (lens) {
        lens.lensShear = patch.lensShear;
      }
    }
  }

  private applyDirectorSample(timeSec: number) {
    const sample = sampleDirectorPose(this.directorKeyframes, timeSec, this.engine.bodies);
    this.originMeters = { ...sample.originMeters };
    this.camera.position.copy(sample.position);
    this.camera.quaternion.copy(sample.quaternion);
    if (Math.abs(this.camera.fov - sample.fov) > 0.05) {
      this.camera.fov = sample.fov;
      this.camera.updateProjectionMatrix();
    }
    this.engine.timeScale = sample.timeScale;
    this.applyDirectorAstroPatch(sample.astroPatch);
    return sample;
  }

  private updateDirectorCamera(dt: number): void {
    if (this.directorKeyframes.length === 0) {
      this.exitSpecialCameraMode(true);
      return;
    }
    const total = computeDirectorTotalDuration(this.directorKeyframes);
    if (this.directorPlaying) {
      this.directorTimeSec += dt;
    }
    const sample = sampleDirectorPose(
      this.directorKeyframes,
      this.directorTimeSec,
      this.engine.bodies
    );
    if (sample.finished && this.directorPlaying) {
      if (this.directorLoop && !this.directorRecordOnPlay && total > 0) {
        this.directorTimeSec = 0;
        this.applyDirectorSample(0);
        return;
      }
      this.directorTimeSec = total;
      this.applyDirectorSample(total);
      this.directorPlaying = false;
      const wasRec = this.directorRecordOnPlay && this.videoRecorder.isRecording();
      this.directorRecordOnPlay = false;
      this.callbacks.onDirectorTelemetry?.(total, total, sample.activeIndex, false);
      this.callbacks.onDirectorFinished?.(wasRec);
      if (wasRec) {
        void this.stopVideoRecording();
        this.exitSpecialCameraMode(true);
      }
      return;
    }
    this.applyDirectorSample(this.directorTimeSec);
  }

  private getCinematicPlaylist(): CelestialBody[] {
    const alive = this.engine.bodies.filter((b) => b.alive);
    const priority = (b: CelestialBody) => {
      if (b.category === 'black_hole') return 10;
      if (b.category === 'comet') return 9;
      if (b.name.includes('地球') || b.name.includes('三体行星')) return 8;
      if (b.hasRings) return 7;
      if (b.category === 'star') return 6;
      if (b.category === 'neutron_star') return 6;
      if (b.category === 'gas_giant') return 5;
      if (b.category === 'moon') return 4;
      return 3;
    };
    return [...alive].sort((a, b) => priority(b) - priority(a)).slice(0, 6);
  }

  private advanceCinematicTarget(immediate = false): void {
    const playlist = this.getCinematicPlaylist();
    if (playlist.length === 0) {
      this.exitSpecialCameraMode(true);
      return;
    }
    const body = playlist[this.tourIndex % playlist.length];
    this.tourCurrentBodyId = body.id;
    this.focusBodyId = body.id;
    this.selectedBodyId = body.id;

    if (immediate) {
      this.originMeters = { ...body.position };
      this.tourOriginOffset = { x: 0, y: 0, z: 0 };
    } else {
      // Smoothly decay offset from previous world anchor to the new moving body (zero velocity lag!)
      this.tourOriginOffset = {
        x: this.originMeters.x - body.position.x,
        y: this.originMeters.y - body.position.y,
        z: this.originMeters.z - body.position.z,
      };
    }
    this.callbacks.onCameraModeChange('cinematic', body.name);
  }

  private updateSurfaceCamera(): void {
    const body = this.engine.getBody(this.surfaceBodyId);
    if (!body) {
      this.exitSpecialCameraMode(true);
      return;
    }
    const vis = this.bodyRenderer.getVisual(body.id);
    const r = vis ? Math.max(vis.renderedRadius, 0.12) : 0.8;

    // Follow planet center at floating origin (0, 0, 0)
    this.originMeters.x = body.position.x;
    this.originMeters.y = body.position.y;
    this.originMeters.z = body.position.z;

    // Anchor longitude cleanly relative to the sunlit star (or parent planet for moons) so you ALWAYS
    // start on the breathtaking sunlit twilight horizon looking out over the curved planet + sky!
    const star = this.engine.bodies.find((b) => b.alive && b.category === 'star') ?? null;
    const parent = body.parentId ? this.engine.getBody(body.parentId) : null;
    const refBody = star ?? parent;

    let baseAngle = 0;
    if (refBody && refBody.id !== body.id) {
      baseAngle = Math.atan2(refBody.position.z - body.position.z, refBody.position.x - body.position.x);
    }

    const lon = baseAngle + this.surfaceLon;
    const cosLat = Math.cos(this.surfaceLat);
    const localNormal = new THREE.Vector3(
      cosLat * Math.cos(lon),
      Math.sin(this.surfaceLat),
      cosLat * Math.sin(lon)
    ).normalize();

    const refAxis = Math.abs(localNormal.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const east = new THREE.Vector3().crossVectors(refAxis, localNormal).normalize();
    const north = new THREE.Vector3().crossVectors(localNormal, east).normalize();

    // ISS / low-orbit vista altitude (1.22x radius): curved sunlit planet & atmosphere fill lower third!
    const altitude = r * (body.category === 'gas_giant' || body.category === 'ice_giant' ? 1.28 : 1.22);
    this.camera.position.copy(localNormal).multiplyScalar(altitude);
    this.camera.up.copy(localNormal);

    const cosP = Math.cos(this.surfacePitch);
    const sinP = Math.sin(this.surfacePitch);
    const horiz = east
      .clone()
      .multiplyScalar(Math.cos(this.surfaceYaw))
      .addScaledVector(north, Math.sin(this.surfaceYaw));
    const lookDir = horiz.multiplyScalar(cosP).addScaledVector(localNormal, sinP).normalize();

    const lookTarget = this.camera.position.clone().addScaledVector(lookDir, 10);
    this.camera.lookAt(lookTarget);
  }

  private updateCinematicCamera(dt: number): void {
    this.tourElapsed += dt;
    if (this.tourElapsed >= this.tourDurationPerStop) {
      this.tourElapsed = 0;
      this.tourIndex++;
      this.advanceCinematicTarget(false);
    }

    const body = this.engine.getBody(this.tourCurrentBodyId);
    if (!body) {
      this.advanceCinematicTarget(false);
      return;
    }

    // Decay transition offset to 0 while riding the target body's EXACT real-time position (zero lag!)
    const decay = Math.exp(-dt * 2.6);
    this.tourOriginOffset.x *= decay;
    this.tourOriginOffset.y *= decay;
    this.tourOriginOffset.z *= decay;

    this.originMeters.x = body.position.x + this.tourOriginOffset.x;
    this.originMeters.y = body.position.y + this.tourOriginOffset.y;
    this.originMeters.z = body.position.z + this.tourOriginOffset.z;

    const vis = this.bodyRenderer.getVisual(body.id);
    const r = vis ? Math.max(vis.renderedRadius, 0.25) : 2.0;
    const desiredDist =
      body.category === 'black_hole'
        ? r * 14.0
        : body.category === 'comet'
          ? Math.max(r * 28, 56)
          : body.hasRings
            ? r * 5.0
            : r * 3.5;

    this.tourAzimuth += dt * 0.16;
    const elev = 0.26 + Math.sin(this.tourElapsed * 0.45) * 0.1;
    const desiredPos = new THREE.Vector3(
      Math.cos(this.tourAzimuth) * Math.cos(elev) * desiredDist,
      Math.sin(elev) * desiredDist,
      Math.sin(this.tourAzimuth) * Math.cos(elev) * desiredDist
    );

    const camLerp = 1 - Math.exp(-dt * 2.4);
    this.camera.position.lerp(desiredPos, camLerp);
    this.camera.lookAt(0, 0, 0);
  }

  private updateFlightCamera(dt: number): void {
    const keys = this.flightKeys;
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const u = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    const braking = keys.has('KeyX');
    const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');

    const maxSpeed = FLIGHT_GEARS[this.flightGearIndex] * (boosting ? 3.0 : 1.0);
    const hasThrust = !braking && (f !== 0 || s !== 0 || u !== 0);

    if (braking) {
      this.flightVelocity.multiplyScalar(Math.exp(-dt * 14.0));
      if (this.flightVelocity.lengthSq() < 1e-6) this.flightVelocity.set(0, 0, 0);
    } else if (hasThrust) {
      this.flightForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      this.flightRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
      this.flightUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

      this.flightThrustVec
        .set(0, 0, 0)
        .addScaledVector(this.flightForward, f)
        .addScaledVector(this.flightRight, s)
        .addScaledVector(this.flightUp, u)
        .normalize()
        .multiplyScalar(maxSpeed);

      const accelAlpha = 1 - Math.exp(-dt * 6.0);
      this.flightVelocity.lerp(this.flightThrustVec, accelAlpha);
    } else {
      this.flightVelocity.multiplyScalar(Math.exp(-dt * 4.2));
      if (this.flightVelocity.lengthSq() < 1e-6) this.flightVelocity.set(0, 0, 0);
    }

    this.camera.position.addScaledVector(this.flightVelocity, dt);

    // Floating-origin rebase keeps infinite deep-space flight free of float32 jitter
    if (this.camera.position.length() > 8000) {
      this.originMeters.x += this.camera.position.x * SCENE_TO_METERS;
      this.originMeters.y += this.camera.position.y * SCENE_TO_METERS;
      this.originMeters.z += this.camera.position.z * SCENE_TO_METERS;
      this.camera.position.set(0, 0, 0);
      this.focusBodyId = null;
    }
  }

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.graphicsQuality = quality;
    const width = this.recordingSizeLock?.width ?? (this.container.clientWidth || window.innerWidth);
    const height = this.recordingSizeLock?.height ?? (this.container.clientHeight || window.innerHeight);
    const dpr = this.recordingSizeLock
      ? 1
      : quality === 'fast'
        ? 1
        : Math.min(window.devicePixelRatio, 1.25);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, !this.recordingSizeLock);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(
      Math.max(1, Math.floor(width / 2)),
      Math.max(1, Math.floor(height / 2))
    );
  }

  public captureScreenshot(): void {
    if (this.graphicsQuality === 'fast') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = dataUrl;
    a.download = `CosmosBox-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  public focusOnBody(id: string | null, zoomCloser = false): void {
    this.focusBodyId = id;
    if (!id) return;
    const body = this.engine.getBody(id);
    if (!body) return;

    this.originMeters = { ...body.position };
    this.controls.target.set(0, 0, 0);

    if (zoomCloser) {
      const vis = this.bodyRenderer.getVisual(id);
      const r = vis ? Math.max(vis.renderedRadius, 0.12) : 2;
      const mult = body.galaxyType === 'andromeda'
        ? 18.0
        : body.galaxyType === 'dwarf_elliptical_compact'
          ? 12.5
          : body.galaxyType === 'dwarf_elliptical_diffuse'
            ? 11.0
            : body.nebulaType === 'pillars_of_creation'
              ? 18.0
              : body.nebulaType === 'ngc6611_cluster'
                ? 14.0
                : body.isGravitationalLens
                  ? 34.0
              : body.isLensSource
                ? 6.2
                : body.hasRings
                  ? 5.0
                  : body.category === 'black_hole'
                    ? 14.5
                    : 3.2;
      const desiredDist = Math.max(r * mult, this.scaleMode === 'real' ? r * 3.8 : 2.6);
      const dir = new THREE.Vector3();
      const srcBody = body.isGravitationalLens
        ? this.engine.bodies.find((b) => b.alive && b.isLensSource)
        : undefined;
      if (srcBody) {
        dir.set(
          body.position.x - srcBody.position.x,
          body.position.y - srcBody.position.y,
          body.position.z - srcBody.position.z
        );
      }
      if (dir.lengthSq() < 1e-6) {
        dir.copy(this.camera.position);
      }
      if (dir.lengthSq() < 0.01) dir.set(0.35, 0.28, 0.89);
      dir.normalize();
      this.camera.position.copy(dir.multiplyScalar(desiredDist));
    }
    this.controls.update();
  }

  public setAndromedaViewPreset(preset: 'earth' | 'face_on' | 'edge_on' | 'core'): void {
    const m31 = this.engine.bodies.find((b) => b.alive && b.galaxyType === 'andromeda');
    if (!m31) return;

    this.focusBodyId = m31.id;
    this.selectedBodyId = m31.id;
    this.originMeters = { ...m31.position };
    this.controls.target.set(0, 0, 0);

    const galQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.0, -0.56, 'ZYX'));
    if (preset === 'earth') {
      this.camera.position.set(0, 0, 243);
    } else if (preset === 'face_on') {
      this.camera.position.copy(
        new THREE.Vector3(0, 1, 0.04).normalize().applyQuaternion(galQuat).multiplyScalar(255)
      );
    } else if (preset === 'edge_on') {
      this.camera.position.copy(
        new THREE.Vector3(0, 0.025, 1).normalize().applyQuaternion(galQuat).multiplyScalar(245)
      );
    } else {
      this.camera.position.copy(
        new THREE.Vector3(0.14, 0.42, 0.89).normalize().applyQuaternion(galQuat).multiplyScalar(52)
      );
    }
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  public setPillarsViewPreset(preset: 'classic' | 'canyon' | 'muse_side' | 'tips'): void {
    const pillars = this.engine.bodies.find((b) => b.alive && b.nebulaType === 'pillars_of_creation');
    if (!pillars) return;

    this.focusBodyId = pillars.id;
    this.selectedBodyId = pillars.id;
    this.originMeters = { ...pillars.position };

    if (preset === 'classic') {
      this.controls.target.set(2, -10, 0);
      this.camera.position.set(2, -6, 268);
    } else if (preset === 'canyon') {
      this.controls.target.set(12, 8, 0);
      this.camera.position.set(-14, -30, 96);
    } else if (preset === 'muse_side') {
      this.controls.target.set(0, -8, 4);
      this.camera.position.set(232, 12, 28);
    } else {
      this.controls.target.set(30, 32, 4);
      this.camera.position.set(14, 30, 98);
    }
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  public setSpawnMode(active: boolean, template: SpawnTemplate | null, mode: LaunchMode): void {
    this.spawnActive = active;
    this.spawnTemplate = template;
    this.launchMode = mode;
    this.isDraggingSlingshot = false;
    this.dragStartWorldMeters = null;

    if (!active) {
      this.spawnPlaneGrid.visible = false;
      this.ghostSphere.visible = false;
      this.predictionLine.visible = false;
      this.slingshotArrow.visible = false;
      this.controls.enabled = true;
    } else {
      this.spawnPlaneGrid.visible = true;
    }
  }

  private createStarfield(): THREE.Points {
    const count = 12000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // Realistic stellar spectral classes (O/B blue, A white, F/G cream, K amber, M orange)
    const palette = [
      new THREE.Color('#9ec4ff'),
      new THREE.Color('#cce0ff'),
      new THREE.Color('#f4f7ff'),
      new THREE.Color('#fff2d6'),
      new THREE.Color('#ffd3a1'),
      new THREE.Color('#ffb578'),
    ];

    const gUp = new THREE.Vector3(0.28, 0.86, -0.42).normalize();
    const gRight = new THREE.Vector3(1, 0, 0).cross(gUp).normalize();
    const gFwd = new THREE.Vector3().crossVectors(gUp, gRight).normalize();
    const tmp = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      let dir: THREE.Vector3;
      if (Math.random() < 0.42) {
        const theta = Math.random() * Math.PI * 2;
        const lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.22;
        dir = tmp
          .copy(gRight)
          .multiplyScalar(Math.cos(theta) * Math.cos(lat))
          .addScaledVector(gFwd, Math.sin(theta) * Math.cos(lat))
          .addScaledVector(gUp, Math.sin(lat))
          .normalize();
      } else {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        dir = tmp.set(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );
      }

      const r = 18000 + Math.random() * 14000;
      positions[i * 3] = dir.x * r;
      positions[i * 3 + 1] = dir.y * r;
      positions[i * 3 + 2] = dir.z * r;

      const c = palette[Math.floor(Math.random() * palette.length)];
      const mag = Math.pow(Math.random(), 4.0);
      // Capped <= 0.94 below UnrealBloomPass 0.98 threshold so skybox stars never clip into square bloom boxes
      const lum = 0.22 + mag * 0.72;
      colors[i * 3] = c.r * lum;
      colors[i * 3 + 1] = c.g * lum;
      colors[i * 3 + 2] = c.b * lum;
      sizes[i] = 1.0 + mag * 3.4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 color;
        uniform float uPixelRatio;
        varying vec3 vColor;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d2 = dot(uv, uv) * 4.0;
          if (d2 > 1.0) discard;
          float core = (1.0 - d2);
          float alpha = core * core;
          vec3 col = mix(vColor, vec3(1.0), alpha * 0.4);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  public spawnKilonovaFX(event: KilonovaEvent): void {
    // Launch expanding spacetime gravitational wave ringdown burst!
    this.spacetimeGrid.triggerMergerWave(event.position);

    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 72);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(event.isBlackHoleMerger ? '#a87bff' : '#5ceeff'),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.scene.add(ringMesh);

    this.shockwaves.push({
      mesh: ringMesh,
      worldPosMeters: { ...event.position },
      age: 0,
      maxAge: 3.4,
      maxScale: 240,
      isSphere: false,
    });

    if (!event.isBlackHoleMerger) {
      // Kilonova blue-violet Fresnel plasma flash shell!
      const shellGeo = new THREE.SphereGeometry(1, 48, 32);
      const shellMat = new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: 1.0 },
          uColorInner: { value: new THREE.Color('#66f0ff') },
          uColorRim: { value: new THREE.Color('#b05cff') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormalWorld;
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            vNormalWorld = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform vec3 uColorInner;
          uniform vec3 uColorRim;
          varying vec3 vNormalWorld;
          varying vec3 vWorldPos;
          void main() {
            vec3 N = normalize(vNormalWorld);
            vec3 V = normalize(cameraPosition - vWorldPos);
            float rim = pow(1.0 - abs(dot(N, V)), 2.0);
            vec3 col = mix(uColorInner, uColorRim, rim) * 1.75;
            gl_FragColor = vec4(col, clamp((0.12 + rim * 1.45) * uOpacity, 0.0, 0.95));
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const shellMesh = new THREE.Mesh(shellGeo, shellMat);
      this.scene.add(shellMesh);

      this.shockwaves.push({
        mesh: shellMesh,
        worldPosMeters: { ...event.position },
        age: 0,
        maxAge: 2.9,
        maxScale: 165,
        isSphere: true,
      });
    }
  }

  public spawnSupernovaFX(event: SupernovaEvent): void {
    // Hollow Fresnel volumetric supernova blast shell (translucent center so pulsar remnant shines through!)
    const shellGeo = new THREE.SphereGeometry(1, 48, 32);
    const shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1.0 },
        uColorInner: { value: new THREE.Color('#7de2ff') },
        uColorRim: { value: new THREE.Color('#ff6ec7') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormalWorld;
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalWorld = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uColorInner;
        uniform vec3 uColorRim;
        varying vec3 vNormalWorld;
        varying vec3 vWorldPos;
        void main() {
          vec3 N = normalize(vNormalWorld);
          vec3 V = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - abs(dot(N, V)), 2.2);
          float glow = 0.08 + rim * 1.45;
          vec3 col = mix(uColorInner, uColorRim, rim) * 1.6;
          gl_FragColor = vec4(col, clamp(glow * uOpacity, 0.0, 0.95));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    this.scene.add(shellMesh);

    this.shockwaves.push({
      mesh: shellMesh,
      worldPosMeters: { ...event.position },
      age: 0,
      maxAge: 2.8,
      maxScale: 155,
      isSphere: true,
    });

    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 72);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff8cd2'),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.scene.add(ringMesh);

    this.shockwaves.push({
      mesh: ringMesh,
      worldPosMeters: { ...event.position },
      age: 0,
      maxAge: 3.1,
      maxScale: 205,
      isSphere: false,
    });
  }

  private spawnShockwave(event: CollisionEvent): void {
    const geo = new THREE.RingGeometry(0.75, 1.0, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(event.color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);

    const visualScale = Math.max(
      event.catastrophic ? 18 : 8,
      Math.min(55, Math.log10(Math.max(event.impactEnergy, 1e20)) * 0.9)
    );
    this.shockwaves.push({
      mesh,
      worldPosMeters: { ...event.position },
      age: 0,
      maxAge: event.catastrophic ? 1.8 : 1.35,
      maxScale: visualScale,
    });
  }

  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const fx = this.shockwaves[i];
      fx.age += dt;
      if (fx.age >= fx.maxAge) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        (fx.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const p = fx.age / fx.maxAge;
      const eased = 1 - Math.pow(1 - p, 3);
      fx.mesh.position.set(
        (fx.worldPosMeters.x - this.originMeters.x) * METERS_TO_SCENE,
        (fx.worldPosMeters.y - this.originMeters.y) * METERS_TO_SCENE,
        (fx.worldPosMeters.z - this.originMeters.z) * METERS_TO_SCENE
      );
      if (!fx.isSphere) {
        fx.mesh.quaternion.copy(this.camera.quaternion);
      }
      fx.mesh.scale.setScalar(0.5 + eased * fx.maxScale);
      const nextAlpha = Math.pow(1 - p, 1.5) * 0.9;
      if (fx.mesh.material instanceof THREE.ShaderMaterial && fx.mesh.material.uniforms.uOpacity) {
        fx.mesh.material.uniforms.uOpacity.value = nextAlpha;
      } else {
        (fx.mesh.material as THREE.MeshBasicMaterial).opacity = nextAlpha;
      }
    }
  }

  private raycastOrbitalPlane(clientX: number, clientY: number): Vec3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;

    // Clamp to reasonable spawn distance so rays near the horizon don't shoot to infinity
    const maxSceneR = Math.max(2500, this.camera.position.length() * 3.5);
    if (hit.length() > maxSceneR) {
      hit.setLength(maxSceneR);
    }

    return {
      x: this.originMeters.x + hit.x * SCENE_TO_METERS,
      y: this.originMeters.y + hit.y * SCENE_TO_METERS,
      z: this.originMeters.z + hit.z * SCENE_TO_METERS,
    };
  }

  private computeCandidateVelocity(spawnPos: Vec3): Vec3 {
    const focusBody = this.engine.getBody(this.focusBodyId);
    const primary = focusBody ?? findDominantBody(this.engine.bodies, spawnPos);

    if (this.launchMode === 'stationary') {
      return primary ? { ...primary.velocity } : { x: 0, y: 0, z: 0 };
    }

    if (this.launchMode === 'orbit') {
      return computeCircularOrbitVelocity(spawnPos, primary);
    }

    // Slingshot mode: velocity proportional to pull-back vector from anchor
    if (this.isDraggingSlingshot && this.dragStartWorldMeters && this.hoverWorldMeters) {
      const dx = this.dragStartWorldMeters.x - this.hoverWorldMeters.x;
      const dy = this.dragStartWorldMeters.y - this.hoverWorldMeters.y;
      const dz = this.dragStartWorldMeters.z - this.hoverWorldMeters.z;
      // Scale pull distance to natural astronomical speed (~30 km/s per 0.6 AU pull)
      const speedPerMeter = 52000 / AU;
      const baseVel = primary ? primary.velocity : { x: 0, y: 0, z: 0 };
      return {
        x: baseVel.x + dx * speedPerMeter,
        y: baseVel.y + dy * speedPerMeter,
        z: baseVel.z + dz * speedPerMeter,
      };
    }

    return computeCircularOrbitVelocity(spawnPos, primary);
  }

  private updateSpawnPreview(): void {
    if (!this.spawnActive || !this.spawnTemplate) return;

    // Keep reference grid scaled comfortably to camera distance
    const camDist = this.camera.position.length();
    const gridScale = Math.max(0.2, Math.min(18, camDist / 450));
    this.spawnPlaneGrid.scale.setScalar(gridScale);
    this.spawnPlaneGrid.position.set(0, 0, 0);

    const anchorPos = this.isDraggingSlingshot ? this.dragStartWorldMeters : this.hoverWorldMeters;
    if (!anchorPos) {
      this.ghostSphere.visible = false;
      this.predictionLine.visible = false;
      this.slingshotArrow.visible = false;
      return;
    }

    const sx = (anchorPos.x - this.originMeters.x) * METERS_TO_SCENE;
    const sy = (anchorPos.y - this.originMeters.y) * METERS_TO_SCENE;
    const sz = (anchorPos.z - this.originMeters.z) * METERS_TO_SCENE;

    this.ghostSphere.visible = true;
    this.ghostSphere.position.set(sx, sy, sz);
    const ghostR = Math.max(1.0, camDist * 0.012);
    this.ghostSphere.scale.setScalar(ghostR);
    (this.ghostSphere.material as THREE.MeshBasicMaterial).color.set(
      this.spawnTemplate.category === 'black_hole' ? '#ff8c42' : this.spawnTemplate.color
    );

    const candidateVel = this.computeCandidateVelocity(anchorPos);

    // Predict curved orbital path (reuse pre-allocated GPU buffer, zero per-frame allocations!)
    const pts = predictTrajectory(
      this.engine.bodies,
      anchorPos,
      candidateVel,
      this.spawnTemplate.mass,
      120
    );

    const count = Math.min(pts.length, 200);
    for (let i = 0; i < count; i++) {
      this.predictionBuffer[i * 3] = (pts[i].x - this.originMeters.x) * METERS_TO_SCENE;
      this.predictionBuffer[i * 3 + 1] = (pts[i].y - this.originMeters.y) * METERS_TO_SCENE;
      this.predictionBuffer[i * 3 + 2] = (pts[i].z - this.originMeters.z) * METERS_TO_SCENE;
    }
    this.predictionLine.geometry.setDrawRange(0, count);
    (this.predictionLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.predictionLine.visible = count > 1;

    // Slingshot vector indicator
    if (this.isDraggingSlingshot && this.dragStartWorldMeters && this.hoverWorldMeters) {
      const pullX = (this.hoverWorldMeters.x - this.originMeters.x) * METERS_TO_SCENE;
      const pullY = (this.hoverWorldMeters.y - this.originMeters.y) * METERS_TO_SCENE;
      const pullZ = (this.hoverWorldMeters.z - this.originMeters.z) * METERS_TO_SCENE;
      this.slingshotBuffer[0] = pullX;
      this.slingshotBuffer[1] = pullY;
      this.slingshotBuffer[2] = pullZ;
      this.slingshotBuffer[3] = sx;
      this.slingshotBuffer[4] = sy;
      this.slingshotBuffer[5] = sz;
      this.slingshotBuffer[6] = sx + (sx - pullX);
      this.slingshotBuffer[7] = sy + (sy - pullY);
      this.slingshotBuffer[8] = sz + (sz - pullZ);
      this.slingshotArrow.geometry.setDrawRange(0, 3);
      (this.slingshotArrow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.slingshotArrow.visible = true;
    } else {
      this.slingshotArrow.visible = false;
    }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.cameraMode === 'director') return;

    // Any pointer interaction during Cinematic Auto-Tour smoothly hands control back to user!
    if (this.cameraMode === 'cinematic') {
      this.exitSpecialCameraMode(true);
      return;
    }

    if (this.cameraMode === 'surface') {
      if (e.button === 0) {
        this.isDraggingSurface = true;
        this.lastSurfacePointer.set(e.clientX, e.clientY);
      }
      return;
    }

    if (this.cameraMode === 'flight') {
      this.pointerDownScreen.set(e.clientX, e.clientY);
      this.lastFlightPointer.set(e.clientX, e.clientY);
      if (e.button === 0) {
        this.isDraggingFlightLook = true;
      } else if (e.button === 2) {
        this.isDraggingFlightRoll = true;
      }
      return;
    }

    if (e.button !== 0) return;
    this.pointerDownScreen.set(e.clientX, e.clientY);

    if (this.spawnActive && this.spawnTemplate) {
      const worldPos = this.raycastOrbitalPlane(e.clientX, e.clientY);
      if (!worldPos) return;

      if (this.launchMode === 'slingshot') {
        this.isDraggingSlingshot = true;
        this.dragStartWorldMeters = worldPos;
        this.hoverWorldMeters = worldPos;
        this.controls.enabled = false;
      } else {
        const vel = this.computeCandidateVelocity(worldPos);
        const body = this.engine.spawnFromTemplate(this.spawnTemplate, worldPos, vel);
        this.callbacks.onSpawnedBody(body);
      }
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.cameraMode === 'director') return;

    if (this.cameraMode === 'surface' && this.isDraggingSurface) {
      const dx = e.clientX - this.lastSurfacePointer.x;
      const dy = e.clientY - this.lastSurfacePointer.y;
      this.lastSurfacePointer.set(e.clientX, e.clientY);
      this.surfaceYaw -= dx * 0.0045;
      this.surfacePitch = Math.max(-0.62, Math.min(1.42, this.surfacePitch + dy * 0.0042));
      return;
    }

    if (this.cameraMode === 'flight' && (this.isDraggingFlightLook || this.isDraggingFlightRoll)) {
      const dx = e.clientX - this.lastFlightPointer.x;
      const dy = e.clientY - this.lastFlightPointer.y;
      this.lastFlightPointer.set(e.clientX, e.clientY);
      if (this.isDraggingFlightLook) {
        this.camera.rotateOnAxis(new THREE.Vector3(0, 1, 0), -dx * 0.0038);
        this.camera.rotateOnAxis(new THREE.Vector3(1, 0, 0), -dy * 0.0038);
      }
      if (this.isDraggingFlightRoll) {
        this.camera.rotateOnAxis(new THREE.Vector3(0, 0, -1), dx * 0.005);
      }
      return;
    }

    if (!this.spawnActive) return;
    const worldPos = this.raycastOrbitalPlane(e.clientX, e.clientY);
    this.hoverWorldMeters = worldPos;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.cameraMode === 'director') return;

    if (this.cameraMode === 'surface') {
      this.isDraggingSurface = false;
      return;
    }

    if (this.cameraMode === 'flight') {
      if (e.button === 0) this.isDraggingFlightLook = false;
      if (e.button === 2) this.isDraggingFlightRoll = false;
      if (e.button === 0) {
        const moveDist = Math.hypot(
          e.clientX - this.pointerDownScreen.x,
          e.clientY - this.pointerDownScreen.y
        );
        if (moveDist <= 5) {
          const rect = this.renderer.domElement.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
          );
          this.raycaster.setFromCamera(ndc, this.camera);
          const hits = this.raycaster.intersectObjects(this.bodyRenderer.getPickables(), false);
          if (hits.length > 0) {
            const bodyId = hits[0].object.userData.bodyId as string;
            this.selectedBodyId = bodyId;
            this.callbacks.onSelectBody(bodyId);
          }
        }
      }
      return;
    }

    if (e.button !== 0) return;

    if (this.isDraggingSlingshot && this.spawnTemplate && this.dragStartWorldMeters) {
      const vel = this.computeCandidateVelocity(this.dragStartWorldMeters);
      const body = this.engine.spawnFromTemplate(
        this.spawnTemplate,
        this.dragStartWorldMeters,
        vel
      );
      this.isDraggingSlingshot = false;
      this.dragStartWorldMeters = null;
      this.slingshotArrow.visible = false;
      this.controls.enabled = true;
      this.callbacks.onSpawnedBody(body);
      return;
    }

    // Normal body click-selection (ignore orbit camera drags)
    if (!this.spawnActive) {
      const moveDist = Math.hypot(
        e.clientX - this.pointerDownScreen.x,
        e.clientY - this.pointerDownScreen.y
      );
      if (moveDist > 5) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.bodyRenderer.getPickables(), false);
      if (hits.length > 0) {
        const bodyId = hits[0].object.userData.bodyId as string;
        this.selectedBodyId = bodyId;
        this.callbacks.onSelectBody(bodyId);
      } else {
        this.selectedBodyId = null;
        this.callbacks.onSelectBody(null);
      }
    }
  };

  private handleResize = (): void => {
    if (this.recordingSizeLock !== null) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(
      Math.max(1, Math.floor(width / 2)),
      Math.max(1, Math.floor(height / 2))
    );
    if (this.graphicsQuality === 'fast') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.cameraMode === 'director') {
      e.preventDefault();
      return;
    }
    if (this.cameraMode === 'cinematic') {
      this.exitSpecialCameraMode(true);
      return;
    }
    if (this.cameraMode === 'flight') {
      e.preventDefault();
      if (e.deltaY < 0) this.shiftFlightGear(1);
      else if (e.deltaY > 0) this.shiftFlightGear(-1);
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.cameraMode === 'flight') {
      e.preventDefault();
    }
  };

  private handleFlightKeyDown = (e: KeyboardEvent): void => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (this.cameraMode === 'flight') {
      this.flightKeys.add(e.code);
    }
  };

  private handleFlightKeyUp = (e: KeyboardEvent): void => {
    this.flightKeys.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.flightKeys.clear();
    this.isDraggingFlightLook = false;
    this.isDraggingFlightRoll = false;
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.videoRecorder.isRecording()) {
        void this.stopVideoRecording();
      }
      if (this.rafId !== 0) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.handleWindowBlur();
    } else if (!this.disposed && this.rafId === 0) {
      this.lastFrameTime = performance.now();
      this.rafId = requestAnimationFrame(this.animate);
    }
  };

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('wheel', this.handleWheel, { passive: false });
    dom.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('keydown', this.handleFlightKeyDown);
    window.addEventListener('keyup', this.handleFlightKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    this.elapsedTime += dt;

    // 1. Step N-body simulation, collisions, Roche tearing, thermodynamics & stellar evolution
    const events = this.engine.step(dt);
    for (const c of events.collisions) {
      this.spawnShockwave(c);
      this.callbacks.onCollision(c);
    }
    for (const td of events.tidalDisruptions) {
      this.callbacks.onTidalDisruption(td);
    }
    for (const sn of events.supernovas) {
      this.spawnSupernovaFX(sn);
      this.callbacks.onSupernova(sn);
    }
    for (const kn of events.kilonovas) {
      this.spawnKilonovaFX(kn);
      this.callbacks.onKilonova(kn);
    }
    for (const ci of events.cmeImpacts) {
      this.callbacks.onCmeImpact(ci);
    }

    // 2. Camera mode update (Surface / Cinematic / 6-DOF Flight / Keyframe Director / Orbit)
    if (this.cameraMode === 'surface') {
      this.updateSurfaceCamera();
    } else if (this.cameraMode === 'cinematic') {
      this.updateCinematicCamera(dt);
    } else if (this.cameraMode === 'flight') {
      this.updateFlightCamera(dt);
    } else if (this.cameraMode === 'director') {
      this.updateDirectorCamera(dt);
    } else {
      // Orbit mode: track floating origin if locked onto a body
      const focusBody = this.engine.getBody(this.focusBodyId);
      if (focusBody) {
        this.originMeters.x = focusBody.position.x;
        this.originMeters.y = focusBody.position.y;
        this.originMeters.z = focusBody.position.z;
      } else if (this.focusBodyId !== null) {
        this.focusBodyId = null;
      }
      this.controls.update();
    }

    // 3. Dynamic near/far clipping planes for seamless solar-system-to-surface zoom & nebula fly-through
    const camDist =
      this.cameraMode === 'surface'
        ? 0.04
        : this.cameraMode === 'flight' || this.cameraMode === 'director'
          ? Math.max(0.25, Math.min(200, this.getNearestVisualDistance().clearance * 0.35))
          : this.camera.position.distanceTo(this.controls.target);
    const desiredNear =
      this.cameraMode === 'flight' || this.cameraMode === 'director'
        ? Math.max(0.004, Math.min(0.5, camDist * 0.04))
        : Math.max(0.0004, Math.min(2.0, camDist * 0.002));
    const desiredFar = Math.max(60000, camDist * 250);
    if (Math.abs(this.camera.near - desiredNear) / this.camera.near > 0.15) {
      this.camera.near = desiredNear;
      this.camera.far = desiredFar;
      this.camera.updateProjectionMatrix();
    }

    // Keep starfield centered on camera so stars feel infinitely far
    this.starfield.position.copy(this.camera.position);

    // 4. Sync celestial bodies, orbiting debris, galaxy stars, 3D overlays & spawn preview
    this.bodyRenderer.sync(
      this.engine.bodies,
      this.originMeters,
      this.camera,
      this.scaleMode,
      this.showTrails,
      this.cameraMode === 'orbit' ? this.selectedBodyId : null,
      this.elapsedTime,
      this.engine.cmeWaves,
      this.graphicsQuality
    );
    this.debrisRenderer.sync(this.engine.debris.particles, this.originMeters);
    this.galaxyRenderer.sync(this.engine.galaxy.stars, this.originMeters);
    this.highEnergyRenderer.sync(
      this.engine.bodies,
      this.engine.cmeWaves,
      this.engine.tidalStreams,
      this.bodyRenderer,
      this.originMeters,
      this.elapsedTime,
      this.camera,
      this.showSpaceWeatherField
    );
    this.spacetimeGrid.sync(
      this.showGravityGrid,
      this.engine.bodies,
      this.originMeters,
      this.camera,
      this.engine.gwSource,
      dt
    );
    this.scienceOverlays.sync(
      {
        showHabitableZone: this.showHabitableZone,
        showVectors: this.showVectors,
        showRocheLimits: this.showRocheLimits,
      },
      this.engine.bodies,
      this.bodyRenderer,
      this.originMeters,
      this.camera,
      this.selectedBodyId
    );
    this.updateSpawnPreview();
    this.updateShockwaves(dt);

    // 5. Render (half-res HDR Bloom in 'high', direct ultra-fast render in 'fast')
    if (this.graphicsQuality === 'fast') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    // 5b. Project screen-space body labels (~20Hz when enabled)
    this.labelTimer += dt;
    if (this.labelTimer >= 0.05) {
      this.labelTimer = 0;
      if (this.showLabels) {
        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;
        const projected: ScreenLabel[] = [];
        for (const b of this.engine.bodies) {
          if (!b.alive) continue;
          const vis = this.bodyRenderer.getVisual(b.id);
          if (!vis) continue;
          this.tempProj.copy(vis.renderedPos);
          this.tempProj.y += vis.renderedRadius * 1.15;
          this.tempProj.project(this.camera);
          if (this.tempProj.z < -1 || this.tempProj.z > 1) continue;
          const sx = (this.tempProj.x * 0.5 + 0.5) * w;
          const sy = (-this.tempProj.y * 0.5 + 0.5) * h;
          if (sx < -80 || sx > w + 80 || sy < -40 || sy > h + 40) continue;
          projected.push({
            id: b.id,
            name: b.name,
            x: sx,
            y: sy,
            color: b.category === 'black_hole' ? '#ff9640' : b.color,
            selected: b.id === this.selectedBodyId,
            subtitle:
              b.galaxyType === 'andromeda'
                ? '旋涡星系 SA(s)b'
                : b.galaxyType
                  ? '矮椭圆伴星系'
                  : b.nebulaType === 'pillars_of_creation'
                    ? '冷分子云 · 创生之柱'
                    : b.nebulaType === 'ngc6611_cluster'
                      ? 'O/B 幼年电离星团'
                      : b.category === 'black_hole'
                        ? '黑洞'
                        : `${Math.round(b.temperature)} K`,
          });
        }
        this.callbacks.onLabelsUpdate(projected);
      }
    }

    // 6. Throttled UI telemetry sync (~4.5Hz to keep React CPU usage near zero)
    this.fpsAccumulator += dt;
    this.fpsFrames++;
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.22) {
      const fps = this.fpsAccumulator > 0 ? Math.round(this.fpsFrames / this.fpsAccumulator) : 60;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      this.telemetryTimer = 0;
      this.callbacks.onTelemetryTick(fps);
      if (this.cameraMode === 'flight') {
        this.callbacks.onFlightTelemetry?.(this.flightGearIndex, this.flightVelocity.length());
      } else if (this.cameraMode === 'director') {
        const total = computeDirectorTotalDuration(this.directorKeyframes);
        const activeSample = sampleDirectorPose(
          this.directorKeyframes,
          this.directorTimeSec,
          this.engine.bodies
        );
        this.callbacks.onDirectorTelemetry?.(
          this.directorTimeSec,
          total,
          activeSample.activeIndex,
          this.directorPlaying
        );
      }
      if (this.videoRecorder.isRecording()) {
        this.callbacks.onRecordingStateChange?.(
          true,
          this.videoRecorder.getElapsedSec(),
          undefined,
          undefined,
          this.recordingActualFormat
        );
      }
    }
  };

  public dispose(): void {
    this.disposed = true;
    this.videoRecorder.abort();
    this.unlockRecordingResolution();
    cancelAnimationFrame(this.rafId);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    dom.removeEventListener('wheel', this.handleWheel);
    dom.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleFlightKeyDown);
    window.removeEventListener('keyup', this.handleFlightKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.bodyRenderer.disposeAll();
    this.debrisRenderer.dispose();
    this.galaxyRenderer.dispose();
    this.highEnergyRenderer.disposeAll();
    this.spacetimeGrid.dispose();
    this.scienceOverlays.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
