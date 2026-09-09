// ============================================================
// 🎙️ Sambert 语音合成（西班牙语：sambert-camila-v1）
// 模型：sambert-camila-v1（西班牙语女声 Camila）
// 方式：DashScope WebSocket 双向流式（run-task → 二进制音频帧 → task-finished）
// 免费额度：每月 3 万字符（长期）；超出后 1 元/万字符
// 备注：Sambert 为固定音色模型，一个 model 即一个发音人；文本须一次性随 run-task 提交
// ============================================================
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// 兜底 WebSocket 客户端：Node >= 22 全局内置；Node 18/20（如线上 node:20 镜像）用 npm ws 包
import WebSocketImpl from 'ws';

const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
export const SAMBERT_CAMILA = 'sambert-camila-v1';

export interface SambertTTSOptions {
  model?: string;      // 发音人模型，默认 sambert-camila-v1
  format?: 'mp3' | 'wav' | 'pcm';  // 默认 mp3
  sampleRate?: number; // 采样率，Camila 建议 16000
  volume?: number;     // 音量 0~100，默认 50
  rate?: number;       // 语速 0.5~2，默认 1.0
  timeoutMs?: number;  // 超时，默认 60s
}

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key || key === 'sk-your-api-key-here') {
    throw new Error('百炼 API Key 未配置，请在 server/.env 中设置 DASHSCOPE_API_KEY');
  }
  return key;
}

/** 合成整段语音并返回音频 Buffer */
export async function sambertSynthesizeBuffer(
  text: string,
  options: SambertTTSOptions = {}
): Promise<Buffer> {
  const {
    model = SAMBERT_CAMILA,
    format = 'mp3',
    sampleRate = 16000,
    volume = 50,
    rate = 1.0,
    timeoutMs = 60000,
  } = options;

  if (!text || !text.trim()) throw new Error('TTS 文本不能为空');

  const apiKey = getApiKey();
  const taskId = crypto.randomUUID().replace(/-/g, '');
  const audioChunks: Buffer[] = [];

  // 优先使用 Node 22+ 全局内置 WebSocket，低版本自动回退到 npm ws 包，
  // 避免线上环境（如 node:20）因缺少全局 WebSocket 导致 TTS 全部失败
  const WS: any =
    typeof (globalThis as any).WebSocket === 'function'
      ? (globalThis as any).WebSocket
      : WebSocketImpl;

  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let ws: any;

    const cleanup = () => clearTimeout(timer);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch { /* ignore */ }
      reject(new Error(`TTS 合成超时（${timeoutMs}ms）`));
    }, timeoutMs);

    const fail = (msg: string, raw?: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { ws?.close(); } catch { /* ignore */ }
      const detail = raw ? JSON.stringify(raw).slice(0, 400) : '';
      reject(new Error(`${msg}${detail ? '：' + detail : ''}`));
    };

    try {
      ws = new WS(WS_URL, {
        headers: {
          Authorization: `bearer ${apiKey}`,
          'X-DashScope-DataInspection': 'enable',
        },
      });
    } catch (e: any) {
      return fail('WebSocket 连接失败', e.message);
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log(`[SambertTTS] 已连接 model=${model}, text="${text.slice(0, 40)}..."`);
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: {
            text_type: 'PlainText',
            format,
            sample_rate: sampleRate,
            volume,
            rate,
          },
          input: { text },
        },
      }));
    };

    ws.onmessage = (ev: any) => {
      if (typeof ev.data === 'string') {
        let json: any;
        try { json = JSON.parse(ev.data); } catch { return; }
        const event = json?.header?.event;
        if (event === 'task-started') {
          ws.send(JSON.stringify({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          }));
        } else if (event === 'task-finished') {
          if (settled) return;
          settled = true;
          cleanup();
          const audio = Buffer.concat(audioChunks);
          try { ws.close(); } catch { /* ignore */ }
          if (audio.length === 0) return fail('TTS 合成完成但未收到音频数据');
          console.log(`[SambertTTS] ✅ 合成完成 ${audio.length}B`);
          resolve(audio);
        } else if (event === 'task-failed') {
          const msg = json?.header?.error_message || '未知错误';
          fail(`TTS 合成失败: ${msg}`);
        }
      } else {
        // 二进制帧 = 音频数据
        const data: any = ev.data;
        if (data) {
          audioChunks.push(
            data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data as any)
          );
        }
      }
    };

    ws.onerror = (e: any) => {
      console.error('[SambertTTS] ❌ onerror:', e?.message || e?.error || e);
    };

    ws.onclose = (e: any) => {
      console.log(`[SambertTTS] 🔌 onclose code=${e?.code} reason=${e?.reason || ''}`);
      if (!settled) {
        cleanup();
        settled = true;
        reject(new Error(`TTS 连接意外关闭 (code=${e?.code})`));
      }
    };
  });
}

/** 合成并直接保存为文件，返回文件路径 */
export async function sambertSynthesizeToFile(
  text: string,
  outputPath: string,
  options: SambertTTSOptions = {}
): Promise<string> {
  const buffer = await sambertSynthesizeBuffer(text, options);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}
