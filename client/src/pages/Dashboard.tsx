import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { learnAPI, wordbookAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTTS } from '../hooks/useTTS';

interface Stats {
  totalCards: number;
  masteredCards: number;
  learningCards: number;
  dueNow: number;
  todayStudied: number;
  accuracy: number;
  avgEaseFactor: number;
  todayMinutes: number;
}

interface Wordbook {
  id: string;
  name: string;
  source_type: string;
  teacher_tag: string;
  card_count: number;
  updated_at: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { speak } = useTTS();
  const [stats, setStats] = useState<Stats | null>(null);
  const [wordbooks, setWordbooks] = useState<Wordbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      learnAPI.stats().catch(() => null),
      wordbookAPI.list().catch(() => ({ data: { wordbooks: [] } })),
    ]).then(([statsRes, booksRes]) => {
      if (statsRes?.data) setStats(statsRes.data);
      if (booksRes?.data?.wordbooks) setWordbooks(booksRes.data.wordbooks.slice(0, 5));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-hairline border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  const getSourceLabel = (type: string) => {
    const map: Record<string, { label: string; color: string }> = {
      create: { label: '创作', color: 'bg-accent-muted text-accent' },
      video: { label: '视频', color: 'bg-accent-muted text-accent' },
      image: { label: '图片', color: 'bg-success-muted text-success' },
      pdf: { label: 'PDF', color: 'bg-danger-muted text-danger' },
      docx: { label: 'Word', color: 'bg-accent-muted text-accent' },
      manual: { label: '手动', color: 'bg-brand-muted text-typo-secondary' },
    };
    return map[type] || { label: type, color: 'bg-brand-muted text-typo-secondary' };
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-display-md text-ink"
              style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
            ¡Hola{user?.nickname ? `, ${user.nickname}` : ''}!
          </h1>
          <p className="text-typo-secondary text-sm mt-1">
            {stats ? `已学 ${stats.totalCards} 个词` : '开始学习吧'}
          </p>
        </div>
        <button
          onClick={() => navigate('/profile')}
          className="w-10 h-10 rounded-pill bg-surface border border-hairline-soft text-ink flex items-center justify-center font-medium text-sm
                     hover:bg-surface-hover transition-all duration-200"
          style={{ fontFamily: "'Geist Mono', monospace" }}
        >
          {(user?.nickname || 'U').charAt(0).toUpperCase()}
        </button>
      </div>

      {/* Stats Cards — responsive grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div
            className="card-hover bg-miro-yellow-light border border-miro-yellow/30"
            onClick={() => navigate('/learn')}
          >
            <p className="text-eyebrow uppercase text-typo-muted mb-2"
               style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
              今日待复习
            </p>
            <p className="text-display-md text-ink mb-1"
               style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
              {stats.dueNow}
            </p>
            <p className="text-typo-secondary text-xs">张卡片等待复习</p>
          </div>
          <div className="card bg-success-muted/30 border border-success/10">
            <p className="text-eyebrow uppercase text-typo-muted mb-2"
               style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
              已掌握
            </p>
            <p className="text-display-md text-success mb-1"
               style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
              {stats.masteredCards}
            </p>
            <p className="text-typo-secondary text-xs">
              正确率 {stats.accuracy}%
            </p>
          </div>
          <div className="card">
            <p className="text-eyebrow uppercase text-typo-muted mb-2"
               style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
              今日已学
            </p>
            <p className="text-display-md text-warning mb-1"
               style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
              {stats.todayStudied}
            </p>
            <p className="text-typo-secondary text-xs">{stats.todayMinutes} 分钟</p>
          </div>
          <div className="card">
            <p className="text-eyebrow uppercase text-typo-muted mb-2"
               style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
              学习中
            </p>
            <p className="text-display-md text-accent mb-1"
               style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
              {stats.learningCards}
            </p>
            <p className="text-typo-secondary text-xs">
              熟练度 {stats.avgEaseFactor}
            </p>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <button
          onClick={() => navigate('/learn')}
          className="card flex flex-col items-center justify-center py-6 hover:border-hairline active:scale-[0.97] transition-all duration-200"
        >
          <svg className="w-7 h-7 text-ink mb-3 opacity-70" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-sm font-medium text-ink">开始复习</span>
        </button>
        <button
          onClick={() => navigate('/upload')}
          className="card flex flex-col items-center justify-center py-6 hover:border-hairline active:scale-[0.97] transition-all duration-200"
        >
          <svg className="w-7 h-7 text-ink mb-3 opacity-70" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12" />
          </svg>
          <span className="text-sm font-medium text-ink">上传资料</span>
        </button>
      </div>

      {/* Stats Detail — secondary metrics */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
          {[
            { value: stats.totalCards, label: '总词量', color: 'text-ink' },
            { value: `${stats.accuracy}%`, label: '正确率', color: 'text-success' },
            { value: stats.todayMinutes, label: '分钟', color: 'text-warning' },
            { value: stats.avgEaseFactor, label: '熟练度', color: 'text-accent' },
          ].map((item) => (
            <div key={item.label}
                 className="bg-surface rounded-card p-3 text-center border border-hairline-soft">
              <p className={`text-lg font-medium ${item.color}`}
                 style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                {item.value}
              </p>
              <p className="text-[10px] text-typo-muted mt-1 uppercase tracking-wider"
                 style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                {item.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Recent Wordbooks */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-eyebrow uppercase text-typo-muted"
              style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
            RECENT
          </h2>
          <button
            onClick={() => navigate('/wordbooks')}
            className="text-sm text-accent hover:text-accent/80 transition-colors duration-200"
          >
            查看全部
          </button>
        </div>

        {wordbooks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {wordbooks.map((wb) => {
              const src = getSourceLabel(wb.source_type);
              return (
                <div
                  key={wb.id}
                  onClick={() => navigate(`/wordbooks/${wb.id}`)}
                  className="card-hover flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-ink truncate">{wb.name}</h3>
                      <span className={`badge ${src.color}`}
                            style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                        {src.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      {wb.teacher_tag && (
                        <span className="text-xs text-typo-muted">{wb.teacher_tag}</span>
                      )}
                      <span className="text-xs text-typo-muted"
                            style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                        {wb.card_count || 0} 张卡片
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-typo-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card text-center py-10">
            <p className="text-typo-muted text-sm mb-4">还没有单词本</p>
            <button onClick={() => navigate('/upload')} className="btn-outline text-sm px-8">
              上传第一份资料
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
