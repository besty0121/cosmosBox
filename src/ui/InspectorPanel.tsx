import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Compass,
  Focus,
  Leaf,
  Lock,
  Navigation,
  Rocket,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  formatMass,
  formatRadius,
  HOUR,
  L_SUN,
  M_EARTH,
  M_JUPITER,
  M_SUN,
  R_EARTH,
  R_SUN,
} from '../physics/constants';
import { getWormholeDestinationName, WORMHOLE_DESTINATIONS } from '../scenarios/presets';
import { useCosmosStore } from '../store/useCosmosStore';
import { BodyCategory } from '../types/cosmos';

const CATEGORY_LABELS: Record<BodyCategory, string> = {
  star: '恒星',
  rocky: '岩质行星',
  gas_giant: '气态巨行星',
  ice_giant: '冰巨星',
  moon: '卫星',
  asteroid: '小行星',
  comet: '双尾冰彗星',
  black_hole: '黑洞',
  neutron_star: '中子星 / 脉冲星',
};

function getMassUnit(category: BodyCategory, massKg: number): { label: string; unitKg: number } {
  if (category === 'star' || category === 'black_hole' || category === 'neutron_star' || massKg >= 0.05 * M_SUN) {
    return { label: 'M☉', unitKg: M_SUN };
  }
  if (category === 'gas_giant' || category === 'ice_giant' || massKg >= 0.1 * M_JUPITER) {
    return { label: 'M♃', unitKg: M_JUPITER };
  }
  return { label: 'M⊕', unitKg: M_EARTH };
}

function getRadiusUnit(category: BodyCategory, radiusM: number): { label: string; unitM: number } {
  if (category === 'star' || radiusM >= 0.15 * R_SUN) {
    return { label: 'R☉', unitM: R_SUN };
  }
  if (radiusM >= 0.15 * R_EARTH) {
    return { label: 'R⊕', unitM: R_EARTH };
  }
  return { label: 'km', unitM: 1000 };
}

export function InspectorPanel() {
  const selectedBodyId = useCosmosStore((s) => s.selectedBodyId);
  const focusBodyId = useCosmosStore((s) => s.focusBodyId);
  const cameraMode = useCosmosStore((s) => s.cameraMode);
  const bodies = useCosmosStore((s) => s.bodies);
  const autoThermo = useCosmosStore((s) => s.autoThermo);

  const selectBody = useCosmosStore((s) => s.selectBody);
  const focusBody = useCosmosStore((s) => s.focusBody);
  const enterSurfaceView = useCosmosStore((s) => s.enterSurfaceView);
  const deleteBody = useCosmosStore((s) => s.deleteBody);
  const scaleBodyMass = useCosmosStore((s) => s.scaleBodyMass);
  const setBodyMassKg = useCosmosStore((s) => s.setBodyMassKg);
  const setBodyRadiusM = useCosmosStore((s) => s.setBodyRadiusM);
  const scaleBodyVelocity = useCosmosStore((s) => s.scaleBodyVelocity);
  const setBodySpeedKmS = useCosmosStore((s) => s.setBodySpeedKmS);
  const stabilizeBodyOrbit = useCosmosStore((s) => s.stabilizeBodyOrbit);
  const updateBodyProps = useCosmosStore((s) => s.updateBodyProps);
  const triggerBodySupernova = useCosmosStore((s) => s.triggerBodySupernova);
  const launchSolarCME = useCosmosStore((s) => s.launchSolarCME);
  const setAndromedaViewPreset = useCosmosStore((s) => s.setAndromedaViewPreset);
  const setPillarsViewPreset = useCosmosStore((s) => s.setPillarsViewPreset);
  const toggleFreeFlight = useCosmosStore((s) => s.toggleFreeFlight);
  const traverseWormhole = useCosmosStore((s) => s.traverseWormhole);

  const body = selectedBodyId ? bodies.find((b) => b.id === selectedBodyId) ?? null : null;

  const [massInput, setMassInput] = useState('');
  const [radiusInput, setRadiusInput] = useState('');
  const [speedInput, setSpeedInput] = useState('');

  useEffect(() => {
    if (!body) return;
    const mUnit = getMassUnit(body.category, body.mass);
    const rUnit = getRadiusUnit(body.category, body.radius);
    setMassInput((body.mass / mUnit.unitKg).toPrecision(4));
    setRadiusInput((body.radius / rUnit.unitM).toPrecision(4));
    setSpeedInput((body.speed / 1000).toFixed(2));
  }, [body?.id, body?.mass, body?.radius]);

  if (!body || cameraMode !== 'orbit') return null;

  const isLocked = focusBodyId === body.id;
  const tempC = body.temperature - 273.15;
  const densityGCm3 = body.densityKgM3 / 1000;
  const massUnit = getMassUnit(body.category, body.mass);
  const radiusUnit = getRadiusUnit(body.category, body.radius);
  const rotHours = Math.abs(body.rotationPeriod) / HOUR;

  const commitMass = () => {
    const val = parseFloat(massInput);
    if (Number.isFinite(val) && val > 0) {
      setBodyMassKg(body.id, val * massUnit.unitKg);
    }
  };

  const commitRadius = () => {
    const val = parseFloat(radiusInput);
    if (Number.isFinite(val) && val > 0) {
      setBodyRadiusM(body.id, val * radiusUnit.unitM);
    }
  };

  const commitSpeed = () => {
    const val = parseFloat(speedInput);
    if (Number.isFinite(val) && val >= 0) {
      setBodySpeedKmS(body.id, val);
    }
  };

  return (
    <div className="glass-panel inspector-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="body-orb"
            style={{
              background: body.isWormhole
                ? 'radial-gradient(circle, #183a64 25%, #5ce1ff 75%, #c58aff 100%)'
                : body.category === 'black_hole'
                  ? '#111'
                  : body.color,
              color: body.isWormhole
                ? '#76dcff'
                : body.category === 'black_hole'
                  ? '#ff8b3d'
                  : body.color,
              border: body.isWormhole
                ? '1.5px solid #76dcff'
                : body.category === 'black_hole'
                  ? '1.5px solid #ff8b3d'
                  : 'none',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {body.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {body.isWormhole
                ? '可穿越虫洞 · Morris-Thorne 时空门'
                : body.galaxyType === 'andromeda'
                  ? '旋涡星系 · SA(s)b (NGC 224)'
                  : body.galaxyType === 'dwarf_elliptical_compact'
                    ? '致密矮椭圆伴星系 · cE2 (NGC 221)'
                    : body.galaxyType === 'dwarf_elliptical_diffuse'
                      ? '矮椭圆伴星系 · dE5 pec (NGC 205)'
                      : (body.spectralClass ?? CATEGORY_LABELS[body.category])}
            </div>
          </div>
        </div>
        <button
          className="hud-btn icon-only"
          style={{ height: 26, width: 26 }}
          onClick={() => selectBody(null)}
        >
          <X size={13} />
        </button>
      </div>

      <div className="inspector-body">
        {/* Live status badges */}
        {body.rocheStress > 0.05 && (
          <div className="status-banner danger">
            <AlertTriangle size={13} />
            <span>洛希极限潮汐撕裂警告 ({Math.round(body.rocheStress * 100)}%)</span>
          </div>
        )}

        {body.isWhiteDwarf && (
          <div
            className="status-banner"
            style={{
              background: 'rgba(84, 184, 255, 0.14)',
              borderColor: 'rgba(116, 208, 255, 0.45)',
              color: '#a8e4ff',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span>钱德拉塞卡极限 (Ia 型超新星)</span>
              <span className="mono">
                {(body.mass / M_SUN).toFixed(3)} / 1.440 M☉
              </span>
            </div>
            <div
              style={{
                height: 5,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.12)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, (body.mass / (1.44 * M_SUN)) * 100)}%`,
                  background: 'linear-gradient(90deg, #5ce1ff, #ffae42, #ff4d4d)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        )}

        {(body.blazarJetPower ?? 0) > 0.05 && (
          <div
            className="status-banner"
            style={{
              background: 'rgba(116, 86, 255, 0.18)',
              borderColor: 'rgba(148, 122, 255, 0.5)',
              color: '#c9b8ff',
            }}
          >
            <Sparkles size={13} />
            <span>相对论性耀变体喷流激活 ({Math.round((body.blazarJetPower ?? 0) * 100)}%)</span>
          </div>
        )}

        {!body.galaxyType && !body.isWormhole && body.category === 'rocky' && body.habitability > 0 && (
          <div className="status-banner habitable">
            <Leaf size={13} />
            <span>行星宜居指数：{body.habitability}%</span>
          </div>
        )}

        <div className="btn-row">
          <button
            className={`hud-btn ${isLocked ? 'active' : ''}`}
            onClick={() => focusBody(isLocked ? null : body.id, false)}
            title="锁定镜头随天体移动"
          >
            {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
            {isLocked ? '解除锁定' : '跟随锁定'}
          </button>
          <button
            className="hud-btn"
            onClick={() => focusBody(body.id, true)}
            title="将镜头拉近至该天体"
          >
            <Focus size={13} />
            拉近观察
          </button>
          {!body.galaxyType && !body.isWormhole && body.category !== 'star' && body.category !== 'black_hole' && (
            <button
              className="hud-btn active"
              onClick={() => enterSurfaceView(body.id)}
              title="降落到天体表面仰望地平线与星空 (V)"
            >
              <Compass size={13} />
              降落观景
            </button>
          )}
          <button
            className="hud-btn danger icon-only"
            style={{ flex: '0 0 32px' }}
            onClick={() => deleteBody(body.id)}
            title="删除该天体"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Core telemetry readout */}
        {body.isWormhole ? (
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">时空度规</div>
              <div className="stat-value mono">Morris-Thorne</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">事件视界</div>
              <div className="stat-value" style={{ color: '#70f7c8' }}>无（双向可穿越）</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">喉部半径 b₀</div>
              <div className="stat-value mono">{(body.wormholeThroatScale ?? 1.55).toFixed(2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">连接彼岸星域</div>
              <div className="stat-value" style={{ fontSize: 11.5 }}>
                {getWormholeDestinationName(body.wormholeDestination ?? 'pillars_of_creation')}
              </div>
            </div>
          </div>
        ) : body.galaxyType ? (
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">总质量</div>
              <div className="stat-value mono">{formatMass(body.mass)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">星系半径</div>
              <div className="stat-value mono">{formatRadius(body.radius)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">物理直径</div>
              <div className="stat-value mono">
                {body.galaxyType === 'andromeda'
                  ? '15.2 万光年'
                  : body.galaxyType === 'dwarf_elliptical_compact'
                    ? '6,500 光年'
                    : '1.7 万光年'}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">距地球</div>
              <div className="stat-value mono">
                {body.galaxyType === 'andromeda'
                  ? '254 万光年'
                  : body.galaxyType === 'dwarf_elliptical_compact'
                    ? '249 万光年'
                    : '269 万光年'}
              </div>
            </div>
          </div>
        ) : (
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">质量</div>
              <div className="stat-value mono">{formatMass(body.mass)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">
                {body.category === 'black_hole' ? '史瓦西半径' : '物理半径'}
              </div>
              <div className="stat-value mono">{formatRadius(body.radius)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">运动速度</div>
              <div className="stat-value mono">{(body.speed / 1000).toFixed(2)} km/s</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">
                {body.category === 'black_hole'
                  ? '吸积活跃度'
                  : body.category === 'star'
                    ? '辐射光度'
                    : '平均密度'}
              </div>
              <div className="stat-value mono">
                {body.category === 'black_hole'
                  ? `${Math.round(body.accretionFlare * 100)}%`
                  : body.category === 'star'
                    ? `${(body.luminosity / L_SUN).toFixed(2)} L☉`
                    : `${densityGCm3 > 1000 ? densityGCm3.toExponential(1) : densityGCm3.toFixed(2)} g/cm³`}
              </div>
            </div>
            <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
              <div className="stat-label">
                {body.category === 'black_hole'
                  ? '事件视界状态'
                  : `表面温度 ${autoThermo && body.category !== 'star' && body.category !== 'neutron_star' ? `（辐射平衡 ≈ ${Math.round(body.equilibriumTemp)} K）` : ''}`}
              </div>
              <div className="stat-value mono">
                {body.category === 'black_hole'
                  ? '引力奇点 · 相对论吸积盘'
                  : `${Math.round(body.temperature)} K (${Math.round(tempC)}°C)`}
              </div>
            </div>
            {body.distanceToPrimaryAU !== null && (
              <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                <div className="stat-label">距主引力源（{body.primaryName}）</div>
                <div className="stat-value mono">
                  {body.distanceToPrimaryAU < 0.05
                    ? `${Math.round(body.distanceToPrimaryAU * 1.496e8).toLocaleString()} km`
                    : `${body.distanceToPrimaryAU.toFixed(3)} AU`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mass & Radius Exact Editor */}
        {!body.galaxyType && !body.isWormhole && (
        <>
        <div className="control-section">
          <div className="section-title">质量与尺寸（精确编辑）</div>
          <div className="btn-row">
            <button className="hud-btn" onClick={() => scaleBodyMass(body.id, 0.5)}>
              ×0.5
            </button>
            <button className="hud-btn" onClick={() => scaleBodyMass(body.id, 0.8)}>
              ×0.8
            </button>
            <button className="hud-btn" onClick={() => scaleBodyMass(body.id, 1.25)}>
              ×1.25
            </button>
            <button className="hud-btn" onClick={() => scaleBodyMass(body.id, 2.0)}>
              ×2.0
            </button>
          </div>

          <div className="exact-row">
            <span className="exact-label">质量 ({massUnit.label})</span>
            <input
              className="hud-input mono"
              value={massInput}
              onChange={(e) => setMassInput(e.target.value)}
              onBlur={commitMass}
              onKeyDown={(e) => e.key === 'Enter' && commitMass()}
            />
          </div>

          {body.category !== 'black_hole' && (
            <div className="exact-row">
              <span className="exact-label">半径 ({radiusUnit.label})</span>
              <input
                className="hud-input mono"
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                onBlur={commitRadius}
                onKeyDown={(e) => e.key === 'Enter' && commitRadius()}
              />
            </div>
          )}
        </div>

        {/* Kinematics & Spin */}
        <div className="control-section">
          <div className="section-title">轨道速度与自转</div>
          <div className="btn-row">
            <button
              className="hud-btn active"
              onClick={() => stabilizeBodyOrbit(body.id)}
              title="将当前天体速度自动校准为环绕主引力源的稳定圆轨道"
            >
              自动入轨
            </button>
            <button className="hud-btn" onClick={() => scaleBodyVelocity(body.id, 0)}>
              归零制动
            </button>
            <button className="hud-btn" onClick={() => scaleBodyVelocity(body.id, 0.85)}>
              -15%
            </button>
            <button className="hud-btn" onClick={() => scaleBodyVelocity(body.id, 1.15)}>
              +15%
            </button>
          </div>

          <div className="exact-row">
            <span className="exact-label">速度 (km/s)</span>
            <input
              className="hud-input mono"
              value={speedInput}
              onChange={(e) => setSpeedInput(e.target.value)}
              onBlur={commitSpeed}
              onKeyDown={(e) => e.key === 'Enter' && commitSpeed()}
            />
          </div>

          <div className="slider-row">
            <div className="slider-header">
              <span>自转轴倾角</span>
              <span className="mono">{Math.round(body.axialTiltDeg)}°</span>
            </div>
            <input
              type="range"
              className="cosmos-slider"
              min={0}
              max={180}
              step={1}
              value={Math.min(180, Math.max(0, body.axialTiltDeg))}
              onChange={(e) =>
                updateBodyProps(body.id, { axialTiltDeg: parseFloat(e.target.value) })
              }
            />
          </div>

          {body.category !== 'black_hole' && body.category !== 'neutron_star' && (
            <div className="slider-row">
              <div className="slider-header">
                <span>自转周期</span>
                <span className="mono">{rotHours.toFixed(1)} 小时</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={2}
                max={720}
                step={1}
                value={Math.min(720, Math.max(2, rotHours))}
                onChange={(e) =>
                  updateBodyProps(body.id, { rotationHours: parseFloat(e.target.value) })
                }
              />
            </div>
          )}
        </div>

        {/* Thermodynamics & Surface Climate */}
        {body.category !== 'black_hole' && body.category !== 'neutron_star' && (
          <div className="control-section">
            <div className="section-title">热力学与气候演化</div>

            <div className="slider-row">
              <div className="slider-header">
                <span>当前温度</span>
                <span className="mono">{Math.round(body.temperature)} K</span>
              </div>
              <input
                type="range"
                className="cosmos-slider"
                min={body.category === 'star' ? 2400 : 40}
                max={body.category === 'star' ? 32000 : 2200}
                step={body.category === 'star' ? 100 : 10}
                value={Math.min(body.category === 'star' ? 32000 : 2200, body.temperature)}
                onChange={(e) =>
                  updateBodyProps(body.id, { temperature: parseFloat(e.target.value) })
                }
              />
            </div>

            {body.category !== 'star' && (
              <>
                <div className="slider-row">
                  <div className="slider-header">
                    <span>反照率 (Albedo)</span>
                    <span className="mono">{body.albedo.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    className="cosmos-slider"
                    min={0.02}
                    max={0.9}
                    step={0.01}
                    value={body.albedo}
                    onChange={(e) =>
                      updateBodyProps(body.id, { albedo: parseFloat(e.target.value) })
                    }
                  />
                </div>

                <div className="slider-row">
                  <div className="slider-header">
                    <span>温室效应</span>
                    <span className="mono">{body.greenhouse.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    className="cosmos-slider"
                    min={0}
                    max={2.6}
                    step={0.05}
                    value={body.greenhouse}
                    onChange={(e) =>
                      updateBodyProps(body.id, { greenhouse: parseFloat(e.target.value) })
                    }
                  />
                </div>
              </>
            )}

            {body.category === 'rocky' && (
              <>
                <div className="slider-row">
                  <div className="slider-header">
                    <span>液态水覆盖率</span>
                    <span className="mono">{Math.round(body.waterFraction * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    className="cosmos-slider"
                    min={0}
                    max={0.95}
                    step={0.01}
                    value={body.waterFraction}
                    onChange={(e) =>
                      updateBodyProps(body.id, { waterFraction: parseFloat(e.target.value) })
                    }
                  />
                </div>

                <div className="slider-row">
                  <div className="slider-header">
                    <span>大气层厚度</span>
                    <span className="mono">{body.atmosphereDensity.toFixed(2)} atm</span>
                  </div>
                  <input
                    type="range"
                    className="cosmos-slider"
                    min={0}
                    max={2}
                    step={0.05}
                    value={body.atmosphereDensity}
                    onChange={(e) =>
                      updateBodyProps(body.id, {
                        atmosphereDensity: parseFloat(e.target.value),
                      })
                    }
                  />
                </div>

                {(body.name.includes('地球') || body.auroraIntensity !== undefined) && (() => {
                  const auroraVal = body.auroraIntensity ?? 0.78;
                  const kp = Math.min(9, Math.round(auroraVal * 6));
                  const kpLabel =
                    kp === 0
                      ? '平静'
                      : kp <= 4
                        ? '活跃'
                        : kp <= 6
                          ? 'G2 地磁暴'
                          : kp <= 8
                            ? 'G4 强地磁暴'
                            : 'G5 超级极光暴';
                  return (
                    <div className="slider-row" style={{ marginTop: 6 }}>
                      <div className="slider-header">
                        <span>南北极光 · 地磁暴</span>
                        <span className="mono" style={{ color: '#4ff2a6' }}>
                          Kp {kp} · {kpLabel}
                        </span>
                      </div>
                      <input
                        type="range"
                        className="cosmos-slider"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={auroraVal}
                        onChange={(e) =>
                          updateBodyProps(body.id, {
                            auroraIntensity: parseFloat(e.target.value),
                          })
                        }
                      />
                      <button
                        className="hud-btn"
                        style={{
                          marginTop: 6,
                          width: '100%',
                          justifyContent: 'center',
                          borderColor:
                            auroraVal >= 1.35 ? 'rgba(79, 242, 166, 0.7)' : undefined,
                          color: auroraVal >= 1.35 ? '#66ffbd' : undefined,
                        }}
                        onClick={() =>
                          updateBodyProps(body.id, {
                            auroraIntensity: auroraVal >= 1.35 ? 0.78 : 1.5,
                          })
                        }
                        title="模拟太阳日冕物质抛射 (CME) 冲击地球磁层，激发出扩张至中纬度的 G5 级红绿极光幕帘"
                      >
                        <Sparkles size={13} />
                        {auroraVal >= 1.35 ? '恢复常态极光 (Kp 5)' : '触发 G5 级极光大爆发 (Kp 9)'}
                      </button>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
        </>
        )}

        {/* Andromeda Galaxy (M31) & Satellites Observatory Panel */}
        {body.galaxyType && (() => {
          const dustVal = body.galaxyDustOpacity ?? 1.0;
          const specMode = body.galaxySpectrumMode ?? 'optical';
          const isM31 = body.galaxyType === 'andromeda';
          const isM32 = body.galaxyType === 'dwarf_elliptical_compact';
          return (
            <div className="control-section">
              <div className="section-title">
                {isM31 ? '仙女座星系观测台' : '矮椭圆伴星系观测档案'}
              </div>

              <div className="stat-grid" style={{ marginBottom: 8 }}>
                {isM31 ? (
                  <>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">观测几何与距离</div>
                      <div className="stat-value mono" style={{ fontSize: 11.5 }}>
                        距地球 254 万光年 (778 kpc) · 倾角 77° · PA 38°
                      </div>
                    </div>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">银心特征</div>
                      <div className="stat-value" style={{ fontSize: 11.5 }}>
                        P1/P2 双星核 · M31* ≈ 1.4×10⁸ M☉
                      </div>
                    </div>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">标志性结构</div>
                      <div className="stat-value" style={{ fontSize: 11.5 }}>
                        10 kpc 恒星形成环 · 巨星云 NGC 206 · 约 1 万亿颗恒星
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">形态分类</div>
                      <div className="stat-value" style={{ fontSize: 11.5 }}>
                        {isM32 ? 'cE2 致密椭圆星系 (NGC 221)' : 'dE5 pec 矮椭圆星系 (NGC 205)'}
                      </div>
                    </div>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">天体物理特征</div>
                      <div className="stat-value" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                        {isM32
                          ? '核球恒星极度致密，外层包层疑在与 M31 的近距潮汐交汇中被剥离'
                          : '外包层柔和延展，核周保有微弱暗尘埃云团与年轻蓝星群，与 M31 存在潮汐互动'}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {isM31 ? (
                <>
                  <div className="section-title" style={{ marginTop: 8 }}>多波段观测</div>
                  <div className="btn-row" style={{ marginBottom: 8 }}>
                    <button
                      className={`hud-btn ${specMode === 'optical' ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => updateBodyProps(body.id, { galaxySpectrumMode: 'optical' })}
                    >
                      光学实拍
                    </button>
                    <button
                      className={`hud-btn ${specMode === 'infrared' ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => updateBodyProps(body.id, { galaxySpectrumMode: 'infrared' })}
                    >
                      红外尘埃环
                    </button>
                    <button
                      className={`hud-btn ${specMode === 'ultraviolet' ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => updateBodyProps(body.id, { galaxySpectrumMode: 'ultraviolet' })}
                    >
                      紫外星环
                    </button>
                  </div>

                  <div className="slider-row">
                    <div className="slider-header">
                      <span>尘埃消光带浓度</span>
                      <span className="mono" style={{ color: '#e6b88a' }}>
                        {Math.round(dustVal * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      className="cosmos-slider"
                      min={0}
                      max={1.8}
                      step={0.05}
                      value={dustVal}
                      onChange={(e) =>
                        updateBodyProps(body.id, { galaxyDustOpacity: parseFloat(e.target.value) })
                      }
                    />
                  </div>

                  <div className="section-title" style={{ marginTop: 8 }}>天文快捷视角</div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 6,
                    }}
                  >
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setAndromedaViewPreset('earth')}
                    >
                      🔭 地球视角 (77°)
                    </button>
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setAndromedaViewPreset('face_on')}
                    >
                      🛸 俯视星系盘
                    </button>
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setAndromedaViewPreset('edge_on')}
                    >
                      🌌 侧视尘埃带
                    </button>
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setAndromedaViewPreset('core')}
                    >
                      🔬 深入双星核
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="hud-btn active"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => setAndromedaViewPreset('earth')}
                >
                  🔭 返回仙女座全貌 (77° 地球视角)
                </button>
              )}
            </div>
          );
        })()}

        {/* Pillars of Creation (M16) & NGC 6611 Ionizing Cluster Observatory */}
        {body.nebulaType && (() => {
          const isPillars = body.nebulaType === 'pillars_of_creation';
          const specMode = body.nebulaSpectrumMode ?? 'jwst_nircam';
          const irVal =
            body.nebulaIrPenetration ?? (specMode === 'hst_optical' ? 0.0 : 0.92);
          const densityVal = body.nebulaDensity ?? 1.0;

          return (
            <div className="control-section">
              <div className="section-title">
                {isPillars ? '鹰状星云 · 创生之柱观测台' : 'NGC 6611 幼年星团观测档案'}
              </div>

              <div className="stat-grid" style={{ marginBottom: 8 }}>
                {isPillars ? (
                  <>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">天体尺度与方位</div>
                      <div className="stat-value mono" style={{ fontSize: 11.5 }}>
                        距地球约 6,500 光年 (M16 巨蛇座) · 主柱跨高约 4–5 光年
                      </div>
                    </div>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">光致蒸发与恒星孕育</div>
                      <div className="stat-value" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                        冷分子氢气与硅酸盐尘埃柱顶部包裹 EGGs 蒸发气态球，红宝石色原恒星与 HH 喷流正在其间诞生
                      </div>
                    </div>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">雕刻辐射源</div>
                      <div className="stat-value" style={{ fontSize: 11.5 }}>
                        外上侧 NGC 6611 幼年 O/B 星团强烈紫外电离风自左上方向下冲刷柱群
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">星团性质</div>
                      <div className="stat-value" style={{ fontSize: 11.5 }}>
                        年龄约 100–200 万年 · 富含 O4/O5/B 型极端大质量炽热恒星
                      </div>
                    </div>
                    <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="stat-label">动力学效应</div>
                      <div className="stat-value" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                        持续释放强紫外电离辐射与高速恒星风，吹散 M16 分子云并雕刻出创生之柱的三维手指状空腔
                      </div>
                    </div>
                  </>
                )}
              </div>

              {isPillars ? (
                <>
                  <div className="section-title" style={{ marginTop: 8 }}>多波段望远镜观测</div>
                  <div className="btn-row" style={{ marginBottom: 8 }}>
                    <button
                      className={`hud-btn ${specMode === 'hst_optical' ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                      onClick={() =>
                        updateBodyProps(body.id, {
                          nebulaSpectrumMode: 'hst_optical',
                          nebulaIrPenetration: 0.0,
                        })
                      }
                    >
                      哈勃可见光 (HST)
                    </button>
                    <button
                      className={`hud-btn ${specMode === 'jwst_nircam' ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                      onClick={() =>
                        updateBodyProps(body.id, {
                          nebulaSpectrumMode: 'jwst_nircam',
                          nebulaIrPenetration: 0.92,
                        })
                      }
                    >
                      韦伯近红外 (NIRCam)
                    </button>
                    <button
                      className={`hud-btn ${specMode === 'jwst_miri' ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                      onClick={() =>
                        updateBodyProps(body.id, {
                          nebulaSpectrumMode: 'jwst_miri',
                          nebulaIrPenetration: 0.98,
                        })
                      }
                    >
                      韦伯中红外 (MIRI)
                    </button>
                  </div>

                  <div className="slider-row">
                    <div className="slider-header">
                      <span>红外尘埃穿透 (HST ⇄ JWST)</span>
                      <span className="mono" style={{ color: '#f3a36d' }}>
                        {Math.round(irVal * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      className="cosmos-slider"
                      min={0}
                      max={1}
                      step={0.02}
                      value={irVal}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        updateBodyProps(body.id, {
                          nebulaIrPenetration: v,
                          nebulaSpectrumMode: v >= 0.45 ? 'jwst_nircam' : 'hst_optical',
                        });
                      }}
                    />
                  </div>

                  <div className="slider-row">
                    <div className="slider-header">
                      <span>冷分子尘埃柱浓度</span>
                      <span className="mono" style={{ color: '#9cd2e6' }}>
                        {Math.round(densityVal * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      className="cosmos-slider"
                      min={0.4}
                      max={1.8}
                      step={0.05}
                      value={densityVal}
                      onChange={(e) =>
                        updateBodyProps(body.id, { nebulaDensity: parseFloat(e.target.value) })
                      }
                    />
                  </div>

                  <div className="section-title" style={{ marginTop: 8 }}>ESO MUSE 3D 快捷视角</div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setPillarsViewPreset('classic')}
                    >
                      🏛️ 哈勃/韦伯经典视角
                    </button>
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setPillarsViewPreset('canyon')}
                    >
                      🏜️ 柱间峡谷仰视
                    </button>
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setPillarsViewPreset('muse_side')}
                    >
                      📐 ESO MUSE 3D 侧视
                    </button>
                    <button
                      className="hud-btn"
                      style={{ justifyContent: 'center', fontSize: 11.5 }}
                      onClick={() => setPillarsViewPreset('tips')}
                    >
                      🌟 柱顶原恒星喷流
                    </button>
                  </div>

                  <button
                    className="hud-btn active"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => toggleFreeFlight()}
                  >
                    🛸 驾驶飞船穿越创生之柱 (F)
                  </button>
                </>
              ) : (
                <button
                  className="hud-btn active"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => setPillarsViewPreset('classic')}
                >
                  🏛️ 返回创生之柱全景
                </button>
              )}
            </div>
          );
        })()}

        {/* Gravitational Lensing Controls (Einstein Ring <-> 4-Image Einstein Cross) */}
        {body.isGravitationalLens && (() => {
          const shearVal = body.lensShear ?? 0;
          const modeLabel =
            shearVal < 0.05
              ? '完美爱因斯坦环'
              : shearVal < 0.16
                ? '椭圆透镜双弧'
                : '四重爱因斯坦十字';
          return (
            <div className="control-section">
              <div className="section-title">广义相对论引力透镜</div>
              <div className="slider-row">
                <div className="slider-header">
                  <span>四极剪切 / 椭率 (γ)</span>
                  <span className="mono" style={{ color: '#8ad8ff' }}>
                    {shearVal.toFixed(2)} · {modeLabel}
                  </span>
                </div>
                <input
                  type="range"
                  className="cosmos-slider"
                  min={0}
                  max={0.28}
                  step={0.01}
                  value={shearVal}
                  onChange={(e) =>
                    updateBodyProps(body.id, { lensShear: parseFloat(e.target.value) })
                  }
                />
              </div>
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button
                  className={`hud-btn ${shearVal < 0.05 ? 'active' : ''}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => updateBodyProps(body.id, { lensShear: 0.0 })}
                >
                  ⭕ 爱因斯坦环
                </button>
                <button
                  className={`hud-btn ${shearVal >= 0.18 ? 'active' : ''}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => updateBodyProps(body.id, { lensShear: 0.24 })}
                >
                  ✚ 爱因斯坦十字
                </button>
              </div>
              <div style={{ fontSize: 11, opacity: 0.72, marginTop: 6, lineHeight: 1.45 }}>
                拖动鼠标环绕透镜可实时弯折背景星系弧；调节上方质量（×0.5 / ×2）可实时缩放爱因斯坦半径 θₑ ∝ √M。
              </div>
            </div>
          );
        })()}

        {/* Traversable Morris-Thorne Wormhole Portal Controls */}
        {body.isWormhole && (() => {
          const curDest = body.wormholeDestination ?? 'pillars_of_creation';
          const throatScale = body.wormholeThroatScale ?? 1.55;
          const throatLength = body.wormholeLength ?? 1.0;

          return (
            <div className="control-section">
              <div className="section-title">🌀 虫洞时空传送门控制台</div>

              <div className="section-title" style={{ marginTop: 4 }}>彼岸连接目标宇宙</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 6,
                  marginBottom: 10,
                }}
              >
                {WORMHOLE_DESTINATIONS.map((dest) => (
                  <button
                    key={dest.id}
                    className={`hud-btn ${curDest === dest.id ? 'active' : ''}`}
                    style={{ justifyContent: 'center', fontSize: 11.5 }}
                    onClick={() => updateBodyProps(body.id, { wormholeDestination: dest.id })}
                  >
                    {`${dest.label.split(' ')[0]} ${dest.shortLabel}`}
                  </button>
                ))}
              </div>

              <div className="slider-row">
                <div className="slider-header">
                  <span>虫洞喉部半径 (b₀)</span>
                  <span className="mono" style={{ color: '#76dcff' }}>
                    {throatScale.toFixed(2)} rₛ
                  </span>
                </div>
                <input
                  type="range"
                  className="cosmos-slider"
                  min={0.9}
                  max={2.3}
                  step={0.05}
                  value={throatScale}
                  onChange={(e) =>
                    updateBodyProps(body.id, { wormholeThroatScale: parseFloat(e.target.value) })
                  }
                />
              </div>

              <div className="slider-row">
                <div className="slider-header">
                  <span>喉管长度与爱因斯坦环曲率 (a)</span>
                  <span className="mono" style={{ color: '#c89bff' }}>
                    {throatLength.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  className="cosmos-slider"
                  min={0.15}
                  max={2.8}
                  step={0.05}
                  value={throatLength}
                  onChange={(e) =>
                    updateBodyProps(body.id, { wormholeLength: parseFloat(e.target.value) })
                  }
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
                <button
                  className="hud-btn wormhole-cta"
                  onClick={() => traverseWormhole(body.id)}
                >
                  <Rocket size={14} />
                  🚀 一键穿越虫洞
                </button>
                <button
                  className="hud-btn"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => toggleFreeFlight()}
                >
                  <Navigation size={13} />
                  🛸 驾驶飞船亲身穿喉 (F)
                </button>
              </div>

              <div style={{ fontSize: 11, opacity: 0.72, marginTop: 7, lineHeight: 1.45 }}>
                拖动鼠标可 360° 透视晶球彼岸星域；在飞船模式 (`F`) 中直接飞入喉部将自动触发时空跃迁并在抵达点生成双向返回星门。
              </div>
            </div>
          );
        })()}

        {/* Stellar Evolution / CME & Supernova Triggers */}
        {body.category === 'star' && (
          <div className="control-section">
            <div className="section-title">恒星高能与演化实验</div>
            {!body.isWhiteDwarf && (
              <div className="btn-row" style={{ marginBottom: 8 }}>
                <button
                  className="hud-btn"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    borderColor: 'rgba(255, 168, 66, 0.55)',
                    color: '#ffbe6b',
                  }}
                  onClick={() => launchSolarCME(body.id, 'random')}
                  title="在太阳 ±34° 黑子活跃带随机经纬度触发日冕爆发（CME），同步掀起太阳海啸波纹与日珥喷涌"
                >
                  <Sparkles size={13} />
                  随机日冕爆发
                </button>
                <button
                  className="hud-btn"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    borderColor: 'rgba(102, 200, 255, 0.48)',
                    color: '#88d6ff',
                  }}
                  onClick={() => launchSolarCME(body.id, 'target')}
                  title="朝地球/行星方向定向触发超级太阳风暴，实时观测地球磁层偏转与 G5 极光大爆发"
                >
                  定向冲击地球
                </button>
              </div>
            )}
            <button
              className="hud-btn supernova-btn"
              onClick={() => triggerBodySupernova(body.id)}
              title="立即引爆该恒星，质量 < 8 M☉ 将坍缩为中子星，≥ 8 M☉ 将坍缩为黑洞"
            >
              <Sparkles size={14} />
              触发超新星爆发（{body.mass >= 8 * M_SUN ? '坍缩为黑洞' : '坍缩为中子星'}）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
