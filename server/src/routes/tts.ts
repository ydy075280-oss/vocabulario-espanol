import { Router, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { textToSpeech } from '../services/qwenClient';

const router = Router();

/** 根据 text+voice+speed 生成唯一 MD5 文件名，支持去重缓存 */
function fileNameFromText(text: string, voice: string, speed: number): string {
  const hash = crypto.createHash('md5').update(`${text}|${voice}|${speed}`).digest('hex');
  return `tts_${hash}.mp3`;
}

/** 确保输出目录存在 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// POST /api/tts/generate — 根据用户造句生成西班牙语读音
// 后端去重：基于 text+voice+speed 的 MD5 文件名，已存在则直接返回不再调用大模型
router.post('/generate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { text, voice, speed } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ error: '请输入要生成语音的文本' });
      return;
    }

    const v = voice || 'Cherry';
    const sp = speed || 1.0;
    const outputDir = path.join(__dirname, '..', '..', 'uploads', 'tts');
    const fileName = fileNameFromText(text.trim(), v, sp);
    const outputPath = path.join(outputDir, fileName);

    // 文件已存在则直接返回，跳过 TTS 调用
    if (!fs.existsSync(outputPath)) {
      ensureDir(outputDir);
      await textToSpeech(
        {
          text: text.trim(),
          voice: v,
          speed: sp,
        },
        outputPath
      );
    }

    res.json({
      audioUrl: `/uploads/tts/${fileName}`,
      text,
      message: '语音生成成功',
    });
  } catch (err: any) {
    res.status(500).json({ error: '语音生成失败: ' + err.message });
  }
});

// POST /api/tts/generate-batch — 批量生成（用于创作模块的例句朗读）
router.post('/generate-batch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sentences, voice, speed } = req.body;

    if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
      res.status(400).json({ error: '请提供要生成语音的句子列表' });
      return;
    }

    const v = voice || 'Cherry';
    const sp = speed || 0.9;
    const outputDir = path.join(__dirname, '..', '..', 'uploads', 'tts');
    ensureDir(outputDir);

    const results: { index: number; text: string; audioUrl: string }[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const sentenceText = sentences[i].trim();
      const fileName = fileNameFromText(sentenceText, v, sp);
      const outputPath = path.join(outputDir, fileName);

      // 文件已存在则跳过 TTS 调用
      if (!fs.existsSync(outputPath)) {
        await textToSpeech(
          {
            text: sentenceText,
            voice: v,
            speed: sp,
          },
          outputPath
        );
      }

      results.push({
        index: i,
        text: sentenceText,
        audioUrl: `/uploads/tts/${fileName}`,
      });
    }

    res.json({ results, message: `成功生成 ${results.length} 段语音` });
  } catch (err: any) {
    res.status(500).json({ error: '批量语音生成失败: ' + err.message });
  }
});

export default router;
