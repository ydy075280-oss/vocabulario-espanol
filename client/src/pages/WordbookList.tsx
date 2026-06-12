import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { wordbookAPI } from '../api';

interface Wordbook {
  id: string;
  name: string;
  source_type: string;
  teacher_tag: string;
  course_tag: string;
  card_count: number;
  current_card_count: number;
  created_at: string;
  updated_at: string;
}

const sourceLabels: Record<string, { label: string; color: string }> = {
  create: { label: '创作', color: 'bg-purple-100 text-purple-700' },
  video: { label: '视频', color: 'bg-blue-100 text-blue-700' },
  image: { label: '图片', color: 'bg-green-100 text-green-700' },
  manual: { label: '手动', color: 'bg-gray-100 text-gray-700' },
};

export default function WordbookList() {
  const navigate = useNavigate();
  const [wordbooks, setWordbooks] = useState<Wordbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTeacher, setNewTeacher] = useState('');

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    try {
      const { data } = await wordbookAPI.list();
      setWordbooks(data.wordbooks || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const createBook = async () => {
    if (!newName.trim()) return;
    try {
      await wordbookAPI.create({ name: newName, teacherTag: newTeacher, sourceType: 'manual' });
      setNewName('');
      setNewTeacher('');
      setShowCreate(false);
      loadBooks();
    } catch { /* ignore */ }
  };

  const deleteBook = async (id: string, name: string) => {
    if (!confirm(`确定删除"${name}"？所有卡片将被永久删除。`)) return;
    try {
      await wordbookAPI.delete(id);
      setWordbooks((prev) => prev.filter((w) => w.id !== id));
    } catch { /* ignore */ }
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary">我的单词本</h1>
          <p className="text-sm text-text-muted mt-0.5">共 {wordbooks.length} 个单词本</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm py-2 px-4">
          + 新建
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-text-primary mb-4">创建单词本</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="单词本名称"
              className="input-field mb-3"
              autoFocus
            />
            <input
              type="text"
              value={newTeacher}
              onChange={(e) => setNewTeacher(e.target.value)}
              placeholder="教师/课程标签（可选）"
              className="input-field mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">取消</button>
              <button onClick={createBook} className="btn-primary flex-1" disabled={!newName.trim()}>创建</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : wordbooks.length > 0 ? (
        <div className="space-y-3">
          {wordbooks.map((wb) => {
            const src = sourceLabels[wb.source_type] || sourceLabels.manual;
            const count = wb.current_card_count ?? wb.card_count;
            return (
              <div
                key={wb.id}
                className="card flex items-center gap-3 group"
              >
                <div
                  onClick={() => navigate(`/wordbooks/${wb.id}`)}
                  className="flex-1 min-w-0 cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-text-primary truncate">{wb.name}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${src.color}`}>
                      {src.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    {wb.teacher_tag && <span>{wb.teacher_tag}</span>}
                    {wb.course_tag && <span>· {wb.course_tag}</span>}
                    <span>· {count} 张卡片</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigate(`/learn/${wb.id}`)}
                    className="p-2 text-primary hover:bg-primary-50 rounded-lg transition-colors"
                    title="开始学习"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteBook(wb.id, wb.name)}
                    className="p-2 text-text-muted hover:text-danger hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="删除"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16">
          <svg className="w-16 h-16 text-text-muted mx-auto mb-4" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253" />
          </svg>
          <p className="text-text-muted mb-3">还没有单词本</p>
          <button onClick={() => navigate('/upload')} className="btn-primary text-sm">
            上传资料创建单词本
          </button>
        </div>
      )}
    </div>
  );
}
