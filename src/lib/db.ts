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

    CREATE TABLE IF NOT EXISTS api_keys (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash   TEXT UNIQUE NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      revoked    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

    CREATE TABLE IF NOT EXISTS email_views (
      id             TEXT PRIMARY KEY,
      log_id         TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      view_token     TEXT UNIQUE NOT NULL,
      recipient      TEXT NOT NULL DEFAULT '',
      view_count     INTEGER NOT NULL DEFAULT 0,
      first_viewed_at TEXT,
      last_viewed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_email_views_log ON email_views(log_id);
    CREATE INDEX IF NOT EXISTS idx_email_views_user ON email_views(user_id);

    CREATE TABLE IF NOT EXISTS lp_portals (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lp_portals_user ON lp_portals(user_id, email);

    CREATE TABLE IF NOT EXISTS sign_requests (
      id               TEXT PRIMARY KEY,
      doc_token        TEXT UNIQUE NOT NULL,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name      TEXT NOT NULL DEFAULT '',
      recipient_email  TEXT NOT NULL,
      recipient_name   TEXT NOT NULL DEFAULT '',
      doc_title        TEXT NOT NULL DEFAULT '',
      doc_content      TEXT,
      message          TEXT NOT NULL DEFAULT '',
      sig_data_url     TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      ip_address       TEXT,
      signed_at        TEXT,
      expires_at       TEXT NOT NULL,
      created_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sign_requests_user ON sign_requests(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS scheduled_sends (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      payload         TEXT NOT NULL,
      template_title  TEXT NOT NULL DEFAULT '',
      recipient_count INTEGER NOT NULL DEFAULT 0,
      scheduled_for   TEXT NOT NULL,
      sent_at         TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      error           TEXT,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_sends_user ON scheduled_sends(user_id, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_scheduled_sends_pending ON scheduled_sends(status, scheduled_for) WHERE status = 'pending';
  `);
}
