import { CelestialBody } from '../types/cosmos';

export interface CosmosSaveData {
  version: 1;
  id: string;
  name: string;
  savedAt: string;
  scenarioId: string;
  simTime: number;
  timeScale: number;
  autoThermo: boolean;
  bodies: CelestialBody[];
}

const STORAGE_KEY = 'cosmosbox_saves_v1';

/**
 * Strips heavy trail history when persisting to keep saves crisp & compact.
 */
function sanitizeBodies(bodies: CelestialBody[]): CelestialBody[] {
  return bodies
    .filter((b) => b.alive)
    .map((b) => ({
      ...b,
      position: { ...b.position },
      velocity: { ...b.velocity },
      acceleration: { x: 0, y: 0, z: 0 },
      trail: [{ ...b.position }],
    }));
}

export function createSavePayload(
  name: string,
  state: {
    scenarioId: string;
    simTime: number;
    timeScale: number;
    autoThermo: boolean;
    bodies: CelestialBody[];
  }
): CosmosSaveData {
  return {
    version: 1,
    id: `save_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || `自定义宇宙 ${new Date().toLocaleTimeString('zh-CN')}`,
    savedAt: new Date().toISOString(),
    scenarioId: state.scenarioId,
    simTime: state.simTime,
    timeScale: state.timeScale,
    autoThermo: state.autoThermo,
    bodies: sanitizeBodies(state.bodies),
  };
}

export function listLocalSaves(): CosmosSaveData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CosmosSaveData[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.version === 1 && Array.isArray(item.bodies));
  } catch {
    return [];
  }
}

export function saveToLocal(save: CosmosSaveData): CosmosSaveData[] {
  const existing = listLocalSaves().filter((s) => s.id !== save.id);
  const next = [save, ...existing].slice(0, 24);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteLocalSave(id: string): CosmosSaveData[] {
  const next = listLocalSaves().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function downloadSaveAsJson(save: CosmosSaveData): void {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = save.name.replace(/[\\/:*?"<>|]/g, '_');
  a.href = url;
  a.download = `${safeName}.cosmos.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseImportedSaveJson(text: string): CosmosSaveData | null {
  try {
    const data = JSON.parse(text) as Partial<CosmosSaveData>;
    if (data.version !== 1 || !Array.isArray(data.bodies)) return null;
    // Basic validation of required body fields
    for (const b of data.bodies) {
      if (
        typeof b.name !== 'string' ||
        typeof b.mass !== 'number' ||
        typeof b.radius !== 'number' ||
        !b.position ||
        !b.velocity
      ) {
        return null;
      }
    }
    return {
      version: 1,
      id: data.id ?? `imp_${Date.now()}`,
      name: data.name ?? '导入的宇宙存档',
      savedAt: data.savedAt ?? new Date().toISOString(),
      scenarioId: data.scenarioId ?? 'empty',
      simTime: typeof data.simTime === 'number' ? data.simTime : 0,
      timeScale: typeof data.timeScale === 'number' ? data.timeScale : 86400 * 7,
      autoThermo: data.autoThermo ?? true,
      bodies: sanitizeBodies(data.bodies),
    };
  } catch {
    return null;
  }
}
