import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { query, queryOne, queryAll, exec } from '../db';

const router = Router();

// GET /api/wordbooks - List all wordbooks for current user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const wordbooks = await queryAll(
      `SELECT wb.*, 
        COUNT(wc.id) as current_card_count
       FROM wordbooks wb
       LEFT JOIN word_cards wc ON wb.id = wc.wordbook_id
       WHERE wb.user_id = $1
       GROUP BY wb.id
       ORDER BY wb.updated_at DESC`,
      [req.userId!]
    );

    res.json({ wordbooks });
  } catch (err: any) {
    res.status(500).json({ error: '获取单词本列表失败' });
  }
});

// POST /api/wordbooks - Create a new wordbook
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, teacherTag, courseTag, sourceType } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: '单词本名称不能为空' });
      return;
    }

    const id = uuidv4();
    await exec(
      'INSERT INTO wordbooks (id, user_id, name, source_type, teacher_tag, course_tag) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.userId!, name.trim(), sourceType || 'manual', teacherTag || '', courseTag || '']
    );

    const wordbook = await queryOne('SELECT * FROM wordbooks WHERE id = $1', [id]);
    res.status(201).json({ wordbook });
  } catch (err: any) {
    res.status(500).json({ error: '创建单词本失败' });
  }
});

// GET /api/wordbooks/tags - 获取用户所有历史标签（供自动补全）
router.get('/tags', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const teacherRows = await queryAll<{ teacher_tag: string }>(
      `SELECT DISTINCT teacher_tag
       FROM wordbooks
       WHERE user_id = $1 AND teacher_tag != ''
       ORDER BY updated_at DESC`,
      [req.userId!]
    );

    const courseRows = await queryAll<{ course_tag: string }>(
      `SELECT DISTINCT course_tag
       FROM wordbooks
       WHERE user_id = $1 AND course_tag != ''
       ORDER BY updated_at DESC`,
      [req.userId!]
    );

    const teacherTags = teacherRows.map(r => r.teacher_tag);
    const courseTags = courseRows.map(r => r.course_tag);
    const allTags = [...new Set([...teacherTags, ...courseTags])];

    res.json({ teacherTags, courseTags, allTags });
  } catch (err: any) {
    res.status(500).json({ error: '获取标签失败' });
  }
});

// GET /api/wordbooks/:id - Get wordbook with cards
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const wordbook = await queryOne<any>(
      'SELECT * FROM wordbooks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!wordbook) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const cards = await queryAll(
      `SELECT * FROM word_cards
       WHERE wordbook_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.userId!]
    );

    const cardsWithSentences = await Promise.all(
      cards.map(async (card: any) => {
        const sentences = await queryAll(
          'SELECT * FROM example_sentences WHERE card_id = $1 ORDER BY sort_order',
          [card.id]
        );

        let conjugation = {};
        try { conjugation = JSON.parse(card.conjugation_json || '{}'); } catch { /* ignore */ }

        return { ...card, sentences, conjugation };
      })
    );

    res.json({ wordbook, cards: cardsWithSentences });
  } catch (err: any) {
    res.status(500).json({ error: '获取单词本详情失败' });
  }
});

// PUT /api/wordbooks/:id - Update wordbook
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, teacherTag, courseTag } = req.body;
    const existing = await queryOne(
      'SELECT * FROM wordbooks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!existing) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (teacherTag !== undefined) {
      updates.push(`teacher_tag = $${paramIndex++}`);
      values.push(teacherTag);
    }
    if (courseTag !== undefined) {
      updates.push(`course_tag = $${paramIndex++}`);
      values.push(courseTag);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(req.params.id);
      await exec(`UPDATE wordbooks SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
    }

    const wordbook = await queryOne('SELECT * FROM wordbooks WHERE id = $1', [req.params.id]);
    res.json({ wordbook });
  } catch (err: any) {
    res.status(500).json({ error: '更新单词本失败' });
  }
});

// DELETE /api/wordbooks/:id - Delete wordbook
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await queryOne(
      'SELECT * FROM wordbooks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!existing) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    await exec('DELETE FROM wordbooks WHERE id = $1', [req.params.id]);
    res.json({ message: '单词本已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除单词本失败' });
  }
});

export default router;
