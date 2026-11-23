import { ChangeEvent, useRef, useState } from 'react';
import { Download, FolderOpen, Save, Trash2, Upload, X } from 'lucide-react';
import { downloadSaveAsJson } from '../storage/saveManager';
import { useCosmosStore } from '../store/useCosmosStore';

export function SaveLoadModal() {
  const open = useCosmosStore((s) => s.saveModalOpen);
  const savedUniverses = useCosmosStore((s) => s.savedUniverses);
  const setSaveModalOpen = useCosmosStore((s) => s.setSaveModalOpen);
  const saveUniverseLocal = useCosmosStore((s) => s.saveUniverseLocal);
  const loadSaveData = useCosmosStore((s) => s.loadSaveData);
  const removeLocalSave = useCosmosStore((s) => s.removeLocalSave);
  const exportCurrentJson = useCosmosStore((s) => s.exportCurrentJson);
  const importSaveJsonText = useCosmosStore((s) => s.importSaveJsonText);

  const [saveName, setSaveName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const handleSave = () => {
    saveUniverseLocal(saveName);
    setSaveName('');
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importSaveJsonText(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="modal-backdrop" onClick={() => setSaveModalOpen(false)}>
      <div className="glass-panel save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Save size={15} color="#5ce1ff" />
            <span>宇宙存档管理与 JSON 分享</span>
          </div>
          <button
            className="hud-btn icon-only"
            style={{ height: 26, width: 26 }}
            onClick={() => setSaveModalOpen(false)}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="save-create-row">
            <input
              className="hud-input"
              style={{ flex: 1, textAlign: 'left', height: 34 }}
              placeholder="为当前宇宙起个名字（例如：双黑洞三体星系）..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <button className="hud-btn active" style={{ height: 34 }} onClick={handleSave}>
              <Save size={14} />
              保存到本地
            </button>
          </div>

          <div className="btn-row">
            <button
              className="hud-btn"
              onClick={() => exportCurrentJson(saveName || undefined)}
            >
              <Download size={14} />
              导出当前宇宙 (.json)
            </button>
            <button className="hud-btn" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} />
              导入宇宙文件 (.json)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          <div className="section-title" style={{ marginTop: 4 }}>
            浏览器本地存档 ({savedUniverses.length})
          </div>

          <div className="save-list">
            {savedUniverses.length === 0 ? (
              <div className="empty-save-hint">
                暂无本地存档。搭建好心仪的星系后，可随时保存在这里或导出 JSON 分享给好友。
              </div>
            ) : (
              savedUniverses.map((item) => (
                <div key={item.id} className="save-item">
                  <div style={{ minWidth: 0 }}>
                    <div className="save-item-name">{item.name}</div>
                    <div className="save-item-meta mono">
                      {item.bodies.length} 个天体 ·{' '}
                      {new Date(item.savedAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button
                      className="hud-btn active"
                      style={{ height: 28, fontSize: 11.5 }}
                      onClick={() => loadSaveData(item)}
                    >
                      <FolderOpen size={12} />
                      载入
                    </button>
                    <button
                      className="hud-btn icon-only"
                      style={{ height: 28, width: 28 }}
                      title="导出此存档 JSON"
                      onClick={() => downloadSaveAsJson(item)}
                    >
                      <Download size={12} />
                    </button>
                    <button
                      className="hud-btn danger icon-only"
                      style={{ height: 28, width: 28 }}
                      title="删除存档"
                      onClick={() => removeLocalSave(item.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
