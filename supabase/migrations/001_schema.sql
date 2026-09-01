-- ============================================================
-- DocKaro — Supabase schema
-- Run this in your Supabase project: SQL Editor → New Query
-- ============================================================

-- profiles (extends auth.users with name + plan)
CREATE TABLE IF NOT EXISTS profiles (
  id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL DEFAULT '',
  plan    TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self" ON profiles FOR ALL USING (auth.uid() = id);

-- Auto-create profile when a user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- documents
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'docx',
  title      TEXT NOT NULL DEFAULT 'Untitled document',
  content    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_self" ON documents FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, updated_at DESC);

-- templates
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  content     TEXT,
  fields      TEXT NOT NULL DEFAULT '[]',
  subject     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates_self" ON templates FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id, updated_at DESC);

-- send_logs
CREATE TABLE IF NOT EXISTS send_logs (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id TEXT,
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'sent',
  provider    TEXT NOT NULL DEFAULT 'smtp',
  sent_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE send_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "send_logs_self" ON send_logs FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_user ON send_logs(user_id, sent_at DESC);

-- unsubscribes
CREATE TABLE IF NOT EXISTS unsubscribes (
  email      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE unsubscribes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "unsubscribes_self" ON unsubscribes FOR ALL USING (auth.uid()::text = user_id);

-- api_keys
CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash   TEXT UNIQUE NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_self" ON api_keys FOR ALL USING (auth.uid() = user_id);

-- email_views (open tracking)
CREATE TABLE IF NOT EXISTS email_views (
  id             TEXT PRIMARY KEY,
  log_id         TEXT NOT NULL,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  view_token     TEXT UNIQUE NOT NULL,
  recipient      TEXT NOT NULL DEFAULT '',
  view_count     INTEGER NOT NULL DEFAULT 0,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at  TIMESTAMPTZ
);
ALTER TABLE email_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_views_self" ON email_views FOR ALL USING (auth.uid() = user_id);

-- lp_portals
CREATE TABLE IF NOT EXISTS lp_portals (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE lp_portals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lp_portals_self" ON lp_portals FOR ALL USING (auth.uid() = user_id);

-- sign_requests
CREATE TABLE IF NOT EXISTS sign_requests (
  id             TEXT PRIMARY KEY,
  doc_token      TEXT UNIQUE NOT NULL,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name    TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT NOT NULL DEFAULT '',
  doc_title      TEXT NOT NULL DEFAULT '',
  doc_content    TEXT,
  message        TEXT NOT NULL DEFAULT '',
  sig_data_url   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  ip_address     TEXT,
  signed_at      TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sign_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sign_requests_self" ON sign_requests FOR ALL USING (auth.uid() = user_id);

-- scheduled_sends
CREATE TABLE IF NOT EXISTS scheduled_sends (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload         TEXT NOT NULL,
  template_title  TEXT NOT NULL DEFAULT '',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE scheduled_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scheduled_sends_self" ON scheduled_sends FOR ALL USING (auth.uid() = user_id);
