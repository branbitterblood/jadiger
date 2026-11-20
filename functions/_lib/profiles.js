// Публичные коллекции: jadiger.com/u/<handle>
/* ---------------- публичная коллекция ---------------- */
export const RESERVED = new Set(['admin', 'api', 'jadiger', 'catalog', 'my', 'wish', 'profile', 'login', 'logout', 'settings', 'help', 'support', 'about', 'privacy', 'kz', 'uz', 'kg', 'tj', 'tm', 'og', 'pack', 'u', 'www', 'root', 'null', 'undefined']);
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
export async function ensureProfiles(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, handle TEXT UNIQUE COLLATE NOCASE, public INTEGER NOT NULL DEFAULT 0,
    show_wish INTEGER NOT NULL DEFAULT 1, title TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`).run();
}
// данные публичной коллекции: только id монет, количество и состояние — без цен, мест и заметок
export async function publicCollection(DB, handle) {
  handle = String(handle || '').toLowerCase();
  if (!HANDLE_RE.test(handle)) return null;
  await ensureProfiles(DB);
  const p = await DB.prepare('SELECT p.user_id, p.handle, p.show_wish, p.title, p.updated_at, u.name, u.created_at FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.handle = ? AND p.public = 1').bind(handle).first();
  if (!p) return null;
  const [it, wi] = await DB.batch([
    DB.prepare('SELECT coin_id, data FROM items WHERE user_id = ?').bind(p.user_id),
    DB.prepare('SELECT coin_id FROM wish WHERE user_id = ?').bind(p.user_id),
  ]);
  const items = {};
  for (const r of it.results) { try { const d = JSON.parse(r.data); if (d && d.have) items[r.coin_id] = { qty: +d.qty || 1, ...(d.cond ? { cond: String(d.cond).slice(0, 30) } : {}) }; } catch (e) {} }
  const wish = p.show_wish ? wi.results.map(r => r.coin_id).filter(id => !items[id]) : null;
  const first = String(p.name || '').trim().split(/\s+/)[0] || '';
  return { handle: p.handle, title: p.title || (first ? 'Коллекция — ' + first : 'Коллекция @' + p.handle), since: p.created_at, updated: p.updated_at, items, wish };
}

