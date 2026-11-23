import { useCosmosStore } from '../store/useCosmosStore';

export function BodyLabelsOverlay() {
  const showLabels = useCosmosStore((s) => s.showLabels);
  const labels = useCosmosStore((s) => s.screenLabels);
  const selectBody = useCosmosStore((s) => s.selectBody);
  const focusBody = useCosmosStore((s) => s.focusBody);

  if (!showLabels || labels.length === 0) return null;

  return (
    <div className="labels-layer">
      {labels.map((lbl) => (
        <button
          key={lbl.id}
          className={`body-screen-label ${lbl.selected ? 'selected' : ''}`}
          style={{
            transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0) translate(-50%, -100%)`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(lbl.id);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            focusBody(lbl.id, true);
          }}
          title="单击选中 · 双击拉近观察"
        >
          <span
            className="label-dot"
            style={{ background: lbl.color, boxShadow: `0 0 6px ${lbl.color}` }}
          />
          <span className="label-name">{lbl.name}</span>
          <span className="label-sub mono">{lbl.subtitle}</span>
        </button>
      ))}
    </div>
  );
}
