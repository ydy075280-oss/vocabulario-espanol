import { Router, Response, Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { query, queryOne, queryAll, transaction, exec } from '../db';
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

// ─── 公共：提取单词并入库 ───
async function performExtraction(
  fileType: string,
  filePathOnDisk: string,
  filePublicPath: string,
  wordbookId: string,
  userId: string,
): Promise<{
  cardIds: string[];
  words: ExtractedWord[];
  sentences: Array<{ es: string; zh: string; cardId: string; audioUrl?: string }>;
  extractionSource: 'ocr' | 'mock';
  extractionNote?: string;
  merged?: boolean;
  mergedWordbookName?: string;
  wordbookId: string;
}> {
  let words: ExtractedWord[] = [];
  let sentences: ExtractedSentence[] = [];
  let extractionSource: 'ocr' | 'mock' = 'mock';
  let extractionNote = '';

  if (fileType === 'image') {
    const result = await extractWordsFromImage(filePathOnDisk);
    words = result.words;
    sentences = result.sentences;
    extractionSource = 'ocr';
  } else if (fileType === 'video') {
    const audioBaseName = `audio_${uuidv4()}.mp3`;
    const audioPath = await extractAudioFromVideo(filePathOnDisk, audioBaseName);
    const asrResult = await transcribeVideoAudio(audioPath);
    words = asrResult.words;
    sentences = asrResult.sentences;
    extractionSource = 'ocr';
    try { fs.unlinkSync(audioPath); } catch {}
  } else if (fileType === 'pdf') {
    const result = await extractWordsFromPDF(filePathOnDisk);
    words = result.words;
    sentences = result.sentences;
    extractionSource = 'ocr';
  } else if (fileType === 'docx') {
    const result = await extractWordsFromDocx(filePathOnDisk);
    words = result.words;
    sentences = result.sentences;
    extractionSource = 'ocr';
  } else {
    words = generateMockWords(fileType, filePublicPath);
    extractionSource = 'mock';
    extractionNote = '未知文件类型，使用示例单词';
  }

  // ─── 去重合并 ───
  let finalWordbookId = wordbookId;
  let mergedIntoExisting = false;
  let mergedWordbookName = '';

  if (wordbookId) {
    const currentWB = await queryOne<{ teacher_tag: string; course_tag: string; name: string }>(
      'SELECT teacher_tag, course_tag, name FROM wordbooks WHERE id = $1 AND user_id = $2',
      [wordbookId, userId]
    );

    if (!currentWB) {
      console.warn(`[Extract] 单词本 ${wordbookId} 不存在，将忽略合并逻辑`);
      finalWordbookId = null as any;
    } else {
      const normalizedTeacher = (currentWB.teacher_tag || '').trim().toLowerCase();
      const normalizedCourse = (currentWB.course_tag || '').trim().toLowerCase();

      let existingWB: { id: string; name: string } | null = null;
      if (normalizedTeacher) {
        existingWB = await queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM wordbooks
           WHERE user_id = $1 AND id != $2 AND LOWER(TRIM(teacher_tag)) = $3
           LIMIT 1`,
          [userId, wordbookId, normalizedTeacher]
        );
      }
      if (!existingWB && normalizedCourse) {
        existingWB = await queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM wordbooks
           WHERE user_id = $1 AND id != $2 AND LOWER(TRIM(course_tag)) = $3
           LIMIT 1`,
          [userId, wordbookId, normalizedCourse]
        );
      }

      if (existingWB) {
        console.log(`[Extract] 检测到相同标签单词本: "${existingWB.name}", 合并单词`);
        finalWordbookId = existingWB.id;
        mergedIntoExisting = true;
        mergedWordbookName = existingWB.name;
      }
    }
  }

  if (!finalWordbookId) {
    throw new Error('单词本不存在，请重新上传文件');
  }

  const cardIds: string[] = [];
  let savedSentences: Array<{ es: string; zh: string; cardId: string; audioUrl?: string }> = [];

  await transaction(async (client) => {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const cid = uuidv4();
      const norm = w.word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      await client.query(
        `INSERT INTO word_cards (
          id, wordbook_id, user_id, word, word_normalized, part_of_speech,
          gender, definite_article, chinese_meaning, original_form,
          accent_type, status, audio_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [cid, finalWordbookId, userId, w.word, norm, w.partOfSpeech,
          w.gender || '', w.definiteArticle || '', w.chineseMeaning, w.originalForm || w.word,
          'es-ES', 'new', '']
      );
      if (w.example) await client.query(
        'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh, audio_url) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), cid, w.example, w.exampleZh || '', '']
      );
      cardIds.push(cid);
    }

    if (sentences.length > 0 && cardIds.length > 0) {
      for (const s of sentences) {
        for (const cid of cardIds) {
          await client.query(
            'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh, audio_url) VALUES ($1, $2, $3, $4, $5)',
            [uuidv4(), cid, s.es, s.zh, '']
          );
        }
        savedSentences.push({ es: s.es, zh: s.zh, cardId: cardIds[0] });
      }
    }

    await client.query(
      'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1) WHERE id = $1',
      [finalWordbookId]
    );

    if (mergedIntoExisting && wordbookId !== finalWordbookId) {
      await client.query('DELETE FROM wordbooks WHERE id = $1', [wordbookId]);
      console.log(`[Extract] 已删除临时单词本: ${wordbookId}`);
    }
  });

  return {
    cardIds,
    words,
    sentences: savedSentences,
    extractionSource,
    extractionNote: extractionNote || undefined,
    merged: mergedIntoExisting || undefined,
    mergedWordbookName: mergedWordbookName || undefined,
    wordbookId: finalWordbookId,
  };
}

// POST /api/upload - Upload files (可选自动提取)
router.post(
  '/',
  authMiddleware,
  upload.array('files', 20),
  async (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: '请选择文件' });
        return;
      }

      const { wordbookName, teacherTag, courseTag, autoExtract } = req.body;

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
        await exec(
          `INSERT INTO wordbooks (id, user_id, name, source_type, source_name, teacher_tag, course_tag)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            wordbookId,
            req.userId!,
            wordbookName,
            sourceType,
            files.map(f => f.originalname).join(', '),
            teacherTag || '',
            courseTag || ''
          ]
        );
      }

      // 自动提取模式：上传后立即在同一个请求中提取
      if (autoExtract === 'true' && wordbookId && files[0]) {
        const f = files[0];
        const fileType = uploadedFiles[0].type;
        try {
          const diskPath = path.join(uploadDir, f.filename);
          const extractResult = await performExtraction(
            fileType, diskPath, uploadedFiles[0].path, wordbookId, req.userId!
          );

          const sourceLabel = fileType === 'video' ? '视频' : fileType === 'pdf' ? 'PDF'
            : fileType === 'docx' ? 'Word文档' : '图片';
          const mergeNote = extractResult.merged
            ? ` 已归入"${extractResult.mergedWordbookName}"` : '';

          res.json({
            message: `文件上传成功！${files.length} 个文件`,
            files: uploadedFiles,
            wordbookId: extractResult.wordbookId,
            extract: {
              message: extractResult.extractionSource === 'ocr'
                ? `AI 识别成功！从${sourceLabel}中提取了 ${extractResult.cardIds.length} 个西语单词、${extractResult.sentences.length} 条造句${mergeNote}`
                : `已生成 ${extractResult.cardIds.length} 个示例单词（${extractResult.extractionNote || ''}）${mergeNote}`,
              cardIds: extractResult.cardIds,
              words: extractResult.words,
              sentences: extractResult.sentences,
              extractionSource: extractResult.extractionSource,
              extractionNote: extractResult.extractionNote,
              wordbookId: extractResult.wordbookId,
              merged: extractResult.merged,
              mergedWordbookName: extractResult.mergedWordbookName,
            },
          });
        } catch (extractErr: any) {
          console.error('[AutoExtract] 提取失败:', extractErr.message);
          res.json({
            message: `文件上传成功！${files.length} 个文件`,
            files: uploadedFiles,
            wordbookId,
            extractError: extractErr.message || '提取失败',
          });
        }
        return;
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

// POST /api/upload/extract - Extract words from uploaded file (legacy, 逐步废弃)
router.post('/extract', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filePath, fileType, wordbookId } = req.body;
    const diskPath = path.join(uploadDir, path.basename(filePath));
    const result = await performExtraction(fileType, diskPath, filePath, wordbookId, req.userId!);

    const isVideo = fileType === 'video';
    const isPDF = fileType === 'pdf';
    const isDocx = fileType === 'docx';
    const sourceLabel = isVideo ? '视频' : isPDF ? 'PDF' : isDocx ? 'Word文档' : '图片';
    const mergeNote = result.merged
      ? ` 已归入"${result.mergedWordbookName}"` : '';

    res.json({
      message: result.extractionSource === 'ocr'
        ? `AI 识别成功！从${sourceLabel}中提取了 ${result.cardIds.length} 个西语单词、${result.sentences.length} 条造句${mergeNote}`
        : `已生成 ${result.cardIds.length} 个示例单词（${result.extractionNote || ''}）${mergeNote}`,
      cardIds: result.cardIds,
      words: result.words,
      sentences: result.sentences,
      extractionSource: result.extractionSource,
      extractionNote: result.extractionNote,
      wordbookId: result.wordbookId,
      merged: result.merged,
      mergedWordbookName: result.mergedWordbookName,
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

  const count = 5 + (filePath.length % 4);
  const shuffled = [...spanishWords].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

export default router;
