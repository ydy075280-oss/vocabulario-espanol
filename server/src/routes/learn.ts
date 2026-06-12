import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { calculateSM2 } from '../utils/sm2';
import db from '../db';

const router = Router();

// GET /api/learn/today - Get today's review queue
router.get('/today', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const now = new Date().toISOString();

    const cards = db.prepare(`
      SELECT wc.*, wb.name as wordbook_name
      FROM word_cards wc
      JOIN wordbooks wb ON wc.wordbook_id = wb.id
      WHERE wc.user_id = ? AND wc.next_review_at <= ?
      ORDER BY wc.ease_factor ASC, wc.next_review_at ASC
      LIMIT 50
    `).all(req.userId!, now) as any[];

    // 为每张卡片挂上造句
    const getSentences = db.prepare(
      'SELECT * FROM example_sentences WHERE card_id = ? ORDER BY sort_order'
    );
    const cardsWithSentences = cards.map((card: any) => ({
      ...card,
      sentences: getSentences.all(card.id),
    }));

    res.json({
      cards: cardsWithSentences,
      total: cardsWithSentences.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取复习列表失败' });
  }
});

// GET /api/learn/wordbook/:wordbookId - Get cards for a specific wordbook to learn
router.get('/wordbook/:wordbookId', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { mode } = req.query; // all, new, review
    let sql = `
      SELECT wc.*, wb.name as wordbook_name
      FROM word_cards wc
      JOIN wordbooks wb ON wc.wordbook_id = wb.id
      WHERE wc.wordbook_id = ? AND wc.user_id = ?
    `;

    if (mode === 'new') {
      sql += " AND wc.status = 'new'";
    } else if (mode === 'review') {
      sql += " AND wc.next_review_at <= datetime('now')";
    }

    sql += ' ORDER BY wc.next_review_at ASC';

    const cards = db.prepare(sql).all(req.params.wordbookId, req.userId!) as any[];

    // 为每张卡片挂上造句
    const getSentences = db.prepare(
      'SELECT * FROM example_sentences WHERE card_id = ? ORDER BY sort_order'
    );
    const cardsWithSentences = cards.map((card: any) => ({
      ...card,
      sentences: getSentences.all(card.id),
    }));

    res.json({ cards: cardsWithSentences });
  } catch (err: any) {
    res.status(500).json({ error: '获取学习卡片失败' });
  }
});

// POST /api/learn/score - Submit review score
router.post('/score', authMiddleware, (req: AuthRequest, res: Response) => {
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

    const card = db.prepare(
      'SELECT * FROM word_cards WHERE id = ? AND user_id = ?'
    ).get(cardId, req.userId!) as any;

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
    db.prepare(`
      UPDATE word_cards SET
        ease_factor = ?, "interval" = ?, repetitions = ?,
        next_review_at = ?, status = ?,
        last_reviewed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      result.easeFactor, result.interval, result.repetitions,
      result.nextReviewAt, result.status, cardId
    );

    // Record study
    db.prepare(`
      INSERT INTO study_records (id, user_id, card_id, score, mode, time_spent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), req.userId!, cardId, score, mode || 'browse', timeSpent || 0);

    res.json({
      result,
      message: score >= 3 ? '掌握得不错！' : score >= 1 ? '继续加油！' : '别灰心，下次记住它！',
    });
  } catch (err: any) {
    res.status(500).json({ error: '提交评分失败: ' + err.message });
  }
});

// GET /api/learn/stats - Get learning statistics
router.get('/stats', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const totalCards = db.prepare(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = ?'
    ).get(req.userId!) as any;

    const masteredCards = db.prepare(
      "SELECT COUNT(*) as count FROM word_cards WHERE user_id = ? AND status = 'mastered'"
    ).get(req.userId!) as any;

    const learningCards = db.prepare(
      "SELECT COUNT(*) as count FROM word_cards WHERE user_id = ? AND status = 'learning'"
    ).get(req.userId!) as any;

    const dueNow = db.prepare(
      "SELECT COUNT(*) as count FROM word_cards WHERE user_id = ? AND next_review_at <= datetime('now')"
    ).get(req.userId!) as any;

    // Today's study count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayStudied = db.prepare(
      "SELECT COUNT(DISTINCT card_id) as count FROM study_records WHERE user_id = ? AND studied_at >= ?"
    ).get(req.userId!, todayStart.toISOString()) as any;

    // Recent accuracy (last 100 records)
    const recentRecords = db.prepare(`
      SELECT score FROM study_records
      WHERE user_id = ?
      ORDER BY studied_at DESC
      LIMIT 100
    `).all(req.userId!) as any[];

    const accuracy = recentRecords.length > 0
      ? Math.round((recentRecords.filter((r: any) => r.score >= 3).length / recentRecords.length) * 100)
      : 0;

    // Average ease factor
    const avgEase = db.prepare(
      'SELECT AVG(ease_factor) as avg FROM word_cards WHERE user_id = ? AND repetitions > 0'
    ).get(req.userId!) as any;

    // Learning time today
    const todayTime = db.prepare(
      'SELECT COALESCE(SUM(time_spent), 0) as total FROM study_records WHERE user_id = ? AND studied_at >= ?'
    ).get(req.userId!, todayStart.toISOString()) as any;

    res.json({
      totalCards: totalCards.count || 0,
      masteredCards: masteredCards.count || 0,
      learningCards: learningCards.count || 0,
      dueNow: dueNow.count || 0,
      todayStudied: todayStudied.count || 0,
      accuracy,
      avgEaseFactor: Math.round((avgEase?.avg || 0) * 100) / 100,
      todayMinutes: Math.round((todayTime?.total || 0) / 60),
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取统计失败' });
  }
});

export default router;
