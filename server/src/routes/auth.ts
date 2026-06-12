import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'vocabulario-secret-key-dev';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'vocabulario-refresh-secret-dev';

// POST /api/auth/register
router.post('/register', (req: Request, res: Response) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: '邮箱和密码不能为空' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: '密码至少需要8位字符' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: '邮箱格式不正确' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ error: '该邮箱已被注册' });
      return;
    }

    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const displayName = nickname || email.split('@')[0];

    db.prepare(
      'INSERT INTO users (id, email, password_hash, nickname) VALUES (?, ?, ?, ?)'
    ).run(id, email, passwordHash, displayName);

    // Generate tokens
    const accessToken = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '2h' });
    const refreshToken = generateRefreshToken(id);

    res.status(201).json({
      user: { id, email, nickname: displayName, avatar_url: '' },
      accessToken,
      refreshToken,
    });
  } catch (err: any) {
    res.status(500).json({ error: '注册失败: ' + err.message });
  }
});

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: '邮箱和密码不能为空' });
      return;
    }

    const user = db.prepare(
      'SELECT id, email, password_hash, nickname, avatar_url FROM users WHERE email = ?'
    ).get(email) as any;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: '邮箱或密码错误' });
      return;
    }

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '2h' });
    const refreshToken = generateRefreshToken(user.id, rememberMe);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url || '',
      },
      accessToken,
      refreshToken,
    });
  } catch (err: any) {
    res.status(500).json({ error: '登录失败: ' + err.message });
  }
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: '缺少 Refresh Token' });
      return;
    }

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as {
      userId: string;
      tokenId: string;
    };

    // Verify token exists in DB
    const stored = db.prepare(
      'SELECT id, expires_at FROM refresh_tokens WHERE token = ? AND user_id = ?'
    ).get(refreshToken, decoded.userId) as any;

    if (!stored) {
      res.status(401).json({ error: 'Refresh Token 无效' });
      return;
    }

    if (new Date(stored.expires_at) < new Date()) {
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);
      res.status(401).json({ error: 'Refresh Token 已过期，请重新登录' });
      return;
    }

    // Delete old, issue new
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);

    const user = db.prepare(
      'SELECT id, email, nickname, avatar_url FROM users WHERE id = ?'
    ).get(decoded.userId) as any;

    if (!user) {
      res.status(401).json({ error: '用户不存在' });
      return;
    }

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '2h' });
    const newRefreshToken = generateRefreshToken(user.id, true);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url || '',
      },
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch {
    res.status(401).json({ error: 'Refresh Token 无效或已过期' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
    }
    // Delete all tokens for this user
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.userId!);
    res.json({ message: '已退出登录' });
  } catch (err: any) {
    res.status(500).json({ error: '退出失败: ' + err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT id, email, nickname, avatar_url, created_at FROM users WHERE id = ?'
    ).get(req.userId!) as any;

    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // Get stats
    const totalCards = db.prepare(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = ?'
    ).get(req.userId!) as any;

    const masteredCards = db.prepare(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = ? AND status = ?'
    ).get(req.userId!, 'mastered') as any;

    const totalCreations = db.prepare(
      'SELECT COUNT(*) as count FROM creations WHERE user_id = ?'
    ).get(req.userId!) as any;

    // Calculate streak
    const streak = calculateStreak(req.userId!);

    const totalTime = db.prepare(
      'SELECT COALESCE(SUM(time_spent), 0) as total FROM study_records WHERE user_id = ?'
    ).get(req.userId!) as any;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url || '',
        created_at: user.created_at,
      },
      stats: {
        totalCards: totalCards.count || 0,
        masteredCards: masteredCards.count || 0,
        totalCreations: totalCreations.count || 0,
        streak: streak,
        totalMinutes: Math.round((totalTime.total || 0) / 60),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { nickname, avatar_url } = req.body;
    const updates: string[] = [];
    const values: any[] = [];

    if (nickname !== undefined) {
      updates.push('nickname = ?');
      values.push(nickname);
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      values.push(avatar_url);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: '没有需要更新的字段' });
      return;
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.userId!);

    db.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const user = db.prepare(
      'SELECT id, email, nickname, avatar_url FROM users WHERE id = ?'
    ).get(req.userId!) as any;

    res.json({ user });
  } catch (err: any) {
    res.status(500).json({ error: '更新失败: ' + err.message });
  }
});

// Helper functions
function generateRefreshToken(userId: string, rememberMe = false): string {
  const tokenId = uuidv4();
  const expiresIn = rememberMe ? 7 : 1; // 7 days or 1 day
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresIn);

  const token = jwt.sign({ userId, tokenId }, JWT_REFRESH_SECRET, {
    expiresIn: `${expiresIn}d`,
  });

  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
  ).run(tokenId, userId, token, expiresAt.toISOString());

  return token;
}

function calculateStreak(userId: string): number {
  const records = db.prepare(`
    SELECT DISTINCT date(studied_at) as study_date
    FROM study_records
    WHERE user_id = ?
    ORDER BY study_date DESC
    LIMIT 100
  `).all(userId) as any[];

  if (records.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < records.length; i++) {
    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);
    const expectedStr = expectedDate.toISOString().split('T')[0];

    if (records[i].study_date === expectedStr) {
      streak++;
    } else if (i === 0) {
      // Today hasn't been recorded yet, check if yesterday matches
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      if (records[i].study_date === yesterdayStr) {
        streak = 1;
        // Continue checking from yesterday
        for (let j = 1; j < records.length; j++) {
          const exp = new Date(yesterday);
          exp.setDate(exp.getDate() - j);
          if (records[j].study_date === exp.toISOString().split('T')[0]) {
            streak++;
          } else {
            break;
          }
        }
      }
      break;
    } else {
      break;
    }
  }

  return streak;
}

export default router;
