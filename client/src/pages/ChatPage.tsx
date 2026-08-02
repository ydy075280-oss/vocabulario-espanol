import { useState, useRef, useEffect, useCallback } from 'react';
import { getChatGreeting, chatSpeak, parseSSEStream } from '../api';
import type { ChatMessage, ChatWord } from '../api';
import { wordbookAPI, cardAPI } from '../api';

// ============================================================
// 场景预设
// ============================================================
const SCENARIOS = [
  { key: 'free', label: '自由对话' },
  { key: 'restaurant', label: '餐厅点餐' },
  { key: 'hotel', label: '酒店入住' },
  { key: 'navigation', label: '问路指路' },
  { key: 'shopping', label: '购物逛街' },
  { key: 'doctor', label: '看医生' },
  { key: 'social', label: '闲聊交友' },
  { key: 'travel', label: '旅行咨询' },
];

const DIFFICULTIES = [
  { key: 'beginner', label: '初级', desc: 'A1-A2 · 现在时', color: 'bg-green-100 text-green-700 border-green-300' },
  { key: 'intermediate', label: '中级', desc: 'B1 · 过去/将来时', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  { key: 'advanced', label: '高级', desc: 'B2+ · 虚拟式/条件式', color: 'bg-red-100 text-red-700 border-red-300' },
];

// ============================================================
// 消息类型
// ============================================================
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  corrections?: Array<{ original: string; corrected: string; explanation: string }>;
  showCorrections?: boolean;
}

interface Config {
  scenario: string;
  scenarioLabel: string;
  difficulty: string;
  wordbookId: string;
  wordbookWords: ChatWord[];
}

// ============================================================
// 开场白文案 (本地降级，避免首次加载网路请求)
// ============================================================
const DEFAULT_GREETINGS: Record<string, string> = {
  free: '¡Hola! ¿Qué tal? ¿De qué tema te gustaría hablar hoy?',
  restaurant: '¡Buenos días! Soy tu camarero. ¿Qué te gustaría comer hoy?',
  hotel: '¡Bienvenido al hotel! ¿Tiene una reserva a qué nombre?',
  navigation: 'Disculpa, ¿necesitas ayuda para llegar a algún lugar?',
  shopping: '¡Hola! ¿En qué puedo ayudarte? ¿Buscas algo en especial?',
  doctor: 'Buenos días, soy tu médico. Cuéntame, ¿qué síntomas tienes?',
  social: '¡Hola! ¿Cómo te llamas? ¿De dónde eres?',
  travel: '¡Bienvenido a la agencia de viajes! ¿A dónde te gustaría viajar?',
};

// ============================================================
// ChatPage 组件
// ============================================================
export default function ChatPage() {
  const [phase, setPhase] = useState<'setup' | 'chatting'>('setup');
  const [config, setConfig] = useState<Config>({
    scenario: 'free', scenarioLabel: '自由对话', difficulty: 'beginner',
    wordbookId: '', wordbookWords: [],
  });
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');

  // Wordbook list for setup
  const [wordbooks, setWordbooks] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingWordbooks, setLoadingWordbooks] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // 加载单词本列表
  useEffect(() => {
    (async () => {
      setLoadingWordbooks(true);
      try {
        const res = await wordbookAPI.list();
        setWordbooks(res.data.wordbooks || res.data || []);
      } catch { /* ignore */ }
      setLoadingWordbooks(false);
    })();
  }, []);

  // ========== Setup: 开始对话 ==========
  const handleStartChat = async () => {
    setError('');
    setMessages([]);
    setStreamingText('');
    setStatus('正在准备...');

    try {
      // 尝试获取 AI 开场白 + TTS
      const { text, audioUrl } = await getChatGreeting({
        scenario: config.scenario,
        scenarioLabel: config.scenarioLabel,
        difficulty: config.difficulty,
        wordbookWords: config.wordbookWords,
      });

      const greetingMsg: UIMessage = {
        id: 'greeting', role: 'assistant', content: text, audioUrl,
      };
      setMessages([greetingMsg]);
      setPhase('chatting');
      setStatus('');

      // 自动播放开场白语音
      playAudio(audioUrl);
    } catch {
      // 降级：使用本地开场白
      const text = DEFAULT_GREETINGS[config.scenario] || DEFAULT_GREETINGS.free;
      const greetingMsg: UIMessage = {
        id: 'greeting', role: 'assistant', content: text,
      };
      setMessages([greetingMsg]);
      setPhase('chatting');
      setStatus('');
    }
  };

  // ========== 播放音频 ==========
  const playAudio = useCallback((url: string) => {
    if (!url) return;
    // 停止之前的音频
    audioRef.current?.pause();
    audioRef.current = new Audio(url);
    audioRef.current.play().catch(() => { /* autoplay blocked */ });
  }, []);

  // ========== 录音 ==========
  const startRecording = useCallback(async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 检查麦克风是否真的在采集数据
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.muted) {
        setError('麦克风被静音，请检查设备');
        return;
      }
      streamRef.current = stream;

      const preferredMime = 'audio/webm;codecs=opus';
      const fallbackMime = 'audio/webm';
      let mimeType = MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : fallbackMime;
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        // 最后尝试 mp4
        mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      }
      if (!mimeType) {
        setError('当前浏览器不支持录音，请换 Chrome/Edge 试试');
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      let hasData = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          hasData = true;
        }
      };

      recorder.onstop = async () => {
        if (!isRecordingRef.current) return;
        isRecordingRef.current = false;
        setIsRecording(false);

        const blobType = mimeType === 'audio/mp4' ? 'audio/mp4' : 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: blobType });

        if (!hasData || blob.size < 1024) {
          setError('录音太短或未采集到声音，请按住多录一点');
          return;
        }
        await handleSendAudio(blob);
      };

      recorder.onerror = () => {
        isRecordingRef.current = false;
        setIsRecording(false);
        setError('录音失败，请重试');
      };

      // 使用 timeslice 确保数据分段写入，避免某些浏览器为空
      recorder.start(200);
      isRecordingRef.current = true;
      setIsRecording(true);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('没有麦克风权限，请在浏览器设置中允许');
      } else if (err.name === 'NotFoundError') {
        setError('未找到麦克风设备');
      } else {
        setError('无法访问麦克风: ' + err.message);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    // 释放麦克风
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ========== 发送音频 + 处理 SSE 流 ==========
  const handleSendAudio = async (audioBlob: Blob) => {
    setStatus('正在识别语音...');
    setError('');

    const chatHistory: ChatMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const stream = await chatSpeak(audioBlob, {
        scenario: config.scenario,
        scenarioLabel: config.scenarioLabel,
        difficulty: config.difficulty,
        wordbookWords: config.wordbookWords,
        chatHistory,
      });

      let transcript = '';
      let fullResponse = '';
      let audioUrl = '';
      let corrections: UIMessage['corrections'] = [];
      let aiMsgAdded = false;
      let aiMsgId = '';

      for await (const sseEvent of parseSSEStream(stream)) {
        const { event, data } = sseEvent;

        switch (event) {
          case 'transcript':
            transcript = data.text || '';
            // 添加用户消息
            setMessages(prev => [...prev, {
              id: `user-${Date.now()}`,
              role: 'user',
              content: transcript,
            }]);
            break;

          case 'status':
            setStatus(data.message || '');
            break;

          case 'ai_text_delta':
            fullResponse += data.delta || '';
            setStreamingText(fullResponse);
            // 第一条 delta 到来时创建 AI 消息占位
            if (!aiMsgAdded) {
              aiMsgAdded = true;
              aiMsgId = `ai-${Date.now()}`;
              setMessages(prev => [...prev, {
                id: aiMsgId, role: 'assistant', content: '',
              }]);
            }
            // 流式更新最后一条 AI 消息
            setMessages(prev => prev.map(m =>
              m.id === aiMsgId ? { ...m, content: fullResponse } : m
            ));
            break;

          case 'ai_audio':
            audioUrl = data.audioUrl || '';
            if (audioUrl) {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, audioUrl } : m
              ));
              setStatus('');
              playAudio(audioUrl);
            }
            break;

          case 'done':
            corrections = data.corrections || [];
            fullResponse = data.fullResponse || fullResponse;
            setMessages(prev => prev.map(m =>
              m.id === aiMsgId
                ? { ...m, content: fullResponse, corrections, audioUrl: audioUrl || m.audioUrl }
                : m
            ));
            setStreamingText('');
            setStatus('');
            break;

          case 'error':
            setError(data.error || '处理失败');
            setStreamingText('');
            setStatus('');
            break;
        }
      }
    } catch (err: any) {
      setError(err.message || '网络错误，请重试');
      setStatus('');
      setStreamingText('');
    }
  };

  // ========== 结束对话 ==========
  const handleEndChat = () => {
    setPhase('setup');
    setMessages([]);
    setStreamingText('');
    setStatus('');
    setError('');
  };

  // ========== 选择单词本 ==========
  const handleSelectWordbook = async (wordbookId: string) => {
    setConfig(prev => ({ ...prev, wordbookId, wordbookWords: [] }));
    if (!wordbookId) return;

    try {
      const res = await cardAPI.list({ wordbookId });
      const cards = res.data.cards || res.data || [];
      const words: ChatWord[] = cards
        .filter((c: any) => c.word && c.translation)
        .map((c: any) => ({ word: c.word, translation: c.translation }))
        .slice(0, 30); // 最多传 30 个词
      setConfig(prev => ({ ...prev, wordbookWords: words }));
    } catch { /* ignore */ }
  };

  // ============================================================
  // Render: Setup modal
  // ============================================================
  if (phase === 'setup') {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-ink mb-1">AI 语音对话</h2>
            <p className="text-sm text-typo-muted">选择场景和难度，开始西班牙语口语练习</p>
          </div>

          {/* Scenario */}
          <div className="mb-5">
            <label className="text-xs font-semibold text-typo-muted uppercase tracking-wide mb-2 block">对话场景</label>
            <div className="grid grid-cols-2 gap-2">
              {SCENARIOS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setConfig(prev => ({ ...prev, scenario: s.key, scenarioLabel: s.label }))}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-left ${
                    config.scenario === s.key
                      ? 'bg-brand text-white shadow-md'
                      : 'bg-surface text-typo-muted hover:text-ink hover:bg-white border border-hairline-soft'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div className="mb-5">
            <label className="text-xs font-semibold text-typo-muted uppercase tracking-wide mb-2 block">难度等级</label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.key}
                  onClick={() => setConfig(prev => ({ ...prev, difficulty: d.key }))}
                  className={`px-3 py-3 rounded-xl text-center transition-all duration-200 border ${
                    config.difficulty === d.key
                      ? `${d.color} border-2 font-semibold`
                      : 'bg-surface text-typo-muted border-hairline-soft hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm">{d.label}</div>
                  <div className="text-[10px] mt-0.5 opacity-70">{d.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Wordbook (optional) */}
          <div className="mb-6">
            <label className="text-xs font-semibold text-typo-muted uppercase tracking-wide mb-2 block">
              使用单词本（可选）
            </label>
            {loadingWordbooks ? (
              <div className="text-xs text-typo-muted py-2">加载中...</div>
            ) : (
              <select
                className="w-full px-3 py-2.5 rounded-xl border border-hairline-soft bg-white text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                value={config.wordbookId}
                onChange={(e) => handleSelectWordbook(e.target.value)}
              >
                <option value="">不限 — 自由对话</option>
                {wordbooks.map(wb => (
                  <option key={wb.id} value={wb.id}>{wb.name}</option>
                ))}
              </select>
            )}
            {config.wordbookWords.length > 0 && (
              <div className="mt-2 text-[11px] text-green-600 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                已加载 {config.wordbookWords.length} 个词汇
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl">
              {error}
            </div>
          )}

          {/* Start button */}
          <button
            onClick={handleStartChat}
            className="w-full py-3 bg-brand text-white font-semibold rounded-xl shadow-lg shadow-brand/25 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            开始对话
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Render: Chat interface
  // ============================================================
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3 border-b border-hairline-soft bg-white flex items-center gap-3">
        <button
          onClick={handleEndChat}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-surface transition-colors"
        >
          <svg className="w-5 h-5 text-typo-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink truncate">{config.scenarioLabel}</div>
          <div className="text-[11px] text-typo-muted">
            {DIFFICULTIES.find(d => d.key === config.difficulty)?.label || '初级'}
            {config.wordbookWords.length > 0 && ` · ${config.wordbookWords.length}个词汇`}
          </div>
        </div>
        <button
          onClick={handleEndChat}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
        >
          结束
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onPlay={playAudio}
            onToggleCorrections={() => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { ...m, showCorrections: !m.showCorrections } : m
              ));
            }}
            isStreaming={streamingText !== '' && msg.id === messages[messages.length - 1]?.id}
          />
        ))}
        {error && (
          <div className="flex justify-center">
            <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl">
              {error}
              <button
                onClick={() => setError('')}
                className="ml-2 underline hover:no-underline"
              >
                关闭
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Status indicator */}
      {status && (
        <div className="flex-shrink-0 px-4 py-1.5 text-center">
          <span className="inline-flex items-center gap-1.5 text-xs text-typo-muted">
            <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
            {status}
          </span>
        </div>
      )}

      {/* Recording button */}
      <div className="flex-shrink-0 px-4 py-4 bg-white border-t border-hairline-soft">
        <div className="flex items-center justify-center">
          <button
            onMouseDown={(e) => { e.preventDefault(); startRecording(); }}
            onMouseUp={(e) => { e.preventDefault(); stopRecording(); }}
            onMouseLeave={() => { if (isRecordingRef.current) stopRecording(); }}
            onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
            onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
            disabled={!!status}
            className={`relative flex items-center justify-center rounded-full transition-all duration-300 select-none ${
              isRecording
                ? 'w-20 h-20 bg-red-500 shadow-lg shadow-red-500/40 scale-110'
                : status
                  ? 'w-16 h-16 bg-gray-300 cursor-not-allowed'
                  : 'w-16 h-16 bg-brand shadow-lg shadow-brand/30 hover:scale-105 active:scale-95'
            }`}
          >
            {isRecording ? (
              <div className="flex items-center gap-0.5">
                <span className="w-1 h-4 bg-white rounded-full animate-pulse" />
                <span className="w-1 h-4 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.1s' }} />
                <span className="w-1 h-4 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
              </div>
            ) : (
              <svg className={`w-7 h-7 ${status ? 'text-gray-400' : 'text-white'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-center text-[11px] text-typo-muted mt-2">
          {isRecording ? '松开发送' : '按住说话'}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// MessageBubble 子组件
// ============================================================
function MessageBubble({
  msg,
  onPlay,
  onToggleCorrections,
  isStreaming,
}: {
  msg: UIMessage;
  onPlay: (url: string) => void;
  onToggleCorrections: () => void;
  isStreaming: boolean;
}) {
  const isUser = msg.role === 'user';
  const hasCorrections = msg.corrections && msg.corrections.length > 0;
  const hasAudio = !!msg.audioUrl;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Bubble */}
        <div
          className={`px-4 py-2.5 rounded-2xl ${
            isUser
              ? 'bg-brand text-white rounded-br-md'
              : 'bg-white border border-hairline-soft text-ink rounded-bl-md shadow-sm'
          }`}
        >
          <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isStreaming ? 'after:content-["▊"] after:animate-pulse after:ml-0.5' : ''}`}>
            {msg.content || (isStreaming ? '' : '...')}
          </p>

          {/* Actions row */}
          {(hasAudio || hasCorrections) && !isStreaming && (
            <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-hairline-soft/50">
              {hasAudio && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPlay(msg.audioUrl!); }}
                  className="flex items-center gap-1 text-[11px] text-brand hover:text-brand/80 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  播放
                </button>
              )}
              {hasCorrections && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCorrections(); }}
                  className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  纠错 {msg.corrections?.length}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Corrections panel */}
        {msg.showCorrections && hasCorrections && (
          <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-2">
            <p className="font-semibold text-amber-700">语法纠错：</p>
            {msg.corrections!.map((c, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-red-500 line-through">{c.original}</span>
                  <svg className="w-3 h-3 text-typo-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-green-600 font-medium">{c.corrected}</span>
                </div>
                <p className="text-typo-muted">{c.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
