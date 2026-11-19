// Jadiger API — Cloudflare Pages Functions
// Вход только через Google: браузер получает ID-токен (Google Identity Services),
// сервер проверяет подпись по ключам Google и выдаёт свою сессию в HttpOnly-cookie.

const COOKIE = 'jd_sess';
const SESSION_DAYS = 90;
const MAX_COIN_ID = 100000;
const MAX_REC = 4000;            // байт JSON на одну запись коллекции
const MAX_PHOTO = 1_600_000;     // символов data:URL

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const err = (status, code, message) => json({ error: code, message }, status);

/* ---------------- утилиты ---------------- */
const b64urlToBytes = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlToJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomToken = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return hex(a); };
const now = () => Math.floor(Date.now() / 1000);

function getCookie(req, name) {
  const h = req.headers.get('cookie') || '';
  for (const part of h.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return null;
}
function sessionCookie(token, maxAge, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/* ---------------- проверка ID-токена Google ---------------- */
let jwksCache = { at: 0, keys: null, url: null };
async function googleKeys(env) {
  const url = env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
  if (jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(url); if (!r.ok) throw new Error('jwks ' + r.status);
  const { keys } = await r.json();
  jwksCache = { at: Date.now(), keys, url };
  return keys;
}
async function verifyGoogleIdToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('format');
  const header = b64urlToJson(parts[0]), payload = b64urlToJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('alg');
  let keys = await googleKeys(env), jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { jwksCache.keys = null; keys = await googleKeys(env); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('signature');
  const issOk = ['accounts.google.com', 'https://accounts.google.com'].concat(env.GOOGLE_ISS_EXTRA ? [env.GOOGLE_ISS_EXTRA] : []);
  if (!issOk.includes(payload.iss)) throw new Error('iss');
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new Error('aud');
  if (!(payload.exp > now() - 60)) throw new Error('exp');
  if (!payload.sub) throw new Error('sub');
  if (payload.email && payload.email_verified === false) throw new Error('email_unverified');
  return payload;
}

/* ---------------- сессия ---------------- */
async function currentUser(req, env) {
  const tok = getCookie(req, COOKIE); if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.picture, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(await sha256(tok)).first();
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}
const publicUser = u => u && ({ name: u.name || '', email: u.email || '', picture: u.picture || '' });

const coinId = s => { const n = Number(s); return Number.isInteger(n) && n >= 0 && n < MAX_COIN_ID ? n : null; };
async function body(req, limit = 2_000_000) {
  const t = await req.text(); if (t.length > limit) throw Object.assign(new Error('too_large'), { status: 413 });
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw Object.assign(new Error('bad_json'), { status: 400 }); }
}

/* ---------------- маршруты ---------------- */
export async function onRequest(ctx) {
  const { request: req, env } = ctx;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const seg = path.split('/');
  const m = req.method;
  const secure = url.protocol === 'https:';

  // защита от CSRF: изменяющие запросы только со своего сайта
  if (m !== 'GET' && m !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return err(403, 'bad_origin', 'Запрос с чужого сайта');
  }

  try {
    if (path === 'config' && m === 'GET')
      return json({ googleClientId: env.GOOGLE_CLIENT_ID || '', identify: !!env.ANTHROPIC_API_KEY });

    if (path === 'auth/google' && m === 'POST') {
      if (!env.GOOGLE_CLIENT_ID) return err(500, 'not_configured', 'GOOGLE_CLIENT_ID не задан');
      const { credential } = await body(req, 10000);
      let p; try { p = await verifyGoogleIdToken(credential, env); } catch (e) { return err(401, 'bad_token', 'Google не подтвердил вход: ' + e.message); }
      const t = now();
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, picture, created_at, last_login) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3, picture = ?4, last_login = ?5`
      ).bind(p.sub, p.email || '', p.name || '', p.picture || '', t).run();
      const tok = randomToken();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(p.sub, t),
        env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(tok), p.sub, t + SESSION_DAYS * 86400),
      ]);
      return json({ user: publicUser({ email: p.email, name: p.name, picture: p.picture }) }, 200, { 'set-cookie': sessionCookie(tok, SESSION_DAYS * 86400, secure) });
    }

    if (path === 'auth/logout' && m === 'POST') {
      const tok = getCookie(req, COOKIE);
      if (tok) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(tok)).run();
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, secure) });
    }

    const user = await currentUser(req, env);
    if (path === 'me' && m === 'GET') return json({ user: publicUser(user) || null });
    if (!user) return err(401, 'login_required', 'Войдите через Google');
    const uid = user.id;

    if (path === 'state' && m === 'GET') {
      const [it, wi] = await env.DB.batch([
        env.DB.prepare('SELECT coin_id, data FROM items WHERE user_id = ?').bind(uid),
        env.DB.prepare('SELECT coin_id, added_at FROM wish WHERE user_id = ?').bind(uid),
      ]);
      const items = {}, wish = {};
      for (const r of it.results) { try { items[r.coin_id] = JSON.parse(r.data); } catch (e) {} }
      for (const r of wi.results) wish[r.coin_id] = { added: r.added_at };
      return json({ items, wish });
    }

    if (seg[0] === 'items' && seg.length === 2) {
      const id = coinId(seg[1]); if (id === null) return err(400, 'bad_id', 'Неверный id');
      if (m === 'PUT') {
        const rec = await body(req, MAX_REC);
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return err(400, 'bad_rec', 'Неверные данные');
        const data = JSON.stringify(rec); if (data.length > MAX_REC) return err(413, 'too_large', 'Слишком длинная запись');
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO items (user_id, coin_id, data, updated_at) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(user_id, coin_id) DO UPDATE SET data = ?3, updated_at = ?4`).bind(uid, id, data, Date.now()),
          env.DB.prepare('DELETE FROM wish WHERE user_id = ? AND coin_id = ?').bind(uid, id), // купил — убираем из вишлиста
        ]);
        return json({ ok: true });
      }
      if (m === 'DELETE') { await env.DB.prepare('DELETE FROM items WHERE user_id = ? AND coin_id = ?').bind(uid, id).run(); return json({ ok: true }); }
    }

    if (path === 'wish/bulk' && m === 'POST') {
      const { ids } = await body(req, 100000);
      const list = (Array.isArray(ids) ? ids : []).map(coinId).filter(x => x !== null).slice(0, 2000);
      const t = Date.now();
      if (list.length) await env.DB.batch(list.map(id => env.DB.prepare('INSERT OR IGNORE INTO wish (user_id, coin_id, added_at) VALUES (?, ?, ?)').bind(uid, id, t)));
      return json({ ok: true, added: list.length });
    }
    if (seg[0] === 'wish' && seg.length === 2) {
      const id = coinId(seg[1]); if (id === null) return err(400, 'bad_id', 'Неверный id');
      if (m === 'PUT') { await env.DB.prepare('INSERT OR IGNORE INTO wish (user_id, coin_id, added_at) VALUES (?, ?, ?)').bind(uid, id, Date.now()).run(); return json({ ok: true }); }
      if (m === 'DELETE') { await env.DB.prepare('DELETE FROM wish WHERE user_id = ? AND coin_id = ?').bind(uid, id).run(); return json({ ok: true }); }
    }

    if (seg[0] === 'photos' && seg.length === 2) {
      const id = coinId(seg[1]); if (id === null) return err(400, 'bad_id', 'Неверный id');
      if (m === 'GET') { const r = await env.DB.prepare('SELECT src FROM photos WHERE user_id = ? AND coin_id = ?').bind(uid, id).first(); return json({ src: r ? r.src : null }); }
      if (m === 'PUT') {
        const { src } = await body(req, MAX_PHOTO + 100);
        if (typeof src !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || src.length > MAX_PHOTO) return err(400, 'bad_photo', 'Нужна картинка JPEG/PNG/WebP до ~1 МБ');
        await env.DB.prepare(`INSERT INTO photos (user_id, coin_id, src) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, coin_id) DO UPDATE SET src = ?3`).bind(uid, id, src).run();
        return json({ ok: true });
      }
      if (m === 'DELETE') { await env.DB.prepare('DELETE FROM photos WHERE user_id = ? AND coin_id = ?').bind(uid, id).run(); return json({ ok: true }); }
    }

    if (path === 'identify' && m === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return err(503, 'not_configured', 'Распознавание не настроено');
      const day = new Date().toISOString().slice(0, 10), lim = +(env.AI_DAILY_LIMIT || 30);
      const used = await env.DB.prepare('SELECT n FROM ai_usage WHERE user_id = ? AND day = ?').bind(uid, day).first();
      if (used && used.n >= lim) return err(429, 'rate_limited', `Лимит ${lim} распознаваний в день`);
      const { prompt, image } = await body(req, 3_000_000);
      const mt = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
      if (!mt || typeof prompt !== 'string' || prompt.length > 120000) return err(400, 'bad_input', 'Нужны фото и запрос');
      await env.DB.prepare(`INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1`).bind(uid, day).run();
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 800,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mt[1], data: mt[2] } },
            { type: 'text', text: prompt },
          ] }],
        }),
      });
      if (!r.ok) return err(502, 'ai_failed', 'Сервис распознавания ответил ' + r.status);
      const out = await r.json();
      const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      let parsed = {}; try { parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch (e) {}
      return json(parsed);
    }

    if (path === 'account' && m === 'DELETE') {
      await env.DB.batch(['items', 'wish', 'photos', 'ai_usage', 'sessions'].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid))
        .concat([env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid)]));
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, secure) });
    }

    return err(404, 'not_found', 'Нет такого метода');
  } catch (e) {
    return err(e.status || 500, e.message || 'error', e.status ? e.message : 'Ошибка сервера');
  }
}
