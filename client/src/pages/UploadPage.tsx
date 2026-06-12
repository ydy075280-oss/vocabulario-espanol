import { useState, useRef } from 'react';
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
  const [extractedSentences, setExtractedSentences] = useState<any[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    // Validate
    const valid = selected.filter((f) => {
      const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(f.type);
      const isVideo = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'].includes(f.type);
      return isImage || isVideo;
    });

    if (valid.length !== selected.length) {
      setError('部分文件格式不支持（仅支持 JPG/PNG/WebP 图片和 MP4/MOV/AVI 视频）');
    } else {
      setError('');
    }

    setFiles(valid);
    setUploadedData(null);

    if (valid.length > 0 && !wordbookName) {
      const firstName = valid[0].name.replace(/\.[^/.]+$/, '');
      setWordbookName(firstName);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setProgress(0);
    setError('');
    setWarning('');
    setMessage('');
    setExtractedSentences([]);

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      formData.append('wordbookName', wordbookName || `上传于 ${new Date().toLocaleDateString('zh-CN')}`);
      if (teacherTag) formData.append('teacherTag', teacherTag);

      // 第一步：上传文件
      const { data } = await uploadAPI.upload(formData, (pct) => setProgress(pct));
      setUploadedData(data);
      setMessage(`文件上传成功！${files.length} 个文件`);

      // 第二步：自动提取单词
      setExtracting(true);
      if (data.wordbookId) {
        const firstFile = data.files?.[0];
        if (firstFile) {
          try {
            const extractRes = await uploadAPI.extract({
              filePath: firstFile.path,
              fileType: firstFile.type,
              wordbookId: data.wordbookId,
            });
            const edata = extractRes.data;
            // 根据提取来源展示不同消息
            if (edata.extractionSource === 'ocr') {
              setMessage(`${edata.message}`);
            } else {
              setWarning(edata.message || `已生成 ${edata.cardIds?.length || 0} 个示例单词`);
            }
            // 保存造句列表
            if (edata.sentences && edata.sentences.length > 0) {
              setExtractedSentences(edata.sentences);
            }
          } catch (extractErr: any) {
            // 提取失败，但文件已上传成功
            const errDetail = extractErr.response?.data?.detail || extractErr.response?.data?.error || '未知错误';
            setWarning(`上传成功，但 AI 单词提取失败：${errDetail}。你可以稍后在单词本中手动添加单词。`);
            console.error('[Extract] 提取失败:', errDetail);
          }
        }
      }
    } catch (err: any) {
      // 上传失败
      setError(err.response?.data?.error || '文件上传失败，请重试');
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const isVideo = (f: File) => f.type.startsWith('video/');

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-text-primary mb-1">上传学习资料</h1>
      <p className="text-sm text-text-muted mb-6">上传老师的教学视频或课件图片，自动提取单词</p>

      {/* File selector */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-primary hover:bg-primary-50/30 transition-colors mb-4"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/webm"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-text-secondary font-medium">点击选择文件</p>
        <p className="text-sm text-text-muted mt-1">图片: JPG/PNG/WebP ≤10MB | 视频: MP4/MOV/AVI ≤500MB</p>
      </div>

      {/* Selected files */}
      {files.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text-secondary">
              已选择 {files.length} 个文件
            </h3>
            <button onClick={() => { setFiles([]); setUploadedData(null); }} className="text-xs text-text-muted">
              清空
            </button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-white rounded-lg shadow-sm">
                {isVideo(f) ? (
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center text-green-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{f.name}</p>
                  <p className="text-xs text-text-muted">{formatSize(f.size)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wordbook name */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-text-secondary mb-1.5">单词本名称</label>
        <input
          type="text"
          value={wordbookName}
          onChange={(e) => setWordbookName(e.target.value)}
          placeholder="为这个单词本起个名字"
          className="input-field"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-text-secondary mb-1.5">
          教师/课程标签 <span className="text-text-muted">（可选）</span>
        </label>
        <input
          type="text"
          value={teacherTag}
          onChange={(e) => setTeacherTag(e.target.value)}
          placeholder="如：张老师、A2语法课"
          className="input-field"
        />
      </div>

      {/* Progress */}
      {uploading && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-text-secondary">
              {extracting ? '正在提取单词...' : '上传中...'}
            </span>
            <span className="text-sm font-medium text-primary">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${extracting ? 90 : progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Message/Error/Warning */}
      {error && <div className="bg-red-50 text-danger text-sm rounded-btn px-4 py-3 mb-4">{error}</div>}
      {warning && (
        <div className="bg-yellow-50 text-yellow-700 text-sm rounded-btn px-4 py-3 mb-4">{warning}</div>
      )}
      {message && !error && (
        <div className="bg-green-50 text-success text-sm rounded-btn px-4 py-3 mb-4 flex items-center justify-between">
          <span>{message}</span>
          {uploadedData?.wordbookId && !extracting && (
            <button onClick={() => navigate(`/wordbooks/${uploadedData.wordbookId}`)} className="font-medium underline">
              查看
            </button>
          )}
        </div>
      )}

      {/* 造句展示 */}
      {extractedSentences.length > 0 && !uploading && (
        <div className="mb-4 bg-blue-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            AI 识别造句 ({extractedSentences.length}条)
          </h3>
          <div className="space-y-2">
            {extractedSentences.map((s: any, i: number) => (
              <div key={i} className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-sm text-text-primary font-medium leading-relaxed">{s.es}</p>
                <p className="text-xs text-text-muted mt-1">{s.zh}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="btn-primary w-full py-3.5"
      >
        {uploading ? (extracting ? '提取中...' : '上传中...') : `上传并提取 (${files.length}个文件)`}
      </button>

      {uploadedData?.wordbookId && !uploading && (
        <button
          onClick={() => navigate('/learn/' + uploadedData.wordbookId)}
          className="btn-secondary w-full py-3.5 mt-3"
        >
          立即开始学习
        </button>
      )}
    </div>
  );
}
