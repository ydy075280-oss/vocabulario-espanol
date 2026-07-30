import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ─── 环境检测：有 DATABASE_URL 就用 PostgreSQL，否则用 SQLite ───
const usePostgres = !!process.env.DATABASE_URL;

// ──────────────────────────────────────────────────────────
// PostgreSQL 模式
// ──────────────────────────────────────────────────────────
let pgPool: any = null;
async function getPgPool() {
  if (!pgPool) {
    const { Pool } = await import('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // 线上通常需要 SSL
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    // 验证连接
    await pgPool.query('SELECT 1');
  }
  return pgPool;
}

// ──────────────────────────────────────────────────────────
// SQLite 模式（本地开发）
// ──────────────────────────────────────────────────────────
let sqliteDb: any = null;
function getSqliteDb() {
  if (!sqliteDb) {
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, '..', 'data', 'vocabulario.db');
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
  }
  return sqliteDb;
}

// ─── PostgreSQL → SQLite 转换（同时处理参数映射） ───
// PG 的 $1 可在同一条 SQL 中重复使用，但 SQLite 的 ? 是纯位置占位符
// 所以 $1 出现 N 次 → 需要 N 个 ? ，参数值重复 N 次
function convertQuery(sql: string, params?: any[]): { sql: string; params: any[] } {
  const newParams: any[] = [];

  // 替换 $1, $2... → ?，同时按出现顺序收集对应的参数值
  let converted = sql.replace(/\$(\d+)/g, (_match, numStr: string) => {
    const idx = parseInt(numStr, 10) - 1; // $1 → index 0
    if (params && idx < params.length) {
      newParams.push(params[idx]);
    }
    return '?';
  });

  // 其他 PG → SQLite 语法转换
  converted = converted.replace(/\bNOW\(\)/g, "datetime('now')");
  converted = converted.replace(/\bRETURNING\s+\*/gi, '');
  converted = converted.replace(/\bRETURNING\s+\w+/gi, '');
  converted = converted.replace(/\bILIKE\b/g, 'LIKE');

  return { sql: converted, params: newParams };
}

// ─── 查询辅助函数 ───

export async function query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number }> {
  if (usePostgres) {
    const pool = await getPgPool();
    const result = await pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  const db = getSqliteDb();
  const { sql: converted, params: newParams } = convertQuery(sql, params);
  const stmt = db.prepare(converted);
  if (/^\s*SELECT/i.test(sql)) {
    return { rows: stmt.all(...newParams) };
  }
  const info = stmt.run(...newParams);
  return { rows: [], rowCount: info.changes };
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  if (usePostgres) {
    const pool = await getPgPool();
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }

  const db = getSqliteDb();
  const { sql: converted, params: newParams } = convertQuery(sql, params);
  const stmt = db.prepare(converted);
  return (stmt.get(...newParams) as T) || null;
}

export async function queryAll<T = any>(sql: string, params?: any[]): Promise<T[]> {
  if (usePostgres) {
    const pool = await getPgPool();
    const result = await pool.query(sql, params);
    return result.rows;
  }

  const db = getSqliteDb();
  const { sql: converted, params: newParams } = convertQuery(sql, params);
  const stmt = db.prepare(converted);
  return stmt.all(...newParams) as T[];
}

export async function exec(sql: string, params?: any[]): Promise<number> {
  if (usePostgres) {
    const pool = await getPgPool();
    const result = await pool.query(sql, params);
    return result.rowCount ?? 0;
  }

  const db = getSqliteDb();
  const { sql: converted, params: newParams } = convertQuery(sql, params);
  const stmt = db.prepare(converted);
  const info = stmt.run(...newParams);
  return info.changes;
}

// ─── 事务辅助函数 ───
export async function transaction<T>(
  fn: (client: { query: (sql: string, params?: any[]) => any }) => Promise<T>
): Promise<T> {
  if (usePostgres) {
    const pool = await getPgPool();
    const pgClient = await pool.connect();
    try {
      await pgClient.query('BEGIN');
      const client = {
        query: async (sql: string, params?: any[]) => {
          const result = await pgClient.query(sql, params);
          return { rows: result.rows, rowCount: result.rowCount };
        }
      };
      const result = await fn(client);
      await pgClient.query('COMMIT');
      return result;
    } catch (e) {
      await pgClient.query('ROLLBACK');
      throw e;
    } finally {
      pgClient.release();
    }
  }

  // SQLite 事务
  const db = getSqliteDb();
  const client = {
    query: async (sql: string, params?: any[]) => {
      const { sql: converted, params: newParams } = convertQuery(sql, params);
      const stmt = db.prepare(converted);
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: stmt.all(...newParams) };
      }
      const info = stmt.run(...newParams);
      return { rows: [], rowCount: info.changes };
    }
  };

  db.exec('BEGIN');
  try {
    const result = await fn(client);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ─── 初始化数据库 ───
export async function initDatabase(): Promise<void> {
  if (usePostgres) {
    // 线上 PostgreSQL：自动建表（IF NOT EXISTS，幂等）
    const pool = await getPgPool();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        avatar_url TEXT DEFAULT '',
        tts_speed REAL DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wordbooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_name TEXT DEFAULT '',
        teacher_tag TEXT DEFAULT '',
        course_tag TEXT DEFAULT '',
        card_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS word_cards (
        id TEXT PRIMARY KEY,
        wordbook_id TEXT NOT NULL REFERENCES wordbooks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        word TEXT NOT NULL,
        word_normalized TEXT NOT NULL,
        part_of_speech TEXT DEFAULT '',
        gender TEXT DEFAULT '',
        definite_article TEXT DEFAULT '',
        chinese_meaning TEXT DEFAULT '',
        original_form TEXT DEFAULT '',
        audio_url TEXT DEFAULT '',
        accent_type TEXT DEFAULT 'es-ES',
        ease_factor REAL DEFAULT 2.5,
        "interval" INTEGER DEFAULT 0,
        repetitions INTEGER DEFAULT 0,
        next_review_at TIMESTAMPTZ DEFAULT NOW(),
        last_reviewed_at TIMESTAMPTZ DEFAULT NOW(),
        status TEXT DEFAULT 'new',
        conjugation_json TEXT DEFAULT '{}',
        image_url TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS example_sentences (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES word_cards(id) ON DELETE CASCADE,
        sentence_es TEXT NOT NULL,
        sentence_zh TEXT DEFAULT '',
        audio_url TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS creations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        teacher_requirement TEXT DEFAULT '',
        keywords_json TEXT DEFAULT '[]',
        user_text_es TEXT DEFAULT '',
        user_text_zh TEXT DEFAULT '',
        full_audio_url TEXT DEFAULT '',
        sentence_audios_json TEXT DEFAULT '[]',
        linked_wordbook_id TEXT,
        word_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS study_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES word_cards(id) ON DELETE CASCADE,
        score INTEGER NOT NULL DEFAULT 0,
        mode TEXT DEFAULT 'browse',
        time_spent INTEGER DEFAULT 0,
        studied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS big_modules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        description TEXT DEFAULT '',
        homework_text TEXT DEFAULT '',
        ai_plan_json TEXT DEFAULT '{}',
        content_type TEXT DEFAULT 'vocabulary',
        content_type_label TEXT DEFAULT '词汇与造句',
        language TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        total_days INTEGER DEFAULT 0,
        completed_days INTEGER DEFAULT 0,
        linked_wordbook_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS module_tasks (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES big_modules(id) ON DELETE CASCADE,
        day_number INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL DEFAULT '',
        content TEXT DEFAULT '',
        task_type TEXT NOT NULL DEFAULT 'vocabulary',
        linked_wordbook_id TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        completed_at TIMESTAMPTZ,
        sort_order INTEGER DEFAULT 0,
        task_data TEXT DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wordbooks_user ON wordbooks(user_id);
      CREATE INDEX IF NOT EXISTS idx_cards_wordbook ON word_cards(wordbook_id);
      CREATE INDEX IF NOT EXISTS idx_cards_user ON word_cards(user_id);
      CREATE INDEX IF NOT EXISTS idx_cards_next_review ON word_cards(user_id, next_review_at);
      CREATE INDEX IF NOT EXISTS idx_sentences_card ON example_sentences(card_id);
      CREATE INDEX IF NOT EXISTS idx_creations_user ON creations(user_id);
      CREATE INDEX IF NOT EXISTS idx_study_records_user ON study_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_modules_user ON big_modules(user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_module ON module_tasks(module_id);
    `);

    // 迁移：为已存在的库补充 notes 字段（幂等）
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'word_cards' AND column_name = 'notes'
        ) THEN
          ALTER TABLE word_cards ADD COLUMN notes TEXT DEFAULT '';
        END IF;
      END $$;
    `);

    console.log('🐘 PostgreSQL database connected & tables initialized');
    await ensureSeedWordbook();
    return;
  }

  // 本地 SQLite：自动建表
  const db = getSqliteDb();

  // 确保 data 目录存在
  const fs = await import('fs');
  const dbPath = path.join(__dirname, '..', 'data', 'vocabulario.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT DEFAULT '',
      tts_speed REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wordbooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_name TEXT DEFAULT '',
      teacher_tag TEXT DEFAULT '',
      course_tag TEXT DEFAULT '',
      card_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS word_cards (
      id TEXT PRIMARY KEY,
      wordbook_id TEXT NOT NULL REFERENCES wordbooks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      word TEXT NOT NULL,
      word_normalized TEXT NOT NULL,
      part_of_speech TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      definite_article TEXT DEFAULT '',
      chinese_meaning TEXT DEFAULT '',
      original_form TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      accent_type TEXT DEFAULT 'es-ES',
      ease_factor REAL DEFAULT 2.5,
      "interval" INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      next_review_at TEXT DEFAULT (datetime('now')),
      last_reviewed_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'new',
      conjugation_json TEXT DEFAULT '{}',
      image_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS example_sentences (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES word_cards(id) ON DELETE CASCADE,
      sentence_es TEXT NOT NULL,
      sentence_zh TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacher_requirement TEXT DEFAULT '',
      keywords_json TEXT DEFAULT '[]',
      user_text_es TEXT DEFAULT '',
      user_text_zh TEXT DEFAULT '',
      full_audio_url TEXT DEFAULT '',
      sentence_audios_json TEXT DEFAULT '[]',
      linked_wordbook_id TEXT,
      word_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS study_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES word_cards(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,
      mode TEXT DEFAULT 'browse',
      time_spent INTEGER DEFAULT 0,
      studied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS big_modules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      description TEXT DEFAULT '',
      homework_text TEXT DEFAULT '',
      ai_plan_json TEXT DEFAULT '{}',
      content_type TEXT DEFAULT 'vocabulary',
      content_type_label TEXT DEFAULT '词汇与造句',
      language TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      total_days INTEGER DEFAULT 0,
      completed_days INTEGER DEFAULT 0,
      linked_wordbook_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS module_tasks (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES big_modules(id) ON DELETE CASCADE,
      day_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '',
      content TEXT DEFAULT '',
      task_type TEXT NOT NULL DEFAULT 'vocabulary',
      linked_wordbook_id TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      sort_order INTEGER DEFAULT 0,
      task_data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 迁移：为已存在的库补充 notes 字段（幂等）
  {
    const cols = db.prepare("PRAGMA table_info(word_cards)").all();
    if (!cols.some((c: any) => c.name === 'notes')) {
      db.exec("ALTER TABLE word_cards ADD COLUMN notes TEXT DEFAULT ''");
    }
  }

  // ─── 索引 ───
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wordbooks_user ON wordbooks(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_wordbook ON word_cards(wordbook_id);
    CREATE INDEX IF NOT EXISTS idx_cards_user ON word_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_next_review ON word_cards(user_id, next_review_at);
    CREATE INDEX IF NOT EXISTS idx_sentences_card ON example_sentences(card_id);
    CREATE INDEX IF NOT EXISTS idx_creations_user ON creations(user_id);
    CREATE INDEX IF NOT EXISTS idx_study_records_user ON study_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_modules_user ON big_modules(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_module ON module_tasks(module_id);
  `);

  console.log('📦 SQLite database initialized');
  await ensureSeedWordbook();
}

// ──────────────────────────────────────────────────────────
// 多单词本（种子数据）：随 git 更新，所有用户自动获得私人副本
// 数据流：server/src/data/wordbooks/*.json（真源，一个文件 = 一个单词本）
//   → 系统级单词本（SEED_USER_ID 持有，确定性 ID）
//   → 每个用户注册/打开时自动获得私人副本（进度独立）
//   → git pull + 重启后系统真源更新，并按 source_name 增量同步
// 兼容：如 wordbooks/ 目录为空或无文件，fallback 到旧版 seed-words.json
// ──────────────────────────────────────────────────────────
export const SEED_USER_ID = '00000000-0000-0000-0000-0000000000seed';

// 基于名称生成确定性 ID（同一名称永远返回相同 ID，用于系统级单词本）
function seedWordbookId(name: string): string {
  const hash = require('crypto').createHash('md5').update(name, 'utf-8').digest('hex').slice(0, 24);
  return '00000000-0000-seed-' + hash;
}

function normalizeWord(word?: string): string {
  return (word || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// 从 wordbooks/ 目录加载所有种子数据，兼容旧版 seed-words.json
function loadAllSeedData(): { name: string; id: string; data: any }[] {
  const fs = require('fs');
  const results: { name: string; id: string; data: any }[] = [];
  const wordbooksDir = path.join(__dirname, 'data', 'wordbooks');

  // 优先：wordbooks/ 目录（多单词本模式）
  if (fs.existsSync(wordbooksDir)) {
    const files = fs.readdirSync(wordbooksDir).filter((f: string) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(wordbooksDir, f), 'utf-8'));
        const name = raw.wordbook?.name || path.basename(f, '.json');
        results.push({ name, id: seedWordbookId(name), data: raw });
      } catch { /* 跳过损坏文件 */ }
    }
  }

  // Fallback：旧版 seed-words.json（单单词本兼容）
  if (results.length === 0) {
    const oldPath = path.join(__dirname, 'data', 'seed-words.json');
    if (fs.existsSync(oldPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
        const name = raw.wordbook?.name || '默认单词本';
        results.push({ name, id: seedWordbookId(name), data: raw });
      } catch { /* 忽略 */ }
    }
  }

  return results;
}

async function insertSeedCards(
  client: { query: (sql: string, params?: any[]) => any },
  wordbookId: string,
  userId: string,
  seed: any
): Promise<void> {
  for (const w of seed.words || []) {
    const cardId = uuidv4();
    const normalized = normalizeWord(w.word);
    await client.query(
      `INSERT INTO word_cards (
        id, wordbook_id, user_id, word, word_normalized, part_of_speech,
        gender, definite_article, chinese_meaning, original_form, conjugation_json, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        cardId, wordbookId, userId, w.word || '', normalized,
        w.partOfSpeech || 'verbo', w.gender || '', w.definiteArticle || '',
        w.chineseMeaning || '', w.originalForm || w.word || '',
        JSON.stringify(w.conjugation || {}), w.notes || ''
      ]
    );
    const sentences = w.sentences || [];
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      await client.query(
        'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), cardId, s.es || '', s.zh || '', i]
      );
    }
  }
}

// 把系统真源中「用户副本尚未拥有」的新词增量补充进去（保留已有学习进度）
async function syncUserSeedCopy(userId: string, wordbookId: string, seed: any): Promise<void> {
  const existing = await queryAll('SELECT word_normalized FROM word_cards WHERE wordbook_id = $1', [wordbookId]);
  const have = new Set(existing.map((c: any) => c.word_normalized));
  const toAdd = (seed.words || []).filter((w: any) => !have.has(normalizeWord(w.word)));
  if (toAdd.length === 0) return;

  await transaction(async (client) => {
    for (const w of toAdd) {
      const cardId = uuidv4();
      const normalized = normalizeWord(w.word);
      await client.query(
        `INSERT INTO word_cards (
          id, wordbook_id, user_id, word, word_normalized, part_of_speech,
          gender, definite_article, chinese_meaning, original_form, conjugation_json, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          cardId, wordbookId, userId, w.word || '', normalized,
          w.partOfSpeech || 'verbo', w.gender || '', w.definiteArticle || '',
          w.chineseMeaning || '', w.originalForm || w.word || '',
          JSON.stringify(w.conjugation || {}), w.notes || ''
        ]
      );
      const sentences = w.sentences || [];
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i];
        await client.query(
          'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [uuidv4(), cardId, s.es || '', s.zh || '', i]
        );
      }
    }
  });

  await exec(
    'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
    [wordbookId]
  );
}

// 同步某一单词本的增量 → 所有持有该单词本副本的用户
async function syncAllUserSeedCopies(seedName: string, seed: any): Promise<void> {
  const copies = await queryAll(
    "SELECT id, user_id FROM wordbooks WHERE source_type = $1 AND source_name = $2",
    ['seed', seedName]
  );
  for (const wb of copies) {
    await syncUserSeedCopy(wb.user_id, wb.id, seed);
  }
}

// 为指定用户创建所有种子单词本私人副本（仅首次，幂等）
export async function copySeedToUser(userId: string): Promise<void> {
  try {
    const allSeeds = loadAllSeedData();
    if (allSeeds.length === 0) return;

    for (const { name, data } of allSeeds) {
      if (!data || !data.words || data.words.length === 0) continue;

      const existing = await queryOne(
        'SELECT id FROM wordbooks WHERE user_id = $1 AND source_type = $2 AND source_name = $3',
        [userId, 'seed', name]
      );
      if (existing) continue;

      const wbId = uuidv4();
      await exec(
        'INSERT INTO wordbooks (id, user_id, name, source_type, source_name, course_tag, card_count) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [wbId, userId, data.wordbook?.name || name, 'seed', name, data.wordbook?.courseTag || '默认', 0]
      );
      await transaction(async (client) => {
        await insertSeedCards(client, wbId, userId, data);
      });
      await exec(
        'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
        [wbId]
      );
    }
  } catch (err: any) {
    console.error('⚠️ 创建默认单词本副本失败:', err.message);
  }
}

// 手动触发：将指定用户的所有种子单词本副本同步到最新（路由中调用）
export async function syncAllSeedForUser(userId: string): Promise<void> {
  const allSeeds = loadAllSeedData();
  if (allSeeds.length === 0) return;

  const userCopies = await queryAll(
    "SELECT id, source_name FROM wordbooks WHERE user_id = $1 AND source_type = $2",
    [userId, 'seed']
  );

  if (userCopies.length === 0) {
    await copySeedToUser(userId);
  } else {
    for (const copy of userCopies) {
      const seed = allSeeds.find(s => s.name === copy.source_name);
      if (seed) {
        await syncUserSeedCopy(userId, copy.id, seed.data);
      }
    }
  }
}

// 同步系统级所有种子单词本（真源），并在 initDatabase 时调用
export async function ensureSeedWordbook(): Promise<void> {
  try {
    const allSeeds = loadAllSeedData();
    if (allSeeds.length === 0) {
      console.log('🌱 未发现种子数据，跳过默认单词本同步');
      return;
    }

    // 1. 确保系统用户存在（持有真源单词本，不会被用来登录）
    const existingUser = await queryOne('SELECT id FROM users WHERE id = $1', [SEED_USER_ID]);
    if (!existingUser) {
      await exec(
        'INSERT INTO users (id, email, password_hash, nickname) VALUES ($1, $2, $3, $4)',
        [SEED_USER_ID, 'seed-system@vocabulario.local', 'SEED_SYSTEM_PLACEHOLDER', '系统默认']
      );
    }

    // 2. 遍历每个种子单词本
    for (const { name, id, data } of allSeeds) {
      // 2a. 确保系统级单词本存在
      const existingWb = await queryOne('SELECT id FROM wordbooks WHERE id = $1', [id]);
      if (!existingWb) {
        await exec(
          'INSERT INTO wordbooks (id, user_id, name, source_type, source_name, course_tag, card_count) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, SEED_USER_ID, data.wordbook?.name || name, 'seed', name, data.wordbook?.courseTag || '默认', 0]
        );
      } else {
        // 更新名称与标签（改名即同步）
        await exec(
          'UPDATE wordbooks SET name = $1, course_tag = $2, updated_at = NOW() WHERE id = $3',
          [data.wordbook?.name || name, data.wordbook?.courseTag || '默认', id]
        );
      }

      // 2b. 重建系统真源卡片
      await transaction(async (client) => {
        await client.query(
          'DELETE FROM example_sentences WHERE card_id IN (SELECT id FROM word_cards WHERE wordbook_id = $1)',
          [id]
        );
        await client.query('DELETE FROM word_cards WHERE wordbook_id = $1', [id]);
        await insertSeedCards(client, id, SEED_USER_ID, data);
      });
      await exec(
        'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
        [id]
      );

      // 2c. 增量同步到所有已有用户的私人副本
      await syncAllUserSeedCopies(name, data);

      console.log(`🌱 "${name}" 已同步，共 ${(data.words || []).length} 词`);
    }
  } catch (err: any) {
    console.error('⚠️ 默认单词本同步失败:', err.message);
  }
}

// 默认导出：生产环境为 null（不直接暴露连接），本地为 db 实例
// 如需直接访问底层连接，建议通过 query/exec 函数操作
export default usePostgres ? null : getSqliteDb();
