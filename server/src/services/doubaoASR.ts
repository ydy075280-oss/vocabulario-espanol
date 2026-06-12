// ============================================================
// 🎙️ 豆包 Seed ASR 语音识别服务
// 火山引擎录音文件识别大模型 v3，异步提交 + 轮询
//
// 特点：
//   - 异步 REST API：POST 提交 → 轮询 → 获取结果
//   - 句子级时间戳（utterances）：start_time/end_time（毫秒）
//   - 无词级时间戳 — 需按字符比例估算词位置
// ============================================================

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// ============================================================
// 类型定义
// ============================================================

/** 单个发音句段 */
interface DoubaoUtterance {
  text: string;
  start_time: number; // 毫秒
  end_time: number;   // 毫秒
}

/** 查询成功时的完整响应 */
interface DoubaoQuerySuccess {
  audio_info: { duration: number }; // 毫秒
  result: { text: string; utterances: DoubaoUtterance[] };
}

/** 对外暴露的统一结果 */
export interface DoubaoASRResult {
  success: boolean;
  fullText: string;
  /** 所有词的时间戳（从 utterance 估算） */
  words: Array<{
    start: number; // 秒
    end: number;   // 秒
    word: string;
    probability: number;
  }>;
  normalizedWords: string[];
  utterances: DoubaoUtterance[];
  error?: string;
}

// ============================================================
// 配置
// ============================================================

const API_BASE = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel';
const SUBMIT_URL = `${API_BASE}/submit`;
const QUERY_URL = `${API_BASE}/query`;
const RESOURCE_ID = 'volc.seedasr.auc';

function getConfig() {
  const appKey = process.env.DOUBAO_STT_APP_KEY || '';
  const accessKey = process.env.DOUBAO_STT_ACCESS_KEY || '';

  if (!appKey || !accessKey) {
    throw new Error(
      '豆包 ASR 未配置。请在 server/.env 中设置 DOUBAO_STT_APP_KEY 和 DOUBAO_STT_ACCESS_KEY\n' +
      '获取地址: 火山引擎控制台 → 豆包语音 → API服务中心 → 服务接口认证信息'
    );
  }

  return { appKey, accessKey };
}

// ============================================================
// 主流程：识别音频文件
// ============================================================

export async function transcribeWithDoubao(audioPath: string): Promise<DoubaoASRResult> {
  console.log(`[DoubaoASR] 开始识别: ${path.basename(audioPath)}`);

  const { appKey, accessKey } = getConfig();

  // 第 1 步：读取音频 → Base64
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBase64 = audioBuffer.toString('base64');

  // 推断格式
  const ext = path.extname(audioPath).toLowerCase().replace('.', '');
  const formatMap: Record<string, string> = {
    mp3: 'mp3', wav: 'wav', ogg: 'ogg', m4a: 'm4a', flac: 'flac',
  };
  const audioFormat = formatMap[ext] || 'mp3';

  console.log(`[DoubaoASR] 音频大小: ${(audioBuffer.length / 1024).toFixed(1)}KB, 格式: ${audioFormat}`);

  // 第 2 步：提交识别任务
  const requestId = randomUUID();
  const submitPayload = {
    user: { uid: 'vocabulario' },
    audio: {
      data: audioBase64,
      format: audioFormat,
    },
  };

  console.log(`[DoubaoASR] 提交任务, requestId=${requestId}`);

  const submitResp = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: buildHeaders(appKey, accessKey, requestId),
    body: JSON.stringify(submitPayload),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text();
    console.error(`[DoubaoASR] 提交失败 HTTP ${submitResp.status}: ${errText}`);
    return { success: false, fullText: '', words: [], normalizedWords: [], utterances: [], error: `提交失败: HTTP ${submitResp.status}` };
  }

  // 第 3 步：轮询结果（最多 60 秒）
  console.log(`[DoubaoASR] 开始轮询...`);
  for (let attempt = 1; attempt <= 30; attempt++) {
    await sleep(2000); // 每 2 秒轮询一次

    const queryResp = await fetch(QUERY_URL, {
      method: 'POST',
      headers: buildHeaders(appKey, accessKey, requestId),
      body: '{}',
    });

    if (!queryResp.ok) {
      console.error(`[DoubaoASR] 查询 HTTP ${queryResp.status}`);
      continue;
    }

    const text = await queryResp.text();
    if (!text || text === '{}') {
      console.log(`[DoubaoASR] 轮询 ${attempt}/30: 处理中...`);
      continue;
    }

    // 有结果了！
    try {
      const result: DoubaoQuerySuccess = JSON.parse(text);
      console.log(`[DoubaoASR] 识别完成! 时长=${result.audio_info.duration}ms, ${result.result.utterances.length} 个句子`);
      return buildResult(result);
    } catch {
      console.error(`[DoubaoASR] 解析结果失败: ${text.slice(0, 200)}`);
      return { success: false, fullText: '', words: [], normalizedWords: [], utterances: [], error: '结果解析失败' };
    }
  }

  console.error(`[DoubaoASR] 超时, 30次轮询后仍无结果`);
  return { success: false, fullText: '', words: [], normalizedWords: [], utterances: [], error: '识别超时 (60秒)' };
}

// ============================================================
// 辅助函数
// ============================================================

function buildHeaders(appKey: string, accessKey: string, requestId: string): Record<string, string> {
  return {
    'X-Api-App-Key': appKey,
    'X-Api-Access-Key': accessKey,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'Content-Type': 'application/json',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 归一化单词 */
function normalizeWord(w: string): string {
  return w
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:¿¡"'«»()\[\]{}—–\-]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 将 API 返回结果转换为统一格式
 * 核心：把 utterance 级时间戳拆分成词级时间戳（按字符比例估算）
 */
function buildResult(apiResp: DoubaoQuerySuccess): DoubaoASRResult {
  const utterances = apiResp.result.utterances;
  const words: DoubaoASRResult['words'] = [];
  const normalizedWords: string[] = [];

  for (const utt of utterances) {
    const rawWords = utt.text.split(/\s+/).filter(w => w.length > 0);
    const totalChars = rawWords.reduce((sum, w) => sum + w.length, 0);
    const uttDuration = (utt.end_time - utt.start_time) / 1000; // 转秒

    if (rawWords.length === 0) continue;

    let charOffset = 0;
    for (const raw of rawWords) {
      const charLen = raw.length;
      // 按字符占比估算该词在 utterance 内的时间位置
      const ratioStart = totalChars > 0 ? charOffset / totalChars : 0;
      const ratioEnd = totalChars > 0 ? (charOffset + charLen) / totalChars : 0;

      words.push({
        start: utt.start_time / 1000 + ratioStart * uttDuration,
        end: utt.start_time / 1000 + ratioEnd * uttDuration,
        word: raw,
        probability: 0.9, // 豆包不返回逐词置信度，给一个默认值
      });

      normalizedWords.push(normalizeWord(raw));
      charOffset += charLen;
    }
  }

  return {
    success: true,
    fullText: apiResp.result.text,
    words,
    normalizedWords,
    utterances,
  };
}
