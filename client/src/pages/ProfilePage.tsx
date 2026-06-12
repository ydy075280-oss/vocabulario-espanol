import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { learnAPI } from '../api';

interface Stats {
  totalCards: number;
  masteredCards: number;
  learningCards: number;
  dueNow: number;
  todayStudied: number;
  accuracy: number;
  todayMinutes: number;
}

export default function ProfilePage() {
  const { user, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(user?.nickname || '');

  useEffect(() => {
    learnAPI.stats().then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  const handleLogout = async () => {
    if (confirm('确定退出登录？')) {
      await logout();
      navigate('/auth');
    }
  };

  const handleSaveNickname = async () => {
    try {
      await updateProfile({ nickname });
      setEditing(false);
    } catch { /* ignore */ }
  };

  return (
    <div className="page-container">
      {/* Profile Header */}
      <div className="card text-center mb-6">
        <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center mx-auto mb-3">
          <span className="text-3xl font-bold text-white">
            {(user?.nickname || 'U').charAt(0).toUpperCase()}
          </span>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 justify-center mb-1">
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="input-field text-center max-w-[200px]"
              autoFocus
            />
            <button onClick={handleSaveNickname} className="text-sm text-primary font-medium">
              保存
            </button>
            <button onClick={() => setEditing(false)} className="text-sm text-text-muted">
              取消
            </button>
          </div>
        ) : (
          <h2
            className="text-lg font-bold text-text-primary cursor-pointer hover:text-primary transition-colors"
            onClick={() => setEditing(true)}
          >
            {user?.nickname || '未设置昵称'}
          </h2>
        )}
        <p className="text-sm text-text-muted mt-1">{user?.email}</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-text-secondary mb-3">学习统计</h3>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="总单词数" value={stats.totalCards} />
            <StatItem label="已掌握" value={stats.masteredCards} color="text-success" />
            <StatItem label="学习中" value={stats.learningCards} color="text-warning" />
            <StatItem label="待复习" value={stats.dueNow} color="text-danger" />
            <StatItem label="今日学习" value={stats.todayStudied} />
            <StatItem label="今日时长" value={`${stats.todayMinutes}分钟`} />
            <StatItem label="正确率" value={`${stats.accuracy}%`} color="text-success" />
            <StatItem label="复习进度" value={`${stats.masteredCards}/${stats.totalCards}`} />
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="card mb-6 divide-y divide-gray-50">
        <button onClick={() => navigate('/wordbooks')} className="w-full flex items-center justify-between py-4 text-text-primary">
          <span className="text-sm font-medium">我的单词本</span>
          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button onClick={() => navigate('/learn')} className="w-full flex items-center justify-between py-4 text-text-primary">
          <span className="text-sm font-medium">开始复习</span>
          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button onClick={() => navigate('/create')} className="w-full flex items-center justify-between py-4 text-text-primary">
          <span className="text-sm font-medium">创作中心</span>
          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Logout */}
      <button onClick={handleLogout} className="w-full py-3 text-danger text-sm font-medium rounded-btn bg-red-50 active:bg-red-100 transition-colors">
        退出登录
      </button>

      <p className="text-center text-xs text-text-muted mt-6 mb-4">
        Vocabulario v1.0 · 西班牙语词汇学习平台
      </p>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-bg-dark rounded-lg p-3 text-center">
      <p className={`text-lg font-bold ${color || 'text-text-primary'}`}>{value}</p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  );
}
