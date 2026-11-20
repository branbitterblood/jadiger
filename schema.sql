-- Jadiger: схема базы D1
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- Google "sub"
  email TEXT, name TEXT, picture TEXT,
  created_at INTEGER NOT NULL, last_login INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,    -- sha256 от токена из cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS items (     -- моя коллекция
  user_id TEXT NOT NULL, coin_id INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, coin_id)
);
CREATE TABLE IF NOT EXISTS wish (      -- вишлист
  user_id TEXT NOT NULL, coin_id INTEGER NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, coin_id)
);
CREATE TABLE IF NOT EXISTS photos (    -- свои фото экземпляров (data:URL, до ~1.5 МБ)
  user_id TEXT NOT NULL, coin_id INTEGER NOT NULL, src TEXT NOT NULL,
  PRIMARY KEY (user_id, coin_id)
);
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- общий дневной бюджет распознавания (создаётся и автоматически при первом запросе)
CREATE TABLE IF NOT EXISTS ai_budget (day TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0);
