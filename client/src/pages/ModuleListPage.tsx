import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { moduleAPI } from '../api/index';
import Loading from '../components/Loading';

interface ModuleSummary {
  id: string;
  title: string;
  description: string;
  status: string;
  total_days: number;
  completed_days: number;
  totalTasks: number;
  completedTasks: number;
  progress: number;
  created_at: string;
}

export default function ModuleListPage() {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [homeworkText, setHomeworkText] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    try {
      const { data } = await moduleAPI.list();
      setModules(data.modules || []);
    } catch (err: any) {
      console.error('加载模块列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!homeworkText.trim() || homeworkText.length < 20) {
      setError('作业内容至少20字，请详细描述课程作业要求');
      return;
    }
    setCreateLoading(true);
    setError('');
    try {
      await moduleAPI.create(homeworkText);
      setCreating(false);
      setHomeworkText('');
      loadModules();
    } catch (err: any) {
      setError('创建失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await moduleAPI.delete(id);
      setDeleteConfirm(null);
      loadModules();
    } catch (err: any) {
      alert('删除失败: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) return <Loading full />;

  return (
    <div className="flex flex-col min-h-screen bg-canvas">
      {/* Header */}
      <div className="bg-canvas px-5 pt-12 pb-4 border-b border-hairline-soft">
        <h1 className="text-xl font-bold font-display tracking-tight text-ink">课程大模块</h1>
        <p className="text-xs font-mono text-typo-muted mt-1 uppercase tracking-wider">上传课后作业，AI 拆解为每日学习任务</p>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4 max-w-lg md:max-w-3xl mx-auto w-full pb-24 md:pb-10">
        {/* Create Button */}
        <button
          onClick={() => setCreating(true)}
          className="w-full py-3.5 bg-brand text-white rounded-pill font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-colors mb-4"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          创建大模块
        </button>

        {/* Module List */}
        {modules.length === 0 ? (
          <div className="text-center py-16 text-typo-muted">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-sm">还没有大模块</p>
            <p className="text-xs mt-1">上传课后作业，让 AI 帮你规划学习</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {modules.map((mod) => (
            <div
              key={mod.id}
              onClick={() => navigate(`/modules/${mod.id}`)}
              className="card-hover p-4 cursor-pointer relative"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-ink text-sm truncate">{mod.title}</h3>
                  {mod.description && (
                    <p className="text-xs text-typo-muted mt-0.5 line-clamp-2">{mod.description}</p>
                  )}
                </div>
                {mod.status === 'completed' && (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-success-muted text-success text-[11px] rounded-pill font-medium">
                    已完成
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              <div className="mt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-mono text-typo-muted uppercase tracking-wider">
                    {mod.completedTasks}/{mod.totalTasks} 任务
                  </span>
                  <span className="text-[11px] font-mono text-typo-secondary">{mod.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-surface rounded-pill overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-pill transition-all duration-500"
                    style={{ width: `${mod.progress}%` }}
                  />
                </div>
              </div>

              {/* Delete Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(mod.id);
                }}
                className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-typo-muted hover:text-danger hover:bg-danger-muted transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>

              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-hairline-soft">
                <span className="text-[10px] font-mono text-typo-muted uppercase tracking-wider">
                  {new Date(mod.created_at).toLocaleDateString('zh-CN')}
                </span>
                <span className="text-[10px] font-mono text-typo-muted uppercase tracking-wider">
                  {mod.total_days} 天计划
                </span>
              </div>
            </div>
          ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => !createLoading && setCreating(false)}>
          <div
            className="bg-canvas border border-hairline-soft rounded-t-card sm:rounded-card w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: 'rgba(5,0,56,0.12) 0px 16px 48px -8px' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ink">创建大模块</h2>
              <button
                onClick={() => !createLoading && setCreating(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface transition-colors"
              >
                <svg className="w-5 h-5 text-typo-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="mb-3 p-3 bg-danger-muted text-danger rounded-input text-sm">{error}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-typo-muted uppercase tracking-wider mb-1.5">
                  课后作业 / 学习要求
                </label>
                <textarea
                  value={homeworkText}
                  onChange={(e) => { setHomeworkText(e.target.value); setError(''); }}
                  placeholder={`请输入你的课后作业或学习要求，AI 会据此生成每天的学习计划。\n\n例如：\n"本周学习西语过去式（pretérito indefinido），需要掌握规则变位和不规则变位，重点单词有：ayer, la semana pasada, el mes pasado...课后作业是写一篇100字的短文描述上周做过的5件事。"`}
                  className="w-full h-48 px-3.5 py-3 bg-canvas border border-hairline rounded-input text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent text-ink placeholder:text-typo-disabled"
                  disabled={createLoading}
                />
                <p className="text-[11px] font-mono text-typo-muted mt-1 uppercase tracking-wider">
                  已输入 {homeworkText.length} 字（至少 20 字）
                </p>
              </div>

              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="w-full py-3 bg-brand text-white rounded-pill font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-colors"
              >
                {createLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    AI 正在分析作业...
                  </>
                ) : (
                  'AI 生成学习计划'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div
            className="bg-canvas border border-hairline-soft rounded-card w-72 p-5 text-center"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: 'rgba(5,0,56,0.12) 0px 16px 48px -8px' }}
          >
            <p className="text-sm text-typo-secondary mb-4">确定要删除这个大模块吗？所有关联任务也会被删除。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 border border-hairline rounded-input text-sm text-typo-secondary hover:text-ink hover:border-hairline-strong transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 bg-danger text-white rounded-input text-sm font-medium hover:bg-danger/90 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
