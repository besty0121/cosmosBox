import { Focus, X } from 'lucide-react';
import { formatMass } from '../physics/constants';
import { useCosmosStore } from '../store/useCosmosStore';

export function BodyListDrawer() {
  const open = useCosmosStore((s) => s.bodyListOpen);
  const bodies = useCosmosStore((s) => s.bodies);
  const selectedBodyId = useCosmosStore((s) => s.selectedBodyId);
  const toggleBodyList = useCosmosStore((s) => s.toggleBodyList);
  const selectBody = useCosmosStore((s) => s.selectBody);
  const focusBody = useCosmosStore((s) => s.focusBody);

  if (!open) return null;

  const sorted = [...bodies].sort((a, b) => b.mass - a.mass);

  return (
    <div className="glass-panel body-drawer">
      <div className="panel-header">
        <span>天体目录 ({bodies.length})</span>
        <button
          className="hud-btn icon-only"
          style={{ height: 26, width: 26 }}
          onClick={toggleBodyList}
        >
          <X size={13} />
        </button>
      </div>
      <div className="body-list-scroll">
        {sorted.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
            当前宇宙为空，点击下方“投放天体”开始创造
          </div>
        ) : (
          sorted.map((b) => (
            <div
              key={b.id}
              className={`body-list-item ${selectedBodyId === b.id ? 'selected' : ''}`}
              onClick={() => selectBody(b.id)}
              onDoubleClick={() => focusBody(b.id, true)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  className="body-orb"
                  style={{
                    background: b.isWormhole
                      ? 'radial-gradient(circle, #183a64 25%, #5ce1ff 75%, #c58aff 100%)'
                      : b.category === 'black_hole'
                        ? '#111'
                        : b.color,
                    color: b.isWormhole
                      ? '#76dcff'
                      : b.category === 'black_hole'
                        ? '#ff8b3d'
                        : b.color,
                    border: b.isWormhole
                      ? '1.5px solid #76dcff'
                      : b.category === 'black_hole'
                        ? '1.5px solid #ff8b3d'
                        : 'none',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                    {formatMass(b.mass)}
                  </div>
                </div>
              </div>
              <button
                className="hud-btn icon-only"
                style={{ height: 24, width: 24 }}
                title="拉近并跟随此天体"
                onClick={(e) => {
                  e.stopPropagation();
                  focusBody(b.id, true);
                }}
              >
                <Focus size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
