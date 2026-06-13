import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadAPI, wordbookAPI } from '../api';

export default function UploadPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [wordbookName, setWordbookName] = useState('');
  const [teacherTag, setTeacherTag] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [uploadedData, setUploadedData] = useState<any>(null);
  const [finalWordbookId, setFinalWordbookId] = useState<string | null>(null);
  const [extractedSentences, setExtractedSentences] = useState<any[]>([]);

  // 自动补全：历史标签
  const [historyTags, setHistoryTags] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    wordbookAPI.tags()
      .then(res => setHistoryTags(res.data.allTags || []))
      .catch(() => { /* 静默失败 */ });
  }, []);

  const filteredSuggestions = teacherTag.trim()
    ? historyTags.filter(t => t !== teacherTag && t.toLowerCase().includes(teacherTag.trim().toLowerCase()))
    : [];

  const acceptSuggestion = useCallback((tag: string) => {
    setTeacherTag(tag);
    setShowSuggestions(false);
    setActiveIndex(-1);
  }, []);

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filteredSuggestions.length === 0) {
      if (e.key === 'ArrowDown' && teacherTag.trim()) {
        setShowSuggestions(true);
        setActiveIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      setActiveIndex(prev => Math.min(prev + 1, filteredSuggestions.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setActiveIndex(prev => Math.max(prev - 1, -1));
      e.preventDefault();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      acceptSuggestion(filteredSuggestions[activeIndex]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    const valid = selected.filter((f) => {
      const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(f.type);
      const isVideo = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'].includes(f.type);
      const isPDF = f.type === 'application/pdf';
      const isDocx = f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || f.name.toLowerCase().endsWith('.docx');
      return isImage || isVideo || isPDF || isDocx;
    });
    if (valid.length !== selected.length) setError('部分文件格式不支持');
    else setError('');
    setFiles(valid); setUploadedData(null);
    e.target.value = '';
    if (valid.length > 0 && !wordbookName) {
      setWordbookName(valid[0].name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true); setExtracting(true); setProgress(0); setError(''); setWarning(''); setMessage(''); setExtractedSentences([]); setFinalWordbookId(null);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      formData.append('wordbookName', wordbookName || `上传于 ${new Date().toLocaleDateString('zh-CN')}`);
      formData.append('autoExtract', 'true');
      if (teacherTag) formData.append('teacherTag', teacherTag);
      const { data } = await uploadAPI.upload(formData, (pct) => setProgress(pct));
      setUploadedData(data);
      if (data.wordbookId && data.files?.[0]) {
        setFinalWordbookId(data.wordbookId);
        if (data.extract) {
          const edata = data.extract;
          if (edata.extractionSource === 'ocr') setMessage(edata.message);
          else setWarning(edata.message || `已生成 ${edata.cardIds?.length || 0} 个示例单词`);
          if (edata.sentences?.length > 0) setExtractedSentences(edata.sentences);
        } else if (data.extractError) {
          setWarning(`上传成功，但 AI 单词提取失败：${data.extractError}`);
        } else {
          setMessage(data.message);
        }
      } else {
        setMessage(data.message);
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || '';
      setError(errMsg.includes('timeout') ? '上传超时，请检查网络后重试' : (errMsg || '文件上传失败'));
    } finally { setUploading(false); setExtracting(false); }
  };

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  const isVideo = (f: File) => f.type.startsWith('video/');
  const isPDF = (f: File) => f.type === 'application/pdf';
  const isDocx = (f: File) => f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || f.name.toLowerCase().endsWith('.docx');

  return (
    <div className="page-container">
      <h1 className="text-display-md text-ink mb-1" style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>上传学习资料</h1>
      <p className="text-sm text-typo-muted mb-6">上传老师的教学视频或课件图片，自动提取单词</p>

      <div onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-hairline rounded-card p-8 text-center cursor-pointer hover:border-hairline-strong hover:bg-surface transition-all duration-200 mb-4">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/webm,application/pdf,.docx" multiple className="hidden" onChange={handleFileSelect} />
        <svg className="w-12 h-12 text-typo-muted mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-ink font-medium">点击选择文件</p>
        <p className="text-sm text-typo-muted mt-1">图片: JPG/PNG/WebP ≤10MB | 视频: MP4/MOV/AVI ≤500MB | 文档: PDF ≤50MB / Word ≤20MB</p>
      </div>

      {files.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-eyebrow uppercase text-typo-muted" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>{files.length} 个文件</h3>
            <button onClick={() => { setFiles([]); setUploadedData(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-xs text-typo-muted hover:text-ink transition-colors">清空</button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-surface rounded-card border border-hairline-soft">
                <div className={`w-10 h-10 rounded-card flex items-center justify-center ${isVideo(f) ? 'bg-accent-muted text-accent' : isPDF(f) ? 'bg-danger-muted text-danger' : isDocx(f) ? 'bg-accent-muted text-accent' : 'bg-success-muted text-success'}`}>
                  {isVideo(f) ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  ) : isPDF(f) ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/><text x="9" y="17" fontSize="6" fontWeight="bold" fill="currentColor">PDF</text></svg>
                  ) : isDocx(f) ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/><text x="9" y="17" fontSize="5" fontWeight="bold" fill="currentColor">W</text></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{f.name}</p>
                  <p className="text-xs text-typo-muted">{formatSize(f.size)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="text-eyebrow uppercase text-typo-muted mb-1.5 block" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>单词本名称</label>
        <input type="text" value={wordbookName} onChange={(e) => setWordbookName(e.target.value)} placeholder="为这个单词本起个名字" className="input-field" />
      </div>
      <div className="mb-4 relative">
        <label className="text-eyebrow uppercase text-typo-muted mb-1.5 block" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>教师/课程 <span className="text-typo-disabled">选填</span></label>
        <input
          type="text"
          value={teacherTag}
          onChange={(e) => { setTeacherTag(e.target.value); setShowSuggestions(true); setActiveIndex(-1); }}
          onFocus={() => { if (filteredSuggestions.length > 0) setShowSuggestions(true); }}
          onBlur={() => { setTimeout(() => { setShowSuggestions(false); setActiveIndex(-1); }, 150); }}
          onKeyDown={handleTagKeyDown}
          placeholder="如：张老师、A2语法课"
          className="input-field"
        />
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-canvas rounded-card border border-hairline shadow-lg overflow-hidden">
            {filteredSuggestions.slice(0, 6).map((tag, i) => {
              const query = teacherTag.trim().toLowerCase();
              const matchStart = tag.toLowerCase().indexOf(query);
              const before = matchStart > 0 ? tag.slice(0, matchStart) : '';
              const match = tag.slice(matchStart, matchStart + query.length);
              const after = tag.slice(matchStart + query.length);
              return (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(tag); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors duration-100 flex items-center gap-3
                    ${i === activeIndex ? 'bg-surface text-ink' : 'text-typo-secondary hover:bg-surface'}`}
                >
                  <svg className="w-4 h-4 text-typo-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  <span className="truncate">
                    {before}
                    <mark className="bg-miro-yellow/40 text-ink font-semibold">{match}</mark>
                    {after}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {uploading && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-typo-secondary">{extracting ? '正在提取单词...' : '上传中...'}</span>
            <span className="text-sm font-medium text-ink" style={{ fontFamily: "'Geist Mono', monospace" }}>{progress}%</span>
          </div>
          <div className="w-full bg-surface rounded-pill h-2 overflow-hidden">
            <div className="h-full bg-brand rounded-pill transition-all duration-300" style={{ width: `${extracting ? 90 : progress}%` }} />
          </div>
        </div>
      )}

      {error && <div className="bg-danger-muted border border-danger/20 text-danger text-sm rounded-input px-4 py-3 mb-4">{error}</div>}
      {warning && <div className="bg-warning-muted border border-warning/20 text-warning text-sm rounded-input px-4 py-3 mb-4">{warning}</div>}
      {message && !error && (
        <div className="bg-success-muted border border-success/20 text-success text-sm rounded-input px-4 py-3 mb-4 flex items-center justify-between">
          <span>{message}</span>
          {finalWordbookId && !extracting && (
            <button onClick={() => navigate(`/wordbooks/${finalWordbookId}`)} className="font-medium text-ink hover:opacity-80 ml-2">查看</button>
          )}
        </div>
      )}

      {extractedSentences.length > 0 && !uploading && (
        <div className="mb-4 bg-accent-muted/30 rounded-card p-4 border border-accent/10">
          <h3 className="text-eyebrow uppercase text-accent mb-3" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>AI 识别造句 ({extractedSentences.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {extractedSentences.map((s: any, i: number) => (
              <div key={i} className="bg-surface rounded-card p-3 border border-hairline-soft">
                <p className="text-sm text-ink font-medium leading-relaxed">{s.es}</p>
                <p className="text-xs text-typo-muted mt-1">{s.zh}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={handleUpload} disabled={files.length === 0 || uploading} className="btn-primary w-full py-3.5">
        {uploading ? (extracting ? '提取中...' : '上传中...') : `上传并提取 (${files.length}个文件)`}
      </button>
      {finalWordbookId && !uploading && (
        <button onClick={() => navigate('/wordbooks/' + finalWordbookId)} className="btn-outline w-full py-3.5 mt-3">查看词本</button>
      )}
    </div>
  );
}
