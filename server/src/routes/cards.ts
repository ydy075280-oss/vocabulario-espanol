import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db';

const router = Router();

// GET /api/cards?wordbookId=&status=&search=
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { wordbookId, status, search, limit } = req.query;
    let sql = 'SELECT * FROM word_cards WHERE user_id = ?';
    const params: any[] = [req.userId!];

    if (wordbookId) {
      sql += ' AND wordbook_id = ?';
      params.push(wordbookId);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (word LIKE ? OR word_normalized LIKE ? OR chinese_meaning LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(Number(limit));
    }

    const cards = db.prepare(sql).all(...params);

    const cardsWithSentences = cards.map((card: any) => {
      const sentences = db.prepare(
        'SELECT * FROM example_sentences WHERE card_id = ? ORDER BY sort_order'
      ).all(card.id);

      return { ...card, sentences };
    });

    res.json({ cards: cardsWithSentences });
  } catch (err: any) {
    res.status(500).json({ error: '获取卡片失败' });
  }
});

// POST /api/cards - Create a new card
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const {
      wordbookId, word, partOfSpeech, gender, definiteArticle,
      chineseMeaning, originalForm, exampleSentence, exampleTranslation,
      conjugation,
    } = req.body;

    if (!word || !wordbookId) {
      res.status(400).json({ error: '单词和单词本ID不能为空' });
      return;
    }

    // Verify wordbook belongs to user
    const wordbook = db.prepare(
      'SELECT id FROM wordbooks WHERE id = ? AND user_id = ?'
    ).get(wordbookId, req.userId!);

    if (!wordbook) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const cardId = uuidv4();
    const normalized = word
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    db.prepare(`
      INSERT INTO word_cards (
        id, wordbook_id, user_id, word, word_normalized, part_of_speech,
        gender, definite_article, chinese_meaning, original_form,
        conjugation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cardId, wordbookId, req.userId!, word, normalized,
      partOfSpeech || '', gender || '', definiteArticle || '',
      chineseMeaning || '', originalForm || word,
      JSON.stringify(conjugation || {})
    );

    if (exampleSentence) {
      db.prepare(`
        INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh)
        VALUES (?, ?, ?, ?)
      `).run(uuidv4(), cardId, exampleSentence, exampleTranslation || '');
    }

    // Update card_count
    db.prepare(`
      UPDATE wordbooks SET card_count = (
        SELECT COUNT(*) FROM word_cards WHERE wordbook_id = ?
      ), updated_at = datetime('now') WHERE id = ?
    `).run(wordbookId, wordbookId);

    const card = db.prepare('SELECT * FROM word_cards WHERE id = ?').get(cardId);
    res.status(201).json({ card });
  } catch (err: any) {
    res.status(500).json({ error: '创建卡片失败' });
  }
});

// GET /api/cards/:id
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const card = db.prepare(
      'SELECT * FROM word_cards WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const sentences = db.prepare(
      'SELECT * FROM example_sentences WHERE card_id = ? ORDER BY sort_order'
    ).all(card.id);

    let conjugation = {};
    try { conjugation = JSON.parse(card.conjugation_json || '{}'); } catch { /* ignore */ }

    res.json({ card: { ...card, sentences, conjugation } });
  } catch (err: any) {
    res.status(500).json({ error: '获取卡片失败' });
  }
});

// PUT /api/cards/:id
router.put('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare(
      'SELECT * FROM word_cards WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!);

    if (!existing) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const {
      word, partOfSpeech, gender, definiteArticle,
      chineseMeaning, originalForm, exampleSentence, exampleTranslation,
      conjugation, imageUrl,
    } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (word !== undefined) {
      updates.push('word = ?');
      values.push(word);
      const normalized = word
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      updates.push('word_normalized = ?');
      values.push(normalized);
    }
    if (partOfSpeech !== undefined) { updates.push('part_of_speech = ?'); values.push(partOfSpeech); }
    if (gender !== undefined) { updates.push('gender = ?'); values.push(gender); }
    if (definiteArticle !== undefined) { updates.push('definite_article = ?'); values.push(definiteArticle); }
    if (chineseMeaning !== undefined) { updates.push('chinese_meaning = ?'); values.push(chineseMeaning); }
    if (originalForm !== undefined) { updates.push('original_form = ?'); values.push(originalForm); }
    if (conjugation !== undefined) { updates.push('conjugation_json = ?'); values.push(JSON.stringify(conjugation)); }
    if (imageUrl !== undefined) { updates.push('image_url = ?'); values.push(imageUrl); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(req.params.id);
      db.prepare(`UPDATE word_cards SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    // Update example sentence
    if (exampleSentence !== undefined) {
      db.prepare('DELETE FROM example_sentences WHERE card_id = ?').run(req.params.id);
      if (exampleSentence) {
        db.prepare(`
          INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh)
          VALUES (?, ?, ?, ?)
        `).run(uuidv4(), req.params.id, exampleSentence, exampleTranslation || '');
      }
    }

    const card = db.prepare('SELECT * FROM word_cards WHERE id = ?').get(req.params.id);
    res.json({ card });
  } catch (err: any) {
    res.status(500).json({ error: '更新卡片失败: ' + err.message });
  }
});

// DELETE /api/cards/:id
router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const card = db.prepare(
      'SELECT * FROM word_cards WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!);

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const wordbookId = (card as any).wordbook_id;
    db.prepare('DELETE FROM word_cards WHERE id = ?').run(req.params.id);

    // Update card_count
    db.prepare(`
      UPDATE wordbooks SET card_count = (
        SELECT COALESCE(COUNT(*), 0) FROM word_cards WHERE wordbook_id = ?
      ), updated_at = datetime('now') WHERE id = ?
    `).run(wordbookId, wordbookId);

    res.json({ message: '卡片已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除卡片失败' });
  }
});

// POST /api/cards/batch - Batch create cards from extracted words
router.post('/batch', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { wordbookId, words } = req.body;

    if (!wordbookId || !words || !Array.isArray(words)) {
      res.status(400).json({ error: '参数错误' });
      return;
    }

    const wordbook = db.prepare(
      'SELECT id FROM wordbooks WHERE id = ? AND user_id = ?'
    ).get(wordbookId, req.userId!);

    if (!wordbook) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const insertCard = db.prepare(`
      INSERT INTO word_cards (
        id, wordbook_id, user_id, word, word_normalized, part_of_speech,
        gender, definite_article, chinese_meaning, original_form,
        conjugation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSentence = db.prepare(`
      INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh)
      VALUES (?, ?, ?, ?)
    `);

    const cardIds: string[] = [];

    const batchInsert = db.transaction(() => {
      for (const w of words) {
        const cardId = uuidv4();
        const normalized = (w.word || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

        insertCard.run(
          cardId, wordbookId, req.userId!, w.word || '', normalized,
          w.partOfSpeech || '', w.gender || '', w.definiteArticle || '',
          w.chineseMeaning || '', w.originalForm || w.word || '',
          JSON.stringify(w.conjugation || {})
        );

        if (w.exampleSentence) {
          insertSentence.run(uuidv4(), cardId, w.exampleSentence, w.exampleTranslation || '');
        }

        cardIds.push(cardId);
      }
    });

    batchInsert();

    // Update card_count
    db.prepare(`
      UPDATE wordbooks SET card_count = (
        SELECT COUNT(*) FROM word_cards WHERE wordbook_id = ?
      ), updated_at = datetime('now') WHERE id = ?
    `).run(wordbookId, wordbookId);

    res.status(201).json({ message: `成功创建 ${cardIds.length} 张卡片`, cardIds });
  } catch (err: any) {
    res.status(500).json({ error: '批量创建失败: ' + err.message });
  }
});

export default router;
