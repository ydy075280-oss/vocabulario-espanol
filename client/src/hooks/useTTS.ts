import { useCallback, useRef, useState } from 'react';
import api from '../api';  // 使用配置好 auth interceptor 的 api 实例（自动携带 token）
import { useAuth } from '../context/AuthContext';

type PlayRate = 0.5 | 0.75 | 1 | 1.25 | 1.5;

const VOICE = 'Cherry';

/** 生成缓存 key：text|voice|speed */
function cacheKey(text: string, speed: number): string {
  return `${text.trim()}|${VOICE}|${speed}`;
}

/**
 * TTS Hook — 直接调用后端大模型 API (qwen3-tts-flash) 发声
 * 单词卡片、例句、创作文本 全部通过后端 API 生成语音
 *
 * 内置两层缓存：
 *   - 前端 Map：同一文本+语速只请求一次 API（同页面/会话复用）
 *   - 后端去重：基于 text+voice+speed 的 MD5 文件名，文件存在则直接返回
 */
export function useTTS() {
  const { user } = useAuth();
  const userSpeed = user?.tts_speed ?? 1.0;
  const [speaking, setSpeaking] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [rate, setRate] = useState<PlayRate>((userSpeed as PlayRate) || 1);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // 前端 TTS 缓存：key → audioUrl，同一文本+语速只请求一次
  const ttsCacheRef = useRef<Map<string, string>>(new Map());

  /** 播放音频 URL */
  const playAudioUrl = useCallback((audioUrl: string) => {
    // 停止当前音频
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    const audio = new Audio(audioUrl);
    audioElRef.current = audio;
    audio.onplay = () => setSpeaking(true);
    audio.onended = () => { setSpeaking(false); audioElRef.current = null; };
    audio.onerror = () => { setSpeaking(false); audioElRef.current = null; };
    audio.play().catch(() => setSpeaking(false));
  }, []);

  /**
   * 核心方法：调用后端大模型 TTS API 生成并播放语音
   * 返回 true/false 表示是否成功播放
   */
  const callTTSApi = useCallback(
    async (text: string, wordRate?: PlayRate): Promise<boolean> => {
      if (!text?.trim()) return false;

      const speed = wordRate || rate;

      // 1) 先查前端缓存
      const key = cacheKey(text, speed);
      const cached = ttsCacheRef.current.get(key);
      if (cached) {
        playAudioUrl(cached);
        return true;
      }

      setTtsLoading(true);
      try {
        const { data } = await api.post('/tts/generate', {
          text: text.trim(),
          voice: VOICE,
          speed,
        });
        if (data.audioUrl) {
          // 2) 写入前端缓存
          ttsCacheRef.current.set(key, data.audioUrl);
          playAudioUrl(data.audioUrl);
          return true;
        }
      } catch (err) {
        console.error('TTS API 调用失败:', err);
      } finally {
        setTtsLoading(false);
      }
      return false;
    },
    [rate, playAudioUrl]
  );

  /** 朗读单词/短文本（默认语速） */
  const speak = useCallback(
    (text: string, wordRate?: PlayRate) => {
      callTTSApi(text, wordRate);
    },
    [callTTSApi]
  );

  /** 朗读句子（语速 0.75） */
  const speakSentence = useCallback(
    (text: string) => {
      callTTSApi(text, 0.75);
    },
    [callTTSApi]
  );

  /** 智能播放：有 audioUrl 则直接播放 → 查前端缓存 → 调用 API（后端也会去重） */
  const speakOrPlay = useCallback(
    async (text: string, audioUrl?: string, wordRate?: PlayRate) => {
      if (audioUrl) {
        playAudioUrl(audioUrl);
        return;
      }
      await callTTSApi(text, wordRate);
    },
    [callTTSApi, playAudioUrl]
  );

  /** 同 speakOrPlay（别名，兼容旧调用） */
  const speakWithFallback = speakOrPlay;

  const stop = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    setSpeaking(false);
  }, []);

  return {
    speak,
    speakSentence,
    speakOrPlay,
    speakWithFallback,
    stop,
    speaking,
    ttsLoading,
    rate,
    setRate,
    playAudioUrl,
  };
}
