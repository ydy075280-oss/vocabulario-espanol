import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db';
import { analyzeRequirement as aiAnalyze } from '../services/qwenClient';

const router = Router();

// GET /api/create - List user's creations
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const creations = db.prepare(`
      SELECT * FROM creations
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.userId!);

    res.json({ creations });
  } catch (err: any) {
    res.status(500).json({ error: '获取创作列表失败' });
  }
});

// POST /api/create/analyze - AI拆解作业重点 -> 返回关键词
router.post('/analyze', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { requirement } = req.body;

    if (!requirement || !requirement.trim()) {
      res.status(400).json({ error: '请输入教师作业要求' });
      return;
    }

    // 📝 调用 deepseek-v4-pro 真实 AI 分析
    const keywords = await aiAnalyze(requirement);

    res.json({ keywords });
  } catch (err: any) {
    res.status(500).json({ error: 'AI 分析失败: ' + err.message });
  }
});

// POST /api/create - Save creation (user text + generate audio placeholder)
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const {
      teacherRequirement, keywords, userTextEs, userTextZh,
      wordbookName, teacherTag, courseTag,
    } = req.body;

    if (!userTextEs || !userTextEs.trim()) {
      res.status(400).json({ error: '请输入西班牙语写作内容' });
      return;
    }

    const creationId = uuidv4();
    const wordCount = userTextEs.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Create linked wordbook
    const wordbookId = uuidv4();
    db.prepare(`
      INSERT INTO wordbooks (id, user_id, name, source_type, teacher_tag, course_tag)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      wordbookId,
      req.userId!,
      wordbookName || '创创作 - ' + new Date().toLocaleDateString('zh-CN'),
      'create',
      teacherTag || '',
      courseTag || ''
    );

    // Create word cards from keywords
    if (keywords && Array.isArray(keywords) && keywords.length > 0) {
      const insertCard = db.prepare(`
        INSERT INTO word_cards (
          id, wordbook_id, user_id, word, word_normalized, part_of_speech,
          gender, definite_article, chinese_meaning, original_form
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const kw of keywords) {
        const cardId = uuidv4();
        const normalized = (kw.word || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

        insertCard.run(
          cardId, wordbookId, req.userId!,
          kw.word, normalized,
          kw.partOfSpeech || '',
          kw.gender || '',
          kw.definiteArticle || '',
          kw.chineseMeaning || '',
          kw.originalForm || kw.word
        );
      }

      // Update card_count
      db.prepare(`
        UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = ?)
        WHERE id = ?
      `).run(wordbookId, wordbookId);
    }

    // Split text into sentences for audio generation
    const sentences = splitSentences(userTextEs);

    // Save creation
    db.prepare(`
      INSERT INTO creations (
        id, user_id, teacher_requirement, keywords_json,
        user_text_es, user_text_zh, sentence_audios_json,
        linked_wordbook_id, word_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      creationId, req.userId!,
      teacherRequirement || '',
      JSON.stringify(keywords || []),
      userTextEs,
      userTextZh || '',
      JSON.stringify(sentences.map((s, i) => ({ index: i, text: s }))),
      wordbookId,
      wordCount
    );

    const creation = db.prepare('SELECT * FROM creations WHERE id = ?').get(creationId);

    res.status(201).json({
      creation,
      wordbookId,
      sentences,
      message: '创作完成！已生成单词本和背诵素材',
    });
  } catch (err: any) {
    res.status(500).json({ error: '保存创作失败: ' + err.message });
  }
});

// GET /api/create/:id - Get creation detail
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const creation = db.prepare(
      'SELECT * FROM creations WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!creation) {
      res.status(404).json({ error: '创作不存在' });
      return;
    }

    let keywords = [];
    let sentenceAudios = [];
    try { keywords = JSON.parse(creation.keywords_json || '[]'); } catch { /* ignore */ }
    try { sentenceAudios = JSON.parse(creation.sentence_audios_json || '[]'); } catch { /* ignore */ }

    // Get linked wordbook
    let wordbook = null;
    if (creation.linked_wordbook_id) {
      wordbook = db.prepare(
        'SELECT * FROM wordbooks WHERE id = ?'
      ).get(creation.linked_wordbook_id);
    }

    res.json({
      creation: { ...creation, keywords, sentenceAudios },
      wordbook,
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取创作详情失败' });
  }
});

// DELETE /api/create/:id
router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const creation = db.prepare(
      'SELECT * FROM creations WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!creation) {
      res.status(404).json({ error: '创作不存在' });
      return;
    }

    db.prepare('DELETE FROM creations WHERE id = ?').run(req.params.id);
    res.json({ message: '创作已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除失败' });
  }
});

// ----- Helper functions -----

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?¡¿]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => s + '.');
}

export default router;
