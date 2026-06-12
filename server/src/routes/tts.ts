import { Router, Response } from 'express';
import path from 'path';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { textToSpeech } from '../services/qwenClient';

const router = Router();

// POST /api/tts/generate — 根据用户造句生成西班牙语读音
router.post('/generate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { text, voice, speed } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ error: '请输入要生成语音的文本' });
      return;
    }

    const outputDir = path.join(__dirname, '..', '..', 'uploads', 'tts');
    const fileName = `tts_${Date.now()}.mp3`;
    const outputPath = path.join(outputDir, fileName);

    await textToSpeech(
      {
        text: text.trim(),
        voice: voice || 'Cherry',
        speed: speed || 1.0,
      },
      outputPath
    );

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

    const outputDir = path.join(__dirname, '..', '..', 'uploads', 'tts');
    const results: { index: number; text: string; audioUrl: string }[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const fileName = `tts_${Date.now()}_${i}.mp3`;
      const outputPath = path.join(outputDir, fileName);

      await textToSpeech(
        {
          text: sentences[i].trim(),
          voice: voice || 'Cherry',
          speed: speed || 0.9,
        },
        outputPath
      );

      results.push({
        index: i,
        text: sentences[i].trim(),
        audioUrl: `/uploads/tts/${fileName}`,
      });
    }

    res.json({ results, message: `成功生成 ${results.length} 段语音` });
  } catch (err: any) {
    res.status(500).json({ error: '批量语音生成失败: ' + err.message });
  }
});

export default router;
