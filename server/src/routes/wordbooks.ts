import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db';

const router = Router();

// GET /api/wordbooks - List all wordbooks for current user
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const wordbooks = db.prepare(`
      SELECT wb.*, 
        COUNT(wc.id) as current_card_count
      FROM wordbooks wb
      LEFT JOIN word_cards wc ON wb.id = wc.wordbook_id
      WHERE wb.user_id = ?
      GROUP BY wb.id
      ORDER BY wb.updated_at DESC
    `).all(req.userId!);

    res.json({ wordbooks });
  } catch (err: any) {
    res.status(500).json({ error: '获取单词本列表失败' });
  }
});

// POST /api/wordbooks - Create a new wordbook
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { name, teacherTag, courseTag, sourceType } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: '单词本名称不能为空' });
      return;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO wordbooks (id, user_id, name, source_type, teacher_tag, course_tag)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.userId!, name.trim(), sourceType || 'manual', teacherTag || '', courseTag || '');

    const wordbook = db.prepare('SELECT * FROM wordbooks WHERE id = ?').get(id);
    res.status(201).json({ wordbook });
  } catch (err: any) {
    res.status(500).json({ error: '创建单词本失败' });
  }
});

// GET /api/wordbooks/tags - 获取用户所有历史标签（供自动补全）
router.get('/tags', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const teacherRows = db.prepare(`
      SELECT DISTINCT teacher_tag
      FROM wordbooks
      WHERE user_id = ? AND teacher_tag != ''
      ORDER BY updated_at DESC
    `).all(req.userId!) as { teacher_tag: string }[];

    const courseRows = db.prepare(`
      SELECT DISTINCT course_tag
      FROM wordbooks
      WHERE user_id = ? AND course_tag != ''
      ORDER BY updated_at DESC
    `).all(req.userId!) as { course_tag: string }[];

    const teacherTags = teacherRows.map(r => r.teacher_tag);
    const courseTags = courseRows.map(r => r.course_tag);

    // 合并去重，按最近使用排序（teacher_tags 在前）
    const allTags = [...new Set([...teacherTags, ...courseTags])];

    res.json({ teacherTags, courseTags, allTags });
  } catch (err: any) {
    res.status(500).json({ error: '获取标签失败' });
  }
});

// GET /api/wordbooks/:id - Get wordbook with cards
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const wordbook = db.prepare(
      'SELECT * FROM wordbooks WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!wordbook) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const cards = db.prepare(`
      SELECT * FROM word_cards
      WHERE wordbook_id = ? AND user_id = ?
      ORDER BY created_at DESC
    `).all(req.params.id, req.userId!);

    // Get sentences for each card
    const cardsWithSentences = cards.map((card: any) => {
      const sentences = db.prepare(
        'SELECT * FROM example_sentences WHERE card_id = ? ORDER BY sort_order'
      ).all(card.id);

      let conjugation = {};
      try {
        conjugation = JSON.parse(card.conjugation_json || '{}');
      } catch { /* ignore */ }

      return {
        ...card,
        sentences,
        conjugation,
      };
    });

    res.json({ wordbook, cards: cardsWithSentences });
  } catch (err: any) {
    res.status(500).json({ error: '获取单词本详情失败' });
  }
});

// PUT /api/wordbooks/:id - Update wordbook
router.put('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { name, teacherTag, courseTag } = req.body;
    const existing = db.prepare(
      'SELECT * FROM wordbooks WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!);

    if (!existing) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (teacherTag !== undefined) {
      updates.push('teacher_tag = ?');
      values.push(teacherTag);
    }
    if (courseTag !== undefined) {
      updates.push('course_tag = ?');
      values.push(courseTag);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(req.params.id);
      db.prepare(`UPDATE wordbooks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const wordbook = db.prepare('SELECT * FROM wordbooks WHERE id = ?').get(req.params.id);
    res.json({ wordbook });
  } catch (err: any) {
    res.status(500).json({ error: '更新单词本失败' });
  }
});

// DELETE /api/wordbooks/:id - Delete wordbook
router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare(
      'SELECT * FROM wordbooks WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!);

    if (!existing) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    db.prepare('DELETE FROM wordbooks WHERE id = ?').run(req.params.id);
    res.json({ message: '单词本已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除单词本失败' });
  }
});

export default router;
