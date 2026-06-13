import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '..', 'data', 'vocabulario.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: Database.Database = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrateColumns(): void {
  // 兼容旧数据库：添加新列
  const migrations = [
    { table: 'big_modules', col: 'content_type', def: "TEXT DEFAULT 'vocabulary'" },
    { table: 'big_modules', col: 'content_type_label', def: "TEXT DEFAULT '词汇与造句'" },
    { table: 'big_modules', col: 'language', def: "TEXT DEFAULT ''" },
    { table: 'module_tasks', col: 'task_data', def: "TEXT DEFAULT '{}'" },
    { table: 'users', col: 'tts_speed', def: "REAL DEFAULT 1.0" },
    { table: 'big_modules', col: 'linked_wordbook_id', def: 'TEXT' },
  ];
  for (const m of migrations) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as any[];
      if (!cols.some((c: any) => c.name === m.col)) {
        db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.col} ${m.def}`);
        console.log(`📦 [Migration] ${m.table}.${m.col} added`);
      }
    } catch { /* ignore */ }
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT DEFAULT '',
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

  // 运行列迁移
  migrateColumns();
}

export default db;
