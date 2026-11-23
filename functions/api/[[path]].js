// Jadiger API — Cloudflare Pages Functions
// Вход только через Google: браузер получает ID-токен (Google Identity Services),
// сервер проверяет подпись по ключам Google и выдаёт свою сессию в HttpOnly-cookie.

import { RESERVED, HANDLE_RE, ensureProfiles, publicCollection } from '../_lib/profiles.js';
import { tgPublic, tgUser } from '../_lib/tg.js';
import { imgRoutes } from '../_lib/img.js';
import { suggestPost, suggestAdmin } from '../_lib/suggest.js';

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

/* ---------------- курсы валют Нацбанка РК ---------------- */
const RATES_FALLBACK = { date: '21.11.2026', kz: 1, usd: 455, uz: 0.038, kg: 5.2, tj: 49.73, tm: 130, mn: 0.13, ru: 6.3, by: 155, am: 1.18, az: 267 };
async function ratesOn(iso, ctx, noCache) {
  const ck = new Request('https://jadiger.com/__rates/' + iso);
  if (!noCache) { const hit = await caches.default.match(ck); if (hit) return hit.json(); }
  for (let back = 0; back < 6; back++) {   // в выходные и праздники берём ближайший предыдущий курс
    const d = new Date(Date.parse(iso + 'T12:00:00Z') - back * 86400e3);
    const ds = [d.getUTCDate(), d.getUTCMonth() + 1].map(x => String(x).padStart(2, '0')).join('.') + '.' + d.getUTCFullYear();
    try {
      const r = await fetch('https://nationalbank.kz/rss/get_rates.cfm?fdate=' + ds, { cf: { cacheTtl: 3600 } }); if (!r.ok) continue;
      const x = await r.text(), rate = code => { const mm = new RegExp('<title>' + code + '</title>\\s*<description>([\\d.]+)</description>\\s*<quant>(\\d+)</quant>').exec(x); return mm ? +mm[1] / +mm[2] : null; };
      const usd = rate('USD'); if (!usd) continue;
      const out = { date: ds, kz: 1, usd, uz: rate('UZS') || RATES_FALLBACK.uz, kg: rate('KGS') || RATES_FALLBACK.kg, tj: rate('TJS') || RATES_FALLBACK.tj, tm: rate('TMT') || usd / 3.5, mn: rate('MNT') || usd / 3500, ru: rate('RUB') || RATES_FALLBACK.ru, by: rate('BYN') || RATES_FALLBACK.by, am: rate('AMD') || RATES_FALLBACK.am, az: rate('AZN') || RATES_FALLBACK.az, src: 'Национальный банк РК' };
      if (!noCache && ctx) ctx.waitUntil(caches.default.put(ck, new Response(JSON.stringify(out), { headers: { 'cache-control': 'public, max-age=31536000' } })));
      return out;
    } catch (e) {}
  }
  return null;
}

const EVENTS = new Set(['suggest', 'suggest_open', 'visit', 'open3d', 'flip', 'add', 'wish', 'share', 'photo_id', 'lang_en', 'lang_kk', 'buy', 'lead']);
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
    // анонимная статистика действий: счётчики по дням, без привязки к людям и устройствам
    if (path === 'ev' && m === 'POST') {
      let e = ''; try { e = String((await req.json()).e || ''); } catch (x) {}
      if (!EVENTS.has(e)) return json({ ok: false });
      const day = new Date().toISOString().slice(0, 10);
      const up = () => env.DB.prepare('INSERT INTO ev (day, name, n) VALUES (?1, ?2, 1) ON CONFLICT(day, name) DO UPDATE SET n = n + 1').bind(day, e).run();
      try { await up(); } catch (x) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS ev (day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, name))').run(); await up(); }
      return json({ ok: true });
    }
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

    // официальные курсы Нацбанка РК: тенге за единицу валюты.
    // /api/rates — на сегодня (кэш 6 часов); /api/rates?dates=2025-04-02,2026-02-02 — на даты покупок (прошлое не меняется, кэш навсегда)
    if (path === 'rates' && m === 'GET') {
      const list = (url.searchParams.get('dates') || '').split(',').filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).slice(0, 80);
      if (list.length) {
        const out = {};
        await Promise.all([...new Set(list)].map(async d => { out[d] = await ratesOn(d, ctx); }));
        return json(out, 200, { 'cache-control': 'public, max-age=86400' });
      }
      const cache = caches.default, ck = new Request(url.origin + '/api/rates?v=1');
      const hit = await cache.match(ck); if (hit) return hit;
      const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
      const r = await ratesOn(today, ctx, true);
      const res = json(r || { ...RATES_FALLBACK, src: 'Национальный банк РК (сохранённые курсы)' }, 200, { 'cache-control': 'public, max-age=21600' });
      if (r) ctx.waitUntil(cache.put(ck, res.clone()));
      return res;
    }

    if (seg[0] === 'u' && seg.length === 2 && m === 'GET') {
      const pc = await publicCollection(env.DB, seg[1]);
      if (!pc) return err(404, 'not_found', 'Коллекция не найдена или скрыта владельцем');
      return json(pc, 200, { 'cache-control': 'public, max-age=60' });
    }

    // Telegram: вебхук бота, рассылка после обновления каталога, установка вебхука
    { const r = await tgPublic(ctx, path, m); if (r) return r; }
    { const r = await imgRoutes(ctx, path, m); if (r) return r; }   // синхронизация фото монет в R2

    const user = await currentUser(req, env);
    if (path === 'suggest' && m === 'POST') return suggestPost(ctx, user);   // «Предложить монету» — можно без входа
    if (path === 'me' && m === 'GET') return json({ user: publicUser(user) || null });
    if (!user) return err(401, 'login_required', 'Войдите через Google');
    const uid = user.id;
    { const r = await tgUser(ctx, path, m, uid); if (r) return r; }
    { const r = await suggestAdmin(ctx, path, m, uid); if (r) return r; }

    // сводка для владельца сайта (/stats.html)
    if (path === 'stats' && m === 'GET') {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)').run();
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS ev (day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, name))').run();
      // владелец = самый первый зарегистрированный аккаунт (если в meta не задан явно)
      const first = await env.DB.prepare('SELECT id FROM users ORDER BY created_at, rowid LIMIT 1').first();
      if (first) await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('admin', ?1)").bind(String(first.id)).run();
      const adm = await env.DB.prepare("SELECT v FROM meta WHERE k = 'admin'").first();
      if (!adm || adm.v !== String(uid)) return err(403, 'forbidden', 'Только для владельца сайта');
      const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      const [ev, us, it, wi, pr] = await env.DB.batch([
        env.DB.prepare('SELECT day, name, n FROM ev WHERE day >= ?1 ORDER BY day').bind(since),
        env.DB.prepare('SELECT COUNT(*) AS n, SUM(created_at >= ?1) AS d7, SUM(last_login >= ?1) AS a7 FROM users').bind(Math.floor(Date.now() / 1000) - 7 * 86400),
        env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS u, COUNT(*) AS n FROM items'),
        env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS u, COUNT(*) AS n FROM wish'),
        env.DB.prepare('SELECT COUNT(*) AS n FROM profiles'),
      ]);
      return json({ events: ev.results, users: us.results[0], items: it.results[0], wish: wi.results[0], profiles: pr.results[0] });
    }

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

    // свои фото экземпляров: файлы в R2 (бинд PHOTOS), в D1 — только отметка с версией.
    // Старые записи (data:URL прямо в D1) переносятся в R2 при первом чтении.
    if (seg[0] === 'photos' && (seg.length === 2 || (seg.length === 3 && seg[2] === 'img'))) {
      const id = coinId(seg[1]); if (id === null) return err(400, 'bad_id', 'Неверный id');
      const key = `p/${uid}/${id}`, R2 = env.PHOTOS;
      const fromDataUrl = src => { const mt = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(src); const bin = atob(mt[2]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return { type: mt[1], bytes: u8 }; };
      const save = async src => { const f = fromDataUrl(src); await R2.put(key, f.bytes, { httpMetadata: { contentType: f.type } }); const v = 'r2:' + Date.now(); await env.DB.prepare(`INSERT INTO photos (user_id, coin_id, src) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, coin_id) DO UPDATE SET src = ?3`).bind(uid, id, v).run(); return v; };
      if (seg.length === 3) {   // сам файл — только владельцу
        if (m !== 'GET' || !R2) return err(404, 'not_found', 'Нет фото');
        const o = await R2.get(key); if (!o) return err(404, 'not_found', 'Нет фото');
        return new Response(o.body, { headers: { 'content-type': (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
      }
      if (m === 'GET') {
        const r = await env.DB.prepare('SELECT src FROM photos WHERE user_id = ? AND coin_id = ?').bind(uid, id).first();
        if (!r) return json({ src: null });
        let v = r.src;
        if (R2 && v.startsWith('data:')) v = await save(v);          // ленивый перенос из D1 в R2
        return json({ src: v.startsWith('r2:') ? `/api/photos/${id}/img?v=${v.slice(3)}` : v });
      }
      if (m === 'PUT') {
        const { src } = await body(req, MAX_PHOTO + 100);
        if (typeof src !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || src.length > MAX_PHOTO) return err(400, 'bad_photo', 'Нужна картинка JPEG/PNG/WebP до ~1 МБ');
        if (R2) await save(src);
        else await env.DB.prepare(`INSERT INTO photos (user_id, coin_id, src) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, coin_id) DO UPDATE SET src = ?3`).bind(uid, id, src).run();
        return json({ ok: true });
      }
      if (m === 'DELETE') { if (R2) await R2.delete(key); await env.DB.prepare('DELETE FROM photos WHERE user_id = ? AND coin_id = ?').bind(uid, id).run(); return json({ ok: true }); }
    }

    if (path === 'identify' && m === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return err(503, 'not_configured', 'Распознавание не настроено');
      const day = new Date().toISOString().slice(0, 10), lim = +(env.AI_DAILY_LIMIT || 10);
      const budget = +(env.AI_DAILY_BUDGET_USD || 3);   // общий потолок расходов на весь сайт в сутки (UTC)
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS ai_budget (day TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)').run();
      const spent = await env.DB.prepare('SELECT usd FROM ai_budget WHERE day = ?').bind(day).first();
      if (spent && spent.usd >= budget) return err(429, 'budget', 'Дневной лимит распознаваний на сайте исчерпан — попробуйте завтра');
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
          // инструкция + каталог одинаковы для всех запросов → кэшируются, повторные чтения в ~10 раз дешевле
          system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mt[1], data: mt[2] } },
            { type: 'text', text: 'Определи монету на этом фото по каталогу из инструкции. Ответь только JSON.' },
          ] }],
        }),
      });
      if (!r.ok) return err(502, 'ai_failed', 'Сервис распознавания ответил ' + r.status);
      const out = await r.json();
      // учёт расходов по фактическим токенам (цены $ за 1 млн токенов задаются в wrangler.toml)
      const u = out.usage || {}, P = k => +(env[k] || 0) / 1e6;
      const usd = (u.input_tokens || 0) * P('AI_PRICE_IN') + (u.output_tokens || 0) * P('AI_PRICE_OUT')
        + (u.cache_creation_input_tokens || 0) * P('AI_PRICE_CACHE_WRITE') + (u.cache_read_input_tokens || 0) * P('AI_PRICE_CACHE_READ');
      await env.DB.prepare('INSERT INTO ai_budget (day, usd, calls) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1').bind(day, usd).run();
      const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      let parsed = {}; try { parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch (e) {}
      return json(parsed);
    }

    if (path === 'profile') {
      await ensureProfiles(env.DB);
      if (m === 'GET') {
        const p = await env.DB.prepare('SELECT handle, public, show_wish, title FROM profiles WHERE user_id = ?').bind(uid).first();
        let suggest = String(user.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[_-]+/, '').slice(0, 30);
        if (suggest.length < 3 || RESERVED.has(suggest)) suggest = '';
        if (suggest && await env.DB.prepare('SELECT 1 FROM profiles WHERE handle = ? AND user_id != ?').bind(suggest, uid).first()) suggest = '';
        return json(p ? { handle: p.handle, public: !!p.public, showWish: !!p.show_wish, title: p.title, suggest } : { handle: '', public: false, showWish: true, title: '', suggest });
      }
      if (m === 'PUT') {
        const b = await body(req, 4000);
        const handle = String(b.handle || '').trim().toLowerCase();
        if (!HANDLE_RE.test(handle)) return err(400, 'bad_handle', 'Адрес: 3–30 символов, латиница, цифры, «-» и «_», начинается с буквы или цифры');
        if (RESERVED.has(handle)) return err(400, 'reserved', 'Этот адрес занят системой, выберите другой');
        const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const taken = await env.DB.prepare('SELECT 1 FROM profiles WHERE handle = ? AND user_id != ?').bind(handle, uid).first();
        if (taken) return err(409, 'taken', 'Адрес jadiger.com/u/' + handle + ' уже занят');
        await env.DB.prepare(`INSERT INTO profiles (user_id, handle, public, show_wish, title, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
          ON CONFLICT(user_id) DO UPDATE SET handle = ?2, public = ?3, show_wish = ?4, title = ?5, updated_at = ?6`)
          .bind(uid, handle, b.public ? 1 : 0, b.showWish === false ? 0 : 1, title, now()).run();
        return json({ ok: true, handle });
      }
    }

    if (path === 'account' && m === 'DELETE') {
      await ensureProfiles(env.DB);
      if (env.PHOTOS) { let cur; do { const l = await env.PHOTOS.list({ prefix: `p/${uid}/`, cursor: cur }); if (l.objects.length) await env.PHOTOS.delete(l.objects.map(o => o.key)); cur = l.truncated ? l.cursor : null; } while (cur); }
      await env.DB.batch(['items', 'wish', 'photos', 'ai_usage', 'sessions', 'profiles'].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid))
        .concat([env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid)]));
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, secure) });
    }

    return err(404, 'not_found', 'Нет такого метода');
  } catch (e) {
    return err(e.status || 500, e.message || 'error', e.status ? e.message : 'Ошибка сервера');
  }
}
