import { Pool, PoolClient } from 'pg';

// ─── 连接池配置 ───
// Railway 会自动注入 DATABASE_URL
// 本地开发可手动设置 DATABASE_URL 或通过独立参数连接
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 可选：如果没有 DATABASE_URL，可使用独立参数
  ...(process.env.DATABASE_URL
    ? {}
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        database: process.env.PGDATABASE || 'vocabulario',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
      }),
  max: 10,
  idleTimeoutMillis: 30000,
});

// ─── 查询辅助函数 ───
export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

export async function queryAll<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function exec(text: string, params?: any[]): Promise<number> {
  const result = await pool.query(text, params);
  return result.rowCount || 0;
}

// ─── 事务辅助函数 ───
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── 初始化数据库 ───
export async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT DEFAULT '',
      tts_speed DOUBLE PRECISION DEFAULT 1.0,
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
      ease_factor DOUBLE PRECISION DEFAULT 2.5,
      "interval" INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      next_review_at TIMESTAMPTZ DEFAULT NOW(),
      last_reviewed_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT DEFAULT 'new',
      conjugation_json TEXT DEFAULT '{}',
      image_url TEXT DEFAULT '',
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
  `);

  // ─── 索引 ───
  await pool.query(`
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

  console.log('📦 PostgreSQL database initialized');
}

export default pool;
