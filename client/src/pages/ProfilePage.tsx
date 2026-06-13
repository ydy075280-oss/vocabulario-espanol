import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const SPEED_OPTIONS = [
  { value: 0.5,  label: '0.5x', desc: '很慢' },
  { value: 0.75, label: '0.75x', desc: '较慢' },
  { value: 1.0,  label: '1.0x', desc: '正常' },
  { value: 1.25, label: '1.25x', desc: '较快' },
  { value: 1.5,  label: '1.5x', desc: '快速' },
] as const;

export default function ProfilePage() {
  const { user, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [savingSpeed, setSavingSpeed] = useState(false);

  const handleLogout = async () => {
    if (confirm('确定退出登录？')) { await logout(); navigate('/auth'); }
  };

  const handleSaveNickname = async () => {
    try { await updateProfile({ nickname }); setEditing(false); } catch {}
  };

  const handleSpeedChange = useCallback(async (speed: number) => {
    if (savingSpeed || speed === (user?.tts_speed ?? 1.0)) return;
    setSavingSpeed(true);
    try {
      await updateProfile({ tts_speed: speed });
    } catch { /* ignore */ }
    finally { setSavingSpeed(false); }
  }, [savingSpeed, user?.tts_speed, updateProfile]);

  return (
    <div className="page-container">
      <div className="card text-center mb-6 p-6">
        <div className="w-20 h-20 rounded-pill bg-surface border border-hairline-soft flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl text-ink" style={{ fontFamily: "'Geist Mono', monospace" }}>
            {(user?.nickname || 'U').charAt(0).toUpperCase()}
          </span>
        </div>
        {editing ? (
          <div className="flex items-center gap-2 justify-center mb-1">
            <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} className="input-field text-center max-w-[200px]" autoFocus />
            <button onClick={handleSaveNickname} className="text-sm text-ink font-medium">保存</button>
            <button onClick={() => setEditing(false)} className="text-sm text-typo-muted">取消</button>
          </div>
        ) : (
          <h2 className="text-lg text-ink cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setEditing(true)}
              style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif", fontWeight: 500 }}>
            {user?.nickname || '未设置昵称'}
          </h2>
        )}
        <p className="text-sm text-typo-muted mt-1">{user?.email}</p>
      </div>

      <div className="card mb-6">
        <h3 className="text-eyebrow uppercase text-typo-muted mb-4" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>朗诵语速</h3>
        <p className="text-xs text-typo-muted mb-4">设置单词和句子的默认朗读语速，学习卡片页面可临时覆盖</p>
        <div className="flex items-center gap-2 flex-wrap">
          {SPEED_OPTIONS.map((opt) => {
            const isActive = (user?.tts_speed ?? 1.0) === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleSpeedChange(opt.value)}
                disabled={savingSpeed}
                className={`
                  flex-1 min-w-[64px] py-2.5 rounded-card text-sm font-medium border transition-all duration-200
                  ${isActive
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface border-hairline-soft text-typo-secondary hover:text-ink hover:border-hairline'
                  }
                  ${savingSpeed ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <div style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>{opt.label}</div>
                <div className="text-[10px] opacity-60 mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <button onClick={handleLogout} className="w-full py-3 text-danger text-sm rounded-pill bg-danger-muted border border-danger/10 hover:opacity-80 transition-all duration-200">
        退出登录
      </button>

      <p className="text-center text-xs text-typo-muted mt-6 mb-4">西语词汇学习平台 v1.0</p>
    </div>
  );
}
