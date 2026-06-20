import path from 'path';

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
    // 线上 PostgreSQL：只验证连接，表结构由 migration 管理
    const pool = await getPgPool();
    await pool.query('SELECT 1');
    console.log('🐘 PostgreSQL database connected');
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
}

// 默认导出：生产环境为 null（不直接暴露连接），本地为 db 实例
// 如需直接访问底层连接，建议通过 query/exec 函数操作
export default usePostgres ? null : getSqliteDb();
