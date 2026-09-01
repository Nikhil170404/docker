import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "dockaro.db");

let _db: ReturnType<typeof Database> | null = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: ReturnType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        TEXT PRIMARY KEY,
      email     TEXT UNIQUE NOT NULL,
      name      TEXT NOT NULL DEFAULT '',
      password  TEXT NOT NULL,
      plan      TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL DEFAULT 'docx',
      title      TEXT NOT NULL DEFAULT 'Untitled document',
      content    TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT,
      fields      TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS unsubscribes (
      email      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS send_logs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      template_id TEXT,
      recipient   TEXT NOT NULL,
      subject     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'sent',
      provider    TEXT NOT NULL DEFAULT 'smtp',
      sent_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_send_logs_user ON send_logs(user_id, sent_at DESC);
  `);
}
