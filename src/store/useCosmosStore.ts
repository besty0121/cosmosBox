import { create } from 'zustand';
import { cosmosAudio } from '../audio/CosmosAudio';
import {
  DAY,
  HOUR,
  M_SUN,
  schwarzschildRadius,
  temperatureToHex,
} from '../physics/constants';
import { computeCircularOrbitVelocity, findDominantBody } from '../physics/integrator';
import { SimulationEngine } from '../physics/SimulationEngine';
import { syncStarFromMass } from '../physics/stellar';
import { stepThermodynamics } from '../physics/thermodynamics';
import { lenVec3 } from '../physics/vec3';
import { GraphicsQuality, SceneManager } from '../render/SceneManager';
import { SCENARIOS } from '../scenarios/presets';
import { SPAWN_TEMPLATES } from '../scenarios/templates';
import {
  CosmosSaveData,
  createSavePayload,
  deleteLocalSave,
  downloadSaveAsJson,
  listLocalSaves,
  parseImportedSaveJson,
  saveToLocal,
} from '../storage/saveManager';
import {
  BodySnapshot,
  CameraMode,
  CmeImpactEvent,
  CollisionEvent,
  KilonovaEvent,
  LaunchMode,
  ScaleMode,
  ScenarioDefinition,
  ScreenLabel,
  SupernovaEvent,
  TidalDisruptionEvent,
} from '../types/cosmos';

interface CosmosState {
  scenarioId: string;
  paused: boolean;
  timeScale: number;
  simTime: number;
  fps: number;
  debrisCount: number;
  galaxyStarCount: number;

  // Visualization & Audio toggles
  graphicsQuality: GraphicsQuality;
  scaleMode: ScaleMode;
  showTrails: boolean;
  showGravityGrid: boolean;
  showHabitableZone: boolean;
  showVectors: boolean;
  showRocheLimits: boolean;
  showLabels: boolean;
  showSpaceWeatherField: boolean;
  autoThermo: boolean;
  audioMuted: boolean;

  hudVisible: boolean;
  bodyListOpen: boolean;
  saveModalOpen: boolean;

  bodies: BodySnapshot[];
  screenLabels: ScreenLabel[];
  selectedBodyId: string | null;
  focusBodyId: string | null;
  cameraMode: CameraMode;
  cameraTargetName: string | null;

  spawnActive: boolean;
  selectedTemplateId: string;
  launchMode: LaunchMode;

  // Saves & Snapshots
  savedUniverses: CosmosSaveData[];
  snapshots: CosmosSaveData[];

  toast: string | null;

  engine: SimulationEngine | null;
  sceneManager: SceneManager | null;

  // Actions
  attachRuntime: (engine: SimulationEngine, sceneManager: SceneManager) => void;
  loadScenario: (scenarioId: string) => void;
  resetScenario: () => void;
  togglePause: () => void;
  setTimeScale: (secPerSec: number) => void;
  setScaleMode: (mode: ScaleMode) => void;
  toggleGraphicsQuality: () => void;

  toggleTrails: () => void;
  toggleGravityGrid: () => void;
  toggleHabitableZone: () => void;
  toggleVectors: () => void;
  toggleRocheLimits: () => void;
  toggleLabels: () => void;
  toggleSpaceWeatherField: () => void;
  toggleAutoThermo: () => void;
  toggleAudioMute: () => void;

  toggleHud: () => void;
  toggleBodyList: () => void;
  setSaveModalOpen: (open: boolean) => void;

  selectBody: (id: string | null) => void;
  focusBody: (id: string | null, zoomCloser?: boolean) => void;
  enterSurfaceView: (id: string) => void;
  cycleSurfaceSpot: () => void;
  toggleCinematicTour: () => void;
  exitSpecialCameraMode: () => void;
  deleteBody: (id: string) => void;

  setSpawnActive: (active: boolean) => void;
  setSelectedTemplateId: (templateId: string) => void;
  setLaunchMode: (mode: LaunchMode) => void;

  // Deep property editor actions
  scaleBodyMass: (id: string, factor: number) => void;
  setBodyMassKg: (id: string, massKg: number) => void;
  setBodyRadiusM: (id: string, radiusM: number) => void;
  scaleBodyVelocity: (id: string, factor: number) => void;
  setBodySpeedKmS: (id: string, speedKmS: number) => void;
  stabilizeBodyOrbit: (id: string) => void;
  updateBodyProps: (
    id: string,
    patch: Partial<{
      temperature: number;
      albedo: number;
      greenhouse: number;
      waterFraction: number;
      atmosphereDensity: number;
      auroraIntensity: number;
      rotationHours: number;
      axialTiltDeg: number;
    }>
  ) => void;
  triggerBodySupernova: (id: string) => void;
  launchSolarCME: (starId?: string, mode?: 'random' | 'target') => void;

  // Persistence, Snapshots & Photo
  takeSnapshot: () => void;
  restoreLatestSnapshot: () => void;
  saveUniverseLocal: (name: string) => void;
  loadSaveData: (save: CosmosSaveData) => void;
  removeLocalSave: (id: string) => void;
  exportCurrentJson: (name?: string) => void;
  importSaveJsonText: (text: string) => boolean;
  captureScreenshot: () => void;

  syncTelemetry: (fps: number) => void;
  setScreenLabels: (labels: ScreenLabel[]) => void;
  pushCollisionToast: (event: CollisionEvent) => void;
  pushTidalToast: (event: TidalDisruptionEvent) => void;
  pushSupernovaToast: (event: SupernovaEvent) => void;
  pushKilonovaToast: (event: KilonovaEvent) => void;
  pushCmeImpactToast: (event: CmeImpactEvent) => void;
  showToast: (msg: string) => void;
}

let toastTimer: number | null = null;

function applyMassUpdate(
  body: NonNullable<ReturnType<SimulationEngine['getBody']>>,
  nextMass: number
) {
  const prevMass = Math.max(body.mass, 1);
  const clampedMass = Math.max(1e15, Math.min(200 * M_SUN, nextMass));
  const ratio = clampedMass / prevMass;
  body.mass = clampedMass;

  if (body.category === 'black_hole') {
    body.radius = schwarzschildRadius(body.mass);
  } else if (body.category === 'star') {
    syncStarFromMass(body);
  } else if (body.category !== 'neutron_star') {
    body.radius *= Math.cbrt(ratio);
    if (body.mass >= 0.075 * M_SUN) {
      body.category = 'star';
      syncStarFromMass(body);
    }
  }
}

export const useCosmosStore = create<CosmosState>((set, get) => ({
  scenarioId: SCENARIOS[0].id,
  paused: false,
  timeScale: 15 * DAY,
  simTime: 0,
  fps: 60,
  debrisCount: 0,
  galaxyStarCount: 0,

  graphicsQuality: 'high',
  scaleMode: 'playable',
  showTrails: true,
  showGravityGrid: false,
  showHabitableZone: false,
  showVectors: false,
  showRocheLimits: false,
  showLabels: false,
  showSpaceWeatherField: true,
  autoThermo: true,
  audioMuted: false,

  hudVisible: true,
  bodyListOpen: false,
  saveModalOpen: false,

  bodies: [],
  screenLabels: [],
  selectedBodyId: null,
  focusBodyId: null,
  cameraMode: 'orbit',
  cameraTargetName: null,

  spawnActive: false,
  selectedTemplateId: SPAWN_TEMPLATES[0].id,
  launchMode: 'orbit',

  savedUniverses: listLocalSaves(),
  snapshots: [],

  toast: null,

  engine: null,
  sceneManager: null,

  attachRuntime: (engine, sceneManager) => {
    set({ engine, sceneManager });
    get().loadScenario(get().scenarioId);
  },

  loadScenario: (scenarioId) => {
    const { engine, sceneManager, autoThermo } = get();
    const scenario: ScenarioDefinition =
      SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    if (!engine || !sceneManager) return;

    const bodies = scenario.createBodies();
    engine.autoThermo = autoThermo;
    engine.loadBodies(bodies, scenario.defaultTimeScale);

    if (scenario.setupGalaxy) {
      scenario.setupGalaxy(
        (core, count, innerR, outerR, tiltX, tiltZ, spin, hue) =>
          engine.galaxy.spawnSpiralDisk(core, count, innerR, outerR, tiltX, tiltZ, spin, hue),
        engine.bodies
      );
    }

    sceneManager.frameScenario(scenario.defaultCameraDistanceAU, scenario.defaultFocusBodyName);
    sceneManager.setSpawnMode(false, null, get().launchMode);
    const enableGrid = Boolean(scenario.defaultShowGravityGrid);
    sceneManager.showGravityGrid = enableGrid;

    if (scenario.autoLaunchCme) {
      engine.launchCME();
      cosmosAudio.playCmeLaunch();
    }

    set({
      scenarioId: scenario.id,
      paused: false,
      timeScale: scenario.defaultTimeScale,
      simTime: 0,
      debrisCount: 0,
      galaxyStarCount: engine.galaxy.stars.length,
      showGravityGrid: enableGrid,
      cameraMode: 'orbit',
      cameraTargetName: null,
      spawnActive: false,
      selectedBodyId: sceneManager.selectedBodyId,
      focusBodyId: sceneManager.focusBodyId,
      bodies: engine.getBodySnapshots(),
    });
    get().showToast(`已载入预设：${scenario.name}`);
  },

  resetScenario: () => {
    get().loadScenario(get().scenarioId);
  },

  togglePause: () => {
    const { engine, paused } = get();
    if (!engine) return;
    engine.paused = !paused;
    set({ paused: engine.paused });
  },

  setTimeScale: (secPerSec) => {
    const { engine } = get();
    if (!engine) return;
    engine.timeScale = secPerSec;
    if (engine.paused && secPerSec > 0) {
      engine.paused = false;
      set({ paused: false });
    }
    set({ timeScale: secPerSec });
  },

  setScaleMode: (mode) => {
    const { sceneManager } = get();
    if (sceneManager) sceneManager.scaleMode = mode;
    set({ scaleMode: mode });
    get().showToast(mode === 'real' ? '已切换至：真实天文比例' : '已切换至：智能视觉缩放');
  },

  toggleGraphicsQuality: () => {
    const { sceneManager, graphicsQuality } = get();
    const next: GraphicsQuality = graphicsQuality === 'high' ? 'fast' : 'high';
    if (sceneManager) sceneManager.setGraphicsQuality(next);
    set({ graphicsQuality: next });
    get().showToast(
      next === 'fast'
        ? '⚡ 已切换至：极致流畅模式（直出渲染，关闭泛光）'
        : '✨ 已切换至：高画质模式（开启 HDR 泛光）'
    );
  },

  toggleTrails: () => {
    const { sceneManager, showTrails } = get();
    const next = !showTrails;
    if (sceneManager) sceneManager.showTrails = next;
    set({ showTrails: next });
  },

  toggleGravityGrid: () => {
    const { sceneManager, showGravityGrid } = get();
    const next = !showGravityGrid;
    if (sceneManager) sceneManager.showGravityGrid = next;
    set({ showGravityGrid: next });
    get().showToast(next ? '已开启：3D 时空弯曲引力网格' : '已关闭：时空弯曲引力网格');
  },

  toggleHabitableZone: () => {
    const { sceneManager, showHabitableZone } = get();
    const next = !showHabitableZone;
    if (sceneManager) sceneManager.showHabitableZone = next;
    set({ showHabitableZone: next });
  },

  toggleVectors: () => {
    const { sceneManager, showVectors } = get();
    const next = !showVectors;
    if (sceneManager) sceneManager.showVectors = next;
    set({ showVectors: next });
  },

  toggleRocheLimits: () => {
    const { sceneManager, showRocheLimits } = get();
    const next = !showRocheLimits;
    if (sceneManager) sceneManager.showRocheLimits = next;
    set({ showRocheLimits: next });
  },

  toggleLabels: () => {
    const { sceneManager, showLabels } = get();
    const next = !showLabels;
    if (sceneManager) sceneManager.showLabels = next;
    set({ showLabels: next, screenLabels: next ? get().screenLabels : [] });
  },

  toggleSpaceWeatherField: () => {
    const { sceneManager, showSpaceWeatherField } = get();
    const next = !showSpaceWeatherField;
    if (sceneManager) sceneManager.showSpaceWeatherField = next;
    set({ showSpaceWeatherField: next });
    get().showToast(
      next
        ? '已开启 NASA SVS 科学视图：显示太阳风带电粒子流与 3D 磁力线'
        : '已切换至纯肉眼光学模式：仅保留可见耀斑、日珥与地球极光'
    );
  },

  toggleAutoThermo: () => {
    const { engine, autoThermo } = get();
    const next = !autoThermo;
    if (engine) engine.autoThermo = next;
    set({ autoThermo: next });
    get().showToast(
      next ? '已开启：动态热力学与气候演化' : '已暂停：自动热力学演化（保留手动温度）'
    );
  },

  toggleAudioMute: () => {
    const next = !get().audioMuted;
    cosmosAudio.setMuted(next);
    set({ audioMuted: next });
    get().showToast(next ? '🔇 已静音宇宙音效' : '🔊 已开启程序化太空音效');
  },

  toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),

  toggleBodyList: () => set((s) => ({ bodyListOpen: !s.bodyListOpen })),

  setSaveModalOpen: (open) => {
    if (open) set({ savedUniverses: listLocalSaves() });
    set({ saveModalOpen: open });
  },

  selectBody: (id) => {
    const { sceneManager } = get();
    if (sceneManager) sceneManager.selectedBodyId = id;
    set({ selectedBodyId: id });
  },

  focusBody: (id, zoomCloser = false) => {
    const { sceneManager } = get();
    if (sceneManager) {
      sceneManager.exitSpecialCameraMode(false);
      sceneManager.selectedBodyId = id;
      sceneManager.focusOnBody(id, zoomCloser);
    }
    set({ focusBodyId: id, selectedBodyId: id, cameraMode: 'orbit', cameraTargetName: null });
  },

  enterSurfaceView: (id) => {
    const { sceneManager } = get();
    if (!sceneManager) return;
    const ok = sceneManager.enterSurfaceView(id);
    if (!ok) {
      get().showToast('恒星与黑洞表面无法降落，请选择行星、卫星或彗星');
    }
  },

  cycleSurfaceSpot: () => {
    get().sceneManager?.cycleSurfaceSpot();
  },

  toggleCinematicTour: () => {
    const { sceneManager, cameraMode } = get();
    if (!sceneManager) return;
    if (cameraMode === 'cinematic') {
      sceneManager.exitSpecialCameraMode(true);
    } else {
      sceneManager.startCinematicTour();
    }
  },

  exitSpecialCameraMode: () => {
    get().sceneManager?.exitSpecialCameraMode(true);
  },

  deleteBody: (id) => {
    const { engine, sceneManager, selectedBodyId, focusBodyId } = get();
    if (!engine || !sceneManager) return;
    const b = engine.getBody(id);
    engine.removeBody(id);
    if (selectedBodyId === id) {
      sceneManager.selectedBodyId = null;
      set({ selectedBodyId: null });
    }
    if (focusBodyId === id) {
      sceneManager.focusBodyId = null;
      set({ focusBodyId: null });
    }
    set({ bodies: engine.getBodySnapshots() });
    if (b) get().showToast(`已移除天体：${b.name}`);
  },

  setSpawnActive: (active) => {
    const { sceneManager, selectedTemplateId, launchMode } = get();
    const tpl = SPAWN_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? SPAWN_TEMPLATES[0];
    if (sceneManager) {
      sceneManager.setSpawnMode(active, active ? tpl : null, launchMode);
    }
    set({ spawnActive: active });
  },

  setSelectedTemplateId: (templateId) => {
    const { sceneManager, launchMode } = get();
    const tpl = SPAWN_TEMPLATES.find((t) => t.id === templateId) ?? SPAWN_TEMPLATES[0];
    if (sceneManager) {
      sceneManager.setSpawnMode(true, tpl, launchMode);
    }
    set({ selectedTemplateId: templateId, spawnActive: true });
  },

  setLaunchMode: (mode) => {
    const { sceneManager, spawnActive, selectedTemplateId } = get();
    const tpl = SPAWN_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? SPAWN_TEMPLATES[0];
    if (sceneManager && spawnActive) {
      sceneManager.setSpawnMode(true, tpl, mode);
    }
    set({ launchMode: mode });
  },

  scaleBodyMass: (id, factor) => {
    const { engine } = get();
    if (!engine) return;
    const body = engine.getBody(id);
    if (!body) return;
    applyMassUpdate(body, body.mass * factor);
    stepThermodynamics(engine.bodies, 0, false);
    set({ bodies: engine.getBodySnapshots() });
  },

  setBodyMassKg: (id, massKg) => {
    const { engine } = get();
    if (!engine || !Number.isFinite(massKg) || massKg <= 0) return;
    const body = engine.getBody(id);
    if (!body) return;
    applyMassUpdate(body, massKg);
    stepThermodynamics(engine.bodies, 0, false);
    set({ bodies: engine.getBodySnapshots() });
  },

  setBodyRadiusM: (id, radiusM) => {
    const { engine } = get();
    if (!engine || !Number.isFinite(radiusM) || radiusM <= 0) return;
    const body = engine.getBody(id);
    if (!body || body.category === 'black_hole') return;
    body.radius = Math.max(1e4, Math.min(200 * 6.9634e8, radiusM));
    set({ bodies: engine.getBodySnapshots() });
  },

  scaleBodyVelocity: (id, factor) => {
    const { engine } = get();
    if (!engine) return;
    const body = engine.getBody(id);
    if (!body) return;
    body.velocity.x *= factor;
    body.velocity.y *= factor;
    body.velocity.z *= factor;
    set({ bodies: engine.getBodySnapshots() });
  },

  setBodySpeedKmS: (id, speedKmS) => {
    const { engine } = get();
    if (!engine || !Number.isFinite(speedKmS) || speedKmS < 0) return;
    const body = engine.getBody(id);
    if (!body) return;
    const targetMs = speedKmS * 1000;
    const curSpeed = lenVec3(body.velocity);
    if (curSpeed > 1e-3) {
      const s = targetMs / curSpeed;
      body.velocity.x *= s;
      body.velocity.y *= s;
      body.velocity.z *= s;
    } else {
      body.velocity.x = targetMs;
    }
    set({ bodies: engine.getBodySnapshots() });
  },

  stabilizeBodyOrbit: (id) => {
    const { engine } = get();
    if (!engine) return;
    const body = engine.getBody(id);
    if (!body) return;
    const primary = findDominantBody(engine.bodies, body.position, body.id);
    if (!primary) {
      get().showToast('当前没有可环绕的主引力源');
      return;
    }
    const circVel = computeCircularOrbitVelocity(body.position, primary);
    body.velocity.x = circVel.x;
    body.velocity.y = circVel.y;
    body.velocity.z = circVel.z;
    set({ bodies: engine.getBodySnapshots() });
    get().showToast(`🛸 已将 ${body.name} 自动调整为环绕 ${primary.name} 的稳定圆轨道`);
  },

  updateBodyProps: (id, patch) => {
    const { engine } = get();
    if (!engine) return;
    const body = engine.getBody(id);
    if (!body) return;

    if (patch.temperature !== undefined) {
      body.temperature = patch.temperature;
      if (body.category === 'star') {
        body.color = temperatureToHex(body.temperature);
        body.secondaryColor = temperatureToHex(Math.max(2200, body.temperature * 0.72));
        body.atmosphereColor = temperatureToHex(Math.max(2600, body.temperature * 0.86));
      }
    }
    if (patch.albedo !== undefined) body.albedo = patch.albedo;
    if (patch.greenhouse !== undefined) body.greenhouse = patch.greenhouse;
    if (patch.waterFraction !== undefined) body.waterFraction = patch.waterFraction;
    if (patch.atmosphereDensity !== undefined) body.atmosphereDensity = patch.atmosphereDensity;
    if (patch.auroraIntensity !== undefined) body.auroraIntensity = patch.auroraIntensity;
    if (patch.rotationHours !== undefined) {
      body.rotationPeriod = Math.max(0.5, patch.rotationHours) * HOUR;
    }
    if (patch.axialTiltDeg !== undefined) {
      body.axialTilt = (patch.axialTiltDeg * Math.PI) / 180;
    }
    stepThermodynamics(engine.bodies, 0, false);
    set({ bodies: engine.getBodySnapshots() });
  },

  triggerBodySupernova: (id) => {
    const { engine, sceneManager } = get();
    if (!engine || !sceneManager) return;
    const ev = engine.detonateSupernova(id);
    if (!ev) return;
    sceneManager.spawnSupernovaFX(ev);
    cosmosAudio.playSupernova();
    get().pushSupernovaToast(ev);
    set({
      bodies: engine.getBodySnapshots(),
      debrisCount: engine.debris.particles.length,
    });
  },

  launchSolarCME: (starId, mode = 'random') => {
    const { engine } = get();
    if (!engine) return;
    const isRandom = mode === 'random';
    const wave = engine.launchCME(starId, undefined, isRandom);
    if (!wave) {
      get().showToast('当前场景没有可喷发日冕物质抛射的恒星');
      return;
    }
    cosmosAudio.playCmeLaunch();
    get().showToast(
      isRandom
        ? `☀️ ${wave.starName} 活跃黑子区发生随机日冕爆发（CME）！`
        : `☀️ ${wave.starName} 朝行星方向爆发超级日冕物质抛射（CME）！`
    );
  },

  takeSnapshot: () => {
    const { engine, scenarioId, autoThermo, snapshots } = get();
    if (!engine) return;
    const snap = createSavePayload(`快照 #${snapshots.length + 1}`, {
      scenarioId,
      simTime: engine.simTime,
      timeScale: engine.timeScale,
      autoThermo,
      bodies: engine.bodies,
    });
    const next = [...snapshots.slice(-9), snap];
    cosmosAudio.playSpawnPing();
    set({ snapshots: next });
    get().showToast(`📸 已保存时间快照（当前共 ${next.length} 个可回溯点）`);
  },

  restoreLatestSnapshot: () => {
    const { snapshots } = get();
    if (snapshots.length === 0) {
      get().showToast('暂无快照可回溯，请先点击“打快照”');
      return;
    }
    const latest = snapshots[snapshots.length - 1];
    get().loadSaveData(latest);
    set({ snapshots: snapshots.slice(0, -1) });
    get().showToast(`⏪ 已回溯至：${latest.name}`);
  },

  saveUniverseLocal: (name) => {
    const { engine, scenarioId, autoThermo } = get();
    if (!engine) return;
    const payload = createSavePayload(name, {
      scenarioId,
      simTime: engine.simTime,
      timeScale: engine.timeScale,
      autoThermo,
      bodies: engine.bodies,
    });
    const nextList = saveToLocal(payload);
    cosmosAudio.playSpawnPing();
    set({ savedUniverses: nextList });
    get().showToast(`💾 已保存自定义宇宙：${payload.name}`);
  },

  loadSaveData: (save) => {
    const { engine, sceneManager } = get();
    if (!engine || !sceneManager) return;
    const clonedBodies = save.bodies.map((b) => ({
      ...b,
      position: { ...b.position },
      velocity: { ...b.velocity },
      acceleration: { x: 0, y: 0, z: 0 },
      trail: [{ ...b.position }],
      alive: true,
    }));
    engine.autoThermo = save.autoThermo;
    engine.loadBodies(clonedBodies, save.timeScale, save.simTime);
    const primaryName = clonedBodies[0]?.name;
    sceneManager.frameScenario(3.4, primaryName);
    set({
      scenarioId: save.scenarioId,
      simTime: save.simTime,
      timeScale: save.timeScale,
      autoThermo: save.autoThermo,
      paused: false,
      debrisCount: 0,
      galaxyStarCount: 0,
      selectedBodyId: sceneManager.selectedBodyId,
      focusBodyId: sceneManager.focusBodyId,
      bodies: engine.getBodySnapshots(),
      saveModalOpen: false,
    });
    get().showToast(`📂 已载入宇宙存档：${save.name}`);
  },

  removeLocalSave: (id) => {
    const next = deleteLocalSave(id);
    set({ savedUniverses: next });
    get().showToast('已删除本地存档');
  },

  exportCurrentJson: (name) => {
    const { engine, scenarioId, autoThermo } = get();
    if (!engine) return;
    const payload = createSavePayload(name ?? 'CosmosBox宇宙', {
      scenarioId,
      simTime: engine.simTime,
      timeScale: engine.timeScale,
      autoThermo,
      bodies: engine.bodies,
    });
    downloadSaveAsJson(payload);
    get().showToast(`📤 已导出 JSON 文件：${payload.name}.cosmos.json`);
  },

  importSaveJsonText: (text) => {
    const parsed = parseImportedSaveJson(text);
    if (!parsed) {
      get().showToast('❌ 导入失败：无效的 CosmosBox JSON 存档格式');
      return false;
    }
    const next = saveToLocal(parsed);
    set({ savedUniverses: next });
    get().loadSaveData(parsed);
    return true;
  },

  captureScreenshot: () => {
    const { sceneManager } = get();
    if (!sceneManager) return;
    sceneManager.captureScreenshot();
    cosmosAudio.playSpawnPing();
    get().showToast('📷 已保存无 UI 高清宇宙截图 (PNG)');
  },

  syncTelemetry: (fps) => {
    const { engine, sceneManager } = get();
    if (!engine || !sceneManager) return;
    set({
      fps,
      simTime: engine.simTime,
      debrisCount: engine.debris.particles.length,
      galaxyStarCount: engine.galaxy.stars.length,
      bodies: engine.getBodySnapshots(),
      focusBodyId: sceneManager.focusBodyId,
      selectedBodyId: sceneManager.selectedBodyId,
    });
  },

  setScreenLabels: (labels) => set({ screenLabels: labels }),

  pushCollisionToast: (event) => {
    cosmosAudio.playCollision(event.impactEnergy, event.catastrophic);
    get().showToast(
      event.catastrophic
        ? `☄️ 灾难性撞击：${event.survivorName} 与 ${event.absorbedName} 剧烈撞击并抛射碎片云！`
        : `💥 碰撞融合：${event.survivorName} 吞并了 ${event.absorbedName}`
    );
  },

  pushTidalToast: (event) => {
    cosmosAudio.playTidalDisruption();
    get().showToast(
      event.isBlackHole
        ? `🌀 潮汐撕裂事件（TDE）：${event.victimName} 被 ${event.primaryName} 撕碎并吸入吸积盘！`
        : `💫 洛希极限撕裂：${event.victimName} 在 ${event.primaryName} 引力下解体为行星环！`
    );
  },

  pushSupernovaToast: (event) => {
    cosmosAudio.playSupernova();
    if (event.isTypeIa) {
      get().showToast(
        `💥 Ia 型热核超新星爆发！${event.starName} 吸积突破 1.44 M☉ 钱德拉塞卡极限并彻底炸碎！`
      );
      return;
    }
    const remnantLabel =
      event.remnantCategory === 'black_hole' ? '恒星级黑洞' : '高速脉冲中子星';
    get().showToast(`🌟 超新星爆发！${event.starName} 剧烈爆炸并坍缩为${remnantLabel}！`);
  },

  pushKilonovaToast: (event) => {
    cosmosAudio.playGravitationalWaveChirp(!event.isBlackHoleMerger);
    if (event.isBlackHoleMerger) {
      get().showToast(`🌀 致密双星并合！释放强引力波涟漪与 LIGO 啁啾激波！`);
    } else {
      get().showToast(`💥 双中子星千新星爆发（Kilonova）！抛射重元素云并坍缩为黑洞！`);
    }
  },

  pushCmeImpactToast: (event) => {
    cosmosAudio.playMagnetosphereHit();
    if (event.hasAurora) {
      get().showToast(
        `🧲 太阳风暴撞击${event.targetName}！偶极磁场成功偏转太阳风，南北极爆发 G5 级（Kp 9）超级极光！`
      );
    } else {
      get().showToast(`☀️ 来自 ${event.starName} 的日冕物质抛射冲击了 ${event.targetName}！`);
    }
  },

  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, 3800);
  },
}));
