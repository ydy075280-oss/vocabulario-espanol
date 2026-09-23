import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { generateGreeting, streamChatResponse, transcribeAudioFile, translateToChinese } from '../services/chatAI';
import { convertToAsrMp3 } from '../services/audioService';
import { logLine } from '../utils/fileLogger';

const router = Router();

// 上传目录
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 保留原始扩展名落盘（iOS=mp4/m4a、安卓=webm 等），
// 这样 ffmpeg 转码失败降级用原文件时，服务端才能正确推断 mime，避免 ASR 按错误格式解码
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    cb(null, `${randomUUID()}${ext || '.webm'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
      'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/mp4',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ============================================================
// POST /api/chat/greet — 获取开场白 + 语音
// ============================================================
router.post('/greet', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { scenario, scenarioLabel, difficulty, wordbookWords } = req.body;
    let words: Array<{ word: string; translation: string }> = [];
    try { words = wordbookWords ? JSON.parse(wordbookWords) : []; } catch {}

    const result = await generateGreeting({
      scenario: scenario || 'free',
      scenarioLabel: scenarioLabel || '自由对话',
      difficulty: difficulty || 'beginner',
      wordbookWords: words,
    });

    res.json(result);
  } catch (err: any) {
    console.error('[Chat Greet] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/chat/translate — 将 AI 的西语对话翻译成简体中文
// ============================================================
router.post('/translate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || !String(text).trim()) {
      res.status(400).json({ error: '缺少待翻译文本' });
      return;
    }
    const translation = await translateToChinese(String(text));
    res.json({ translation });
  } catch (err: any) {
    console.error('[Chat Translate] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/chat/speak — 上传用户录音 → SSE 流式返回 AI 回复
// SSE 事件: transcript | status | ai_text_delta | ai_audio | done | error
// ============================================================
router.post('/speak', authMiddleware, upload.single('audio'), async (req: AuthRequest, res: Response) => {
  let audioFilePath = '';
  try {
    if (!req.file) {
      res.status(400).json({ error: '未收到音频文件' });
      return;
    }

    const { scenario, scenarioLabel, difficulty, wordbookWords, chatHistory } = req.body;
    let words: Array<{ word: string; translation: string }> = [];
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    try { words = wordbookWords ? JSON.parse(wordbookWords) : []; } catch {}
    try { history = chatHistory ? JSON.parse(chatHistory) : []; } catch {}

    // SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    audioFilePath = req.file.path;
    logLine(
      'Chat',
      `收到录音: name=${req.file.originalname}, mime=${req.file.mimetype}, size=${(req.file.size / 1024).toFixed(1)}KB`
    );

    // Step 0: 统一转码为 16kHz 单声道 mp3
    // 手机浏览器录音容器五花八门（iOS=m4a/aac、安卓=webm/opus、部分=ogg），
    // 且 multer 落盘无扩展名会导致 ASR 格式识别错误 → 识别不出语音。
    // 先转成标准 mp3 再交给 ASR，兼容所有来源。
    try {
      const convertedPath = path.join(uploadDir, `asr_${randomUUID()}.mp3`);
      await convertToAsrMp3(audioFilePath, convertedPath);
      const convertedKB = (fs.statSync(convertedPath).size / 1024).toFixed(1);
      try { fs.unlinkSync(audioFilePath); } catch { /* ignore */ }
      audioFilePath = convertedPath;
      logLine('Chat', `转码成功 → 16kHz 单声道 mp3, ${convertedKB}KB（128kbps 下约 ${(Number(convertedKB) / 16).toFixed(1)}s，静音会远小于此值）`);
    } catch (convErr: any) {
      logLine('Chat', `⚠️ 转码失败，将尝试直接识别原文件: ${convErr?.message || convErr}`);
    }

    // Step 1: ASR 语音识别
    send('status', { message: '正在识别语音...' });
    const transcript = await transcribeAudioFile(audioFilePath);
    logLine('ChatASR', transcript.trim() ? `识别结果: "${transcript.slice(0, 80)}"` : '⚠️ 识别结果为空（音频可能是静音/格式未被正确解码）');
    send('transcript', { text: transcript });

    // 清理临时音频文件
    try { fs.unlinkSync(audioFilePath); audioFilePath = ''; } catch {}

    // Step 2: LLM 流式回复
    send('status', { message: 'AI 正在回复...' });

    const result = await streamChatResponse({
      userMessage: transcript,
      scenario: scenario || 'free',
      scenarioLabel: scenarioLabel || '自由对话',
      difficulty: difficulty || 'beginner',
      wordbookWords: words,
      chatHistory: history,
      onTextDelta: (delta: string) => send('ai_text_delta', { delta }),
    });

    // Step 3: TTS 语音 + 完成
    send('ai_audio', { audioUrl: result.audioUrl });
    send('done', {
      fullResponse: result.fullResponse,
      corrections: result.corrections,
    });

    res.end();
  } catch (err: any) {
    console.error('[Chat Speak] 错误:', err.message);

    // 清理残留音频文件
    if (audioFilePath) {
      try { fs.unlinkSync(audioFilePath); } catch {}
    }

    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

export default router;
