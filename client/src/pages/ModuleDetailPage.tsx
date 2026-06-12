import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { moduleAPI } from '../api/index';
import Loading from '../components/Loading';

// ============================================================
// 类型定义
// ============================================================

interface KeyWord {
  word: string;
  translation: string;
  partOfSpeech: string;
  exampleSentence: string;
  exampleTranslation: string;
}

interface TaskData {
  keyWords?: KeyWord[];
  writingPrompt?: string;
  referenceVocabulary?: string[];
  ttsAudioUrls?: Record<string, string>;
  userSentences?: Record<string, string[]>;        // { "keyword": ["sentence1", ...] }
  userSentenceTTS?: Record<string, string>;         // { "key": audioUrl }
}

interface ModuleTask {
  id: string;
  module_id: string;
  day_number: number;
  title: string;
  content: string;
  task_type: string;
  completed: number;
  completed_at: string | null;
  sort_order: number;
  taskData?: TaskData;
}

interface ModuleDetail {
  id: string;
  title: string;
  description: string;
  language?: string;
  content_type?: string;
  content_type_label?: string;
  status: string;
  total_days: number;
  completed_days: number;
  homework_text: string;
  tasks: ModuleTask[];
  aiPlan?: any;
}

const taskTypeLabels: Record<string, string> = {
  vocabulary: '词汇造句',
  grammar: '语法练习',
  reading: '阅读理解',
  writing: '主题写作',
  listening: '听力训练',
  speaking: '口语表达',
};

const taskTypeColors: Record<string, string> = {
  vocabulary: 'bg-blue-100 text-blue-700',
  grammar: 'bg-purple-100 text-purple-700',
  reading: 'bg-green-100 text-green-700',
  writing: 'bg-orange-100 text-orange-700',
  listening: 'bg-pink-100 text-pink-700',
  speaking: 'bg-teal-100 text-teal-700',
};

const taskTypeIcons: Record<string, string> = {
  vocabulary: '📝',
  grammar: '📖',
  reading: '📚',
  writing: '✍️',
  listening: '🎧',
  speaking: '🗣️',
};

export default function ModuleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [module, setModule] = useState<ModuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit states
  const [editingModule, setEditingModule] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Task edit states
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskContent, setEditTaskContent] = useState('');
  const [editTaskType, setEditTaskType] = useState('');

  // Expanded task
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // TTS states
  const [ttsLoading, setTtsLoading] = useState<string | null>(null); // taskId
  const [playingAudio, setPlayingAudio] = useState<string | null>(null); // audio key
  const [ttsError, setTtsError] = useState<string>(''); // TTS 错误提示

  // 用户造句状态（本地编辑，自动保存到后端）
  const [userSentences, setUserSentences] = useState<Record<string, Record<string, string[]>>>({}); // { taskId: { keyword: [sentences] } }
  const [sentenceTTSLoading, setSentenceTTSLoading] = useState<string | null>(null); // "taskId:keyword:idx"

  // 自动展开
  const [initialExpandDone, setInitialExpandDone] = useState(false);

  // 防抖保存定时器
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 添加新单词状态
  const [addingWordTaskId, setAddingWordTaskId] = useState<string | null>(null);
  const [newWordForm, setNewWordForm] = useState<KeyWord>({
    word: '', translation: '', partOfSpeech: 'noun',
    exampleSentence: '', exampleTranslation: '',
  });

  // 添加新天状态
  const [addingNewDay, setAddingNewDay] = useState(false);
  const [newDayForm, setNewDayForm] = useState({
    title: '', content: '', taskType: 'vocabulary',
  });

  // 处理中状态
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadModule();
  }, [id]);

  useEffect(() => {
    if (module && !initialExpandDone) {
      const ids = new Set<string>();
      module.tasks.forEach((t) => {
        if (t.content || (t.taskData?.keyWords?.length || 0) > 0 || t.taskData?.writingPrompt) {
          ids.add(t.id);
        }
      });
      setExpandedTasks(ids);

      // 初始化用户造句数据
      const us: Record<string, Record<string, string[]>> = {};
      module.tasks.forEach((t) => {
        if (t.taskData?.userSentences) {
          us[t.id] = { ...t.taskData.userSentences };
        } else {
          us[t.id] = {};
        }
      });
      setUserSentences(us);
      setInitialExpandDone(true);
    }
  }, [module, initialExpandDone]);

  const loadModule = async () => {
    try {
      const { data } = await moduleAPI.get(id!);
      setModule(data.module);
      setEditTitle(data.module.title);
      setEditDescription(data.module.description || '');
    } catch (err: any) {
      setError('加载失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // ---------- 模块编辑 ----------
  const handleSaveModule = async () => {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      await moduleAPI.update(id!, { title: editTitle, description: editDescription });
      setModule((prev) => prev ? { ...prev, title: editTitle, description: editDescription } : prev);
      setEditingModule(false);
    } catch (err: any) {
      alert('保存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  // ---------- 任务勾选 ----------
  const handleToggleTask = async (taskId: string) => {
    try {
      const { data } = await moduleAPI.toggleTask(id!, taskId);
      setModule((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === taskId ? { ...t, completed: t.completed ? 0 : 1, completed_at: data.task.completed_at } : t
          ),
        };
      });
    } catch (err: any) {
      console.error('切换任务状态失败:', err);
    }
  };

  // ---------- 任务编辑 ----------
  const startEditTask = (task: ModuleTask) => {
    setEditingTaskId(task.id);
    setEditTaskTitle(task.title);
    setEditTaskContent(task.content);
    setEditTaskType(task.task_type);
  };

  const handleSaveTask = async () => {
    if (!editingTaskId || !editTaskTitle.trim()) return;
    setSaving(true);
    try {
      await moduleAPI.updateTask(id!, editingTaskId, {
        title: editTaskTitle,
        content: editTaskContent,
        taskType: editTaskType,
      });
      setModule((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === editingTaskId
              ? { ...t, title: editTaskTitle, content: editTaskContent, task_type: editTaskType }
              : t
          ),
        };
      });
      setEditingTaskId(null);
    } catch (err: any) {
      alert('保存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  // ---------- 展开/折叠 ----------
  const toggleExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // ---------- TTS 例句朗读 ----------
  const handleGenerateTTS = async (taskId: string) => {
    setTtsLoading(taskId);
    try {
      const { data } = await moduleAPI.generateTTS(id!, taskId);
      setModule((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const td = { ...(t.taskData || {}) };
            td.ttsAudioUrls = td.ttsAudioUrls || {};
            for (const r of data.results || []) {
              if (r.audioUrl) td.ttsAudioUrls[r.keyword] = r.audioUrl;
            }
            return { ...t, taskData: td };
          }),
        };
      });
    } catch (err: any) {
      console.error('TTS 生成失败:', err);
      alert('语音生成失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setTtsLoading(null);
    }
  };

  const handlePlayAudio = (audioUrl: string, key: string) => {
    setPlayingAudio(key);
    setTtsError('');
    const audio = new Audio(audioUrl);
    audio.onended = () => setPlayingAudio(null);
    audio.onerror = (e) => {
      console.error('[Audio] 播放失败:', audioUrl, e);
      setPlayingAudio(null);
      setTtsError('音频播放失败，请检查网络或重试');
      setTimeout(() => setTtsError(''), 4000);
    };
    audio.play().catch((e) => {
      console.error('[Audio] play() 失败:', e);
      setPlayingAudio(null);
      if (e.name === 'NotAllowedError') {
        setTtsError('浏览器阻止了自动播放，请再点一次播放按钮');
      } else {
        setTtsError('音频播放失败: ' + e.message);
      }
      setTimeout(() => setTtsError(''), 4000);
    });
  };

  // ---------- 用户造句操作 ----------

  /** 更新本地造句状态 */
  const updateUserSentence = (taskId: string, keyword: string, index: number, value: string) => {
    setUserSentences((prev) => {
      const taskSentences = { ...(prev[taskId] || {}) };
      const arr = [...(taskSentences[keyword] || [''])];
      arr[index] = value;
      taskSentences[keyword] = arr;
      return { ...prev, [taskId]: taskSentences };
    });
  };

  /** 为某个关键词添加一个造句空栏 */
  const addUserSentenceSlot = (taskId: string, keyword: string) => {
    setUserSentences((prev) => {
      const taskSentences = { ...(prev[taskId] || {}) };
      const arr = [...(taskSentences[keyword] || [''])];
      arr.push('');
      taskSentences[keyword] = arr;
      return { ...prev, [taskId]: taskSentences };
    });
  };

  /** 删除某个造句栏 */
  const removeUserSentenceSlot = (taskId: string, keyword: string, index: number) => {
    setUserSentences((prev) => {
      const taskSentences = { ...(prev[taskId] || {}) };
      const arr = [...(taskSentences[keyword] || [''])];
      if (arr.length <= 1) return prev;
      arr.splice(index, 1);
      taskSentences[keyword] = arr;
      return { ...prev, [taskId]: taskSentences };
    });
  };

  /** 防抖保存造句到后端 */
  const debouncedSave = useCallback((taskId: string, sentences: Record<string, string[]>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await moduleAPI.saveSentences(id!, taskId, sentences);
      } catch (err) {
        console.error('自动保存造句失败:', err);
      }
    }, 800);
  }, [id]);

  // 实时保存
  useEffect(() => {
    if (!id) return;
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // 组件卸载时做一次最终保存
      Object.entries(userSentences).forEach(([taskId, s]) => {
        moduleAPI.saveSentences(id, taskId, s).catch(() => {});
      });
    };
  }, []);

  // 造句内容变化时自动保存
  const handleSentenceChange = (taskId: string, keyword: string, index: number, value: string) => {
    updateUserSentence(taskId, keyword, index, value);
    // 获取最新值进行保存
    setUserSentences((prev) => {
      const taskSentences = { ...(prev[taskId] || {}) };
      const arr = [...(taskSentences[keyword] || [''])];
      arr[index] = value;
      taskSentences[keyword] = arr.filter((s) => s.trim());
      debouncedSave(taskId, taskSentences);
      return { ...prev, [taskId]: { ...taskSentences, [keyword]: arr } };
    });
  };

  /** 为用户输入文本生成 TTS */
  const handleUserTextTTS = async (taskId: string, keyword: string, sentenceIdx: number) => {
    const sentences = userSentences[taskId]?.[keyword];
    const text = sentences?.[sentenceIdx];
    if (!text?.trim()) return;

    const ttsKey = `${taskId}:${keyword}:${sentenceIdx}`;
    setSentenceTTSLoading(ttsKey);
    setTtsError('');

    try {
      const { data } = await moduleAPI.generateUserTTS(id!, taskId, text.trim(), sentenceIdx);
      if (data.audioUrl) {
        // 缓存到 taskData 中
        setModule((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tasks: prev.tasks.map((t) => {
              if (t.id !== taskId) return t;
              const td = { ...(t.taskData || {}) };
              td.userSentenceTTS = { ...(td.userSentenceTTS || {}), [ttsKey]: data.audioUrl };
              return { ...t, taskData: td };
            }),
          };
        });
        // 播放
        handlePlayAudio(data.audioUrl, ttsKey);
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || '未知错误';
      console.error('用户TTS失败:', errMsg);
      setTtsError('语音生成失败: ' + errMsg);
      setTimeout(() => setTtsError(''), 5000);
    } finally {
      setSentenceTTSLoading(null);
    }
  };

  // ---------- 关键词增删 ----------

  /** 删除某个关键词 */
  const handleDeleteKeyword = async (taskId: string, keywordIndex: number) => {
    const task = module?.tasks.find(t => t.id === taskId);
    if (!task?.taskData?.keyWords) return;
    const newKeywords = [...task.taskData.keyWords];
    newKeywords.splice(keywordIndex, 1);
    // 乐观更新
    setModule((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const td = { ...(t.taskData || {}) };
          td.keyWords = newKeywords;
          return { ...t, taskData: td };
        }),
      };
    });
    try {
      await moduleAPI.updateKeywords(id!, taskId, newKeywords);
    } catch (err: any) {
      alert('删除单词失败: ' + (err.response?.data?.error || err.message));
      loadModule(); // 失败则回滚
    }
  };

  /** 添加新关键词到某天任务 */
  const handleAddKeyword = async (taskId: string) => {
    if (!newWordForm.word.trim() || !newWordForm.translation.trim()) return;
    setActionLoading(taskId);
    const task = module?.tasks.find(t => t.id === taskId);
    const existingKeywords = task?.taskData?.keyWords || [];
    const newKeywords = [...existingKeywords, { ...newWordForm }];
    try {
      await moduleAPI.updateKeywords(id!, taskId, newKeywords);
      setModule((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const td = { ...(t.taskData || {}) };
            td.keyWords = newKeywords;
            return { ...t, taskData: td };
          }),
        };
      });
      setNewWordForm({ word: '', translation: '', partOfSpeech: 'noun', exampleSentence: '', exampleTranslation: '' });
      setAddingWordTaskId(null);
    } catch (err: any) {
      alert('添加单词失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  // ---------- 任务/天 增删 ----------

  /** 删除某一天的所有任务 */
  const handleDeleteDay = async (dayNum: number) => {
    if (!module) return;
    const dayTasks = module.tasks.filter(t => t.day_number === dayNum);
    if (dayTasks.length === 0) return;
    if (!confirm(`确定删除第 ${dayNum} 天的全部 ${dayTasks.length} 个任务吗？`)) return;
    setActionLoading(`delete-day-${dayNum}`);
    try {
      // 逐个删除该天的任务
      for (const task of dayTasks) {
        await moduleAPI.deleteTask(id!, task.id);
      }
      setModule((prev) => {
        if (!prev) return prev;
        const remainingTasks = prev.tasks.filter(t => t.day_number !== dayNum);
        const maxDayNum = remainingTasks.reduce((max, t) => Math.max(max, t.day_number), 0);
        return { ...prev, tasks: remainingTasks, total_days: maxDayNum };
      });
    } catch (err: any) {
      alert('删除失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  /** 添加新的一天 */
  const handleAddDay = async () => {
    if (!newDayForm.title.trim()) {
      alert('请输入任务标题');
      return;
    }
    setActionLoading('add-day');
    try {
      const { data } = await moduleAPI.addTask(id!, newDayForm);
      setModule((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: [...prev.tasks, data.task],
          total_days: Math.max(prev.total_days, data.task.day_number),
        };
      });
      setNewDayForm({ title: '', content: '', taskType: 'vocabulary' });
      setAddingNewDay(false);
    } catch (err: any) {
      alert('添加失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  // ============================================================
  // 加载/错误状态
  // ============================================================
  if (loading) return <Loading full />;
  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-5">
      <p className="text-red-500 text-sm mb-3">{error}</p>
      <button onClick={() => navigate('/modules')} className="text-primary text-sm underline">返回列表</button>
    </div>
  );
  if (!module) return null;

  const totalTasks = module.tasks.length;
  const completedTasks = module.tasks.filter((t) => t.completed).length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const dayGroups: Record<number, ModuleTask[]> = {};
  module.tasks.forEach((t) => {
    if (!dayGroups[t.day_number]) dayGroups[t.day_number] = [];
    dayGroups[t.day_number].push(t);
  });

  const isVocab = module.content_type === 'vocabulary';
  const isWriting = module.content_type === 'writing';

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div className="flex flex-col min-h-screen bg-bg">
      {/* ========== Header ========== */}
      <div className="sticky top-0 z-30 bg-white shadow-sm">
        <div className="flex items-center gap-3 px-4 pt-12 pb-3">
          <button
            onClick={() => navigate('/modules')}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-text" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            {editingModule ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-lg font-bold border-b-2 border-primary pb-0.5 outline-none bg-transparent"
                autoFocus
              />
            ) : (
              <h1 className="text-lg font-bold text-text truncate">{module.title}</h1>
            )}
          </div>
          <button
            onClick={() => {
              if (editingModule) {
                handleSaveModule();
              } else {
                setEditTitle(module.title);
                setEditDescription(module.description || '');
                setEditingModule(true);
              }
            }}
            disabled={saving}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border"
            style={{
              color: editingModule ? '#fff' : 'var(--primary)',
              backgroundColor: editingModule ? 'var(--primary)' : 'transparent',
              borderColor: 'var(--primary)',
            }}
          >
            {saving ? '保存中...' : editingModule ? '完成' : '编辑'}
          </button>
        </div>

        {/* 描述 + 元信息 */}
        <div className="px-4 pb-3">
          {editingModule ? (
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full text-xs text-text-muted border border-gray-200 rounded-lg p-2 outline-none resize-none"
              rows={2}
              placeholder="课程描述（可选）"
            />
          ) : (
            <>
              {module.description && (
                <p className="text-xs text-text-muted mb-2">{module.description}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {module.language && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                    {module.language}
                  </span>
                )}
                {module.content_type_label && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    isVocab ? 'bg-blue-50 text-blue-600' :
                    isWriting ? 'bg-orange-50 text-orange-600' :
                    'bg-purple-50 text-purple-600'
                  }`}>
                    {module.content_type_label}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* 进度条 */}
        <div className="px-4 pb-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[11px] text-text-muted">学习进度</span>
            <span className="text-[11px] font-semibold text-primary">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-text-muted mt-1">
            {completedTasks}/{totalTasks} 任务完成 · 共 {module.total_days} 天
          </p>
        </div>
      </div>

      {/* ========== 学习目标 ========== */}
      {module.aiPlan?.learningGoals?.length > 0 && (
        <div className="px-4 pt-3 max-w-lg mx-auto w-full">
          <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl p-3 border border-primary/10">
            <p className="text-[10px] text-primary font-semibold mb-1.5">学习目标</p>
            <div className="flex flex-wrap gap-1">
              {module.aiPlan.learningGoals.map((goal: string, i: number) => (
                <span key={i} className="text-[11px] text-text-muted">
                  {i > 0 && ' · '}{goal}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========== 任务列表 ========== */}
      <div className="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-24">
        {Object.keys(dayGroups)
          .map(Number)
          .sort((a, b) => a - b)
          .map((dayNum) => {
            const tasks = dayGroups[dayNum];
            const dayCompleted = tasks.every((t) => t.completed);

            return (
              <div key={dayNum} className="mb-5">
                {/* Day Header */}
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    dayCompleted ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'
                  }`}>
                    {dayNum}
                  </div>
                  <span className="text-sm font-semibold text-text">第 {dayNum} 天</span>
                  {dayCompleted && (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {/* 删除当天 */}
                  <button
                    onClick={() => handleDeleteDay(dayNum)}
                    disabled={actionLoading === `delete-day-${dayNum}`}
                    className="ml-auto w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                    title={`删除第 ${dayNum} 天`}
                  >
                    {actionLoading === `delete-day-${dayNum}` ? (
                      <span className="w-3 h-3 border border-red-300 border-t-red-500 rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Tasks */}
                <div className="space-y-2.5 ml-4 pl-5 border-l-2 border-gray-100">
                  {tasks.map((task) => renderTask(task))}
                </div>
              </div>
            );
          })}

        {/* 添加新的一天 */}
        <div className="mb-5">
          <div className="ml-4 pl-5 border-l-2 border-dashed border-gray-200">
            {addingNewDay ? (
              <div className="bg-white rounded-xl p-3 shadow-sm border border-dashed border-primary/30 space-y-2">
                <input
                  type="text"
                  value={newDayForm.title}
                  onChange={(e) => setNewDayForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="任务标题（如：第 4 天 重点词汇）"
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-primary"
                  autoFocus
                />
                <textarea
                  value={newDayForm.content}
                  onChange={(e) => setNewDayForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="任务内容/指令（可选）"
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none resize-none focus:border-primary"
                  rows={2}
                />
                <select
                  value={newDayForm.taskType}
                  onChange={(e) => setNewDayForm(f => ({ ...f, taskType: e.target.value }))}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none"
                >
                  {Object.entries(taskTypeLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAddingNewDay(false); setNewDayForm({ title: '', content: '', taskType: 'vocabulary' }); }}
                    className="flex-1 text-xs py-1.5 border border-gray-200 rounded-lg text-gray-500"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddDay}
                    disabled={actionLoading === 'add-day'}
                    className="flex-1 text-xs py-1.5 bg-primary text-white rounded-lg font-medium"
                  >
                    {actionLoading === 'add-day' ? '添加中...' : '确认添加'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingNewDay(true)}
                className="flex items-center gap-2 text-[11px] text-primary/60 hover:text-primary transition-colors w-full justify-center py-3 border border-dashed border-primary/20 rounded-xl hover:border-primary/40 hover:bg-primary/5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                添加新一天的学习计划
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ============================================================
  // 渲染单个任务
  // ============================================================
  function renderTask(task: ModuleTask) {
    const isEditing = editingTaskId === task.id;
    const isExpanded = expandedTasks.has(task.id);
    const taskData = task.taskData || {};
    const keyWords = taskData.keyWords || [];
    const hasVocabContent = keyWords.length > 0;
    const hasWritingContent = !!taskData.writingPrompt;
    const hasRefVocab = (taskData.referenceVocabulary || []).length > 0;
    const ttsUrls = taskData.ttsAudioUrls || {};
    const userSentTTS = taskData.userSentenceTTS || {};
    const localSentences = userSentences[task.id] || {};

    return (
      <div
        key={task.id}
        className={`bg-white rounded-xl p-3 shadow-sm border transition-colors ${
          task.completed ? 'border-green-200 bg-green-50/30' : 'border-gray-50'
        }`}
      >
        {isEditing ? (
          // ======== 编辑模式 ========
          <div className="space-y-2">
            <input
              value={editTaskTitle}
              onChange={(e) => setEditTaskTitle(e.target.value)}
              className="w-full text-sm font-medium border border-gray-200 rounded-lg p-2 outline-none focus:border-primary"
              placeholder="任务标题"
              autoFocus
            />
            <textarea
              value={editTaskContent}
              onChange={(e) => setEditTaskContent(e.target.value)}
              className="w-full text-xs text-text-muted border border-gray-200 rounded-lg p-2 outline-none resize-none focus:border-primary"
              rows={3}
              placeholder="任务内容"
            />
            <select
              value={editTaskType}
              onChange={(e) => setEditTaskType(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg p-2 outline-none"
            >
              {Object.entries(taskTypeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setEditingTaskId(null)}
                className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg text-text-muted"
              >
                取消
              </button>
              <button
                onClick={handleSaveTask}
                disabled={saving}
                className="flex-1 py-1.5 text-xs bg-primary text-white rounded-lg font-medium"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          // ======== 查看模式 ========
          <div>
            <div className="flex items-start gap-2.5">
              <button
                onClick={() => handleToggleTask(task.id)}
                className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
                  task.completed
                    ? 'bg-green-500 border-green-500'
                    : 'border-gray-300 hover:border-primary'
                }`}
              >
                {task.completed && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-text-muted">{taskTypeIcons[task.task_type] || '📌'}</span>
                  <h4 className={`text-sm font-medium ${task.completed ? 'text-text-muted line-through' : 'text-text'}`}>
                    {task.title}
                  </h4>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${taskTypeColors[task.task_type] || 'bg-gray-100 text-gray-600'}`}>
                    {taskTypeLabels[task.task_type] || task.task_type}
                  </span>
                </div>

                {isExpanded && (
                  <div className="mt-2 space-y-2">
                    {/* 任务指令 */}
                    {task.content && (
                      <p className="text-xs text-text-muted leading-relaxed bg-gray-50 rounded-lg p-2.5">
                        {task.content}
                      </p>
                    )}

                    {/* TTS 错误提示 */}
                    {ttsError && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <span>{ttsError}</span>
                      </div>
                    )}

                    {/* ====== 词汇造句类 ====== */}
                    {hasVocabContent && renderVocabSection(task, keyWords, ttsUrls, userSentTTS, localSentences)}

                    {/* ====== 主题写作类 ====== */}
                    {hasWritingContent && renderWritingSection(taskData, hasRefVocab)}
                  </div>
                )}
              </div>

              <button
                onClick={() => startEditTask(task)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-300 hover:text-text-muted"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>

            <button
              onClick={() => toggleExpand(task.id)}
              className="mt-1 ml-7 text-[10px] text-text-muted/60 hover:text-primary transition-colors"
            >
              {isExpanded ? '收起详情 ▲' : '展开详情 ▼'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // 词汇造句区域渲染
  // ============================================================
  function renderVocabSection(
    task: ModuleTask,
    keyWords: KeyWord[],
    ttsUrls: Record<string, string>,
    userSentTTS: Record<string, string>,
    localSentences: Record<string, string[]>
  ) {
    return (
      <div className="space-y-2">
        {/* 例句语音生成按钮 */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-blue-600">
            重点单词 ({keyWords.length})
          </span>
          <button
            onClick={() => handleGenerateTTS(task.id)}
            disabled={ttsLoading === task.id}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
              ttsLoading === task.id
                ? 'border-gray-200 text-gray-400 bg-gray-50'
                : 'border-blue-200 text-blue-600 hover:bg-blue-50'
            }`}
          >
            {ttsLoading === task.id ? (
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 border border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                生成语音...
              </span>
            ) : Object.keys(ttsUrls).length > 0 ? (
              '重新生成例句语音'
            ) : (
              '生成例句语音'
            )}
          </button>
        </div>

        {/* 单词卡片列表 */}
        {keyWords.map((kw: KeyWord, ki: number) =>
          renderKeywordCard(task, kw, ki, ttsUrls, userSentTTS, localSentences)
        )}

        {/* 添加新单词 */}
        {addingWordTaskId === task.id ? (
          <div className="bg-blue-50/30 rounded-lg p-2.5 border border-dashed border-blue-200 space-y-1.5">
            <div className="flex gap-1.5">
              <input
                type="text" value={newWordForm.word}
                onChange={(e) => setNewWordForm(f => ({ ...f, word: e.target.value }))}
                placeholder="单词"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
              />
              <input
                type="text" value={newWordForm.partOfSpeech}
                onChange={(e) => setNewWordForm(f => ({ ...f, partOfSpeech: e.target.value }))}
                placeholder="词性"
                className="w-16 text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
              />
              <input
                type="text" value={newWordForm.translation}
                onChange={(e) => setNewWordForm(f => ({ ...f, translation: e.target.value }))}
                placeholder="翻译"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
              />
            </div>
            <input
              type="text" value={newWordForm.exampleSentence}
              onChange={(e) => setNewWordForm(f => ({ ...f, exampleSentence: e.target.value }))}
              placeholder="例句（原文）"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
            />
            <input
              type="text" value={newWordForm.exampleTranslation}
              onChange={(e) => setNewWordForm(f => ({ ...f, exampleTranslation: e.target.value }))}
              placeholder="例句翻译"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setAddingWordTaskId(null); }}
                className="flex-1 text-[10px] py-1 border border-gray-200 rounded text-gray-500"
              >
                取消
              </button>
              <button
                onClick={() => handleAddKeyword(task.id)}
                disabled={actionLoading === task.id}
                className="flex-1 text-[10px] py-1 bg-blue-500 text-white rounded font-medium"
              >
                {actionLoading === task.id ? '保存中...' : '确认添加'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setAddingWordTaskId(task.id); }}
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-600 transition-colors w-full justify-center py-1.5 border border-dashed border-blue-200 rounded-lg"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            添加新单词
          </button>
        )}
      </div>
    );
  }

  // ============================================================
  // 单个单词卡片（含例句 + 造句空栏）
  // ============================================================
  function renderKeywordCard(
    task: ModuleTask,
    kw: KeyWord,
    ki: number,
    ttsUrls: Record<string, string>,
    userSentTTS: Record<string, string>,
    localSentences: Record<string, string[]>
  ) {
    const audioKey = `${task.id}:${kw.word}`;
    const audioUrl = ttsUrls[kw.word];
    const isPlaying = playingAudio === audioKey;

    const sentences = localSentences[kw.word] || [''];
    const hasAnySentence = sentences.some((s) => s.trim());

    return (
      <div key={ki} className="bg-blue-50/50 rounded-lg p-2.5 border border-blue-100 relative group">
        {/* 删除单词按钮 */}
        <button
          onClick={() => handleDeleteKeyword(task.id, ki)}
          className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
          title="删除此单词"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* 单词 + 词性 + 翻译 */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-bold text-blue-800">{kw.word}</span>
          <span className="text-[10px] text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded">
            {kw.partOfSpeech}
          </span>
          <span className="text-xs text-blue-600">{kw.translation}</span>
        </div>

        {/* AI 例句 */}
        <div className="text-xs text-text-muted leading-relaxed mb-1">
          <span className="text-blue-400">📖 </span>
          {kw.exampleSentence}
        </div>
        <div className="text-[11px] text-text-muted/60 mb-2">
          {kw.exampleTranslation}
        </div>

        {/* AI 例句播放按钮 */}
        {audioUrl && (
          <button
            onClick={() => handlePlayAudio(audioUrl, audioKey)}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors mb-2 ${
              isPlaying
                ? 'border-blue-300 bg-blue-100 text-blue-700'
                : 'border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-600'
            }`}
          >
            {isPlaying ? (
              <>
                <span className="w-2 h-2 bg-blue-600 rounded-sm animate-pulse" />播放中...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                朗读例句
              </>
            )}
          </button>
        )}

        {/* ====== 用户造句区域 ====== */}
        <div className="border-t border-blue-200/50 pt-2 mt-1">
          <span className="text-[10px] font-medium text-blue-500 mb-1.5 block">
            ✏️ 用「{kw.word}」造句
          </span>

          {sentences.map((sentence, si) => (
            <div key={si} className="flex items-center gap-1.5 mb-1.5">
              {/* 造句输入框 */}
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={sentence}
                  onChange={(e) => handleSentenceChange(task.id, kw.word, si, e.target.value)}
                  placeholder={si === 0 ? '请输入你的造句...' : '继续添加造句...'}
                  className={`w-full text-xs border rounded-lg px-2.5 py-1.5 outline-none transition-colors ${
                    sentence.trim()
                      ? 'border-green-200 bg-green-50/30 text-text focus:border-green-400'
                      : 'border-gray-200 bg-white text-text-muted focus:border-primary'
                  }`}
                />
                {/* 输入后显示对勾 */}
                {sentence.trim() && (
                  <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-green-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>

              {/* 发音按钮 */}
              <button
                onClick={() => handleUserTextTTS(task.id, kw.word, si)}
                disabled={!sentence.trim() || sentenceTTSLoading === `${task.id}:${kw.word}:${si}`}
                className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                  sentence.trim()
                    ? 'bg-blue-50 text-blue-500 hover:bg-blue-100 active:bg-blue-200'
                    : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                }`}
                title="朗读我的造句"
              >
                {sentenceTTSLoading === `${task.id}:${kw.word}:${si}` ? (
                  <span className="w-3 h-3 border border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                )}
              </button>

              {/* 删除按钮（仅多个时显示） */}
              {sentences.length > 1 && (
                <button
                  onClick={() => removeUserSentenceSlot(task.id, kw.word, si)}
                  className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                  title="删除此栏"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* 添加造句按钮 */}
          <button
            onClick={() => addUserSentenceSlot(task.id, kw.word)}
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-600 transition-colors mt-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            添加造句
          </button>

          {/* 已保存提示 */}
          {hasAnySentence && (
            <p className="text-[9px] text-green-500/70 mt-1">造句已自动保存</p>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // 写作区域渲染
  // ============================================================
  function renderWritingSection(taskData: TaskData, hasRefVocab: boolean) {
    return (
      <div className="space-y-2">
        <div className="bg-orange-50/50 rounded-lg p-2.5 border border-orange-100">
          <span className="text-[10px] font-semibold text-orange-600 mb-1 block">
            写作题目
          </span>
          <p className="text-xs text-text leading-relaxed">
            {taskData.writingPrompt}
          </p>
        </div>

        {hasRefVocab && (
          <div className="bg-orange-50/30 rounded-lg p-2.5 border border-orange-100">
            <span className="text-[10px] font-semibold text-orange-600 mb-1 block">
              参考词汇
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(taskData.referenceVocabulary || []).map((w: string, vi: number) => (
                <span key={vi} className="text-[11px] bg-white text-orange-700 px-2 py-0.5 rounded-full border border-orange-200">
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
}
