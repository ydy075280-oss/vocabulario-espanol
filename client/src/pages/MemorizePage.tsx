import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { memorizeAPI, moduleAPI } from '../api/index';
import Loading from '../components/Loading';

interface MemorizeItem {
  id: string;
  module_id: string;
  module_title: string;
  title: string;
  task_type: string;
  day_number: number;
  updated_at: string;
  taskData?: {
    writingPrompt?: string;
    referenceVocabulary?: string[];
    userWriting?: string;
    userWritingTitle?: string;
    memorize?: boolean;
    [key: string]: any;
  };
}

export default function MemorizePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MemorizeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const { data } = await memorizeAPI.list();
      setItems(data.items || []);
    } catch (err: any) {
      setError('加载失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleUnmemorize = async (item: MemorizeItem) => {
    setActionLoading(item.id);
    try {
      await memorizeAPI.toggle(item.module_id, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err: any) {
      alert('操作失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTTS = async (text: string, moduleId: string, taskId: string) => {
    if (!text?.trim()) return;
    const ttsKey = `tts-${taskId}`;
    try {
      setActionLoading(ttsKey);
      const { data } = await moduleAPI.generateUserTTS(moduleId, taskId, text.trim(), -1);
      if (data.audioUrl) {
        setPlayingAudio(ttsKey);
        const audio = new Audio(data.audioUrl);
        audio.onended = () => setPlayingAudio(null);
        audio.onerror = () => setPlayingAudio(null);
        audio.play().catch(() => setPlayingAudio(null));
      }
    } catch (err: any) {
      console.error('TTS失败:', err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <Loading full />;

  return (
    <div className="flex flex-col min-h-screen bg-canvas">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-canvas border-b border-hairline-soft">
        <div className="flex items-center gap-3 px-4 pt-12 pb-3">
          <button
            onClick={() => navigate('/modules')}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface transition-colors"
          >
            <svg className="w-5 h-5 text-typo-secondary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-ink">背诵列表</h1>
          </div>
          {items.length > 0 && (
            <span className="text-[11px] font-mono text-typo-muted">{items.length} 篇</span>
          )}
        </div>
        <div className="px-4 pb-3">
          <p className="text-xs text-typo-muted">
            集中复习需要背诵的写作内容，支持朗读和原文跳转
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4 max-w-lg md:max-w-5xl lg:max-w-7xl mx-auto w-full pb-24 md:pb-10">
        {error && (
          <div className="bg-danger-muted border border-danger/20 rounded-card p-3 mb-4">
            <p className="text-xs text-danger">{error}</p>
            <button onClick={loadItems} className="text-[10px] text-danger underline mt-1">重试</button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-16 h-16 text-typo-disabled mb-4" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-sm text-typo-muted mb-1">还没有背诵内容</p>
            <p className="text-xs text-typo-disabled mb-4">
              在模块详情页的写作卡片中点击「加入背诵」即可添加
            </p>
            <button
              onClick={() => navigate('/modules')}
              className="px-4 py-2 text-xs font-medium bg-brand text-white rounded-pill hover:bg-charcoal transition-colors"
            >
              前往模块列表
            </button>
          </div>
        ) : (
          <div className="md:grid md:grid-cols-2 md:gap-4">
            {items.map((item) => {
              const td = item.taskData || {};
              const isExpanded = expanded.has(item.id);
              const writing = td.userWriting || '';
              const preview = writing.length > 150
                ? writing.slice(0, 150) + '...'
                : writing;

              return (
                <div
                  key={item.id}
                  className="bg-canvas rounded-card border border-hairline-soft p-4 mb-3 md:mb-0 hover:border-hairline-strong transition-colors"
                >
                  {/* Module source */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" />
                    <button
                      onClick={() => navigate(`/modules/${item.module_id}`)}
                      className="text-[10px] font-mono text-typo-muted hover:text-accent transition-colors truncate"
                    >
                      {item.module_title} · 第{item.day_number}天
                    </button>
                  </div>

                  {/* Writing prompt */}
                  {td.writingPrompt && (
                    <div className="bg-warning-muted rounded-card p-2.5 border border-warning/10 mb-3">
                      <span className="text-[10px] font-mono text-warning uppercase tracking-wider mb-1 block">
                        写作题目
                      </span>
                      <p className="text-xs text-typo-secondary leading-relaxed">
                        {td.writingPrompt}
                      </p>
                    </div>
                  )}

                  {/* User writing preview or full */}
                  <div className="bg-surface rounded-card p-3 border border-hairline mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono text-typo-muted uppercase tracking-wider">
                        ✍️ 我的写作
                      </span>
                      <span className="text-[10px] text-typo-disabled font-mono">
                        {writing.replace(/\s/g, '').length} 字符
                      </span>
                    </div>
                    <p className={`text-xs text-typo-secondary leading-relaxed whitespace-pre-wrap ${!isExpanded && writing.length > 150 ? 'line-clamp-6' : ''}`}>
                      {isExpanded ? writing : preview}
                    </p>
                    {writing.length > 150 && (
                      <button
                        onClick={() => toggleExpand(item.id)}
                        className="text-[10px] text-accent hover:text-accent/70 transition-colors mt-1"
                      >
                        {isExpanded ? '收起 ▲' : '展开全部 ▼'}
                      </button>
                    )}
                  </div>

                  {/* Reference vocabulary */}
                  {td.referenceVocabulary && td.referenceVocabulary.length > 0 && (
                    <div className="mb-3">
                      <span className="text-[10px] font-mono text-typo-muted uppercase tracking-wider mb-1 block">
                        参考词汇
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {td.referenceVocabulary.map((w: string, i: number) => (
                          <span key={i} className="text-[10px] bg-warning-muted text-warning px-1.5 py-0.5 rounded-pill border border-warning/10">
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-hairline-soft">
                    <button
                      onClick={() => handleTTS(writing, item.module_id, item.id)}
                      disabled={!writing.trim() || actionLoading === `tts-${item.id}`}
                      className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-pill border transition-colors ${
                        playingAudio === `tts-${item.id}`
                          ? 'border-warning/50 bg-warning-muted text-warning'
                          : writing.trim()
                          ? 'border-hairline text-typo-muted hover:border-warning/30 hover:text-warning/70'
                          : 'border-hairline text-typo-disabled cursor-not-allowed'
                      }`}
                    >
                      {actionLoading === `tts-${item.id}` ? (
                        <><span className="w-2.5 h-2.5 border border-warning/30 border-t-warning rounded-full animate-spin" />生成中...</>
                      ) : playingAudio === `tts-${item.id}` ? (
                        <><span className="w-2 h-2 bg-warning rounded-sm animate-pulse" />播放中...</>
                      ) : (
                        <><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>朗读</>
                      )}
                    </button>

                    <button
                      onClick={() => handleUnmemorize(item)}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-pill border border-hairline text-typo-muted hover:text-danger hover:border-danger/30 hover:bg-danger-muted transition-colors"
                    >
                      {actionLoading === item.id ? (
                        <span className="w-2.5 h-2.5 border border-danger/30 border-t-danger rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      <span>{actionLoading === item.id ? '处理中...' : '已背诵'}</span>
                    </button>

                    <button
                      onClick={() => navigate(`/modules/${item.module_id}`)}
                      className="ml-auto text-[10px] px-2 py-1 text-accent hover:text-accent/70 transition-colors"
                    >
                      查看来源 →
                    </button>
                  </div>

                  <p className="text-[9px] text-typo-disabled mt-2">
                    加入时间: {new Date(item.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
