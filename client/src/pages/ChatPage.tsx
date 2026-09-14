import { useState, useRef, useEffect, useCallback } from 'react';
import { getChatGreeting, chatSpeak, chatTranslate, parseSSEStream } from '../api';
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
  // 中文翻译（仅 AI 消息）
  translation?: string;
  showTranslation?: boolean;
  translating?: boolean;
  translationError?: string;
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
// 录音交互参数
// ============================================================
const MAX_RECORD_SECONDS = 60;      // 单次最长录音（秒），到点自动发送
const SLIDE_CANCEL_DISTANCE = 70;   // 上滑取消阈值（px）

// 移除 AI 回复中的语法纠错标记段（<!--ANALYSIS-->...<!--END_ANALYSIS-->）。
// 后端在流式过程中会逐段下发原始文本（含该标记），若不过滤，
// 气泡里会闪现一长串纠错 JSON 分析数据，故在前端渲染时就剔除。
const stripAnalysisMarkers = (text: string) =>
  text.replace(/<!--ANALYSIS-->[\s\S]*?<!--END_ANALYSIS-->/g, '');

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
  const [recSeconds, setRecSeconds] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false); // 正在上滑取消
  const [error, setError] = useState('');

  // Wordbook list for setup
  const [wordbooks, setWordbooks] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingWordbooks, setLoadingWordbooks] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingMimeRef = useRef('audio/webm'); // 实际录音 blob 类型
  const recordingExtRef = useRef('.webm');       // 实际录音文件扩展名
  const isRecordingRef = useRef(false);
  const cancelRef = useRef(false);          // 本次录音是否取消
  const startTouchYRef = useRef(0);         // 按下时的 Y 坐标（用于上滑判断）
  const recordingStartedAtRef = useRef(0);  // 录音开始时间戳（计时）
  const recTimerRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);
  const handleSendAudioRef = useRef<((blob: Blob) => Promise<void>) | null>(null);

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
  /** 清除录音计时器 */
  const clearRecTimers = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, []);

  /**
   * 结束录音
   * canceled=true → 丢弃录音（上滑取消）
   * canceled=false → 正常停止并发送
   */
  const finishRecording = useCallback(
    (canceled: boolean) => {
      clearRecTimers();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        cancelRef.current = canceled;
        mediaRecorderRef.current.stop(); // 轨道统一在 onstop 里释放
      } else {
        cancelRef.current = false;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        isRecordingRef.current = false;
        setIsRecording(false);
        setCancelArmed(false);
      }
    },
    [clearRecTimers]
  );

  /** 供自动超时 / 手势结束等场景调用的最新引用，避免过期闭包 */
  const finishRecordingRef = useRef((canceled: boolean) => finishRecording(canceled));
  useEffect(() => {
    finishRecordingRef.current = finishRecording;
  }, [finishRecording]);

  // 切后台 / 接电话 / 锁屏导致页面隐藏时自动结束录音（防止无限录音与麦克风常驻）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && isRecordingRef.current) {
        finishRecordingRef.current(false);
      }
    };
    const onBlur = () => {
      if (isRecordingRef.current) finishRecordingRef.current(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError('');
    setCancelArmed(false);
    cancelRef.current = false;

    // 1) 环境检测：getUserMedia 仅在安全上下文（HTTPS / localhost）可用。
    //    手机通过 http://局域网IP 访问时 navigator.mediaDevices 为 undefined
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        '无法使用麦克风：手机浏览器禁止在 http:// 局域网地址下录音。\n请使用 https:// 线上地址访问（或电脑本机 http://localhost），并在浏览器地址栏允许麦克风权限。微信/部分 App 内置浏览器不支持录音，请用系统浏览器打开。'
      );
      return;
    }

    // 2) 获取麦克风流：先用增强约束，设备不支持则降级为裸约束（避免 OverconstrainedError）
    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err: any) {
        if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setError('没有麦克风权限：请在浏览器地址栏的麦克风图标中允许访问后重试');
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        setError('未找到麦克风设备，请检查系统是否接入并启用麦克风');
      } else if (err?.name === 'NotReadableError') {
        setError('麦克风被其他应用占用，请关闭占用程序后重试');
      } else if (err?.name === 'SecurityError') {
        setError('浏览器安全策略阻止访问麦克风，请使用 https:// 或 localhost 访问');
      } else {
        setError('无法访问麦克风: ' + (err?.message || err?.name || '未知错误'));
      }
      return;
    }

    // 检查麦克风是否真的在采集数据
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.muted) {
      setError('麦克风被静音，请检查设备');
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    // 3) 选择当前浏览器支持的最佳录音编码
    const pickConfig = () => {
      const candidates: Array<{ mime: string; ext: string; blobType: string }> = [
        { mime: 'audio/webm;codecs=opus', ext: '.webm', blobType: 'audio/webm' },
        { mime: 'audio/webm', ext: '.webm', blobType: 'audio/webm' },
        { mime: 'audio/mp4', ext: '.mp4', blobType: 'audio/mp4' }, // iOS Safari / 部分安卓
        { mime: 'audio/ogg;codecs=opus', ext: '.ogg', blobType: 'audio/ogg' },
      ];
      for (const c of candidates) {
        try {
          if (MediaRecorder.isTypeSupported(c.mime)) return c;
        } catch { /* ignore */ }
      }
      return null;
    };

    const cfg = pickConfig();
    if (!cfg) {
      setError('当前浏览器不支持录音，请换 Chrome/Edge/Safari 试试');
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: cfg.mime });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setError('当前浏览器不支持录音，请换 Chrome/Edge/Safari 试试');
        return;
      }
    }
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    recordingMimeRef.current = cfg.blobType;
    recordingExtRef.current = cfg.ext;
    recordingStartedAtRef.current = Date.now();
    setRecSeconds(0);
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
      setCancelArmed(false);
      clearRecTimers();

      // 录音结束统一释放麦克风（不要在 stop() 后立刻停轨道，避免丢数据）
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      // 上滑取消：丢弃录音，不发消息
      const wasCanceled = cancelRef.current;
      cancelRef.current = false;
      if (wasCanceled) {
        chunksRef.current = [];
        return;
      }

      const blob = new Blob(chunksRef.current, {
        type: recordingMimeRef.current || 'audio/webm',
      });

      // 时长 + 大小双重校验：快速点按会攒下几 KB 有效数据，但太短云端会判为无声
      const elapsedMs = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0;
      if (!hasData || blob.size < 1024) {
        setError('录音太短或未采集到声音，请按住多说几句再松开');
        return;
      }
      if (elapsedMs < 800) {
        setError('说话时间太短，请按住按钮说完整一句话再松开');
        return;
      }
      // 通过 ref 调用最新的 handleSendAudio，避免过期闭包导致聊天历史丢失
      await handleSendAudioRef.current?.(blob);
    };

    recorder.onerror = () => {
      isRecordingRef.current = false;
      setIsRecording(false);
      setCancelArmed(false);
      clearRecTimers();
      setError('录音失败，请重试');
    };

    // 4) 使用 timeslice 确保数据分段写入，避免某些浏览器为空
    recorder.start(200);
    isRecordingRef.current = true;
    setIsRecording(true);

    // 计时显示（每 300ms 刷新一次，秒取整）+ 最长录音自动发送
    recTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
      setRecSeconds(elapsed);
    }, 300);
    autoStopTimerRef.current = window.setTimeout(() => {
      if (isRecordingRef.current) finishRecordingRef.current(false);
    }, MAX_RECORD_SECONDS * 1000);
  }, [clearRecTimers]);

  const stopRecording = useCallback(
    (canceled = false) => {
      finishRecording(canceled);
    },
    [finishRecording]
  );

  /** 按下说话（pointerdown） */
  const handleHoldStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (status) return; // 处理中禁止录音
      e.preventDefault();
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      startTouchYRef.current = e.clientY;
      startRecording();
    },
    [startRecording, status]
  );

  /** 按住滑动：上滑超过阈值 → 进入取消态 */
  const handleHoldMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isRecordingRef.current) return;
      const dy = e.clientY - startTouchYRef.current;
      const nextCancel = dy <= -SLIDE_CANCEL_DISTANCE;
      if (nextCancel !== cancelRef.current) {
        cancelRef.current = nextCancel;
        setCancelArmed(nextCancel);
      }
    },
    []
  );

  /** 松开发送 / 取消 */
  const handleHoldEnd = useCallback(
    (e?: React.PointerEvent<HTMLButtonElement>) => {
      if (!isRecordingRef.current) return;
      const canceled = cancelRef.current;
      cancelRef.current = false;
      setCancelArmed(false);
      finishRecording(canceled);
    },
    [finishRecording]
  );

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
            {
              // 过滤掉 ANALYSIS 纠错标记段，避免流式期间闪现原始 JSON
              const visibleText = stripAnalysisMarkers(fullResponse);
              setStreamingText(visibleText);
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
                m.id === aiMsgId ? { ...m, content: visibleText } : m
              ));
            }
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
            fullResponse = stripAnalysisMarkers(data.fullResponse || fullResponse).trim();
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

  // 保持 ref 指向最新的 handleSendAudio（供录音 onstop 回调使用，避免过期闭包）
  useEffect(() => {
    handleSendAudioRef.current = handleSendAudio;
  });

  // ========== 翻译 AI 消息为中文 ==========
  const handleToggleTranslation = async (msg: UIMessage) => {
    if (msg.translating || msg.role !== 'assistant') return;

    // 已有译文 → 切换展开/收起（避免重复请求浪费 token）
    if (msg.translation) {
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, showTranslation: !m.showTranslation } : m
      ));
      return;
    }

    if (!msg.content.trim()) return;

    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, translating: true, translationError: '' } : m
    ));

    try {
      const translation = await chatTranslate(msg.content);
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, translating: false, translation, showTranslation: true } : m
      ));
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, translating: false, translationError: err.message || '翻译失败，请重试' } : m
      ));
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
            onTranslate={handleToggleTranslation}
            onToggleCorrections={() => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { ...m, showCorrections: !m.showCorrections } : m
              ));
            }}
            isStreaming={streamingText !== '' && msg.id === messages[messages.length - 1]?.id}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 底部操作区：处理状态 / 错误提示 / 录音按钮 */}
      <div className="flex-shrink-0 px-4 pt-2 pb-3 bg-white border-t border-hairline-soft">
        {/* 处理中状态 */}
        {status && (
          <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-surface px-4 py-2.5 border border-hairline-soft">
            <span className="w-4 h-4 rounded-full border-2 border-hairline border-t-brand animate-spin" />
            <span className="text-xs text-typo-secondary font-medium truncate">{status}</span>
          </div>
        )}

        {/* 错误提示（始终可见，可关闭） */}
        {error && (
          <div className="mb-3 rounded-xl bg-danger-muted border border-danger/20 px-3.5 py-2.5 flex items-start gap-2">
            <svg className="w-4 h-4 text-danger mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="flex-1 min-w-0 text-xs text-danger leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {error}
            </p>
            <button
              onClick={() => setError('')}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-danger/60 hover:text-danger hover:bg-danger/10 transition-colors"
              aria-label="关闭提示"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* 录音按钮 */}
        <div className="flex items-center justify-center">
          <div className="relative">
            {/* 录音时外圈扩散动画 */}
            {isRecording && !cancelArmed && (
              <span className="absolute inset-0 rounded-full bg-red-500/25 animate-ping" />
            )}
            <button
              onPointerDown={handleHoldStart}
              onPointerMove={handleHoldMove}
              onPointerUp={handleHoldEnd}
              onPointerCancel={() => handleHoldEnd()}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!!status}
              style={{ touchAction: 'none' }}
              aria-label={isRecording ? (cancelArmed ? '松开取消' : '松开发送') : '按住说话'}
              className={`relative flex items-center justify-center rounded-full transition-all duration-300 select-none ${
                isRecording
                  ? cancelArmed
                    ? 'w-20 h-20 bg-danger shadow-lg shadow-danger/40 scale-110'
                    : 'w-20 h-20 bg-red-500 shadow-lg shadow-red-500/40 scale-110'
                  : status
                    ? 'w-16 h-16 bg-gray-300 cursor-not-allowed'
                    : 'w-16 h-16 bg-brand shadow-lg shadow-brand/30 hover:scale-105 active:scale-95'
              }`}
            >
              {isRecording ? (
                cancelArmed ? (
                  /* 上滑取消态：X + 上升箭头 */
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  /* 录音中：声波动画 + 计时 */
                  <div className="flex items-center gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="w-1 bg-white rounded-full rec-bar"
                        style={{ animationDelay: `${i * 0.12}s` }}
                      />
                    ))}
                  </div>
                )
              ) : status ? (
                <span className="w-5 h-5 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* 状态提示文字 */}
        <p className={`text-center text-[11px] mt-2 transition-colors ${cancelArmed ? 'text-danger font-semibold' : 'text-typo-muted'}`}>
          {isRecording ? (
            cancelArmed ? (
              '松开取消'
            ) : (
              <>
                松开发送 · 上滑取消
                <span className="ml-1 font-semibold text-red-500" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  {recSeconds}s
                </span>
              </>
            )
          ) : status ? (
            '正在处理，请稍候…'
          ) : (
            '按住说话'
          )}
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
  onTranslate,
  onToggleCorrections,
  isStreaming,
}: {
  msg: UIMessage;
  onPlay: (url: string) => void;
  onTranslate: (msg: UIMessage) => void;
  onToggleCorrections: () => void;
  isStreaming: boolean;
}) {
  const isUser = msg.role === 'user';
  const hasCorrections = msg.corrections && msg.corrections.length > 0;
  const hasAudio = !!msg.audioUrl;
  const showTranslateBtn = !isUser && !!msg.content.trim() && !isStreaming;

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
          <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${isStreaming ? 'after:content-["▊"] after:animate-pulse after:ml-0.5' : ''}`}>
            {msg.content || (isStreaming ? '' : '...')}
          </p>

          {/* 翻译失败提示 */}
          {!isUser && msg.translationError && (
            <p className="mt-2 text-xs text-red-500">{msg.translationError}</p>
          )}

          {/* 中文译文 */}
          {!isUser && msg.translation && msg.showTranslation && (
            <div className="mt-2 pt-2 border-t border-hairline-soft/60">
              <p className="text-[13px] leading-relaxed text-typo-muted whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {msg.translation}
              </p>
            </div>
          )}

          {/* Actions row */}
          {(hasAudio || hasCorrections || showTranslateBtn) && !isStreaming && (
            <div className="flex items-center gap-2 flex-wrap mt-2 pt-1.5 border-t border-hairline-soft/50">
              {showTranslateBtn && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTranslate(msg); }}
                  disabled={msg.translating}
                  title="将这条 AI 消息翻译成中文"
                  className="flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-700 transition-colors disabled:opacity-60"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016 5m-3.9 9.5h9M13 13l4 8 4-8m1.5-4.5h-1" />
                  </svg>
                  {msg.translating ? '翻译中…' : msg.translation ? (msg.showTranslation ? '收起译文' : '显示译文') : '中文翻译'}
                </button>
              )}
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
