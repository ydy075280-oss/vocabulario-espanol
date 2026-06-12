import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import Ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { transcribeWithDoubao } from './doubaoASR';

// Set ffmpeg binary path
Ffmpeg.setFfmpegPath(ffmpegPath.path);

const uploadDir = path.join(__dirname, '..', '..', 'uploads');

/** ASR 后端选择 */
export type ASRBackend = 'whisper' | 'doubao';

/** 获取当前启用的 ASR 后端 */
export function getASRBackend(): ASRBackend {
  const backend = (process.env.ASR_BACKEND || 'whisper').toLowerCase();
  if (backend === 'doubao') return 'doubao';
  return 'whisper';
}

// ============================================================
// 🎵 从视频中提取完整音轨
// ============================================================
export function extractAudioFromVideo(videoPath: string, outputName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(uploadDir, outputName);

    console.log(`[Audio] 提取音轨: ${path.basename(videoPath)} → ${outputName}`);

    Ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => {
        const stat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
        console.log(`[Audio] 音轨提取完成: ${outputName} (${stat ? (stat.size / 1024).toFixed(1) + 'KB' : '未知'})`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('[Audio] 提取失败:', err.message);
        reject(new Error('音频提取失败: ' + err.message));
      })
      .run();
  });
}

/**
 * 获取音频时长（秒），失败返回 60
 */
function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    Ffmpeg.ffprobe(audioPath, (err, data) => {
      if (!err && data?.format?.duration) {
        resolve(data.format.duration);
      } else {
        const tmpOut = path.join(uploadDir, '_dur_null.mp3');
        let dur = 60;
        Ffmpeg(audioPath)
          .audioCodec('libmp3lame')
          .output(tmpOut)
          .on('stderr', (line: string) => {
            const m = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
            if (m) dur = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          })
          .on('end', () => { try { fs.unlinkSync(tmpOut); } catch {}; resolve(dur); })
          .on('error', () => resolve(dur))
          .run();
      }
    });
  });
}

// ============================================================
// ✂️ 从音频中裁切指定时间段的片段
// ============================================================
export function extractAudioClip(
  audioPath: string,
  start: number,
  end: number,
  outputName: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(uploadDir, outputName);
    const duration = Math.max(end - start, 0.1);

    Ffmpeg(audioPath)
      .setStartTime(start)
      .setDuration(duration)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => {
        console.log(`[Audio] 裁切完成: ${outputName} [${start.toFixed(1)}s - ${end.toFixed(1)}s]`);
        resolve(outputName);
      })
      .on('error', (err) => {
        console.error(`[Audio] 裁切失败 ${outputName}:`, err.message);
        reject(err);
      })
      .run();
  });
}

// ============================================================
// 📐 音频切分引擎：基于 Whisper 词级时间戳精确裁切
//
// 核心思路：
//   1. 用 faster-whisper 本地做语音识别 → 得到每个词的精确时间戳
//   2. 全局序列对齐 LLM 单词到 Whisper 词 → 容错性强
//   3. 搜索每个造句在 Whisper 词列表中的位置 → 精确的造句时间边界
// ============================================================
export interface WordSentenceAlignment {
  wordAudioUrls: string[];
  sentenceAudioUrls: string[];
}

interface WordInfo {
  word: string;
}

interface SentenceInfo {
  es: string;
}

/** ASR 返回的词级时间戳（统一接口，Whisper/Doubao 都输出此格式） */
interface ASRWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

interface ASRWordResult {
  success: boolean;
  full_text: string;
  full_text_normalized: string;
  words: ASRWord[];
  normalized_words: string[];
  word_count: number;
  error?: string;
}

export async function alignSpeechToWordsAndSentences(
  audioPath: string,
  words: WordInfo[],
  sentences: SentenceInfo[],
  rawTranscript: string,
  backend?: ASRBackend,
): Promise<WordSentenceAlignment> {
  const wordBaseName = path.basename(audioPath, path.extname(audioPath));
  const wordCount = words.length;
  const asrBackend = backend || getASRBackend();

  console.log(`\n[Align] ===== ${asrBackend.toUpperCase()} 音频切分 =====`);
  console.log(`[Align] ${wordCount} 个单词 + ${sentences.length} 条造句`);

  // ==========================================================
  // 第 1 步：调用 ASR 获取词级时间戳
  // ==========================================================
  let wr: ASRWordResult;
  try {
    if (asrBackend === 'doubao') {
      wr = await runDoubaoASR(audioPath);
    } else {
      wr = await runWhisperASR(audioPath);
    }
    if (!wr.success) throw new Error(wr.error || `${asrBackend} 失败`);
    console.log(`[Align] ${asrBackend}: ${wr.word_count} 个词`);
  } catch (err: any) {
    console.error(`[Align] ${asrBackend} 失败:`, err.message);
    return fallbackTimeSplit(audioPath, words, sentences);
  }

  const wsWords = wr.words;
  const wsNormWords = wr.normalized_words;
  const wsTextNorm = wr.full_text_normalized;

  // ==========================================================
  // 第 2 步：全局序列对齐 LLM 单词 → Whisper 词
  // 用比例锚点 + 窗口搜索，不再用笨拙的 searchFrom
  // ==========================================================
  const llmNormWords = words.map(w => normalizeWord(w.word));
  const alignedIndices = alignWordSequences(llmNormWords, wsNormWords, wsWords.length);

  const wordTimeSegments: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < wordCount; i++) {
    const wi = alignedIndices[i];

    if (wi >= 0 && wi < wsWords.length) {
      const seg = {
        start: Math.max(wsWords[wi].start - 0.05, 0),
        end: wsWords[wi].end + 0.1,
      };
      wordTimeSegments.push(seg);
      console.log(`[Align]   ✓ "${words[i].word}" ↔ ASR[${wi}] "${wsWords[wi].word}" [${seg.start.toFixed(2)}-${seg.end.toFixed(2)}]`);
    } else {
      console.log(`[Align]   ✗ "${words[i].word}" 未匹配 → 插值`);
      // 插值：在前后已知时间点之间均分
      wordTimeSegments.push({ start: -1, end: -1 }); // placeholder
    }
  }

  // 填补未匹配的单词时间（插值法）
  fillUnmatchedWordTimes(wordTimeSegments, alignedIndices, wsWords);

  // ==========================================================
  // 第 3 步：造句 → 在 ASR 词列表中搜索造句文本位置
  // ==========================================================
  const sentenceTimeSegments: Array<{ start: number; end: number }> = [];

  if (sentences.length > 0 && wsWords.length > 0) {
    for (let i = 0; i < sentences.length; i++) {
      const seg = findSentenceInASRWords(sentences[i].es, wsWords, wsNormWords, wsTextNorm);
      sentenceTimeSegments.push(seg);
      if (seg.start < seg.end) {
        console.log(`[Align]   造句${i} "${sentences[i].es.slice(0, 40)}..." [${seg.start.toFixed(2)}-${seg.end.toFixed(2)}]`);
      } else {
        console.log(`[Align]   造句${i} 未在 ASR 词中找到 → 降级`);
      }
    }
  }

  // ==========================================================
  // 第 4 步：裁切每个单词的音频
  // ==========================================================
  const wordAudioUrls: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const seg = wordTimeSegments[i];
    const clipName = `wd_${wordBaseName}_${i.toString().padStart(2, '0')}.mp3`;
    try {
      await extractAudioClip(audioPath, seg.start, seg.end, clipName);
      wordAudioUrls.push(`/uploads/${clipName}`);
    } catch {
      wordAudioUrls.push('');
    }
  }

  // ==========================================================
  // 第 5 步：裁切每条造句的音频
  // ==========================================================
  const sentenceAudioUrls: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i < sentenceTimeSegments.length) {
      const seg = sentenceTimeSegments[i];
      const clipName = `st_${wordBaseName}_${i.toString().padStart(2, '0')}.mp3`;
      try {
        await extractAudioClip(audioPath, seg.start, seg.end, clipName);
        sentenceAudioUrls.push(`/uploads/${clipName}`);
      } catch {
        sentenceAudioUrls.push('');
      }
    } else {
      sentenceAudioUrls.push('');
    }
  }

  console.log(`[Align] ===== 结果: ${wordAudioUrls.filter(u => u).length}/${wordCount} 单词 + ${sentenceAudioUrls.filter(u => u).length}/${sentences.length} 造句 =====\n`);
  return { wordAudioUrls, sentenceAudioUrls };
}

// ============================================================
// 辅助函数
// ============================================================

/** 调用 Python Whisper 脚本 */
function runWhisperASR(audioPath: string): Promise<ASRWordResult> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'whisper_asr.py');
    const child = spawn('python', [scriptPath, audioPath, '--model', 'small', '--language', 'es']);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code: number) => {
      if (stderr) console.log(`[Whisper] stderr: ${stderr.slice(0, 300)}`);
      try {
        const result = JSON.parse(stdout.trim());
        // Whisper Python 输出格式兼容
        resolve({
          success: result.success,
          full_text: result.full_text || '',
          full_text_normalized: result.full_text_normalized || '',
          words: result.words || [],
          normalized_words: result.normalized_words || [],
          word_count: result.word_count || 0,
          error: result.error,
        });
      } catch {
        reject(new Error(`Whisper 输出解析失败, stdout: ${stdout.slice(0, 200)}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`无法启动 Whisper: ${err.message}`));
    });
  });
}

/** 调用豆包 Seed ASR（返回统一格式） */
async function runDoubaoASR(audioPath: string): Promise<ASRWordResult> {
  const result = await transcribeWithDoubao(audioPath);
  return {
    success: result.success,
    full_text: result.fullText,
    full_text_normalized: result.normalizedWords.join(' '),
    words: result.words.map(w => ({
      start: w.start,
      end: w.end,
      word: w.word,
      probability: w.probability,
    })),
    normalized_words: result.normalizedWords,
    word_count: result.words.length,
    error: result.error,
  };
}

/** 归一化单词（去重音、标点、小写） */
function normalizeWord(w: string): string {
  return w
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:¿¡"'«»()\[\]{}—–\-]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 全局序列对齐：把 LLM 单词序列对齐到 Whisper 词序列
 * 
 * 策略：对每个 LLM 词，在 Whisper 词列表中按预期比例位置搜索窗口匹配
 * 预期位置 = llm_index * whisper_total / llm_total
 * 搜索窗口 = [-2, +3] 个词
 * 
 * 返回 matchedIndices: 每个 LLM 词对应的 Whisper 词索引(-1表示未匹配)
 */
function alignWordSequences(
  llmWords: string[],
  wsNormWords: string[],
  wsTotal: number,
): number[] {
  const llmTotal = llmWords.length;
  const result: number[] = [];

  for (let i = 0; i < llmTotal; i++) {
    const target = llmWords[i];
    // 按比例计算在 whisper 列表中的预期位置
    const expectedPos = Math.round(i * wsTotal / llmTotal);
    const searchStart = Math.max(0, expectedPos - 2);
    const searchEnd = Math.min(wsTotal, expectedPos + 3);

    let bestIdx = -1;
    let bestScore = 0;

    for (let j = searchStart; j < searchEnd; j++) {
      const ww = wsNormWords[j];
      if (!ww || ww.length === 0) continue;

      // 完全匹配
      if (ww === target) {
        bestIdx = j;
        bestScore = 2;
        break; // 精确匹配无需继续
      }

      // 包含匹配（分数比精确匹配低）
      if (ww.includes(target) || target.includes(ww)) {
        const score = 1.0 + (Math.min(target.length, ww.length) / Math.max(target.length, ww.length));
        if (score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }

      // 编辑距离匹配（更宽松）
      const dist = levenshteinDistance(target, ww);
      const maxLen = Math.max(target.length, ww.length);
      if (maxLen > 0) {
        const score = 1.0 - dist / maxLen;
        if (score > 0.6 && score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }
    }

    result.push(bestIdx);
  }

  return result;
}

/** 编辑距离 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** 填补未匹配单词的时间：在前有匹配的词之间插值 */
function fillUnmatchedWordTimes(
  timeSegs: Array<{ start: number; end: number }>,
  alignedIndices: number[],
  wsWords: ASRWord[],
): void {
  const n = timeSegs.length;

  // 找到所有未填的 (start=-1) 位置
  let lastValidEnd = 0;
  let lastValidIdx = -1;

  for (let i = 0; i < n; i++) {
    if (alignedIndices[i] >= 0 && timeSegs[i].start >= 0) {
      // 已匹配的单词保持不动
      lastValidEnd = timeSegs[i].end;
      lastValidIdx = i;
    }
  }

  // 重新处理：用前后已匹配词的时间插值
  for (let i = 0; i < n; i++) {
    if (timeSegs[i].start >= 0) continue; // 已填，跳过

    // 找前一个有效词
    let prevEnd = 0;
    let prevIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (timeSegs[j].start >= 0) {
        prevEnd = timeSegs[j].end;
        prevIdx = j;
        break;
      }
    }

    // 找后一个有效词
    let nextStart = wsWords.length > 0 ? wsWords[wsWords.length - 1].end : 10;
    let nextWIdx = wsWords.length;
    for (let j = i + 1; j < n; j++) {
      if (alignedIndices[j] >= 0 && timeSegs[j].start >= 0) {
        nextStart = timeSegs[j].start;
        nextWIdx = alignedIndices[j];
        break;
      }
    }

    // 在前后之间插值
    const unmatchedCount = (i - prevIdx);
    const totalGap = nextStart - prevEnd;
    const gapPerWord = totalGap / (nextWIdx - (prevIdx >= 0 ? alignedIndices[prevIdx] : 0) || 1);

    timeSegs[i] = {
      start: prevEnd + (unmatchedCount - 1) * gapPerWord * 0.5,
      end: prevEnd + unmatchedCount * gapPerWord * 0.5 + 0.05,
    };
  }
}

/**
 * 在 Whisper 词列表中搜索句子位置
 * 
 * 策略：
 * 1. 把 LLM 造句文本按词拆开并归一化
 * 2. 在 Whisper 归一化词列表中搜索这些词的连续出现
 * 3. 返回对应的时间范围
 * 4. 如果找不到，返回整个词区之后的时间范围
 */
function findSentenceInASRWords(
  sentenceEs: string,
  wsWords: ASRWord[],
  wsNormWords: string[],
  wsTextNorm: string,
): { start: number; end: number } {
  // 归一化句子并分词
  const sentNorm = normalizeWord(sentenceEs);
  const sentWords = sentNorm.split(/\s+/).filter(w => w.length > 0);

  if (sentWords.length === 0 || wsWords.length === 0) {
    return { start: 0, end: 1 };
  }

  // 在 whisper 归一化词列表中找到与句子词匹配的最佳起始位置
  let bestStart = -1;
  let bestEnd = -1;
  let bestMatched = 0;

  // 滑窗搜索：尝试每个可能的起始位置
  for (let start = 0; start <= wsNormWords.length - 1; start++) {
    let matched = 0;
    let si = 0;
    let wi = start;

    // 按顺序匹配句子中的每个词
    while (si < sentWords.length && wi < wsNormWords.length) {
      const sw = sentWords[si];
      const ww = wsNormWords[wi];

      // 尝试匹配（允许跳过少数不匹配的词）
      if (sw === ww || ww.includes(sw) || sw.includes(ww)) {
        matched++;
        si++;
      } else if (ww.length > 0 && sw.length > 0) {
        // 短词容错：编辑距离 <= 1
        const dist = levenshteinDistance(sw, ww);
        const maxLen = Math.max(sw.length, ww.length);
        if (dist <= 1 && maxLen <= 5) {
          matched++;
          si++;
        }
      }
      wi++;
    }

    if (matched > bestMatched) {
      bestMatched = matched;
      bestStart = start;
      // 找到匹配的结束位置（搜索最后一个匹配词后的位置）
      let end = start;
      si = 0;
      for (let k = start; k < wsNormWords.length && si < sentWords.length; k++) {
        const sw = sentWords[si];
        const ww = wsNormWords[k];
        if (sw === ww || ww.includes(sw) || sw.includes(ww)) {
          end = k + 1;
          si++;
        } else if (ww.length > 0 && sw.length > 0) {
          const dist = levenshteinDistance(sw, ww);
          if (dist <= 1 && Math.max(sw.length, ww.length) <= 5) {
            end = k + 1;
            si++;
          }
        }
      }
      bestEnd = end;
    }

    // 如果匹配率超过80%，就是它了
    if (bestMatched >= sentWords.length * 0.8) break;
  }

  if (bestStart >= 0 && bestEnd > bestStart) {
    const startTime = wsWords[bestStart].start;
    const endTime = wsWords[Math.min(bestEnd - 1, wsWords.length - 1)].end;
    return {
      start: Math.max(startTime - 0.15, 0),
      end: endTime + 0.15,
    };
  }

  // 降级：如果句子文本在 whisper 全文中能找到
  if (wsTextNorm.length > 0) {
    const pos = wsTextNorm.indexOf(sentNorm);
    if (pos >= 0) {
      // 统计 pos 之前的空格数 = 词索引
      const before = wsTextNorm.substring(0, pos).split(' ').filter(w => w).length;
      const matchLen = sentNorm.split(' ').filter(w => w).length;
      const afterIdx = Math.min(before + matchLen - 1, wsWords.length - 1);
      if (before < wsWords.length) {
        return {
          start: Math.max(wsWords[before].start - 0.15, 0),
          end: wsWords[afterIdx].end + 0.15,
        };
      }
    }
  }

  // 完全找不到 → 返回整个音频的后半段（词区之后）
  const midPoint = wsWords[wsWords.length - 1].end * 0.5;
  return { start: midPoint, end: wsWords[wsWords.length - 1].end };
}

/** 降级：时间均分 */
async function fallbackTimeSplit(
  audioPath: string,
  words: WordInfo[],
  sentences: SentenceInfo[],
): Promise<WordSentenceAlignment> {
  const audioDuration = await getAudioDuration(audioPath);
  const wordBaseName = path.basename(audioPath, path.extname(audioPath));
  const step = audioDuration / (words.length + sentences.length);

  const wordAudioUrls: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const clipName = `wd_${wordBaseName}_${i.toString().padStart(2, '0')}.mp3`;
    try {
      await extractAudioClip(audioPath, i * step, (i + 1) * step, clipName);
      wordAudioUrls.push(`/uploads/${clipName}`);
    } catch { wordAudioUrls.push(''); }
  }

  const sentenceAudioUrls: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const idx = words.length + i;
    const clipName = `st_${wordBaseName}_${i.toString().padStart(2, '0')}.mp3`;
    try {
      await extractAudioClip(audioPath, idx * step, (idx + 1) * step, clipName);
      sentenceAudioUrls.push(`/uploads/${clipName}`);
    } catch { sentenceAudioUrls.push(''); }
  }

  return { wordAudioUrls, sentenceAudioUrls };
}



