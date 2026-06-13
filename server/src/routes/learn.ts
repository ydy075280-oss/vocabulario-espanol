import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { calculateSM2 } from '../utils/sm2';
import { query, queryOne, queryAll, exec } from '../db';

const router = Router();

// GET /api/learn/today - Get today's review queue
router.get('/today', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cards = await queryAll<any>(
      `SELECT wc.*, wb.name as wordbook_name
       FROM word_cards wc
       JOIN wordbooks wb ON wc.wordbook_id = wb.id
       WHERE wc.user_id = $1 AND wc.next_review_at <= NOW()
       ORDER BY wc.ease_factor ASC, wc.next_review_at ASC
       LIMIT 50`,
      [req.userId!]
    );

    const cardsWithSentences = await Promise.all(
      cards.map(async (card: any) => {
        const sentences = await queryAll(
          'SELECT * FROM example_sentences WHERE card_id = $1 ORDER BY sort_order',
          [card.id]
        );
        return { ...card, sentences };
      })
    );

    res.json({
      cards: cardsWithSentences,
      total: cardsWithSentences.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取复习列表失败' });
  }
});

// GET /api/learn/wordbook/:wordbookId - Get cards for a specific wordbook to learn
router.get('/wordbook/:wordbookId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { mode } = req.query;
    const params: any[] = [req.params.wordbookId, req.userId!];
    let sql = `
      SELECT wc.*, wb.name as wordbook_name
      FROM word_cards wc
      JOIN wordbooks wb ON wc.wordbook_id = wb.id
      WHERE wc.wordbook_id = $1 AND wc.user_id = $2
    `;

    if (mode === 'new') {
      sql += " AND wc.status = 'new'";
    } else if (mode === 'review') {
      sql += ' AND wc.next_review_at <= NOW()';
    }

    sql += ' ORDER BY wc.next_review_at ASC';

    const cards = await queryAll<any>(sql, params);

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
    res.status(500).json({ error: '获取学习卡片失败' });
  }
});

// POST /api/learn/score - Submit review score
router.post('/score', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { cardId, score, mode, timeSpent } = req.body;

    if (!cardId || score === undefined) {
      res.status(400).json({ error: '参数错误' });
      return;
    }

    if (![0, 1, 2, 3, 4].includes(score)) {
      res.status(400).json({ error: '评分必须在 0-4 之间' });
      return;
    }

    const card = await queryOne<any>(
      'SELECT * FROM word_cards WHERE id = $1 AND user_id = $2',
      [cardId, req.userId!]
    );

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    // Calculate SM-2
    const result = calculateSM2(
      card.ease_factor || 2.5,
      card.interval || 0,
      card.repetitions || 0,
      score
    );

    // Update card
    await exec(
      `UPDATE word_cards SET
        ease_factor = $1, "interval" = $2, repetitions = $3,
        next_review_at = $4, status = $5,
        last_reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $6`,
      [
        result.easeFactor, result.interval, result.repetitions,
        result.nextReviewAt, result.status, cardId
      ]
    );

    // Record study
    await exec(
      'INSERT INTO study_records (id, user_id, card_id, score, mode, time_spent) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), req.userId!, cardId, score, mode || 'browse', timeSpent || 0]
    );

    res.json({
      result,
      message: score >= 3 ? '掌握得不错！' : score >= 1 ? '继续加油！' : '别灰心，下次记住它！',
    });
  } catch (err: any) {
    res.status(500).json({ error: '提交评分失败: ' + err.message });
  }
});

// GET /api/learn/stats - Get learning statistics
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const totalCards = await queryOne<any>(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = $1',
      [req.userId!]
    );

    const masteredCards = await queryOne<any>(
      "SELECT COUNT(*) as count FROM word_cards WHERE user_id = $1 AND status = 'mastered'",
      [req.userId!]
    );

    const learningCards = await queryOne<any>(
      "SELECT COUNT(*) as count FROM word_cards WHERE user_id = $1 AND status = 'learning'",
      [req.userId!]
    );

    const dueNow = await queryOne<any>(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = $1 AND next_review_at <= NOW()',
      [req.userId!]
    );

    // Today's study count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayStudied = await queryOne<any>(
      'SELECT COUNT(DISTINCT card_id) as count FROM study_records WHERE user_id = $1 AND studied_at >= $2',
      [req.userId!, todayStart.toISOString()]
    );

    // Recent accuracy (last 100 records)
    const recentRecords = await queryAll<any>(
      `SELECT score FROM study_records
       WHERE user_id = $1
       ORDER BY studied_at DESC
       LIMIT 100`,
      [req.userId!]
    );

    const accuracy = recentRecords.length > 0
      ? Math.round((recentRecords.filter((r: any) => r.score >= 3).length / recentRecords.length) * 100)
      : 0;

    // Average ease factor
    const avgEase = await queryOne<any>(
      'SELECT AVG(ease_factor) as avg FROM word_cards WHERE user_id = $1 AND repetitions > 0',
      [req.userId!]
    );

    // Learning time today
    const todayTime = await queryOne<any>(
      'SELECT COALESCE(SUM(time_spent), 0) as total FROM study_records WHERE user_id = $1 AND studied_at >= $2',
      [req.userId!, todayStart.toISOString()]
    );

    res.json({
      totalCards: parseInt(totalCards?.count) || 0,
      masteredCards: parseInt(masteredCards?.count) || 0,
      learningCards: parseInt(learningCards?.count) || 0,
      dueNow: parseInt(dueNow?.count) || 0,
      todayStudied: parseInt(todayStudied?.count) || 0,
      accuracy,
      avgEaseFactor: Math.round((avgEase?.avg || 0) * 100) / 100,
      todayMinutes: Math.round((parseInt(todayTime?.total) || 0) / 60),
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取统计失败' });
  }
});

export default router;
