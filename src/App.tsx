import { useEffect, useRef } from 'react';
import {
  Camera,
  Clapperboard,
  Compass,
  Eye,
  Film,
  Minus,
  Navigation,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { cosmosAudio } from './audio/CosmosAudio';
import { SimulationEngine } from './physics/SimulationEngine';
import { FLIGHT_GEARS, FLIGHT_GEAR_LABELS, SceneManager } from './render/SceneManager';
import { useCosmosStore } from './store/useCosmosStore';
import { BodyLabelsOverlay } from './ui/BodyLabelsOverlay';
import { BodyListDrawer } from './ui/BodyListDrawer';
import { BottomDock } from './ui/BottomDock';
import { DirectorPanel } from './ui/DirectorPanel';
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
  const directorKeyframes = useCosmosStore((s) => s.directorKeyframes);
  const directorTimeSec = useCosmosStore((s) => s.directorTimeSec);
  const directorTotalSec = useCosmosStore((s) => s.directorTotalSec);
  const directorActiveIndex = useCosmosStore((s) => s.directorActiveIndex);
  const directorPlaying = useCosmosStore((s) => s.directorPlaying);
  const recordingActive = useCosmosStore((s) => s.recordingActive);
  const recordingElapsedSec = useCosmosStore((s) => s.recordingElapsedSec);
  const toast = useCosmosStore((s) => s.toast);
  const toggleHud = useCosmosStore((s) => s.toggleHud);
  const captureScreenshot = useCosmosStore((s) => s.captureScreenshot);
  const cycleSurfaceSpot = useCosmosStore((s) => s.cycleSurfaceSpot);
  const shiftFlightGear = useCosmosStore((s) => s.shiftFlightGear);
  const toggleDirectorPause = useCosmosStore((s) => s.toggleDirectorPause);
  const stopRecording = useCosmosStore((s) => s.stopRecording);
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
      onDirectorTelemetry: (timeSec, totalSec, activeIndex, playing) => {
        useCosmosStore.setState({
          directorTimeSec: timeSec,
          directorTotalSec: totalSec,
          directorActiveIndex: activeIndex,
          directorPlaying: playing,
        });
      },
      onDirectorFinished: (wasRecording) => {
        if (!wasRecording) {
          useCosmosStore.getState().showToast('✅ 关键帧运镜预览完成');
        }
      },
      onRecordingStateChange: (recording, elapsedSec, result, errorMsg) => {
        const st = useCosmosStore.getState();
        if (errorMsg) {
          useCosmosStore.setState({ recordingActive: false, recordingElapsedSec: 0 });
          st.showToast(`❌ ${errorMsg}`);
          return;
        }
        if (result) {
          cosmosAudio.playSpawnPing();
          useCosmosStore.setState({
            recordingActive: false,
            recordingElapsedSec: 0,
            lastRecording: result,
          });
          const mb = (result.sizeBytes / (1024 * 1024)).toFixed(2);
          st.showToast(`🎬 已保存纯净 WebM 短片：${result.filename}（${mb} MB）`);
          return;
        }
        useCosmosStore.setState({
          recordingActive: recording,
          recordingElapsedSec: elapsedSec,
        });
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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const st = useCosmosStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        st.togglePause();
      } else if (e.code === 'Escape') {
        if (st.recordingActive) {
          void st.stopRecording();
        } else if (st.cameraMode !== 'orbit') {
          st.exitSpecialCameraMode();
        } else if (st.saveModalOpen) {
          st.setSaveModalOpen(false);
        } else if (st.directorOpen) {
          st.setDirectorOpen(false);
        } else if (st.spawnActive) {
          st.setSpawnActive(false);
        } else {
          st.selectBody(null);
        }
      } else if (e.key === 'h' || e.key === 'H') {
        st.toggleHud();
      } else if (e.key === 'r' || e.key === 'R') {
        if (!st.recordingActive) st.resetScenario();
      } else if (e.key === 'g' || e.key === 'G') {
        st.toggleGravityGrid();
      } else if (e.key === 'l' || e.key === 'L') {
        st.toggleLabels();
      } else if (e.key === 'c' || e.key === 'C') {
        st.toggleCinematicTour();
      } else if (e.key === 'f' || e.key === 'F') {
        st.toggleFreeFlight();
      } else if ((e.key === 'k' || e.key === 'K') && st.directorOpen) {
        st.addDirectorKeyframe();
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
          <DirectorPanel />
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

          {recordingActive && (
            <div className="glass-panel camera-mode-banner rec-banner">
              <span className="rec-dot" />
              <span>
                正在录制纯净 WebM ·{' '}
                <strong className="mono">{recordingElapsedSec.toFixed(1)}s</strong>
              </span>
              {cameraMode === 'director' && directorKeyframes.length > 0 && (
                <span className="mono" style={{ color: '#9edbff', fontSize: 11.5 }}>
                  机位 {directorActiveIndex + 1}/{directorKeyframes.length}
                </span>
              )}
              <button
                className="hud-btn danger"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={() => void stopRecording()}
              >
                <Square size={11} />
                停止并保存
              </button>
            </div>
          )}

          {!recordingActive && cameraMode === 'director' && (
            <div className="glass-panel camera-mode-banner">
              <Clapperboard size={15} color="#5ce1ff" />
              <span>
                关键帧运镜 · 机位{' '}
                <strong>
                  {Math.min(directorActiveIndex + 1, Math.max(1, directorKeyframes.length))}/
                  {Math.max(1, directorKeyframes.length)}
                </strong>{' '}
                ·{' '}
                <span className="mono">
                  {directorTimeSec.toFixed(1)}s / {directorTotalSec.toFixed(1)}s
                </span>
              </span>
              <button
                className="hud-btn"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={toggleDirectorPause}
              >
                {directorPlaying ? <Pause size={12} /> : <Play size={12} />}
                {directorPlaying ? '暂停' : '继续'}
              </button>
              <button
                className="hud-btn amber active"
                style={{ height: 26, fontSize: 11.5 }}
                onClick={exitSpecialCameraMode}
              >
                <X size={12} />
                退出运镜 (Esc)
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
                <div>空格 暂停 · G 时空网格 · V 地表 · F 飞船 · C 巡航 · K 录机位 · H 隐藏</div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="hud-restore-group">
          {recordingActive && (
            <button
              className="glass-panel hud-btn danger"
              onClick={() => void stopRecording()}
              title="停止并保存当前 WebM 录制"
            >
              <span className="rec-dot" />
              停止录制 ({recordingElapsedSec.toFixed(1)}s)
            </button>
          )}
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
