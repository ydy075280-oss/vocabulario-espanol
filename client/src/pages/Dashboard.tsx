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
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getSourceLabel = (type: string) => {
    const map: Record<string, { label: string; color: string }> = {
      create: { label: '创作', color: 'bg-purple-100 text-purple-700' },
      video: { label: '视频', color: 'bg-blue-100 text-blue-700' },
      image: { label: '图片', color: 'bg-green-100 text-green-700' },
      manual: { label: '手动', color: 'bg-gray-100 text-gray-700' },
    };
    return map[type] || { label: type, color: 'bg-gray-100 text-gray-700' };
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            ¡Hola{user?.nickname ? `, ${user.nickname}` : ''}!
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            {stats ? `已学 ${stats.totalCards} 个词` : '开始学习吧'}
          </p>
        </div>
        <button
          onClick={() => navigate('/profile')}
          className="w-10 h-10 rounded-full bg-primary-100 text-primary flex items-center justify-center font-bold text-sm"
        >
          {(user?.nickname || 'U').charAt(0).toUpperCase()}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="card bg-gradient-to-br from-primary-50 to-primary-100 border border-primary-200 cursor-pointer"
               onClick={() => navigate('/learn')}>
            <p className="text-sm text-primary-700 font-medium">今日待复习</p>
            <p className="text-3xl font-bold text-primary mt-1">{stats.dueNow}</p>
            <p className="text-xs text-primary-600 mt-1">张卡片等待复习</p>
          </div>
          <div className="card bg-gradient-to-br from-green-50 to-green-100 border border-green-200">
            <p className="text-sm text-green-700 font-medium">已掌握</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{stats.masteredCards}</p>
            <p className="text-xs text-green-600 mt-1">
              正确率 {stats.accuracy}%
            </p>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <button
          onClick={() => navigate('/learn')}
          className="card flex flex-col items-center justify-center py-5 active:scale-95 transition-transform"
        >
          <svg className="w-8 h-8 text-primary mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-sm font-medium text-text-primary">开始复习</span>
        </button>
        <button
          onClick={() => navigate('/upload')}
          className="card flex flex-col items-center justify-center py-5 active:scale-95 transition-transform"
        >
          <svg className="w-8 h-8 text-primary mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12" />
          </svg>
          <span className="text-sm font-medium text-text-primary">上传资料</span>
        </button>
        <button
          onClick={() => navigate('/create')}
          className="card flex flex-col items-center justify-center py-5 active:scale-95 transition-transform"
        >
          <svg className="w-8 h-8 text-primary mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l-2 5 5-2 8.232-8.232a2.5 2.5 0 00-3.536-3.536L9 11z" />
          </svg>
          <span className="text-sm font-medium text-text-primary">开始创作</span>
        </button>
      </div>

      {/* Stats Detail */}
      {stats && (
        <div className="grid grid-cols-4 gap-2 mb-6">
          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
            <p className="text-lg font-bold text-primary">{stats.todayStudied}</p>
            <p className="text-[10px] text-text-muted">今日学习</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
            <p className="text-lg font-bold text-warning">{stats.learningCards}</p>
            <p className="text-[10px] text-text-muted">学习中</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
            <p className="text-lg font-bold text-text-primary">{stats.todayMinutes}</p>
            <p className="text-[10px] text-text-muted">今日分钟</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center shadow-sm">
            <p className="text-lg font-bold text-success">{stats.avgEaseFactor}</p>
            <p className="text-[10px] text-text-muted">舒适度</p>
          </div>
        </div>
      )}

      {/* Recent Wordbooks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-text-primary">最近单词本</h2>
          <button
            onClick={() => navigate('/wordbooks')}
            className="text-sm text-primary font-medium"
          >
            查看全部
          </button>
        </div>

        {wordbooks.length > 0 ? (
          <div className="space-y-2">
            {wordbooks.map((wb) => {
              const src = getSourceLabel(wb.source_type);
              return (
                <div
                  key={wb.id}
                  onClick={() => navigate(`/wordbooks/${wb.id}`)}
                  className="card flex items-center justify-between active:bg-gray-50 cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text-primary truncate">{wb.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${src.color}`}>
                        {src.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {wb.teacher_tag && (
                        <span className="text-xs text-text-muted">{wb.teacher_tag}</span>
                      )}
                      <span className="text-xs text-text-muted">
                        {wb.card_count || 0} 张卡片
                      </span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card text-center py-8">
            <p className="text-text-muted text-sm mb-3">还没有单词本</p>
            <button onClick={() => navigate('/upload')} className="btn-primary text-sm">
              上传第一份资料
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
