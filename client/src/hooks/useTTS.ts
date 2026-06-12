import { useCallback, useRef, useState } from 'react';
import axios from 'axios';

type SpanishAccent = 'es-ES' | 'es-MX';
type PlayRate = 0.5 | 0.75 | 1 | 1.25 | 1.5;

/**
 * 检测设备是否有西班牙语语音可用
 * 需要在 voices 加载完成后调用
 */
function hasSpanishVoice(): boolean {
  if (!('speechSynthesis' in window)) return false;
  const voices = window.speechSynthesis.getVoices();
  return voices.some((v) => v.lang.startsWith('es'));
}

/**
 * 获取 voices 列表（处理 Chrome 异步加载问题）
 */
function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    // Chrome 需要等 voiceschanged 事件
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
  });
}

/**
 * 检测是否有西班牙语语音（异步版本，处理 Chrome 加载延迟）
 */
async function hasSpanishVoiceAsync(): Promise<boolean> {
  const voices = await getVoicesAsync();
  return voices.some((v) => v.lang.startsWith('es'));
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState<PlayRate>(1);
  const [accent, setAccent] = useState<SpanishAccent>('es-ES');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // 缓存西班牙语语音检测结果，避免重复检测
  const spanishVoiceAvailableRef = useRef<boolean | null>(null);

  const speak = useCallback(
    (text: string, wordRate?: PlayRate) => {
      if (!('speechSynthesis' in window)) {
        console.warn('Web Speech API not supported');
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const selectedAccent = accent;
      const selectedRate = wordRate || rate;

      utterance.lang = selectedAccent;
      utterance.rate = selectedRate;
      utterance.pitch = 1;
      utterance.volume = 1;

      // Find best Spanish voice
      const voices = window.speechSynthesis.getVoices();
      const spanishVoice = voices.find(
        (v) =>
          v.lang.startsWith('es') &&
          v.lang.includes(selectedAccent.split('-')[1]) &&
          v.name.includes('Google')
      ) ||
      voices.find((v) => v.lang.startsWith('es') && v.name.includes('Google')) ||
      voices.find((v) => v.lang.startsWith('es')) ||
      voices[0];

      if (spanishVoice) utterance.voice = spanishVoice;

      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [accent, rate]
  );

  /** 播放视频原声音频文件 */
  const playAudioUrl = useCallback((audioUrl: string) => {
    // 停止 TTS
    window.speechSynthesis?.cancel();
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
   * 智能朗读：优先使用设备 Web Speech API（需有西班牙语语音），否则降级调用后端 API
   * @param text 要朗读的文本
   * @param wordRate 语速
   * @returns 使用的方案：'web-speech' | 'api' | 'none'
   */
  const speakWithFallback = useCallback(
    async (text: string, wordRate?: PlayRate): Promise<'web-speech' | 'api' | 'none'> => {
      // 1. 检测是否有西班牙语语音可用
      if (spanishVoiceAvailableRef.current === null) {
        spanishVoiceAvailableRef.current = await hasSpanishVoiceAsync();
      }

      if (spanishVoiceAvailableRef.current) {
        // 有西班牙语语音 → 用 Web Speech API
        speak(text, wordRate);
        return 'web-speech';
      }

      // 2. 没有西班牙语语音 → 降级调用后端 API
      try {
        const { data } = await axios.post('/api/tts/generate', {
          text: text.trim(),
          voice: 'Cherry',
          speed: wordRate || rate,
        });
        if (data.audioUrl) {
          playAudioUrl(data.audioUrl);
          return 'api';
        }
      } catch (err) {
        console.error('TTS API 降级调用失败:', err);
      }

      return 'none';
    },
    [speak, rate, playAudioUrl]
  );

  /** 智能播放：优先使用原声音频 URL，回退到 TTS（含西班牙语检测 + API 降级） */
  const speakOrPlay = useCallback(
    async (text: string, audioUrl?: string, wordRate?: PlayRate) => {
      if (audioUrl) {
        playAudioUrl(audioUrl);
        return;
      }
      // 没有缓存音频 → 用 speakWithFallback（自动判断 Web Speech API 还是 API）
      await speakWithFallback(text, wordRate);
    },
    [speakWithFallback, playAudioUrl]
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speakSentence = useCallback(
    (text: string, audioUrl?: string) => {
      speakOrPlay(text, audioUrl, 0.75);
    },
    [speakOrPlay]
  );

  return { speak, speakSentence, speakOrPlay, speakWithFallback, stop, speaking, rate, setRate, accent, setAccent, playAudioUrl, hasSpanishVoice };
}
