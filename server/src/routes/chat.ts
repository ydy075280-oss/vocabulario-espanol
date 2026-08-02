import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { generateGreeting, streamChatResponse, transcribeAudioFile } from '../services/chatAI';

const router = Router();

// 上传目录
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/mp4'];
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

    // Step 1: ASR 语音识别
    send('status', { message: '正在识别语音...' });
    const transcript = await transcribeAudioFile(audioFilePath);
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
