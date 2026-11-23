import { Crosshair, Pause, Play, Plus, Sparkles, Target, X } from 'lucide-react';
import { formatTimeScale, TIME_PRESETS, YEAR } from '../physics/constants';
import { SPAWN_TEMPLATES } from '../scenarios/templates';
import { useCosmosStore } from '../store/useCosmosStore';
import { LaunchMode } from '../types/cosmos';

const LOG_MIN = Math.log10(1); // 1 sec/sec
const LOG_MAX = Math.log10(YEAR); // 1 year/sec

export function BottomDock() {
  const paused = useCosmosStore((s) => s.paused);
  const timeScale = useCosmosStore((s) => s.timeScale);
  const spawnActive = useCosmosStore((s) => s.spawnActive);
  const selectedTemplateId = useCosmosStore((s) => s.selectedTemplateId);
  const launchMode = useCosmosStore((s) => s.launchMode);

  const togglePause = useCosmosStore((s) => s.togglePause);
  const setTimeScale = useCosmosStore((s) => s.setTimeScale);
  const setSpawnActive = useCosmosStore((s) => s.setSpawnActive);
  const setSelectedTemplateId = useCosmosStore((s) => s.setSelectedTemplateId);
  const setLaunchMode = useCosmosStore((s) => s.setLaunchMode);

  const sliderVal = Math.max(LOG_MIN, Math.min(LOG_MAX, Math.log10(Math.max(1, timeScale))));

  const launchModes: { id: LaunchMode; label: string; hint: string }[] = [
    { id: 'orbit', label: '自动入轨', hint: '点击即按圆轨道速度公转' },
    { id: 'slingshot', label: '弹弓发射', hint: '左键按住拖拽拉出初速度矢量' },
    { id: 'stationary', label: '静止投放', hint: '相对参考系零初速放下' },
  ];

  return (
    <div className="bottom-container">
      {spawnActive && (
        <div className="glass-panel spawn-palette">
          <div className="spawn-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#5ce1ff" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>选择要投放的天体</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {launchModes.find((m) => m.id === launchMode)?.hint}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {launchModes.map((m) => (
                <button
                  key={m.id}
                  className={`hud-btn ${launchMode === m.id ? 'active' : ''}`}
                  style={{ height: 27, fontSize: 11.5 }}
                  onClick={() => setLaunchMode(m.id)}
                >
                  {m.id === 'orbit' && <Target size={12} />}
                  {m.id === 'slingshot' && <Crosshair size={12} />}
                  {m.label}
                </button>
              ))}
              <button
                className="hud-btn icon-only"
                style={{ height: 27, width: 27 }}
                onClick={() => setSpawnActive(false)}
                title="退出投放模式 (ESC)"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          <div className="spawn-grid">
            {SPAWN_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                className={`spawn-card ${selectedTemplateId === tpl.id ? 'selected' : ''}`}
                onClick={() => setSelectedTemplateId(tpl.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className="body-orb"
                    style={{
                      background: tpl.category === 'black_hole' ? '#111' : tpl.color,
                      color: tpl.category === 'black_hole' ? '#ff8b3d' : tpl.color,
                      border: tpl.category === 'black_hole' ? '1.5px solid #ff8b3d' : 'none',
                    }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#eef4ff' }}>
                    {tpl.name}
                  </span>
                </div>
                <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  {tpl.subtitle}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel bottom-dock">
        <button
          className={`hud-btn ${paused ? 'amber active' : 'active'}`}
          onClick={togglePause}
          title="暂停 / 继续 (Space)"
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? '继续' : '暂停'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 195 }}>
          <input
            type="range"
            className="cosmos-slider"
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.02}
            value={sliderVal}
            onChange={(e) => setTimeScale(Math.pow(10, parseFloat(e.target.value)))}
          />
          <span className="mono" style={{ fontSize: 11.5, minWidth: 74, textAlign: 'right' }}>
            {paused ? '已暂停' : formatTimeScale(timeScale)}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {TIME_PRESETS.filter((_, idx) => idx === 2 || idx === 3 || idx === 4 || idx === 6).map(
            (p) => (
              <button
                key={p.label}
                className={`hud-btn ${
                  !paused && Math.abs(timeScale - p.value) / p.value < 0.08 ? 'active' : ''
                }`}
                style={{ height: 28, padding: '0 8px', fontSize: 11 }}
                onClick={() => setTimeScale(p.value)}
              >
                {p.label}
              </button>
            )
          )}
        </div>

        <div className="dock-divider" />

        <button
          className={`hud-btn ${spawnActive ? 'active' : ''}`}
          onClick={() => setSpawnActive(!spawnActive)}
          title="打开天体投放工具"
        >
          <Plus size={15} />
          {spawnActive ? '正在投放' : '投放天体'}
        </button>
      </div>
    </div>
  );
}
