import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// AI 对话服务 — 语音实时对话 MVP
// 包含：ASR 语音识别、LLM 流式对话、TTS 语音合成
// ============================================================
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  baseURL: BASE_URL,
});

// =========== 类型定义 ===========
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatWord {
  word: string;
  translation: string;
}

export interface StreamChatParams {
  userMessage: string;
  scenario: string;
  scenarioLabel: string;
  difficulty: string;
  wordbookWords?: ChatWord[];
  chatHistory?: ChatMessage[];
  onTextDelta: (delta: string) => void;
}

export interface StreamChatResult {
  fullResponse: string;
  corrections: Array<{ original: string; corrected: string; explanation: string }>;
  audioUrl: string;
}

export interface GreetingResult {
  text: string;
  audioUrl: string;
}

// =========== ASR 语音转文字 ===========
export async function transcribeAudioFile(audioFilePath: string): Promise<string> {
  const audioBuffer = fs.readFileSync(audioFilePath);
  if (audioBuffer.length < 100) {
    throw new Error('音频文件为空，请重试并确保麦克风正常工作');
  }
  if (audioBuffer.length > 10 * 1024 * 1024) {
    throw new Error('音频文件过大，请控制在 10MB 以内');
  }

  const ext = path.extname(audioFilePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp4': 'audio/mp4',
  };
  const mimeType = mimeMap[ext] || 'audio/webm';
  const base64Audio = audioBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Audio}`;

  console.log(`[ChatASR] 转写中, 大小=${(audioBuffer.length / 1024).toFixed(1)}KB`);

  const response = await openai.chat.completions.create({
    model: 'qwen3-asr-flash',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_audio' as any, input_audio: { data: dataUrl } } as any,
      ],
    }],
    extra_body: { asr_options: { language: 'es', enable_itn: false } },
    stream: false,
  } as any);

  const transcript = response.choices[0]?.message?.content || '';
  console.log(`[ChatASR] 结果: "${transcript.slice(0, 80)}"`);

  if (!transcript.trim()) throw new Error('未识别到语音内容，请重试');
  return transcript.trim();
}

// =========== TTS 文本转语音 ===========
async function generateSpeech(text: string): Promise<string> {
  const filename = `chat-${uuidv4()}.mp3`;
  const outputDir = path.join(__dirname, '..', '..', 'uploads', 'chat');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);

  console.log(`[ChatTTS] 合成中: "${text.slice(0, 50)}..."`);

  const res = await fetch(
    `${DASHSCOPE_API_BASE}/services/aigc/multimodal-generation/generation`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3-tts-instruct-flash',
        input: { text, voice: 'Cherry', language_type: 'Spanish' },
      }),
    }
  );

  const data = (await res.json()) as any;
  if (!res.ok || data.code) {
    throw new Error('TTS 失败: ' + (data.message || data.code || res.status));
  }

  const audioUrl: string = data.output?.audio?.url || '';
  if (!audioUrl) throw new Error('TTS 响应缺少音频 URL');

  const audioRes = await fetch(audioUrl);
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`[ChatTTS] 已保存: ${(buffer.length / 1024).toFixed(1)}KB`);
  return `/uploads/chat/${filename}`;
}

// =========== 构建 System Prompt ===========
function buildSystemPrompt(params: {
  scenario: string;
  scenarioLabel: string;
  difficulty: string;
  wordbookWords?: ChatWord[];
}): string {
  const { scenario, scenarioLabel, difficulty, wordbookWords } = params;

  const dg: Record<string, string> = {
    beginner: '使用 A1-A2 词汇和现在时。每句不超过 10 词，语速放慢。',
    intermediate: '使用 B1 词汇，可包含简单过去时和将来时。每句 10-15 词。',
    advanced: '使用 B2+ 词汇，可包含虚拟式、条件式等复杂语法。自然表达。',
  };
  const diffGuide = dg[difficulty] || dg.beginner;

  const vocabHint = wordbookWords?.length
    ? `\n用户正在学习以下词汇，请在对话中尽可能自然地使用它们：\n${wordbookWords.map(w => `- ${w.word}（${w.translation}）`).join('\n')}`
    : '';

  return `你是西班牙语对话练习伙伴。
${scenario !== 'free' ? `当前场景：${scenarioLabel}。请扮演该场景中的角色。` : '请进行自然的西班牙语日常对话。'}
难度等级：${difficulty}。${diffGuide}
${vocabHint}

对话规则：
1. 始终用西班牙语回复
2. 回复控制在 1-3 句话，自然口语化
3. 主动引导对话继续（提问、追问）
4. 如果用户完全用中文提问（说明不懂西语），先用西语回复，再附简短中文翻译

在回复末尾，必须附加一段语法纠错分析（用 <!--ANALYSIS--> 和 <!--END_ANALYSIS--> 包裹）：
<!--ANALYSIS-->
[{"original":"用户错误片段","corrected":"正确写法","explanation":"中文错误说明"}]
<!--END_ANALYSIS-->
如果用户的话没有语法错误，返回空数组 []。`;
}

// =========== 生成开场白 ===========
export async function generateGreeting(params: {
  scenario: string;
  scenarioLabel: string;
  difficulty: string;
  wordbookWords?: ChatWord[];
}): Promise<GreetingResult> {
  const systemPrompt = buildSystemPrompt(params);
  const { scenarioLabel } = params;

  const response = await openai.chat.completions.create({
    model: 'qwen-plus-latest',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请开始对话。场景：${scenarioLabel}。用一句自然的西班牙语打招呼并引导对话开始。只回复一句话，不需要纠错标记。`,
      },
    ],
    temperature: 0.8,
    max_tokens: 150,
  });

  let text = response.choices[0]?.message?.content?.trim() || '¡Hola! ¿Cómo estás?';
  // 去除可能的 ANALYSIS 标记
  text = text.replace(/<!--ANALYSIS-->[\s\S]*?<!--END_ANALYSIS-->/g, '').trim();

  const audioUrl = await generateSpeech(text);
  return { text, audioUrl };
}

// =========== 流式 AI 对话回复 ===========
export async function streamChatResponse(params: StreamChatParams): Promise<StreamChatResult> {
  const { userMessage, scenario, scenarioLabel, difficulty, wordbookWords, chatHistory, onTextDelta } = params;
  const systemPrompt = buildSystemPrompt({ scenario, scenarioLabel, difficulty, wordbookWords });

  // 构建消息历史
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ];
  for (const msg of chatHistory || []) {
    if (msg.content.trim()) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: userMessage });

  console.log(`[ChatAI] 流式对话, 场景="${scenarioLabel}", 历史=${messages.length - 2}条`);

  const stream = await openai.chat.completions.create({
    model: 'qwen-plus-latest',
    messages: messages as any,
    temperature: 0.7,
    stream: true,
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullResponse += delta;
      onTextDelta(delta);
    }
  }

  console.log(`[ChatAI] 回复完成, ${fullResponse.length}字符`);

  // 解析纠错数据
  let corrections: Array<{ original: string; corrected: string; explanation: string }> = [];
  const analysisMatch = fullResponse.match(/<!--ANALYSIS-->([\s\S]*?)<!--END_ANALYSIS-->/);
  let cleanResponse = fullResponse;

  if (analysisMatch) {
    try {
      corrections = JSON.parse(analysisMatch[1].trim());
    } catch (err) {
      console.log('[ChatAI] 纠错JSON解析失败, 忽略');
    }
    cleanResponse = fullResponse.replace(/<!--ANALYSIS-->[\s\S]*?<!--END_ANALYSIS-->/g, '').trim();
  }

  // TTS 生成语音
  const audioUrl = await generateSpeech(cleanResponse);

  return { fullResponse: cleanResponse, corrections, audioUrl };
}
