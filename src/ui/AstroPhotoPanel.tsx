import { useState } from 'react';
import {
  Camera,
  Eye,
  Focus,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Telescope,
  X,
} from 'lucide-react';
import {
  ASTRO_FILTER_LABELS,
  ASTRO_TELESCOPE_PRESETS,
  DEFAULT_ASTRO_SETTINGS,
  focalLengthToFovDeg,
} from '../render/AstroPhotoPipeline';
import { useCosmosStore } from '../store/useCosmosStore';
import { AstroFilterMode, AstroTelescopePreset } from '../types/cosmos';

type AstroTab = 'optics' | 'stack' | 'darkroom';

const PRESET_ORDER: AstroTelescopePreset[] = [
  'eyepiece',
  'hubble',
  'jwst',
  'newtonian',
  'refractor',
];

const FILTER_ORDER: AstroFilterMode[] = ['lrgb', 'sho', 'ha', 'oiii', 'ir'];

export function AstroPhotoPanel() {
  const [tab, setTab] = useState<AstroTab>('optics');

  const active = useCosmosStore((s) => s.astroPhotoActive);
  const settings = useCosmosStore((s) => s.astroSettings);
  const status = useCosmosStore((s) => s.astroStackStatus);

  const setAstroPhotoActive = useCosmosStore((s) => s.setAstroPhotoActive);
  const selectAstroTelescope = useCosmosStore((s) => s.selectAstroTelescope);
  const updateAstroSettings = useCosmosStore((s) => s.updateAstroSettings);
  const startAstroStacking = useCosmosStore((s) => s.startAstroStacking);
  const stopAstroStacking = useCosmosStore((s) => s.stopAstroStacking);
  const resetAstroStack = useCosmosStore((s) => s.resetAstroStack);
  const exportAstroPhoto = useCosmosStore((s) => s.exportAstroPhoto);

  if (!active) return null;

  const activePreset = ASTRO_TELESCOPE_PRESETS[settings.telescope];
  const fovDeg = focalLengthToFovDeg(settings.focalLengthMm);
  const progressPct =
    status.targetFrames > 0
      ? Math.min(100, (status.stackedFrames / status.targetFrames) * 100)
      : 0;

  return (
    <aside className="glass-panel astro-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Telescope size={15} color="#5ce1ff" />
          <span>深空天文摄影台</span>
        </div>
        <button
          className="hud-btn icon-only"
          style={{ height: 25, width: 25 }}
          onClick={() => setAstroPhotoActive(false)}
          title="退出摄影模式 (T / Esc)"
        >
          <X size={13} />
        </button>
      </div>

      <div className="astro-tabs">
        <button
          className={`astro-tab ${tab === 'optics' ? 'active' : ''}`}
          onClick={() => setTab('optics')}
        >
          <Eye size={12} />
          光学目镜
        </button>
        <button
          className={`astro-tab ${tab === 'stack' ? 'active' : ''}`}
          onClick={() => setTab('stack')}
        >
          <Focus size={12} />
          长曝堆栈
        </button>
        <button
          className={`astro-tab ${tab === 'darkroom' ? 'active' : ''}`}
          onClick={() => setTab('darkroom')}
        >
          <SlidersHorizontal size={12} />
          暗房出片
        </button>
      </div>

      <div className="astro-tab-body">
        {tab === 'optics' && (
          <>
            <div className="section-title">光学系统预设</div>
            <div className="astro-preset-grid">
              {PRESET_ORDER.map((id) => {
                const spec = ASTRO_TELESCOPE_PRESETS[id];
                return (
                  <button
                    key={id}
                    className={`hud-btn ${settings.telescope === id ? 'active' : ''}`}
                    style={{ height: 27, fontSize: 11, justifyContent: 'center' }}
                    onClick={() => selectAstroTelescope(id)}
                    title={spec.spec}
                  >
                    {spec.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
              {activePreset.spec}
            </div>

            <div className="section-title" style={{ marginTop: 4 }}>
              窄带 / 彩色滤镜
            </div>
            <div className="astro-preset-grid">
              {FILTER_ORDER.map((f) => (
                <button
                  key={f}
                  className={`hud-btn ${settings.filter === f ? 'active' : ''}`}
                  style={{ height: 26, fontSize: 10.5, justifyContent: 'center' }}
                  onClick={() => updateAstroSettings({ filter: f })}
                >
                  {ASTRO_FILTER_LABELS[f]}
                </button>
              ))}
            </div>

            <div className="slider-row" style={{ marginTop: 2 }}>
              <div className="slider-header">
                <span>等效焦距（光学变焦）</span>
                <span className="mono">
                  {settings.focalLengthMm}mm · FOV {fovDeg.toFixed(1)}°
                </span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={200}
                max={2400}
                step={20}
                value={settings.focalLengthMm}
                onChange={(e) =>
                  updateAstroSettings({ focalLengthMm: parseInt(e.target.value, 10) })
                }
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>调焦环（离焦散景测试）</span>
                <span className="mono">{Math.round(settings.defocus * 100)}%</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={0}
                max={1}
                step={0.02}
                value={settings.defocus}
                onChange={(e) => updateAstroSettings({ defocus: parseFloat(e.target.value) })}
              />
            </div>

            <div className="btn-row" style={{ marginTop: 2 }}>
              <button
                className={`hud-btn ${settings.eyepieceMask ? 'active' : ''}`}
                style={{ height: 27, fontSize: 11 }}
                onClick={() => updateAstroSettings({ eyepieceMask: !settings.eyepieceMask })}
              >
                圆形目镜视场
              </button>
              <button
                className={`hud-btn ${settings.showReticle ? 'active' : ''}`}
                style={{ height: 27, fontSize: 11 }}
                onClick={() => updateAstroSettings({ showReticle: !settings.showReticle })}
              >
                目镜十字丝
              </button>
            </div>
          </>
        )}

        {tab === 'stack' && (
          <>
            <div className="slider-row">
              <div className="slider-header">
                <span>ISO 感光度</span>
                <span className="mono">ISO {settings.iso}</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={100}
                max={6400}
                step={100}
                value={settings.iso}
                onChange={(e) => updateAstroSettings({ iso: parseInt(e.target.value, 10) })}
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>单帧模拟曝光</span>
                <span className="mono">{settings.subExposureSec} 秒</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={1}
                max={30}
                step={1}
                value={settings.subExposureSec}
                onChange={(e) =>
                  updateAstroSettings({ subExposureSec: parseInt(e.target.value, 10) })
                }
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>目标堆栈帧数</span>
                <span className="mono">{settings.targetFrames} 帧</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={8}
                max={128}
                step={4}
                value={settings.targetFrames}
                onChange={(e) =>
                  updateAstroSettings({ targetFrames: parseInt(e.target.value, 10) })
                }
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>天空光害等级 (Bortle)</span>
                <span className="mono">Bortle {settings.bortle} 级</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={1}
                max={9}
                step={1}
                value={settings.bortle}
                onChange={(e) => updateAstroSettings({ bortle: parseInt(e.target.value, 10) })}
              />
            </div>

            <button
              className={`hud-btn ${settings.mountLock ? 'active' : ''}`}
              style={{ width: '100%', justifyContent: 'center', height: 29, fontSize: 11.5 }}
              onClick={() => updateAstroSettings({ mountLock: !settings.mountLock })}
            >
              赤道仪锁定跟踪：{settings.mountLock ? '开启' : '关闭（可拍星轨）'}
            </button>

            <button
              className="hud-btn"
              style={{ width: '100%', justifyContent: 'center', height: 28, fontSize: 11.5 }}
              disabled={!status.stacking && !status.completed && status.stackedFrames === 0}
              onClick={resetAstroStack}
            >
              <RotateCcw size={12} />
              回到实时取景
            </button>
          </>
        )}

        {tab === 'darkroom' && (
          <>
            <div style={{ fontSize: 10.5, color: '#8df5c4', lineHeight: 1.35 }}>
              {status.completed
                ? '✓ 已定格堆栈底片：以下暗房调色可实时无损微调'
                : '提示：完成堆栈后可在此无损拉出暗弱星云细节'}
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>Asinh 曲线拉伸</span>
                <span className="mono">{Math.round(settings.stretch * 100)}%</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={0}
                max={1}
                step={0.02}
                value={settings.stretch}
                onChange={(e) => updateAstroSettings({ stretch: parseFloat(e.target.value) })}
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>黑场背景校准</span>
                <span className="mono">{Math.round(settings.blackPoint * 100)}%</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={0}
                max={0.35}
                step={0.01}
                value={settings.blackPoint}
                onChange={(e) =>
                  updateAstroSettings({ blackPoint: parseFloat(e.target.value) })
                }
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>色彩饱和度</span>
                <span className="mono">{Math.round(settings.saturation * 100)}%</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={0}
                max={1.8}
                step={0.04}
                value={settings.saturation}
                onChange={(e) =>
                  updateAstroSettings({ saturation: parseFloat(e.target.value) })
                }
              />
            </div>

            <div className="slider-row">
              <div className="slider-header">
                <span>衍射星芒强度</span>
                <span className="mono">{settings.spikeStrength.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={0}
                max={2.2}
                step={0.05}
                value={settings.spikeStrength}
                onChange={(e) =>
                  updateAstroSettings({ spikeStrength: parseFloat(e.target.value) })
                }
              />
            </div>

            <button
              className={`hud-btn ${settings.includeObservatoryPlate ? 'active' : ''}`}
              style={{ width: '100%', justifyContent: 'center', height: 28, fontSize: 11.5 }}
              onClick={() =>
                updateAstroSettings({
                  includeObservatoryPlate: !settings.includeObservatoryPlate,
                })
              }
            >
              出片附带天文台拍摄铭牌
            </button>

            <button
              className="hud-btn"
              style={{ width: '100%', justifyContent: 'center', height: 27, fontSize: 11 }}
              onClick={() =>
                updateAstroSettings({
                  stretch: DEFAULT_ASTRO_SETTINGS.stretch,
                  blackPoint: DEFAULT_ASTRO_SETTINGS.blackPoint,
                  saturation: DEFAULT_ASTRO_SETTINGS.saturation,
                  spikeStrength: activePreset.defaultSpikeStrength,
                })
              }
            >
              <RotateCcw size={12} />
              重置暗房参数
            </button>
          </>
        )}
      </div>

      <div className="astro-footer">
        <div className="slider-header" style={{ fontSize: 11 }}>
          <span>
            {status.stacking
              ? '正在长曝光堆栈'
              : status.completed
                ? '堆栈已定格'
                : '实时光学取景'}
          </span>
          <span className="mono">
            {status.stackedFrames}/{status.targetFrames} 帧 · SNR ×{status.snrGain.toFixed(1)}
          </span>
        </div>
        <div className="astro-progress-track">
          <div className="astro-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="btn-row">
          {status.stacking ? (
            <button
              className="hud-btn amber active"
              style={{ height: 30, fontSize: 11.5 }}
              onClick={stopAstroStacking}
            >
              <Square size={11} />
              定格堆栈
            </button>
          ) : (
            <button
              className="hud-btn active"
              style={{ height: 30, fontSize: 11.5 }}
              onClick={startAstroStacking}
            >
              <Play size={12} />
              {status.completed ? '重新堆栈' : '开始堆栈'}
            </button>
          )}
          <button
            className="hud-btn"
            style={{ height: 30, fontSize: 11.5 }}
            onClick={exportAstroPhoto}
            title="渲染并保存带有可选天文台铭牌的高清深空成片 (PNG)"
          >
            <Camera size={13} />
            保存大片
          </button>
        </div>
      </div>
    </aside>
  );
}
