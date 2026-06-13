import { Router, Response, Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db';
import { extractWordsFromImage, extractWordsFromPDF, extractWordsFromDocx, transcribeVideoAudio, ExtractedWord, ExtractedSentence } from '../services/qwenClient';
import { extractAudioFromVideo } from '../services/audioService';

const router = Router();

// Set up multer for file uploads
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const videoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
  const documentTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

  if (imageTypes.includes(file.mimetype) || videoTypes.includes(file.mimetype) || documentTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件格式'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
  },
});

// POST /api/upload - Upload files
router.post(
  '/',
  authMiddleware,
  upload.array('files', 20),
  (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: '请选择文件' });
        return;
      }

      const { wordbookName, teacherTag, courseTag } = req.body;

      const uploadedFiles = files.map((file) => {
        let fileType: 'video' | 'image' | 'pdf' | 'docx';
        if (file.mimetype.startsWith('video/')) fileType = 'video';
        else if (file.mimetype === 'application/pdf') fileType = 'pdf';
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') fileType = 'docx';
        else fileType = 'image';
        return {
          id: uuidv4(),
          originalName: file.originalname,
          filename: file.filename,
          path: `/uploads/${file.filename}`,
          size: file.size,
          type: fileType,
          mimetype: file.mimetype,
        };
      });

      // Auto-create wordbook if name provided
      let wordbookId: string | null = null;
      if (wordbookName) {
        const sourceType = files.some(f => f.mimetype.startsWith('video/'))
          ? 'video'
          : files.some(f => f.mimetype === 'application/pdf')
            ? 'pdf'
            : files.some(f => f.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
              ? 'docx'
              : 'image';
        wordbookId = uuidv4();
        db.prepare(`
          INSERT INTO wordbooks (id, user_id, name, source_type, source_name, teacher_tag, course_tag)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          wordbookId,
          req.userId!,
          wordbookName,
          sourceType,
          files.map(f => f.originalname).join(', '),
          teacherTag || '',
          courseTag || ''
        );

        // Update card_count later
      }

      res.json({
        message: `成功上传 ${files.length} 个文件`,
        files: uploadedFiles,
        wordbookId,
      });
    } catch (err: any) {
      res.status(500).json({ error: '上传失败: ' + err.message });
    }
  }
);

// POST /api/upload/extract - Extract words from uploaded file
router.post('/extract', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filePath, fileType, wordbookId } = req.body;

    // Choose extraction method based on file type
    let words: ExtractedWord[] = [];
    let extractionSource: 'ocr' | 'mock' = 'mock';
    let extractionNote = '';

    // 造句列表（图片有固定格式时才有）
    let sentences: ExtractedSentence[] = [];

    if (fileType === 'image') {
      // 📷 图片 → qwen3-vl-flash OCR 提取
      try {
        const absolutePath = path.join(uploadDir, path.basename(filePath));
        const result = await extractWordsFromImage(absolutePath);
        words = result.words;
        sentences = result.sentences;
        extractionSource = 'ocr';
      } catch (ocrErr: any) {
        console.error('[OCR] 图片提取失败:', ocrErr.message);
        // OCR 失败时返回明确错误，不静默降级为 mock
        res.status(500).json({
          error: '图片 OCR 提取失败',
          detail: ocrErr.message,
        });
        return;
      }
    } else if (fileType === 'video') {
      // 🎬 视频 → 提取音轨 + qwen3-asr-flash 语音转文字（不再保留原声音频，统一用 TTS）
      try {
        const videoAbsPath = path.join(uploadDir, path.basename(filePath));
        const audioBaseName = `audio_${uuidv4()}.mp3`;
        const audioPath = await extractAudioFromVideo(videoAbsPath, audioBaseName);

        const asrResult = await transcribeVideoAudio(audioPath);
        words = asrResult.words;
        sentences = asrResult.sentences;
        extractionSource = 'ocr';

        // 清理提取的完整音轨（不再需要裁切）
        try { fs.unlinkSync(audioPath); } catch {}

        // 不再进行音频裁切，单词和造句均使用设备 TTS / API TTS 朗读
        (req as any)._wordAudioUrls = words.map(() => '');
        (req as any)._sentenceAudioUrls = sentences.map(() => '');
      } catch (asrErr: any) {
        console.error('[ASR] 视频语音识别失败:', asrErr.message);
        res.status(500).json({
          error: '视频语音识别失败',
          detail: asrErr.message,
        });
        return;
      }
    } else if (fileType === 'pdf') {
      // 📄 PDF → pdf-parse 提取文本 → LLM 拆分单词+造句
      try {
        const absolutePath = path.join(uploadDir, path.basename(filePath));
        const result = await extractWordsFromPDF(absolutePath);
        words = result.words;
        sentences = result.sentences;
        extractionSource = 'ocr';
      } catch (pdfErr: any) {
        console.error('[PDF] 提取失败:', pdfErr.message);
        res.status(500).json({
          error: 'PDF 提取失败',
          detail: pdfErr.message,
        });
        return;
      }
    } else if (fileType === 'docx') {
      // 📝 Word → mammoth 提取文本 → LLM 拆分单词+造句
      try {
        const absolutePath = path.join(uploadDir, path.basename(filePath));
        const result = await extractWordsFromDocx(absolutePath);
        words = result.words;
        sentences = result.sentences;
        extractionSource = 'ocr';
      } catch (docxErr: any) {
        console.error('[Docx] 提取失败:', docxErr.message);
        res.status(500).json({
          error: 'Word 文档提取失败',
          detail: docxErr.message,
        });
        return;
      }
    } else {
      words = generateMockWords(fileType, filePath);
      extractionSource = 'mock';
      extractionNote = '未知文件类型，使用示例单词';
    }

    // ─── 去重合并：检查是否已有相似标签的单词本 ───
    let finalWordbookId = wordbookId;
    let mergedIntoExisting = false;
    let mergedWordbookName = '';

    if (wordbookId) {
      const currentWB = db.prepare(
        'SELECT teacher_tag, course_tag, name FROM wordbooks WHERE id = ? AND user_id = ?'
      ).get(wordbookId, req.userId!) as { teacher_tag: string; course_tag: string; name: string } | undefined;

      if (!currentWB) {
        // 原始单词本不存在（可能被删除），清除无效 ID
        console.warn(`[Extract] 单词本 ${wordbookId} 不存在，将忽略合并逻辑`);
        finalWordbookId = null;
      } else {
        const normalizedTeacher = (currentWB.teacher_tag || '').trim().toLowerCase();
        const normalizedCourse = (currentWB.course_tag || '').trim().toLowerCase();

        // 按教师标签或课程标签匹配已有单词本（排除自身）
        let existingWB: { id: string; name: string } | undefined;
        if (normalizedTeacher) {
          existingWB = db.prepare(`
            SELECT id, name FROM wordbooks
            WHERE user_id = ? AND id != ? AND LOWER(TRIM(teacher_tag)) = ?
            LIMIT 1
          `).get(req.userId!, wordbookId, normalizedTeacher) as { id: string; name: string } | undefined;
        }
        if (!existingWB && normalizedCourse) {
          existingWB = db.prepare(`
            SELECT id, name FROM wordbooks
            WHERE user_id = ? AND id != ? AND LOWER(TRIM(course_tag)) = ?
            LIMIT 1
          `).get(req.userId!, wordbookId, normalizedCourse) as { id: string; name: string } | undefined;
        }

        if (existingWB) {
          console.log(`[Extract] 检测到相同标签单词本: "${existingWB.name}", 合并单词`);
          finalWordbookId = existingWB.id;
          mergedIntoExisting = true;
          mergedWordbookName = existingWB.name;
        }
      }
    }

    // 如果没有有效的单词本 ID，返回错误（无法插入外键引用）
    if (!finalWordbookId) {
      res.status(400).json({
        error: '单词本不存在，请重新上传文件',
        detail: '关联的单词本已被删除或不存在',
      });
      return;
    }

    // 允许提取 0 个单词（图片中确实没有西语内容）
    const cardIds: string[] = [];

    const insertCard = db.prepare(`
      INSERT INTO word_cards (
        id, wordbook_id, user_id, word, word_normalized, part_of_speech,
        gender, definite_article, chinese_meaning, original_form,
        accent_type, status, audio_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSentence = db.prepare(`
      INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh, audio_url)
      VALUES (?, ?, ?, ?, ?)
    `);

    // 音频 URL（视频上传不再保留原声，统一用 TTS，故均为空字符串）
    const wordAudioUrls: string[] = (req as any)._wordAudioUrls || [];
    const sentenceAudioUrls: string[] = (req as any)._sentenceAudioUrls || [];

    // 用事务包裹所有数据库写入，保证原子性
    const result = db.transaction(() => {
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const cardId = uuidv4();
        const normalized = word.word
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

        insertCard.run(
          cardId,
          finalWordbookId,
          req.userId!,
          word.word,
          normalized,
          word.partOfSpeech,
          word.gender || '',
          word.definiteArticle || '',
          word.chineseMeaning,
          word.originalForm || word.word,
          'es-ES',
          'new',
          wordAudioUrls[i] || ''
        );

        if (word.example) {
          insertSentence.run(uuidv4(), cardId, word.example, word.exampleZh || '', '');
        }

        cardIds.push(cardId);
      }

    // 存储造句 — 每条造句独立存储（音频统一用 TTS，不保留原声）
    const savedSentences: Array<{ es: string; zh: string; cardId: string; audioUrl?: string }> = [];
    if (sentences.length > 0 && cardIds.length > 0) {
      for (let si = 0; si < sentences.length; si++) {
        const s = sentences[si];
        const sentAudio = sentenceAudioUrls[si] || '';
        // 每条造句为所有卡片各创建一条记录（例句可重复匹配）
        for (const cardId of cardIds) {
          insertSentence.run(uuidv4(), cardId, s.es, s.zh, sentAudio);
        }
        savedSentences.push({ es: s.es, zh: s.zh, cardId: cardIds[0], audioUrl: sentAudio });
      }
    }

    // Update final wordbook card_count
    if (finalWordbookId) {
      db.prepare(
        'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = ?) WHERE id = ?'
      ).run(finalWordbookId, finalWordbookId);
    }

    // 合并后清理临时单词本
    if (mergedIntoExisting && wordbookId && wordbookId !== finalWordbookId) {
      db.prepare('DELETE FROM wordbooks WHERE id = ?').run(wordbookId);
      console.log(`[Extract] 已删除临时单词本: ${wordbookId}`);
    }

    return { savedSentences };
    })();
    // 事务返回值：savedSentences 从作用域内取出
    const { savedSentences } = txResult;

    const isVideo = fileType === 'video';
    const isPDF = fileType === 'pdf';
    const isDocx = fileType === 'docx';
    const sourceLabel = isVideo ? '视频' : isPDF ? 'PDF' : isDocx ? 'Word文档' : '图片';
    const mergeNote = mergedIntoExisting
      ? ` 已归入"${mergedWordbookName}"`
      : '';
    res.json({
      message: extractionSource === 'ocr'
        ? `AI 识别成功！从${sourceLabel}中提取了 ${cardIds.length} 个西语单词、${sentences.length} 条造句${mergeNote}`
        : `已生成 ${cardIds.length} 个示例单词（${extractionNote}）${mergeNote}`,
      cardIds,
      words,
      sentences: savedSentences,
      extractionSource,
      extractionNote: extractionNote || undefined,
      wordbookId: finalWordbookId,    // 返回最终归属的单词本 ID
      merged: mergedIntoExisting || undefined,
      mergedWordbookName: mergedWordbookName || undefined,
    });
  } catch (err: any) {
    console.error('[Extract] 未知错误:', err.message);
    res.status(500).json({ error: '提取失败: ' + err.message });
  }
});

// GET /api/upload/uploads - Serve uploaded files
router.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: '文件不存在' });
  }
});

// Mock word extraction - simulates OCR + NLP for demo
function generateMockWords(fileType: string, filePath: string) {
  const spanishWords = [
    { word: 'información', partOfSpeech: 'sustantivo', gender: 'femenino', definiteArticle: 'la', chineseMeaning: '信息', originalForm: 'información', example: 'Necesito más información sobre el curso.', exampleZh: '我需要更多关于课程的信息。' },
    { word: 'levantarse', partOfSpeech: 'verbo', gender: '', definiteArticle: '', chineseMeaning: '起床', originalForm: 'levantarse', example: 'Me levanto a las siete todos los días.', exampleZh: '我每天七点起床。' },
    { word: 'trabajar', partOfSpeech: 'verbo', gender: '', definiteArticle: '', chineseMeaning: '工作', originalForm: 'trabajar', example: 'Ella trabaja en una oficina.', exampleZh: '她在一间办公室工作。' },
    { word: 'familia', partOfSpeech: 'sustantivo', gender: 'femenino', definiteArticle: 'la', chineseMeaning: '家庭', originalForm: 'familia', example: 'Mi familia es muy grande.', exampleZh: '我的家庭很大。' },
    { word: 'hermoso', partOfSpeech: 'adjetivo', gender: '', definiteArticle: '', chineseMeaning: '美丽的', originalForm: 'hermoso', example: 'Es un día hermoso.', exampleZh: '这是美丽的一天。' },
    { word: 'comer', partOfSpeech: 'verbo', gender: '', definiteArticle: '', chineseMeaning: '吃', originalForm: 'comer', example: 'Vamos a comer juntos.', exampleZh: '我们一起去吃饭。' },
    { word: 'dormir', partOfSpeech: 'verbo', gender: '', definiteArticle: '', chineseMeaning: '睡觉', originalForm: 'dormir', example: 'Necesito dormir ocho horas.', exampleZh: '我需要睡八小时。' },
    { word: 'estudiante', partOfSpeech: 'sustantivo', gender: 'común', definiteArticle: 'el/la', chineseMeaning: '学生', originalForm: 'estudiante', example: 'Soy estudiante de español.', exampleZh: '我是西班牙语学生。' },
    { word: 'biblioteca', partOfSpeech: 'sustantivo', gender: 'femenino', definiteArticle: 'la', chineseMeaning: '图书馆', originalForm: 'biblioteca', example: 'Estudio en la biblioteca.', exampleZh: '我在图书馆学习。' },
    { word: 'profesor', partOfSpeech: 'sustantivo', gender: 'masculino', definiteArticle: 'el', chineseMeaning: '老师', originalForm: 'profesor', example: 'El profesor explica muy bien.', exampleZh: '老师解释得很好。' },
  ];

  // Randomly select 4-8 words based on file path hash
  const count = 5 + (filePath.length % 4);
  const shuffled = [...spanishWords].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

export default router;
