import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, queryAll, exec } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'vocabulario-secret-key-dev';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'vocabulario-refresh-secret-dev';

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
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

    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      res.status(409).json({ error: '该邮箱已被注册' });
      return;
    }

    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const displayName = nickname || email.split('@')[0];

    await exec(
      'INSERT INTO users (id, email, password_hash, nickname, tts_speed) VALUES ($1, $2, $3, $4, 1.0)',
      [id, email, passwordHash, displayName]
    );

    // Generate tokens
    const accessToken = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '2h' });
    const refreshToken = await generateRefreshToken(id);

    res.status(201).json({
      user: { id, email, nickname: displayName, avatar_url: '', tts_speed: 1.0 },
      accessToken,
      refreshToken,
    });
  } catch (err: any) {
    res.status(500).json({ error: '注册失败: ' + err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: '邮箱和密码不能为空' });
      return;
    }

    const user = await queryOne<any>(
      'SELECT id, email, password_hash, nickname, avatar_url, tts_speed FROM users WHERE email = $1',
      [email]
    );

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: '邮箱或密码错误' });
      return;
    }

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '2h' });
    const refreshToken = await generateRefreshToken(user.id, rememberMe);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url || '',
        tts_speed: user.tts_speed ?? 1.0,
      },
      accessToken,
      refreshToken,
    });
  } catch (err: any) {
    res.status(500).json({ error: '登录失败: ' + err.message });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
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
    const stored = await queryOne<any>(
      'SELECT id, expires_at FROM refresh_tokens WHERE token = $1 AND user_id = $2',
      [refreshToken, decoded.userId]
    );

    if (!stored) {
      res.status(401).json({ error: 'Refresh Token 无效' });
      return;
    }

    if (new Date(stored.expires_at) < new Date()) {
      await exec('DELETE FROM refresh_tokens WHERE id = $1', [stored.id]);
      res.status(401).json({ error: 'Refresh Token 已过期，请重新登录' });
      return;
    }

    // Delete old, issue new
    await exec('DELETE FROM refresh_tokens WHERE id = $1', [stored.id]);

    const user = await queryOne<any>(
      'SELECT id, email, nickname, avatar_url, tts_speed FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!user) {
      res.status(401).json({ error: '用户不存在' });
      return;
    }

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '2h' });
    const newRefreshToken = await generateRefreshToken(user.id, true);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url || '',
        tts_speed: user.tts_speed ?? 1.0,
      },
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch {
    res.status(401).json({ error: 'Refresh Token 无效或已过期' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await exec('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    await exec('DELETE FROM refresh_tokens WHERE user_id = $1', [req.userId!]);
    res.json({ message: '已退出登录' });
  } catch (err: any) {
    res.status(500).json({ error: '退出失败: ' + err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<any>(
      'SELECT id, email, nickname, avatar_url, tts_speed, created_at FROM users WHERE id = $1',
      [req.userId!]
    );

    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // Get stats
    const totalCards = await queryOne<any>(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = $1',
      [req.userId!]
    );

    const masteredCards = await queryOne<any>(
      'SELECT COUNT(*) as count FROM word_cards WHERE user_id = $1 AND status = $2',
      [req.userId!, 'mastered']
    );

    const totalCreations = await queryOne<any>(
      'SELECT COUNT(*) as count FROM creations WHERE user_id = $1',
      [req.userId!]
    );

    // Calculate streak
    const streak = await calculateStreak(req.userId!);

    const totalTime = await queryOne<any>(
      'SELECT COALESCE(SUM(time_spent), 0) as total FROM study_records WHERE user_id = $1',
      [req.userId!]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url || '',
        tts_speed: user.tts_speed ?? 1.0,
        created_at: user.created_at,
      },
      stats: {
        totalCards: parseInt(totalCards?.count) || 0,
        masteredCards: parseInt(masteredCards?.count) || 0,
        totalCreations: parseInt(totalCreations?.count) || 0,
        streak: streak,
        totalMinutes: Math.round((parseInt(totalTime?.total) || 0) / 60),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { nickname, avatar_url, tts_speed } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (nickname !== undefined) {
      updates.push(`nickname = $${paramIndex++}`);
      values.push(nickname);
    }
    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatar_url);
    }
    if (tts_speed !== undefined) {
      updates.push(`tts_speed = $${paramIndex++}`);
      values.push(tts_speed);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: '没有需要更新的字段' });
      return;
    }

    updates.push('updated_at = NOW()');
    values.push(req.userId!);

    await exec(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    const user = await queryOne<any>(
      'SELECT id, email, nickname, avatar_url, tts_speed FROM users WHERE id = $1',
      [req.userId!]
    );

    res.json({ user: { ...user, tts_speed: user.tts_speed ?? 1.0 } });
  } catch (err: any) {
    res.status(500).json({ error: '更新失败: ' + err.message });
  }
});

// Helper functions
async function generateRefreshToken(userId: string, rememberMe = false): Promise<string> {
  const tokenId = uuidv4();
  const expiresIn = rememberMe ? 7 : 1;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresIn);

  const token = jwt.sign({ userId, tokenId }, JWT_REFRESH_SECRET, {
    expiresIn: `${expiresIn}d`,
  });

  await exec(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)',
    [tokenId, userId, token, expiresAt.toISOString()]
  );

  return token;
}

async function calculateStreak(userId: string): Promise<number> {
  const records = await queryAll<any>(
    `SELECT DISTINCT studied_at::date as study_date
     FROM study_records
     WHERE user_id = $1
     ORDER BY study_date DESC
     LIMIT 100`,
    [userId]
  );

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
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      if (records[i].study_date === yesterdayStr) {
        streak = 1;
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
