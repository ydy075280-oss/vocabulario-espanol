import { useCallback, useRef, useState } from 'react';
import api from '../api';  // 使用配置好 auth interceptor 的 api 实例（自动携带 token）
import { useAuth } from '../context/AuthContext';

export type PlayRate = 0.1 | 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5;

const VOICE = 'Cherry';

/**
 * 给定用户选择的语速，计算后端 TTS speed 和前端 audio.playbackRate
 * 后端通义千问 TTS API 限制：0.5 ~ 2.0
 * 0.1x / 0.25x 通过共用 0.5x 后端音频 + 前端 audio.playbackRate 额外降速实现
 */
function getServerAndClientRate(userRate: PlayRate): { serverSpeed: number; clientRate: number } {
  // 后端能生成的最低语速是 0.5
  const serverSpeed = userRate < 0.5 ? 0.5 : userRate;
  const clientRate = userRate / serverSpeed;
  return { serverSpeed, clientRate };
}

/** 生成缓存 key：text|voice|serverSpeed（0.1x/0.25x/0.5x 共用 0.5x 缓存） */
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
 *
 * 语速范围 0.1x ~ 1.5x：
 *   - 0.5x ~ 1.5x：后端直接生成对应语速
 *   - 0.1x / 0.25x：后端生成 0.5x 音频，前端用 audio.playbackRate 额外降速
 */
export function useTTS() {
  const { user } = useAuth();
  const userSpeed = (user?.tts_speed ?? 1) as PlayRate;
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [rate, setRate] = useState<PlayRate>(userSpeed || 1);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // 前端 TTS 缓存：key → audioUrl，同一文本+语速只请求一次
  const ttsCacheRef = useRef<Map<string, string>>(new Map());

  /**
   * 播放音频 URL，按 userRate 调整 playbackRate
   * 即使 audioUrl 是后端生成的固定语速，也可以通过 playbackRate 减速
   */
  const playAudioUrl = useCallback((audioUrl: string, userRate: PlayRate = rate) => {
    const { clientRate } = getServerAndClientRate(userRate);

    // 停止当前音频
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    const audio = new Audio(audioUrl);
    audio.preservesPitch = true;  // 保持音调不变（避免变调成怪兽声）
    audio.playbackRate = clientRate;
    audioElRef.current = audio;
    audio.onplay = () => setSpeaking(true);
    audio.onended = () => { setSpeaking(false); if (audioElRef.current === audio) audioElRef.current = null; };
    audio.onerror = () => { setSpeaking(false); if (audioElRef.current === audio) audioElRef.current = null; };
    audio.play().catch(() => setSpeaking(false));
  }, [rate]);

  /**
   * 核心方法：调用后端大模型 TTS API 生成并播放语音
   * 返回 true/false 表示是否成功播放
   */
  const callTTSApi = useCallback(
    async (text: string, wordRate?: PlayRate): Promise<boolean> => {
      if (!text?.trim()) return false;

      const userRate = wordRate || rate;
      const { serverSpeed, clientRate } = getServerAndClientRate(userRate);

      // 1) 先查前端缓存（用 serverSpeed 作为 key，0.1/0.25/0.5 共用 0.5 缓存）
      const key = cacheKey(text, serverSpeed);
      const cached = ttsCacheRef.current.get(key);
      if (cached) {
        playAudioUrl(cached, userRate);
        return true;
      }

      setTtsLoading(true);
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.post('/tts/generate', {
          text: text.trim(),
          voice: VOICE,
          speed: serverSpeed,
        });
        if (data.audioUrl) {
          // 2) 写入前端缓存
          ttsCacheRef.current.set(key, data.audioUrl);
          // 用 clientRate 播放
          if (audioElRef.current) {
            audioElRef.current.pause();
            audioElRef.current = null;
          }
          const audio = new Audio(data.audioUrl);
          audio.preservesPitch = true;
          audio.playbackRate = clientRate;
          audioElRef.current = audio;
          audio.onplay = () => setSpeaking(true);
          audio.onended = () => { setSpeaking(false); if (audioElRef.current === audio) audioElRef.current = null; };
          audio.onerror = () => { setSpeaking(false); if (audioElRef.current === audio) audioElRef.current = null; };
          audio.play().catch(() => setSpeaking(false));
          return true;
        }
      } catch (err: any) {
        console.error('TTS API 调用失败:', err);
        setError(err?.message || 'TTS 失败');
      } finally {
        setTtsLoading(false);
        setLoading(false);
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

  /** 朗读句子（语速 0.75 — 比单词慢一些便于听清） */
  const speakSentence = useCallback(
    (text: string) => {
      callTTSApi(text, 0.75 as PlayRate);
    },
    [callTTSApi]
  );

  /** 智能播放：有 audioUrl 则直接播放 → 查前端缓存 → 调用 API（后端也会去重） */
  const speakOrPlay = useCallback(
    async (text: string, audioUrl?: string, wordRate?: PlayRate) => {
      const userRate = wordRate || rate;
      if (audioUrl) {
        playAudioUrl(audioUrl, userRate);
        return;
      }
      await callTTSApi(text, wordRate);
    },
    [callTTSApi, playAudioUrl, rate]
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
    loading,
    error,
    rate,
    setRate,
    playAudioUrl,
  };
}
