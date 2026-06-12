/**
 * 大模块 AI 服务
 * 根据用户上传的课后作业，自动识别语种、提炼知识点、拆分任务类型，
 * 生成符合学习规律的3-7天学习计划。
 * 模型：qwen3-max（通义千问3-Max，速度快、JSON 稳定）
 */
import OpenAI from 'openai';

const OPENAI_TIMEOUT = 180000; // 3 分钟

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  timeout: OPENAI_TIMEOUT,
});

// ============================================================
// 类型定义
// ============================================================

/** 重点单词（词汇造句类任务的核心） */
export interface KeyWord {
  word: string;
  translation: string;
  partOfSpeech: string;
  exampleSentence: string;
  exampleTranslation: string;
}

/** 单天任务 */
export interface AIDayTask {
  dayNumber: number;
  title: string;
  content: string;
  taskType: 'vocabulary' | 'grammar' | 'reading' | 'writing' | 'listening' | 'speaking';
  keyWords: KeyWord[];
  writingPrompt: string;
  referenceVocabulary: string[];
  suggestedWords: string[];
}

export type ContentType = 'vocabulary' | 'writing' | 'mixed';

export interface AIModulePlan {
  title: string;
  description: string;
  language: string;
  contentType: ContentType;
  contentTypeLabel: string;
  suggestedDays: number;
  learningGoals: string[];
  dailyTasks: AIDayTask[];
}

// ============================================================
// Prompt（精简版，去除冗余重复描述）
// ============================================================

const SYSTEM_PROMPT = `你是语言学习课程拆解专家。根据作业文本识别语种、判断类型（词汇/写作/综合），生成分天学习计划。
规则：
- 只输出纯 JSON，禁止 markdown、代码块、解释文字
- 根据内容量自动决定天数(3-7天)：少则3-4天，中则5天，多则6-7天
- 词汇类任务 keyWords 必填，写作类 writingPrompt+referenceVocabulary 必填，互斥
- 文本简洁精准，适合直接渲染`;

function buildUserPrompt(homeworkText: string): string {
  return `分析以下作业，返回 JSON：

<homework>
${homeworkText}
</homework>

JSON Schema（严格遵循，不增不减字段）：

{
  "title": "主题 ≤15字",
  "description": "1-2句概括",
  "language": "语种",
  "contentType": "vocabulary|writing|mixed",
  "contentTypeLabel": "词汇与造句|主题写作|综合练习",
  "suggestedDays": 5,
  "learningGoals": ["目标1","目标2","目标3"],
  "dailyTasks": [{
    "dayNumber": 1,
    "title": "≤12字",
    "content": "任务指令。词汇类写'请用以下单词造句：A, B, C'，写作类写主题+字数+时态要求",
    "taskType": "vocabulary|writing|grammar|reading|listening|speaking",
    "keyWords": [],
    "writingPrompt": "",
    "referenceVocabulary": [],
    "suggestedWords": []
  }]
}

字段规则（互斥）：
■ vocabulary/grammar 任务 → keyWords 必填(每天2-4个)，writingPrompt=""，referenceVocabulary=[]
  每个 keyWord: {"word":"单词","translation":"中文","partOfSpeech":"词性","exampleSentence":"地道的短例句(≤15词)","exampleTranslation":"例句翻译"}
■ writing 任务 → keyWords=[]，writingPrompt 必填，referenceVocabulary 必填(3-6个单词原文)
■ reading/listening/speaking → 全部空数组/空字符串
■ suggestedWords 填 keyWords 或 referenceVocabulary 中的单词原文

编排规律：Day1-2 核心词汇/语法→Day3-5 场景拓展→Day6-7 整合复盘。每天1-2个任务。mixed 类型前段词汇后段写作。

仅输出纯JSON。`;
}

// ============================================================
// 主函数
// ============================================================

export async function generateModulePlan(homeworkText: string): Promise<AIModulePlan> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('百炼 API Key 未配置');

  console.log(`[ModuleAI] 分析作业 (${homeworkText.length} 字符) → qwen3-max`);

  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: 'qwen3-max',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(homeworkText) },
    ],
    temperature: 0.2,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  console.log(`[ModuleAI] API 响应耗时: ${Date.now() - t0}ms`);

  const content = response.choices[0]?.message?.content || '{}';

  try {
    const parsed = JSON.parse(content);

    if (!parsed.title || !Array.isArray(parsed.dailyTasks)) {
      throw new Error('缺少 title 或 dailyTasks');
    }

    const plan: AIModulePlan = {
      title: parsed.title || '未命名课程',
      description: parsed.description || '',
      language: parsed.language || '未识别',
      contentType: ['vocabulary', 'writing', 'mixed'].includes(parsed.contentType)
        ? parsed.contentType : 'vocabulary',
      contentTypeLabel: parsed.contentTypeLabel || '词汇与造句',
      suggestedDays: parsed.suggestedDays || parsed.dailyTasks.length || 5,
      learningGoals: Array.isArray(parsed.learningGoals) ? parsed.learningGoals : [],
      dailyTasks: parsed.dailyTasks.map((t: any, i: number) => ({
        dayNumber: t.dayNumber || i + 1,
        title: t.title || `第${i + 1}天`,
        content: t.content || '',
        taskType: t.taskType || 'vocabulary',
        keyWords: Array.isArray(t.keyWords)
          ? t.keyWords.map((kw: any) => ({
              word: kw.word || '',
              translation: kw.translation || '',
              partOfSpeech: kw.partOfSpeech || '',
              exampleSentence: kw.exampleSentence || '',
              exampleTranslation: kw.exampleTranslation || '',
            }))
          : [],
        writingPrompt: t.writingPrompt || '',
        referenceVocabulary: Array.isArray(t.referenceVocabulary) ? t.referenceVocabulary : [],
        suggestedWords: Array.isArray(t.suggestedWords) ? t.suggestedWords : [],
      })),
    };

    if (plan.dailyTasks.length === 0) throw new Error('AI 未生成任何任务');

    console.log(`[ModuleAI] ✅ "${plan.title}" | ${plan.language} | ${plan.contentTypeLabel} | ${plan.dailyTasks.length}天 | 总耗时 ${Date.now() - t0}ms`);
    return plan;
  } catch (err: any) {
    throw new Error('AI 计划解析失败: ' + (err.message || content.slice(0, 200)));
  }
}
