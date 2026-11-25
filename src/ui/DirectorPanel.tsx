import { ChangeEvent, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Crosshair,
  Download,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { isWebMRecordingSupported } from '../render/VideoRecorder';
import { useCosmosStore } from '../store/useCosmosStore';
import {
  DirectorEasing,
  DirectorFps,
  DirectorKeyframe,
  DirectorResolution,
} from '../types/cosmos';

function formatAstroChip(kf: DirectorKeyframe): string | null {
  if (kf.nebulaSpectrumMode === 'hst_optical') return 'HST';
  if (kf.nebulaSpectrumMode === 'jwst_nircam') return 'NIRCam';
  if (kf.nebulaSpectrumMode === 'jwst_miri') return 'MIRI';
  if (kf.galaxySpectrumMode === 'infrared') return '红外';
  if (kf.galaxySpectrumMode === 'ultraviolet') return '紫外';
  if (kf.galaxySpectrumMode === 'optical') return '光学';
  if (kf.lensShear !== undefined) return `剪切 ${kf.lensShear.toFixed(2)}`;
  if (kf.auroraIntensity !== undefined) return `极光 ${kf.auroraIntensity.toFixed(1)}`;
  return null;
}

export function DirectorPanel() {
  const open = useCosmosStore((s) => s.directorOpen);
  const cameraMode = useCosmosStore((s) => s.cameraMode);
  const keyframes = useCosmosStore((s) => s.directorKeyframes);
  const timeSec = useCosmosStore((s) => s.directorTimeSec);
  const totalSec = useCosmosStore((s) => s.directorTotalSec);
  const activeIndex = useCosmosStore((s) => s.directorActiveIndex);
  const playing = useCosmosStore((s) => s.directorPlaying);
  const loop = useCosmosStore((s) => s.directorLoop);
  const resolution = useCosmosStore((s) => s.directorResolution);
  const fps = useCosmosStore((s) => s.directorFps);
  const includeAudio = useCosmosStore((s) => s.directorIncludeAudio);
  const recordingActive = useCosmosStore((s) => s.recordingActive);
  const recordingElapsedSec = useCosmosStore((s) => s.recordingElapsedSec);
  const lastRecording = useCosmosStore((s) => s.lastRecording);

  const setDirectorOpen = useCosmosStore((s) => s.setDirectorOpen);
  const addDirectorKeyframe = useCosmosStore((s) => s.addDirectorKeyframe);
  const updateDirectorKeyframe = useCosmosStore((s) => s.updateDirectorKeyframe);
  const recaptureDirectorKeyframe = useCosmosStore((s) => s.recaptureDirectorKeyframe);
  const moveDirectorKeyframe = useCosmosStore((s) => s.moveDirectorKeyframe);
  const removeDirectorKeyframe = useCosmosStore((s) => s.removeDirectorKeyframe);
  const clearDirectorKeyframes = useCosmosStore((s) => s.clearDirectorKeyframes);
  const jumpToDirectorKeyframe = useCosmosStore((s) => s.jumpToDirectorKeyframe);
  const generateDirectorStoryboard = useCosmosStore((s) => s.generateDirectorStoryboard);
  const playDirectorScript = useCosmosStore((s) => s.playDirectorScript);
  const toggleDirectorPause = useCosmosStore((s) => s.toggleDirectorPause);
  const stopDirectorPlayback = useCosmosStore((s) => s.stopDirectorPlayback);
  const seekDirectorTime = useCosmosStore((s) => s.seekDirectorTime);
  const setDirectorLoop = useCosmosStore((s) => s.setDirectorLoop);
  const setDirectorResolution = useCosmosStore((s) => s.setDirectorResolution);
  const setDirectorFps = useCosmosStore((s) => s.setDirectorFps);
  const setDirectorIncludeAudio = useCosmosStore((s) => s.setDirectorIncludeAudio);
  const recordDirectorScript = useCosmosStore((s) => s.recordDirectorScript);
  const toggleFreeRecording = useCosmosStore((s) => s.toggleFreeRecording);
  const stopRecording = useCosmosStore((s) => s.stopRecording);
  const exportDirectorScriptJson = useCosmosStore((s) => s.exportDirectorScriptJson);
  const importDirectorScriptJson = useCosmosStore((s) => s.importDirectorScriptJson);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const webmSupported = isWebMRecordingSupported();

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importDirectorScriptJson(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const resolutionOpts: { id: DirectorResolution; label: string }[] = [
    { id: 'viewport', label: '窗口' },
    { id: '720p', label: '720p' },
    { id: '1080p', label: '1080p' },
  ];

  const fpsOpts: DirectorFps[] = [30, 60];

  return (
    <aside className="glass-panel director-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Clapperboard size={15} color="#5ce1ff" />
          <span>关键帧运镜与录影</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            className="hud-btn active"
            style={{ height: 25, padding: '0 8px', fontSize: 11 }}
            onClick={generateDirectorStoryboard}
            disabled={recordingActive}
            title="一键为当前场景生成推荐运镜分镜脚本"
          >
            <Sparkles size={12} />
            智能分镜
          </button>
          <button
            className="hud-btn icon-only"
            style={{ height: 25, width: 25 }}
            onClick={() => setDirectorOpen(false)}
            title="关闭面板"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="director-toolbar">
        <button
          className="hud-btn active"
          style={{ flex: 1, justifyContent: 'center', height: 29, fontSize: 11.5 }}
          onClick={() => addDirectorKeyframe()}
          disabled={recordingActive}
          title="将当前镜头姿态记录为新关键机位 (K)"
        >
          <Plus size={13} />
          记录机位 (K)
        </button>
        <button
          className="hud-btn icon-only"
          style={{ height: 29, width: 29 }}
          onClick={exportDirectorScriptJson}
          disabled={keyframes.length === 0}
          title="导出运镜脚本 (.json)"
        >
          <Download size={13} />
        </button>
        <button
          className="hud-btn icon-only"
          style={{ height: 29, width: 29 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={recordingActive}
          title="导入运镜脚本 (.json)"
        >
          <Upload size={13} />
        </button>
        <button
          className="hud-btn danger icon-only"
          style={{ height: 29, width: 29 }}
          onClick={clearDirectorKeyframes}
          disabled={keyframes.length === 0 || recordingActive}
          title="清空全部机位"
        >
          <Trash2 size={13} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      <div className="director-kf-list">
        {keyframes.length === 0 ? (
          <div className="empty-save-hint" style={{ padding: '14px 10px', fontSize: 11.5 }}>
            点击上方「记录机位」或按 <span className="mono">K</span> 捕捉视角，或点右上角「✨ 智能分镜」一键生成大片运镜脚本。
          </div>
        ) : (
          keyframes.map((kf, idx) => {
            const isActive =
              idx === activeIndex && (cameraMode === 'director' || playing);
            const chip = formatAstroChip(kf);
            return (
              <div key={kf.id} className={`kf-card ${isActive ? 'active' : ''}`}>
                <div className="kf-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <span className="kf-index mono">#{idx + 1}</span>
                    <span className="kf-name" title={kf.name}>
                      {kf.name}
                    </span>
                    <span className="kf-chip mono">{Math.round(kf.fov)}°</span>
                    {chip && <span className="kf-chip">{chip}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <button
                      className="hud-btn icon-only"
                      style={{ height: 22, width: 22 }}
                      onClick={() => jumpToDirectorKeyframe(kf.id)}
                      disabled={recordingActive}
                      title="跳转到此机位"
                    >
                      <Crosshair size={11} />
                    </button>
                    <button
                      className="hud-btn icon-only"
                      style={{ height: 22, width: 22 }}
                      onClick={() => recaptureDirectorKeyframe(kf.id)}
                      disabled={recordingActive}
                      title="用当前视角覆盖此机位"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      className="hud-btn icon-only"
                      style={{ height: 22, width: 22 }}
                      onClick={() => moveDirectorKeyframe(kf.id, -1)}
                      disabled={idx === 0 || recordingActive}
                      title="上移"
                    >
                      <ChevronUp size={11} />
                    </button>
                    <button
                      className="hud-btn icon-only"
                      style={{ height: 22, width: 22 }}
                      onClick={() => moveDirectorKeyframe(kf.id, 1)}
                      disabled={idx === keyframes.length - 1 || recordingActive}
                      title="下移"
                    >
                      <ChevronDown size={11} />
                    </button>
                    <button
                      className="hud-btn danger icon-only"
                      style={{ height: 22, width: 22 }}
                      onClick={() => removeDirectorKeyframe(kf.id)}
                      disabled={recordingActive}
                      title="删除机位"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                <div className="kf-card-controls">
                  {idx > 0 && (
                    <label className="kf-field">
                      <span>过渡</span>
                      <input
                        type="number"
                        className="kf-num"
                        min={0.5}
                        max={30}
                        step={0.5}
                        value={kf.durationSec}
                        disabled={recordingActive}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v)) {
                            updateDirectorKeyframe(kf.id, {
                              durationSec: Math.max(0.25, Math.min(30, v)),
                            });
                          }
                        }}
                      />
                    </label>
                  )}
                  <label className="kf-field">
                    <span>停留</span>
                    <input
                      type="number"
                      className="kf-num"
                      min={0}
                      max={15}
                      step={0.2}
                      value={kf.holdSec}
                      disabled={recordingActive}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) {
                          updateDirectorKeyframe(kf.id, {
                            holdSec: Math.max(0, Math.min(15, v)),
                          });
                        }
                      }}
                    />
                  </label>
                  {idx > 0 && (
                    <select
                      className="kf-select"
                      value={kf.easing}
                      disabled={recordingActive}
                      onChange={(e) =>
                        updateDirectorKeyframe(kf.id, {
                          easing: e.target.value as DirectorEasing,
                        })
                      }
                    >
                      <option value="cinematicSlow">电影缓动</option>
                      <option value="easeInOut">平滑加减速</option>
                      <option value="smoothstep">柔顺过渡</option>
                      <option value="linear">匀速直线</option>
                    </select>
                  )}
                  <label className="kf-field">
                    <span>FOV</span>
                    <input
                      type="number"
                      className="kf-num"
                      min={22}
                      max={85}
                      step={1}
                      value={Math.round(kf.fov)}
                      disabled={recordingActive}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) {
                          updateDirectorKeyframe(kf.id, {
                            fov: Math.max(22, Math.min(85, v)),
                          });
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="director-section">
        <div className="slider-header" style={{ marginBottom: 4 }}>
          <span>时间线预览</span>
          <span className="mono">
            {timeSec.toFixed(1)}s / {totalSec.toFixed(1)}s
          </span>
        </div>
        <input
          type="range"
          className="cosmos-slider"
          min={0}
          max={Math.max(0.1, totalSec)}
          step={0.05}
          value={Math.min(timeSec, totalSec)}
          disabled={keyframes.length === 0 || recordingActive}
          onChange={(e) => seekDirectorTime(parseFloat(e.target.value))}
        />
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button
            className={`hud-btn ${playing ? 'amber active' : 'active'}`}
            onClick={() =>
              cameraMode === 'director' ? toggleDirectorPause() : playDirectorScript()
            }
            disabled={keyframes.length < 2 || recordingActive}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {cameraMode === 'director' ? (playing ? '暂停' : '继续') : '预览运镜'}
          </button>
          <button
            className="hud-btn"
            onClick={stopDirectorPlayback}
            disabled={cameraMode !== 'director' || recordingActive}
            title="停止运镜并返回自由轨道"
          >
            <Square size={11} />
            停止
          </button>
          <button
            className={`hud-btn icon-only ${loop ? 'active' : ''}`}
            style={{ flex: '0 0 30px' }}
            onClick={() => setDirectorLoop(!loop)}
            disabled={recordingActive}
            title={loop ? '循环预览：开启' : '循环预览：关闭'}
          >
            <Repeat size={13} />
          </button>
        </div>
      </div>

      <div className="director-section">
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>纯净 WebM 视频输出</span>
          {!webmSupported && <span style={{ color: '#ff8e99' }}>当前浏览器不支持</span>}
        </div>

        <div className="btn-row">
          {resolutionOpts.map((opt) => (
            <button
              key={opt.id}
              className={`hud-btn ${resolution === opt.id ? 'active' : ''}`}
              style={{ height: 25, fontSize: 11 }}
              disabled={recordingActive}
              onClick={() => setDirectorResolution(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="btn-row">
          {fpsOpts.map((f) => (
            <button
              key={f}
              className={`hud-btn ${fps === f ? 'active' : ''}`}
              style={{ height: 25, fontSize: 11 }}
              disabled={recordingActive}
              onClick={() => setDirectorFps(f)}
            >
              {f} fps
            </button>
          ))}
          <button
            className={`hud-btn ${includeAudio ? 'active' : ''}`}
            style={{ height: 25, fontSize: 11 }}
            disabled={recordingActive}
            onClick={() => setDirectorIncludeAudio(!includeAudio)}
            title="开启后将 Web Audio 太空音效同步混入录制视频"
          >
            {includeAudio ? <Volume2 size={12} /> : <VolumeX size={12} />}
            含音效
          </button>
        </div>

        {recordingActive ? (
          <button className="hud-btn director-btn-rec active" onClick={() => void stopRecording()}>
            <span className="rec-dot" />
            停止并保存 WebM（{recordingElapsedSec.toFixed(1)}s）
          </button>
        ) : (
          <div className="btn-row">
            <button
              className="hud-btn director-btn-rec"
              disabled={!webmSupported || keyframes.length < 2}
              onClick={recordDirectorScript}
              title="按关键帧脚本自动运镜并录制无 UI 纯净 WebM 视频"
            >
              <Video size={13} />
              运镜并录制
            </button>
            <button
              className="hud-btn"
              disabled={!webmSupported}
              onClick={toggleFreeRecording}
              title="保持当前手动/飞船控制并直接录制纯净画布"
            >
              <span className="rec-dot" style={{ opacity: webmSupported ? 0.85 : 0.3 }} />
              自由录屏
            </button>
          </div>
        )}

        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          直采纯净 3D 画布，导出的 WebM 自动无任何 UI 与准星
        </div>

        {lastRecording && (
          <div className="director-last-rec mono" title={lastRecording.filename}>
            ✓ {lastRecording.filename} · {(lastRecording.sizeBytes / (1024 * 1024)).toFixed(2)} MB
          </div>
        )}
      </div>
    </aside>
  );
}
