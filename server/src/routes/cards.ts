import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { query, queryOne, queryAll, transaction, exec } from '../db';

const router = Router();

// GET /api/cards?wordbookId=&status=&search=
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { wordbookId, status, search, limit } = req.query;
    let sql = 'SELECT * FROM word_cards WHERE user_id = $1';
    const params: any[] = [req.userId!];
    let paramIndex = 2;

    if (wordbookId) {
      sql += ` AND wordbook_id = $${paramIndex++}`;
      params.push(wordbookId);
    }
    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (word ILIKE $${paramIndex} OR word_normalized ILIKE $${paramIndex + 1} OR chinese_meaning ILIKE $${paramIndex + 2})`;
      const s = `%${search}%`;
      params.push(s, s, s);
      paramIndex += 3;
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(Number(limit));
    }

    const cards = await queryAll(sql, params);

    const cardsWithSentences = await Promise.all(
      cards.map(async (card: any) => {
        const sentences = await queryAll(
          'SELECT * FROM example_sentences WHERE card_id = $1 ORDER BY sort_order',
          [card.id]
        );
        return { ...card, sentences };
      })
    );

    res.json({ cards: cardsWithSentences });
  } catch (err: any) {
    res.status(500).json({ error: '获取卡片失败' });
  }
});

// POST /api/cards - Create a new card
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
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
    const wordbook = await queryOne(
      'SELECT id FROM wordbooks WHERE id = $1 AND user_id = $2',
      [wordbookId, req.userId!]
    );

    if (!wordbook) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const cardId = uuidv4();
    const normalized = word
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    await exec(
      `INSERT INTO word_cards (
        id, wordbook_id, user_id, word, word_normalized, part_of_speech,
        gender, definite_article, chinese_meaning, original_form,
        conjugation_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        cardId, wordbookId, req.userId!, word, normalized,
        partOfSpeech || '', gender || '', definiteArticle || '',
        chineseMeaning || '', originalForm || word,
        JSON.stringify(conjugation || {})
      ]
    );

    if (exampleSentence) {
      await exec(
        'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh) VALUES ($1, $2, $3, $4)',
        [uuidv4(), cardId, exampleSentence, exampleTranslation || '']
      );
    }

    // Update card_count
    await exec(
      'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
      [wordbookId]
    );

    const card = await queryOne('SELECT * FROM word_cards WHERE id = $1', [cardId]);
    res.status(201).json({ card });
  } catch (err: any) {
    res.status(500).json({ error: '创建卡片失败' });
  }
});

// GET /api/cards/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const card = await queryOne<any>(
      'SELECT * FROM word_cards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const sentences = await queryAll(
      'SELECT * FROM example_sentences WHERE card_id = $1 ORDER BY sort_order',
      [card.id]
    );

    let conjugation = {};
    try { conjugation = JSON.parse(card.conjugation_json || '{}'); } catch { /* ignore */ }

    res.json({ card: { ...card, sentences, conjugation } });
  } catch (err: any) {
    res.status(500).json({ error: '获取卡片失败' });
  }
});

// PUT /api/cards/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await queryOne(
      'SELECT * FROM word_cards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

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
    let paramIndex = 1;

    if (word !== undefined) {
      updates.push(`word = $${paramIndex++}`);
      values.push(word);
      const normalized = word
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      updates.push(`word_normalized = $${paramIndex++}`);
      values.push(normalized);
    }
    if (partOfSpeech !== undefined) { updates.push(`part_of_speech = $${paramIndex++}`); values.push(partOfSpeech); }
    if (gender !== undefined) { updates.push(`gender = $${paramIndex++}`); values.push(gender); }
    if (definiteArticle !== undefined) { updates.push(`definite_article = $${paramIndex++}`); values.push(definiteArticle); }
    if (chineseMeaning !== undefined) { updates.push(`chinese_meaning = $${paramIndex++}`); values.push(chineseMeaning); }
    if (originalForm !== undefined) { updates.push(`original_form = $${paramIndex++}`); values.push(originalForm); }
    if (conjugation !== undefined) { updates.push(`conjugation_json = $${paramIndex++}`); values.push(JSON.stringify(conjugation)); }
    if (imageUrl !== undefined) { updates.push(`image_url = $${paramIndex++}`); values.push(imageUrl); }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(req.params.id);
      await exec(`UPDATE word_cards SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
    }

    // Update example sentence
    if (exampleSentence !== undefined) {
      await exec('DELETE FROM example_sentences WHERE card_id = $1', [req.params.id]);
      if (exampleSentence) {
        await exec(
          'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh) VALUES ($1, $2, $3, $4)',
          [uuidv4(), req.params.id, exampleSentence, exampleTranslation || '']
        );
      }
    }

    const card = await queryOne('SELECT * FROM word_cards WHERE id = $1', [req.params.id]);
    res.json({ card });
  } catch (err: any) {
    res.status(500).json({ error: '更新卡片失败: ' + err.message });
  }
});

// DELETE /api/cards/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const card = await queryOne<any>(
      'SELECT * FROM word_cards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const wordbookId = card.wordbook_id;
    await exec('DELETE FROM word_cards WHERE id = $1', [req.params.id]);

    // Update card_count
    await exec(
      'UPDATE wordbooks SET card_count = (SELECT COALESCE(COUNT(*), 0) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
      [wordbookId]
    );

    res.json({ message: '卡片已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除卡片失败' });
  }
});

// POST /api/cards/batch - Batch create cards from extracted words
router.post('/batch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { wordbookId, words } = req.body;

    if (!wordbookId || !words || !Array.isArray(words)) {
      res.status(400).json({ error: '参数错误' });
      return;
    }

    const wordbook = await queryOne(
      'SELECT id FROM wordbooks WHERE id = $1 AND user_id = $2',
      [wordbookId, req.userId!]
    );

    if (!wordbook) {
      res.status(404).json({ error: '单词本不存在' });
      return;
    }

    const cardIds: string[] = [];

    await transaction(async (client) => {
      for (const w of words) {
        const cardId = uuidv4();
        const normalized = (w.word || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

        await client.query(
          `INSERT INTO word_cards (
            id, wordbook_id, user_id, word, word_normalized, part_of_speech,
            gender, definite_article, chinese_meaning, original_form,
            conjugation_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            cardId, wordbookId, req.userId!, w.word || '', normalized,
            w.partOfSpeech || '', w.gender || '', w.definiteArticle || '',
            w.chineseMeaning || '', w.originalForm || w.word || '',
            JSON.stringify(w.conjugation || {})
          ]
        );

        if (w.exampleSentence) {
          await client.query(
            'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh) VALUES ($1, $2, $3, $4)',
            [uuidv4(), cardId, w.exampleSentence, w.exampleTranslation || '']
          );
        }

        cardIds.push(cardId);
      }
    });

    // Update card_count
    await exec(
      'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
      [wordbookId]
    );

    res.status(201).json({ message: `成功创建 ${cardIds.length} 张卡片`, cardIds });
  } catch (err: any) {
    res.status(500).json({ error: '批量创建失败: ' + err.message });
  }
});

export default router;
