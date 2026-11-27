import { useState } from 'react';
import {
  BookmarkPlus,
  Camera,
  Clapperboard,
  EyeOff,
  Film,
  Flame,
  Grid,
  History,
  Layers,
  List,
  Navigation,
  Orbit,
  RotateCcw,
  Save,
  Scaling,
  ShieldAlert,
  Sprout,
  Tag,
  Telescope,
  Volume2,
  VolumeX,
  Wind,
  Zap,
} from 'lucide-react';
import { formatSimTime } from '../physics/constants';
import { SCENARIOS } from '../scenarios/presets';
import { useCosmosStore } from '../store/useCosmosStore';

export function TopBar() {
  const [overlayOpen, setOverlayOpen] = useState(false);

  const scenarioId = useCosmosStore((s) => s.scenarioId);
  const cameraMode = useCosmosStore((s) => s.cameraMode);
  const graphicsQuality = useCosmosStore((s) => s.graphicsQuality);
  const scaleMode = useCosmosStore((s) => s.scaleMode);
  const showTrails = useCosmosStore((s) => s.showTrails);
  const showGravityGrid = useCosmosStore((s) => s.showGravityGrid);
  const showHabitableZone = useCosmosStore((s) => s.showHabitableZone);
  const showVectors = useCosmosStore((s) => s.showVectors);
  const showRocheLimits = useCosmosStore((s) => s.showRocheLimits);
  const showLabels = useCosmosStore((s) => s.showLabels);
  const showSpaceWeatherField = useCosmosStore((s) => s.showSpaceWeatherField);
  const autoThermo = useCosmosStore((s) => s.autoThermo);
  const audioMuted = useCosmosStore((s) => s.audioMuted);
  const bodyListOpen = useCosmosStore((s) => s.bodyListOpen);
  const directorOpen = useCosmosStore((s) => s.directorOpen);
  const astroPhotoActive = useCosmosStore((s) => s.astroPhotoActive);
  const recordingActive = useCosmosStore((s) => s.recordingActive);
  const simTime = useCosmosStore((s) => s.simTime);
  const fps = useCosmosStore((s) => s.fps);
  const bodyCount = useCosmosStore((s) => s.bodies.length);
  const debrisCount = useCosmosStore((s) => s.debrisCount);
  const galaxyStarCount = useCosmosStore((s) => s.galaxyStarCount);
  const snapshotCount = useCosmosStore((s) => s.snapshots.length);

  const loadScenario = useCosmosStore((s) => s.loadScenario);
  const resetScenario = useCosmosStore((s) => s.resetScenario);
  const setScaleMode = useCosmosStore((s) => s.setScaleMode);
  const toggleGraphicsQuality = useCosmosStore((s) => s.toggleGraphicsQuality);
  const toggleCinematicTour = useCosmosStore((s) => s.toggleCinematicTour);
  const toggleFreeFlight = useCosmosStore((s) => s.toggleFreeFlight);
  const toggleTrails = useCosmosStore((s) => s.toggleTrails);
  const toggleGravityGrid = useCosmosStore((s) => s.toggleGravityGrid);
  const toggleHabitableZone = useCosmosStore((s) => s.toggleHabitableZone);
  const toggleVectors = useCosmosStore((s) => s.toggleVectors);
  const toggleRocheLimits = useCosmosStore((s) => s.toggleRocheLimits);
  const toggleLabels = useCosmosStore((s) => s.toggleLabels);
  const toggleSpaceWeatherField = useCosmosStore((s) => s.toggleSpaceWeatherField);
  const toggleAutoThermo = useCosmosStore((s) => s.toggleAutoThermo);
  const toggleAudioMute = useCosmosStore((s) => s.toggleAudioMute);
  const toggleBodyList = useCosmosStore((s) => s.toggleBodyList);
  const toggleDirectorOpen = useCosmosStore((s) => s.toggleDirectorOpen);
  const toggleAstroPhoto = useCosmosStore((s) => s.toggleAstroPhoto);
  const toggleHud = useCosmosStore((s) => s.toggleHud);
  const setSaveModalOpen = useCosmosStore((s) => s.setSaveModalOpen);
  const takeSnapshot = useCosmosStore((s) => s.takeSnapshot);
  const restoreLatestSnapshot = useCosmosStore((s) => s.restoreLatestSnapshot);
  const captureScreenshot = useCosmosStore((s) => s.captureScreenshot);

  const activeOverlayCount = [
    showGravityGrid,
    showHabitableZone,
    showVectors,
    showRocheLimits,
    showLabels,
  ].filter(Boolean).length;

  return (
    <div className="top-bar">
      <div className="glass-panel top-group">
        <div className="brand-badge">
          <span className="brand-dot" />
          <div>
            <div className="brand-title">CosmosBox</div>
            <div className="brand-sub">宇宙物理沙盒</div>
          </div>
        </div>

        <select
          className="hud-select"
          value={scenarioId}
          onChange={(e) => {
            loadScenario(e.target.value);
            e.currentTarget.blur();
          }}
          title="切换预设宇宙场景"
        >
          {SCENARIOS.map((sc) => (
            <option key={sc.id} value={sc.id}>
              预设：{sc.name}
            </option>
          ))}
        </select>

        <button className="hud-btn icon-only" onClick={resetScenario} title="重置当前场景 (R)">
          <RotateCcw size={14} />
        </button>

        <button
          className={`hud-btn ${bodyListOpen ? 'active' : ''}`}
          onClick={toggleBodyList}
          title="展开/折叠天体目录"
        >
          <List size={14} />
          天体 ({bodyCount})
        </button>
      </div>

      <div className="glass-panel top-group" style={{ position: 'relative' }}>
        <button
          className={`hud-btn ${scaleMode === 'real' ? 'amber active' : ''}`}
          onClick={() => setScaleMode(scaleMode === 'playable' ? 'real' : 'playable')}
          title="在智能放大比例与 1:1 真实天文比例之间切换"
        >
          <Scaling size={14} />
          {scaleMode === 'playable' ? '智能比例' : '真实比例'}
        </button>

        <button
          className={`hud-btn ${graphicsQuality === 'fast' ? 'amber active' : ''}`}
          onClick={toggleGraphicsQuality}
          title="切换高画质（HDR泛光）与极致流畅模式"
        >
          <Zap size={14} />
          {graphicsQuality === 'fast' ? '流畅模式' : '高画质'}
        </button>

        <button
          className={`hud-btn ${cameraMode === 'cinematic' ? 'amber active' : ''}`}
          onClick={toggleCinematicTour}
          title="开启/退出电影级自动运镜巡航 (C)"
        >
          <Film size={14} />
          {cameraMode === 'cinematic' ? '巡航中' : '巡航'}
        </button>

        <button
          className={`hud-btn ${cameraMode === 'flight' ? 'active' : ''}`}
          onClick={toggleFreeFlight}
          title="进入/退出 6 自由度自由飞船巡航模式 (F)"
        >
          <Navigation size={14} />
          {cameraMode === 'flight' ? '飞船中' : '飞船'}
        </button>

        <button
          className={`hud-btn ${directorOpen || cameraMode === 'director' || recordingActive ? 'active' : ''}`}
          onClick={toggleDirectorOpen}
          title="关键帧运镜脚本与纯净 MP4 / WebM 视频录制 (K 记录机位)"
        >
          {recordingActive ? <span className="rec-dot" /> : <Clapperboard size={14} />}
          {recordingActive ? '录制中' : '运镜'}
        </button>

        <button
          className={`hud-btn ${astroPhotoActive ? 'active' : ''}`}
          onClick={toggleAstroPhoto}
          title="虚拟深空天文摄影：望远镜目镜与长曝光堆栈 (T)"
        >
          <Telescope size={14} />
          {astroPhotoActive ? '摄影中' : '摄影'}
        </button>

        <button
          className={`hud-btn ${showGravityGrid ? 'active' : ''}`}
          onClick={toggleGravityGrid}
          title="开关 3D 时空弯曲引力势阱网格 (G)"
        >
          <Grid size={14} />
          时空网格
        </button>

        <button
          className={`hud-btn ${overlayOpen || activeOverlayCount > 0 ? 'active' : ''}`}
          onClick={() => setOverlayOpen((v) => !v)}
          title="科学可视化叠加层设置"
        >
          <Layers size={14} />
          叠加层{activeOverlayCount > 0 ? ` (${activeOverlayCount})` : ''}
        </button>

        <div className="dock-divider" style={{ height: 18 }} />

        <button className="hud-btn icon-only" onClick={takeSnapshot} title="记录当前时间快照">
          <BookmarkPlus size={14} />
        </button>

        <button
          className={`hud-btn ${snapshotCount > 0 ? 'amber active' : ''}`}
          onClick={restoreLatestSnapshot}
          title="回溯到上一个时间快照"
          style={{ padding: '0 8px' }}
        >
          <History size={14} />
          {snapshotCount > 0 ? snapshotCount : ''}
        </button>

        <button
          className="hud-btn icon-only"
          onClick={() => setSaveModalOpen(true)}
          title="存档管理 / JSON 导入导出"
        >
          <Save size={14} />
        </button>

        <button
          className="hud-btn icon-only"
          onClick={captureScreenshot}
          title="一键保存高清无 UI 宇宙截图 (PNG)"
        >
          <Camera size={14} />
        </button>

        <button
          className={`hud-btn icon-only ${!audioMuted ? 'active' : ''}`}
          onClick={toggleAudioMute}
          title={audioMuted ? '开启太空环境音效' : '静音太空环境音效'}
        >
          {audioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>

        <div className="telemetry-pill">
          <span>
            <strong className="mono">{formatSimTime(simTime)}</strong>
          </span>
          {galaxyStarCount > 0 && (
            <span>
              恒星 <strong className="mono">{galaxyStarCount}</strong>
            </span>
          )}
          {debrisCount > 0 && (
            <span>
              碎片 <strong className="mono">{debrisCount}</strong>
            </span>
          )}
          <span>
            <strong className="mono">{fps}</strong> FPS
          </span>
        </div>

        <button className="hud-btn icon-only" onClick={toggleHud} title="隐藏界面 (H)">
          <EyeOff size={14} />
        </button>

        {overlayOpen && (
          <div className="glass-panel overlay-popover">
            <div className="section-title" style={{ marginBottom: 4 }}>
              科学可视化与物理开关
            </div>
            <button
              className={`overlay-toggle-item ${showGravityGrid ? 'active' : ''}`}
              onClick={toggleGravityGrid}
            >
              <Grid size={14} />
              <span>3D 时空弯曲引力网格</span>
            </button>
            <button
              className={`overlay-toggle-item ${showHabitableZone ? 'active' : ''}`}
              onClick={toggleHabitableZone}
            >
              <Sprout size={14} />
              <span>恒星宜居带光环</span>
            </button>
            <button
              className={`overlay-toggle-item ${showVectors ? 'active' : ''}`}
              onClick={toggleVectors}
            >
              <Navigation size={14} />
              <span>速度 / 加速度 3D 矢量</span>
            </button>
            <button
              className={`overlay-toggle-item ${showRocheLimits ? 'active' : ''}`}
              onClick={toggleRocheLimits}
            >
              <ShieldAlert size={14} />
              <span>洛希极限潮汐边界圈</span>
            </button>
            <button
              className={`overlay-toggle-item ${showLabels ? 'active' : ''}`}
              onClick={toggleLabels}
            >
              <Tag size={14} />
              <span>屏幕空间天体信息标签</span>
            </button>
            <button
              className={`overlay-toggle-item ${showTrails ? 'active' : ''}`}
              onClick={toggleTrails}
            >
              <Orbit size={14} />
              <span>天体轨道尾迹</span>
            </button>
            <button
              className={`overlay-toggle-item ${showSpaceWeatherField ? 'active' : ''}`}
              onClick={toggleSpaceWeatherField}
              title="关闭即切换至纯肉眼光学视角（隐藏不可见的太阳风粒子流与磁力线，仅保留耀斑、日珥与地球极光）"
            >
              <Wind size={14} />
              <span>太阳风粒子流与磁力线</span>
            </button>
            <button
              className={`overlay-toggle-item ${autoThermo ? 'active' : ''}`}
              onClick={toggleAutoThermo}
            >
              <Flame size={14} />
              <span>多恒星动态热力学演化</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
