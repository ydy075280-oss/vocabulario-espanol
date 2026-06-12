import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

// ============================================================
// 统一配置
// ============================================================
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  baseURL: BASE_URL,
});

// ============================================================
// 公共类型
// ============================================================
export interface ExtractedWord {
  word: string;
  partOfSpeech: string;
  gender: string;
  definiteArticle: string;
  chineseMeaning: string;
  originalForm: string;
  example: string;
  exampleZh: string;
}

export interface ExtractedSentence {
  es: string;
  zh: string;
  derivedFrom?: string[]; // 造句用到了哪些单词
}

export interface ImageExtractionResult {
  words: ExtractedWord[];
  sentences: ExtractedSentence[];
}

// ============================================================
// 📷 模型1：图片 OCR 提取单词
// 模型：qwen3-vl-flash
// 方式：OpenAI 兼容 SDK
// 价格：输入 0.15 / 输出 1.5 元/百万Token（0-32K范围）
// ============================================================
export async function extractWordsFromImage(
  imageFilePath: string
): Promise<ImageExtractionResult> {
  // 检查 API Key
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey === 'sk-your-api-key-here') {
    throw new Error('百炼 API Key 未配置，请在 server/.env 中设置 DASHSCOPE_API_KEY');
  }

  // 检查文件
  if (!fs.existsSync(imageFilePath)) {
    throw new Error(`文件不存在: ${imageFilePath}`);
  }

  const imageBuffer = fs.readFileSync(imageFilePath);
  const ext = path.extname(imageFilePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';
  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  console.log(`[OCR] 开始提取图片: ${imageFilePath}, 大小: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

  const response = await openai.chat.completions.create({
    model: 'qwen3-vl-flash',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl },
          },
          {
            type: 'text',
            text: `你是一位西班牙语教师。这张图片内容有固定排版格式：
前三行/n前三个条目是独立的西班牙语词汇（单词），后面所有条目是使用这些词汇造的句子（造句/例句）。

请仔细识别图片中的所有文字内容，按以下 JSON 格式返回：

{
  "words": [
    {
      "word": "单词（保留重音符号，如 información）",
      "partOfSpeech": "词性（sustantivo/verbo/adjetivo/adverbio/preposición/conjunción/interjección）",
      "gender": "阴阳性（masculino/femenino/común，非名词用空字符串）",
      "definiteArticle": "定冠词（el/la/los/las，非名词用空字符串）",
      "chineseMeaning": "中文释义",
      "originalForm": "原形（动词用不定式，名词用单数）",
      "example": "一句包含该单词的自然西班牙语句子（可以从后面的造句中选取）",
      "exampleZh": "例句的中文翻译"
    }
  ],
  "sentences": [
    {
      "es": "完整的西班牙语句子",
      "zh": "该句的中文翻译"
    }
  ]
}

注意：
- words 数组只包含前 3 个独立单词
- sentences 数组包含后面所有的造句（可能有多行，每行是一个独立句子）
- 只返回纯 JSON，不要 markdown 代码块包裹，不要额外解释`,
          },
        ],
      },
    ],
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content || '{}';
  console.log(`[OCR] API 原始返回 (前300字符): ${content.slice(0, 300)}`);

  const jsonStr = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonStr);
    // 兼容两种返回格式：
    // 1. 新格式: { words: [...], sentences: [...] }
    // 2. 旧格式: 纯数组 [...]（向后兼容）
    let words: ExtractedWord[] = [];
    let sentences: ExtractedSentence[] = [];

    if (Array.isArray(parsed)) {
      // 旧格式：纯数组，全部当作单词，没有造句
      words = parsed as ExtractedWord[];
    } else {
      words = (parsed.words || []) as ExtractedWord[];
      sentences = (parsed.sentences || []) as ExtractedSentence[];
    }

    console.log(`[OCR] 成功提取 ${words.length} 个单词 + ${sentences.length} 条造句`);
    return { words, sentences };
  } catch {
    throw new Error('OCR 返回解析失败，API 返回内容: ' + content.slice(0, 300));
  }
}

// ============================================================
// 📝 模型2：文本作业拆解
// 模型：deepseek-v4-pro
// 方式：OpenAI 兼容 SDK
// 价格：输入 12 / 输出 24 元/百万Token（缓存命中输入仅 1 元）
// ============================================================
export async function analyzeRequirement(
  requirement: string
): Promise<ExtractedWord[]> {
  const response = await openai.chat.completions.create({
    model: 'deepseek-v4-pro',
    messages: [
      {
        role: 'system',
        content: `你是一位专业的西班牙语教师。你的任务是分析学生的作业要求，提取关键单词列表。
对每个单词必须提供完整信息：词性、阴阳性、定冠词、中文释义、原形、例句及翻译。
请以 JSON 格式返回，放在 "words" 字段下。`,
      },
      {
        role: 'user',
        content: `请分析以下西班牙语作业要求，提取所有需要掌握的关键单词：\n\n${requirement}\n\n
返回格式：
{
  "words": [
    {
      "word": "单词（保留重音）",
      "partOfSpeech": "词性",
      "gender": "阴阳性（非名词为空字符串）",
      "definiteArticle": "冠词（非名词为空字符串）",
      "chineseMeaning": "中文释义",
      "originalForm": "原形",
      "example": "西语例句",
      "exampleZh": "例句中文翻译"
    }
  ]
}`,
      },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(content);
    return (parsed.words || parsed.keywords || []) as ExtractedWord[];
  } catch {
    throw new Error('LLM 返回解析失败: ' + content.slice(0, 300));
  }
}

// ============================================================
// 🎙️ 模型3：视频音频 → 语音转文字 + 拆分为单词/造句
// 模型：qwen3-asr-flash
// 方式：OpenAI 兼容 SDK（支持 base64 直接上传音频）
// 价格：1.5 元/小时音频
// ============================================================
export interface ASRResult {
  words: ExtractedWord[];
  sentences: ExtractedSentence[];
  /** 完整转录原文 */
  rawTranscript: string;
}

export async function transcribeVideoAudio(
  audioFilePath: string
): Promise<ASRResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey === 'sk-your-api-key-here') {
    throw new Error('百炼 API Key 未配置，请在 server/.env 中设置 DASHSCOPE_API_KEY');
  }

  if (!fs.existsSync(audioFilePath)) {
    throw new Error(`音频文件不存在: ${audioFilePath}`);
  }

  const audioBuffer = fs.readFileSync(audioFilePath);
  const fileSizeMB = audioBuffer.length / (1024 * 1024);

  console.log(`[ASR] 开始转写音频: ${path.basename(audioFilePath)}, 大小: ${fileSizeMB.toFixed(1)}MB`);

  if (fileSizeMB > 10) {
    throw new Error(`音频文件过大 (${fileSizeMB.toFixed(1)}MB)，请使用不超过 10MB 的音频文件`);
  }

  const ext = path.extname(audioFilePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
  };
  const mimeType = mimeMap[ext] || 'audio/mpeg';
  const base64Audio = audioBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Audio}`;

  // Step 1: ASR 转写
  const asrResponse = await openai.chat.completions.create({
    model: 'qwen3-asr-flash',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio' as any,
            input_audio: { data: dataUrl },
          } as any,
        ],
      },
    ],
    extra_body: {
      asr_options: {
        language: 'es',
        enable_itn: false,
      },
    },
    stream: false,
  } as any);

  const rawTranscript = asrResponse.choices[0]?.message?.content || '';
  console.log(`[ASR] 转写结果 (前200字符): ${rawTranscript.slice(0, 200)}`);

  if (!rawTranscript.trim()) {
    throw new Error('ASR 未能识别到语音内容');
  }

  // Step 2: 用 LLM 将转写文本拆分为单词 + 造句（复用 OCR 的逻辑）
  const parseResponse = await openai.chat.completions.create({
    model: 'qwen-plus-latest',
    messages: [
      {
        role: 'system',
        content: `你是一位西班牙语教师。你的任务是将一段西班牙语语音转写出来的文本，拆分为"核心单词"和"造句"两部分。
规则：开头的前几个是独立的西班牙语词汇（单词），后面的内容是使用这些单词造的句子。
请提取前 3 个核心单词，并提供完整的语言分析信息。`,
      },
      {
        role: 'user',
        content: `以下是西班牙语教学视频的语音转写文本，请拆分为核心单词和造句：

${rawTranscript}

请按以下 JSON 格式返回：
{
  "words": [
    {
      "word": "单词（保留重音符号，如 información）",
      "partOfSpeech": "词性（sustantivo/verbo/adjetivo/adverbio/preposición/conjunción/interjección）",
      "gender": "阴阳性（masculino/femenino/común，非名词用空字符串）",
      "definiteArticle": "定冠词（el/la/los/las，非名词用空字符串）",
      "chineseMeaning": "中文释义",
      "originalForm": "原形（动词用不定式，名词用单数）",
      "example": "一句包含该单词的自然西班牙语句子",
      "exampleZh": "例句的中文翻译"
    }
  ],
  "sentences": [
    {
      "es": "完整的西班牙语句子",
      "zh": "该句的中文翻译"
    }
  ]
}

注意：
- words 数组只包含前 3 个核心学习单词
- sentences 数组包含所有造句内容（尽可能还原原文中每个完整的句子）
- 只返回纯 JSON，不要 markdown 代码块包裹，不要额外解释`,
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const parseContent = parseResponse.choices[0]?.message?.content || '{}';

  try {
    const parsed = JSON.parse(parseContent);
    const words = (parsed.words || []) as ExtractedWord[];
    const sentences = (parsed.sentences || []) as ExtractedSentence[];

    console.log(`[ASR] 拆分结果: ${words.length} 个单词 + ${sentences.length} 条造句`);
    return { words, sentences, rawTranscript };
  } catch {
    throw new Error('ASR 文本解析失败，LLM 返回: ' + parseContent.slice(0, 300));
  }
}

// ============================================================
// ✍️ 模型4：文本转语音（同步模式）
// 模型：qwen3-tts-flash
// 方式：DashScope 同步 HTTP API（Qwen-TTS 不支持异步轮询）
// 价格：0.8 元/万字符（输出不计费）
// 音色：Cherry 女声
// ============================================================
export interface TTSOptions {
  text: string;
  voice?: string;     // 默认 'Cherry'，DashScope 官方音色
  speed?: number;     // 0.5 ~ 2.0
}

export async function textToSpeech(
  options: TTSOptions,
  outputPath: string
): Promise<string> {
  const { text, voice = 'Cherry', speed = 1.0 } = options;

  // Qwen-TTS 同步 API：所有参数放在 input 内，不带 X-DashScope-Async
  const requestBody: Record<string, any> = {
    model: 'qwen3-tts-flash',
    input: {
      text,
      voice,
      language_type: 'Spanish',  // 西班牙语发音
    },
  };
  if (speed !== 1.0) {
    requestBody.input.speech_rate = speed;
  }

  console.log(`[TTS] 同步请求, model=qwen3-tts-flash, voice=${voice}, text="${text.slice(0, 40)}..."`);

  // 一次同步 POST，响应中直接包含 output.audio.url
  const res = await fetch(
    `${DASHSCOPE_API_BASE}/services/aigc/multimodal-generation/generation`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  const data = (await res.json()) as any;
  console.log(`[TTS] HTTP ${res.status}, code=${data.code}`);

  if (!res.ok || data.code) {
    const errDetail = JSON.stringify(data).slice(0, 500);
    console.error(`[TTS] ❌ API 失败: ${errDetail}`);
    throw new Error('TTS API 返回错误: ' + (data.message || data.code || errDetail));
  }

  // 提取音频 URL
  const audioUrl: string =
    data.output?.audio?.url || '';
  if (!audioUrl) {
    console.error(`[TTS] ❌ 响应中无 audio.url: ${JSON.stringify(data).slice(0, 500)}`);
    throw new Error('TTS 响应缺少音频 URL');
  }

  console.log(`[TTS] ✅ 获取到 audioUrl: ${audioUrl.slice(0, 80)}...`);

  // 下载音频文件
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`下载音频失败: HTTP ${audioRes.status}`);
  }
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  console.log(`[TTS] ✅ 文件已保存: ${outputPath} (${(buffer.length / 1024).toFixed(1)}KB)`);

  return outputPath;
}
