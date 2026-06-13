import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAPI } from '../api';
import { useTTS } from '../hooks/useTTS';

interface Keyword {
  word: string;
  partOfSpeech?: string;
  gender?: string;
  definiteArticle?: string;
  chineseMeaning: string;
  originalForm?: string;
  exampleSentence?: string;
  conjugation?: Record<string, string>;
}

export default function CreatePage() {
  const navigate = useNavigate();
  const { speakSentence, speaking } = useTTS();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [requirement, setRequirement] = useState('');
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [userTextEs, setUserTextEs] = useState('');
  const [userTextZh, setUserTextZh] = useState('');
  const [wordbookName, setWordbookName] = useState('');
  const [teacherTag, setTeacherTag] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (!requirement.trim()) return;
    setAnalyzing(true); setError('');
    try {
      const { data } = await createAPI.analyze(requirement);
      setKeywords(data.keywords || []); setStep(2);
    } catch (err: any) {
      setError(err.response?.data?.error || 'AI 分析失败');
    } finally { setAnalyzing(false); }
  };

  const handleConfirmKeywords = () => setStep(3);

  const removeKeyword = (idx: number) => setKeywords((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!userTextEs.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await createAPI.save({
        teacherRequirement: requirement, keywords, userTextEs, userTextZh,
        wordbookName: wordbookName || `创作 - ${new Date().toLocaleDateString('zh-CN')}`, teacherTag,
      });
      setResult(data); setStep(4);
    } catch (err: any) {
      setError(err.response?.data?.error || '保存失败');
    } finally { setSaving(false); }
  };

  if (step === 4 && result) {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[70dvh]">
        <div className="w-20 h-20 bg-accent-muted rounded-pill flex items-center justify-center mb-6 border border-accent/10">
          <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-display-md text-ink mb-2" style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>创作完成</h2>
        <p className="text-typo-secondary mb-1">已生成单词本和背诵素材</p>
        <p className="text-sm text-typo-muted mb-2">{result.sentences?.length || 0} 个句子 · {keywords.length} 个关键词</p>
        {userTextEs && (
          <button onClick={() => speakSentence(userTextEs)}
            className={`flex items-center gap-2 px-6 py-3 rounded-pill mb-6 transition-all duration-200 border ${speaking ? 'bg-accent-muted border-accent/30 text-accent pulse-playing' : 'bg-surface border-hairline-soft text-ink hover:bg-surface-hover'}`}>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5zM14 3.23v2.06a7.007 7.007 0 010 13.42v2.06A9.01 9.01 0 0021 12a9 9 0 00-7-8.77z" /></svg>
            {speaking ? '朗读中...' : '播放全文朗读'}
          </button>
        )}
        <div className="flex gap-3 w-full max-w-xs">
          <button onClick={() => navigate('/')} className="btn-outline flex-1">返回首页</button>
          {result.wordbookId && (
            <button onClick={() => navigate(`/wordbooks/${result.wordbookId}`)} className="btn-primary flex-1">查看单词本</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="text-display-md text-ink mb-1" style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>创作学习素材</h1>
      <p className="text-sm text-typo-muted mb-6">总结教师作业重点，AI 拆解关键词，自己造句写作</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-pill flex items-center justify-center text-sm font-medium transition-all duration-200 ${step >= s ? 'bg-brand text-white' : 'bg-surface text-typo-muted'}`}>
              {step > s ? '✓' : s}
            </div>
            {s < 3 && <div className={`flex-1 h-1 rounded-pill transition-all duration-300 ${step > s ? 'bg-brand' : 'bg-surface'}`} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <>
          <div className="card mb-4">
            <label className="text-eyebrow uppercase text-typo-muted mb-2 block" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>作业描述</label>
            <textarea value={requirement} onChange={(e) => setRequirement(e.target.value)}
              placeholder="例如：张老师要求我们写一段话描述日常生活作息，用到 levantarse, trabajar, comer, dormir 等关键词"
              className="input-field min-h-[120px] resize-none h-auto" />
          </div>
          {error && <div className="bg-danger-muted border border-danger/20 text-danger text-sm rounded-input px-4 py-3 mb-4">{error}</div>}
          <button onClick={handleAnalyze} disabled={!requirement.trim() || analyzing} className="btn-primary w-full py-3.5">
            {analyzing ? 'AI 分析中...' : 'AI 拆解关键词'}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="card mb-4">
            <h2 className="text-eyebrow uppercase text-typo-muted mb-3" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
              AI 已拆解 {keywords.length} 个关键词
            </h2>
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw, i) => (
                <div key={i} className="inline-flex items-center gap-1 bg-surface text-ink rounded-pill px-3 py-1.5 text-sm group border border-hairline-soft">
                  <span className="font-medium">{kw.word}</span>
                  <span className="text-xs text-typo-secondary">({kw.chineseMeaning})</span>
                  <button onClick={() => removeKeyword(i)} className="w-4 h-4 rounded-pill hover:bg-surface-hover flex items-center justify-center ml-0.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="btn-outline flex-1">返回修改</button>
            <button onClick={handleConfirmKeywords} className="btn-primary flex-1">确认，开始写作</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="card mb-4">
            <h2 className="text-eyebrow uppercase text-typo-muted mb-3" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>用以下关键词写一段西班牙语</h2>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {keywords.map((kw, i) => (
                <span key={i} className="bg-surface text-ink text-xs rounded-pill px-2 py-0.5 border border-hairline-soft">{kw.word}</span>
              ))}
            </div>
            <textarea value={userTextEs} onChange={(e) => setUserTextEs(e.target.value)}
              placeholder="Me levanto a las siete de la mañana..." className="input-field min-h-[150px] resize-none h-auto mb-3" />
            <input type="text" value={userTextZh} onChange={(e) => setUserTextZh(e.target.value)}
              placeholder="中文翻译（可选）" className="input-field mb-3 text-sm" />
          </div>
          <div className="card mb-4">
            <h2 className="text-eyebrow uppercase text-typo-muted mb-2" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>素材设置</h2>
            <input type="text" value={wordbookName} onChange={(e) => setWordbookName(e.target.value)} placeholder="单词本名称" className="input-field mb-2 text-sm" />
            <input type="text" value={teacherTag} onChange={(e) => setTeacherTag(e.target.value)} placeholder="教师/课程标签（可选）" className="input-field text-sm" />
          </div>
          {userTextEs && (
            <button onClick={() => speakSentence(userTextEs)}
              className={`w-full py-3 rounded-pill mb-3 flex items-center justify-center gap-2 text-sm font-medium transition-all duration-200 border ${speaking ? 'bg-accent-muted border-accent/30 text-accent' : 'bg-surface border-hairline-soft text-ink hover:bg-surface-hover'}`}>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5z" /></svg>
              {speaking ? '朗读中...' : '试听朗读'}
            </button>
          )}
          {error && <div className="bg-danger-muted border border-danger/20 text-danger text-sm rounded-input px-4 py-3 mb-4">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="btn-outline flex-1">返回修改关键词</button>
            <button onClick={handleSave} disabled={!userTextEs.trim() || saving} className="btn-primary flex-1">
              {saving ? '保存中...' : '保存并生成素材'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
