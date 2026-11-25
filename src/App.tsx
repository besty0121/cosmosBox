import { useEffect, useRef } from 'react';
import { Camera, Compass, Eye, Film, Minus, Navigation, Plus, RefreshCw, X } from 'lucide-react';
import { cosmosAudio } from './audio/CosmosAudio';
import { SimulationEngine } from './physics/SimulationEngine';
import { FLIGHT_GEARS, FLIGHT_GEAR_LABELS, SceneManager } from './render/SceneManager';
import { useCosmosStore } from './store/useCosmosStore';
import { BodyLabelsOverlay } from './ui/BodyLabelsOverlay';
import { BodyListDrawer } from './ui/BodyListDrawer';
import { BottomDock } from './ui/BottomDock';
import { InspectorPanel } from './ui/InspectorPanel';
import { SaveLoadModal } from './ui/SaveLoadModal';
import { TopBar } from './ui/TopBar';

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const hudVisible = useCosmosStore((s) => s.hudVisible);
  const spawnActive = useCosmosStore((s) => s.spawnActive);
  const cameraMode = useCosmosStore((s) => s.cameraMode);
  const cameraTargetName = useCosmosStore((s) => s.cameraTargetName);
  const flightGearIndex = useCosmosStore((s) => s.flightGearIndex);
  const flightSpeedUnits = useCosmosStore((s) => s.flightSpeedUnits);
  const toast = useCosmosStore((s) => s.toast);
  const toggleHud = useCosmosStore((s) => s.toggleHud);
  const captureScreenshot = useCosmosStore((s) => s.captureScreenshot);
  const cycleSurfaceSpot = useCosmosStore((s) => s.cycleSurfaceSpot);
  const shiftFlightGear = useCosmosStore((s) => s.shiftFlightGear);
  const exitSpecialCameraMode = useCosmosStore((s) => s.exitSpecialCameraMode);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const engine = new SimulationEngine();
    const sceneManager = new SceneManager(container, engine, {
      onSelectBody: (id) => useCosmosStore.setState({ selectedBodyId: id }),
      onSpawnedBody: (body) => {
        cosmosAudio.playSpawnPing();
        const st = useCosmosStore.getState();
        st.showToast(`✨ 已投放：${body.name}`);
        useCosmosStore.setState({
          bodies: engine.getBodySnapshots(),
          selectedBodyId: body.id,
        });
        sceneManager.selectedBodyId = body.id;
      },
      onCollision: (event) => {
        useCosmosStore.getState().pushCollisionToast(event);
      },
      onTidalDisruption: (event) => {
        useCosmosStore.getState().pushTidalToast(event);
      },
      onSupernova: (event) => {
        useCosmosStore.getState().pushSupernovaToast(event);
      },
      onKilonova: (event) => {
        useCosmosStore.getState().pushKilonovaToast(event);
      },
      onCmeImpact: (event) => {
        useCosmosStore.getState().pushCmeImpactToast(event);
      },
      onCameraModeChange: (mode, targetName) => {
        useCosmosStore.setState({
          cameraMode: mode,
          cameraTargetName: targetName ?? null,
        });
      },
      onTelemetryTick: (fps) => {
        useCosmosStore.getState().syncTelemetry(fps);
      },
      onFlightTelemetry: (gearIndex, speedUnits) => {
        useCosmosStore.setState({
          flightGearIndex: gearIndex,
          flightSpeedUnits: speedUnits,
        });
      },
      onLabelsUpdate: (labels) => {
        useCosmosStore.getState().setScreenLabels(labels);
      },
    });

    useCosmosStore.getState().attachRuntime(engine, sceneManager);

    const unlockAudio = () => {
      if (!useCosmosStore.getState().audioMuted) {
        cosmosAudio.ensureStarted();
      }
      window.removeEventListener('pointerdown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const st = useCosmosStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        st.togglePause();
      } else if (e.code === 'Escape') {
        if (st.cameraMode !== 'orbit') {
          st.exitSpecialCameraMode();
        } else if (st.saveModalOpen) {
          st.setSaveModalOpen(false);
        } else if (st.spawnActive) {
          st.setSpawnActive(false);
        } else {
          st.selectBody(null);
        }
      } else if (e.key === 'h' || e.key === 'H') {
        st.toggleHud();
      } else if (e.key === 'r' || e.key === 'R') {
        st.resetScenario();
      } else if (e.key === 'g' || e.key === 'G') {
        st.toggleGravityGrid();
      } else if (e.key === 'l' || e.key === 'L') {
        st.toggleLabels();
      } else if (e.key === 'c' || e.key === 'C') {
        st.toggleCinematicTour();
      } else if (e.key === 'f' || e.key === 'F') {
        st.toggleFreeFlight();
      } else if (e.key === 'v' || e.key === 'V') {
        if (st.cameraMode === 'surface') {
          st.exitSpecialCameraMode();
        } else if (st.selectedBodyId) {
          st.enterSurfaceView(st.selectedBodyId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', handleKeyDown);
      sceneManager.dispose();
    };
  }, []);

  return (
    <>
      <div
        ref={viewportRef}
        className={`cosmos-viewport ${spawnActive ? 'spawn-cursor' : ''}`}
      />

      {hudVisible ? (
        <div className="hud-layer">
          <BodyLabelsOverlay />
          <TopBar />
          <BodyListDrawer />
          <InspectorPanel />
          <BottomDock />
          <SaveLoadModal />

          {cameraMode === 'surface' && (
            <div className="glass-panel camera-mode-banner">
              <Compass size={15} color="#5ce1ff" />
              <span>
                地表第一人称观景：<strong>{cameraTargetName}</strong>（拖拽鼠标环顾地平线与星空）
              </span>
              <button
                className="hud-btn"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={cycleSurfaceSpot}
                title="切换不同经度位置（昼夜/晨昏线）"
              >
                <RefreshCw size={12} />
                换位置
              </button>
              <button
                className="hud-btn amber active"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={exitSpecialCameraMode}
              >
                <X size={12} />
                返回轨道 (V)
              </button>
            </div>
          )}

          {cameraMode === 'cinematic' && (
            <div className="glass-panel camera-mode-banner">
              <Film size={15} color="#ffae42" />
              <span>
                电影级自动巡航 · 正在游览：<strong>{cameraTargetName}</strong>
              </span>
              <button
                className="hud-btn amber active"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={exitSpecialCameraMode}
              >
                <X size={12} />
                退出巡航 (C)
              </button>
            </div>
          )}

          {cameraMode === 'flight' && (
            <div className="glass-panel camera-mode-banner">
              <Navigation size={15} color="#5ce1ff" />
              <span>
                自由飞船巡航 · 挡位 <strong>{flightGearIndex + 1}/{FLIGHT_GEARS.length}</strong>{' '}
                ({FLIGHT_GEAR_LABELS[flightGearIndex]})
              </span>
              <button
                className="hud-btn icon-only"
                style={{ height: 24, width: 24 }}
                onClick={() => shiftFlightGear(-1)}
                title="降挡减速（滚轮向下）"
              >
                <Minus size={12} />
              </button>
              <button
                className="hud-btn icon-only"
                style={{ height: 24, width: 24 }}
                onClick={() => shiftFlightGear(1)}
                title="升挡加速（滚轮向上）"
              >
                <Plus size={12} />
              </button>
              <span className="mono" style={{ color: '#8ad8ff', fontSize: 11.5 }}>
                {flightSpeedUnits < 10 ? flightSpeedUnits.toFixed(1) : Math.round(flightSpeedUnits)} u/s
              </span>
              <button
                className="hud-btn amber active"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={exitSpecialCameraMode}
              >
                <X size={12} />
                退出飞船 (F)
              </button>
            </div>
          )}

          {toast && <div className="cosmos-toast">{toast}</div>}

          <div className="glass-panel controls-hint">
            {cameraMode === 'flight' ? (
              <>
                <div>WASD 前后左右 · Q/E 垂直升降 · Shift 3×冲刺 · X 刹车</div>
                <div>左拖转向 · 右拖滚转 · 滚轮 8 挡变速 · F/Esc 返回轨道</div>
              </>
            ) : (
              <>
                <div>左键旋转 · 右键平移 · 滚轮缩放</div>
                <div>空格 暂停 · G 时空网格 · V 地表观景 · F 自由飞船 · C 巡航 · H 隐藏界面</div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="hud-restore-group">
          <button className="glass-panel hud-btn" onClick={captureScreenshot} title="保存无 UI 高清截图">
            <Camera size={14} />
            截图
          </button>
          <button className="glass-panel hud-btn" onClick={toggleHud}>
            <Eye size={14} />
            显示界面 (H)
          </button>
        </div>
      )}
    </>
  );
}
