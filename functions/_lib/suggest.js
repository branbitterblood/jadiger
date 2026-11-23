// «Предложить монету»: посетитель присылает данные и два фото монеты, которой нет в каталоге.
// Фото — в R2 (sug/<id>/a.jpg, b.jpg; адрес не угадать), заявка — в D1 (таблица sug),
// владельцу сайта — сообщение в Telegram с кнопками «Принять» / «Отклонить».
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const now = () => Math.floor(Date.now() / 1000);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const IMG = 'https://img.jadiger.com';
const MAX_FILE = 8 * 1024 * 1024, PER_DAY = 12;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const CNAME = { kz: 'Казахстан', uz: 'Узбекистан', kg: 'Кыргызстан', tj: 'Таджикистан', tm: 'Туркменистан', mn: 'Монголия', su: 'СССР', ru: 'Россия', by: 'Беларусь', am: 'Армения', az: 'Азербайджан', ua: 'Украина', jp: 'Япония' };
const ST = { new: '🕓 новая', ok: '✅ принята', no: '❌ отклонена' };

export async function ensureSug(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sug (id TEXT PRIMARY KEY, created INTEGER NOT NULL, user_id TEXT, ip TEXT, lang TEXT,
      cc TEXT, country TEXT, title TEXT, year TEXT, nom TEXT, metal TEXT, size TEXT, note TEXT, contact TEXT,
      a TEXT, b TEXT, status TEXT NOT NULL DEFAULT 'new', tg_chat INTEGER, tg_msg INTEGER)`),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'),
  ]);
}
// владелец сайта = meta.admin, иначе самый первый зарегистрированный аккаунт
export async function adminId(env) {
  const first = await env.DB.prepare('SELECT id FROM users ORDER BY created_at, rowid LIMIT 1').first();
  if (first) await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('admin', ?1)").bind(String(first.id)).run();
  const a = await env.DB.prepare("SELECT v FROM meta WHERE k = 'admin'").first();
  return a ? a.v : null;
}
async function tgCall(env, method, payload, form) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, form ? { method: 'POST', body: form }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) { return { ok: false, description: String(e) }; }
}
const card = s => {
  const country = s.cc ? (CNAME[s.cc] || s.cc) : (s.country || '—');
  const rows = [['Страна', country], ['Название', s.title], ['Год', s.year], ['Номинал', s.nom], ['Металл', s.metal], ['Размер / вес', s.size], ['Комментарий', s.note], ['Контакт', s.contact]]
    .filter(r => r[1]).map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join('\n');
  return `🪙 <b>Предложена монета</b> · ${ST[s.status] || s.status}\n\n${rows}\n\n${s.user_id ? 'От пользователя сайта' : 'Без входа на сайт'} · язык ${s.lang || 'ru'}`;
};
const kb = id => ({ inline_keyboard: [[{ text: '✅ Принять', callback_data: `sg:ok:${id}` }, { text: '❌ Отклонить', callback_data: `sg:no:${id}` }]] });

// POST /api/suggest (multipart): поля + файлы a (аверс) и b (реверс). Вход на сайт не обязателен.
export async function suggestPost(ctx, user) {
  const { env, request } = ctx;
  if (!env.IMG) return json({ error: 'off' }, 503);
  await ensureSug(env);
  let f; try { f = await request.formData(); } catch (e) { return json({ error: 'bad_form' }, 400); }
  const ip = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jd-sug:' + (request.headers.get('cf-connecting-ip') || ''))).then(b => hex(b).slice(0, 24));
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM sug WHERE ip = ? AND created > ?').bind(ip, now() - 86400).first();
  if (cnt && cnt.n >= PER_DAY) return json({ error: 'too_many' }, 429);
  const s = { cc: clip(f.get('cc'), 4).toLowerCase(), country: clip(f.get('country'), 60), title: clip(f.get('title'), 200), year: clip(f.get('year'), 20),
    nom: clip(f.get('nom'), 40), metal: clip(f.get('metal'), 60), size: clip(f.get('size'), 60), note: clip(f.get('note'), 1000), contact: clip(f.get('contact'), 120), lang: clip(f.get('lang'), 4) };
  if (!CNAME[s.cc]) s.cc = '';
  if (!s.title || (!s.cc && !s.country)) return json({ error: 'fields' }, 400);
  const files = {};
  for (const k of ['a', 'b']) {
    const v = f.get(k);
    if (!v || typeof v === 'string') return json({ error: 'photos' }, 400);
    if (!TYPES[v.type] || v.size > MAX_FILE || v.size < 2000) return json({ error: 'photo_type' }, 400);
    files[k] = v;
  }
  const rnd = new Uint8Array(12); crypto.getRandomValues(rnd); const id = hex(rnd);
  const keys = {};
  for (const k of ['a', 'b']) {
    keys[k] = `sug/${id}/${k}.${TYPES[files[k].type]}`;
    await env.IMG.put(keys[k], await files[k].arrayBuffer(), { httpMetadata: { contentType: files[k].type, cacheControl: 'private, max-age=86400' } });
  }
  Object.assign(s, { id, created: now(), user_id: user ? String(user.id) : null, ip, a: keys.a, b: keys.b, status: 'new' });
  await env.DB.prepare(`INSERT INTO sug (id, created, user_id, ip, lang, cc, country, title, year, nom, metal, size, note, contact, a, b)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, s.created, s.user_id, ip, s.lang, s.cc, s.country, s.title, s.year, s.nom, s.metal, s.size, s.note, s.contact, s.a, s.b).run();
  ctx.waitUntil(tellAdmin(env, s, files));
  return json({ ok: true, id });
}

async function tellAdmin(env, s, files) {
  try {
    const adm = await adminId(env); if (!adm) return;
    const row = await env.DB.prepare('SELECT chat_id FROM tg WHERE user_id = ?').bind(adm).first().catch(() => null);
    if (!row) return;
    const fd = new FormData(); fd.append('chat_id', String(row.chat_id));
    fd.append('media', JSON.stringify([{ type: 'photo', media: 'attach://a', caption: 'Аверс' }, { type: 'photo', media: 'attach://b', caption: 'Реверс' }]));
    fd.append('a', files.a, 'a'); fd.append('b', files.b, 'b');
    await tgCall(env, 'sendMediaGroup', null, fd);
    const r = await tgCall(env, 'sendMessage', { chat_id: row.chat_id, text: card(s), parse_mode: 'HTML', reply_markup: kb(s.id) });
    if (r.ok) await env.DB.prepare('UPDATE sug SET tg_chat = ?, tg_msg = ? WHERE id = ?').bind(row.chat_id, r.result.message_id, s.id).run();
  } catch (e) {}
}

async function setStatus(env, id, st) {
  await env.DB.prepare('UPDATE sug SET status = ? WHERE id = ?').bind(st, id).run();
  const s = await env.DB.prepare('SELECT * FROM sug WHERE id = ?').bind(id).first();
  if (!s) return null;
  if (s.tg_chat && s.tg_msg) await tgCall(env, 'editMessageText', { chat_id: s.tg_chat, message_id: s.tg_msg, text: card(s), parse_mode: 'HTML', reply_markup: st === 'new' ? kb(id) : { inline_keyboard: [] } });
  if (st === 'ok' && s.user_id) {   // автору (если вошёл на сайт и подключил Telegram) — спасибо
    const u = await env.DB.prepare('SELECT chat_id, lang FROM tg WHERE user_id = ?').bind(s.user_id).first().catch(() => null);
    if (u) {
      const t = u.lang === 'en' ? `Thank you! Your coin “${esc(s.title)}” has been accepted and will appear in the Jadiger catalog soon.`
        : u.lang === 'kk' ? `Рақмет! Сіз ұсынған «${esc(s.title)}» монетасы қабылданды, жақында Jadiger каталогында пайда болады.`
        : `Спасибо! Предложенная вами монета «${esc(s.title)}» принята и скоро появится в каталоге Jadiger.`;
      await tgCall(env, 'sendMessage', { chat_id: u.chat_id, text: t, parse_mode: 'HTML' });
    }
  }
  return s;
}

// кнопки под сообщением в Telegram (вызывается из вебхука бота)
export async function suggestCallback(env, cq) {
  const m = /^sg:(ok|no):([0-9a-f]{24})$/.exec(cq.data || '');
  if (!m) return false;
  await ensureSug(env);
  const adm = await adminId(env);
  const row = adm && await env.DB.prepare('SELECT chat_id FROM tg WHERE user_id = ?').bind(adm).first();
  if (!row || !cq.from || row.chat_id !== cq.from.id) { await tgCall(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Только для владельца сайта' }); return true; }
  const s = await setStatus(env, m[2], m[1]);
  await tgCall(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: s ? (m[1] === 'ok' ? 'Принята' : 'Отклонена') : 'Заявка не найдена' });
  return true;
}

// для владельца сайта: GET /api/suggest — список; POST /api/suggest/<id> {status} — изменить статус
export async function suggestAdmin(ctx, path, m, uid) {
  if (path !== 'suggest' && !path.startsWith('suggest/')) return null;
  const { env, request } = ctx;
  await ensureSug(env);
  if (await adminId(env) !== String(uid)) return json({ error: 'forbidden' }, 403);
  if (path === 'suggest' && m === 'GET') {
    const r = await env.DB.prepare('SELECT id, created, user_id, lang, cc, country, title, year, nom, metal, size, note, contact, a, b, status FROM sug ORDER BY created DESC LIMIT 300').all();
    return json({ items: r.results.map(x => ({ ...x, a: `${IMG}/${x.a}`, b: `${IMG}/${x.b}`, user_id: !!x.user_id })) });
  }
  const id = path.split('/')[1];
  if (m === 'POST' && /^[0-9a-f]{24}$/.test(id)) {
    const b = await request.json().catch(() => ({}));
    if (!['new', 'ok', 'no'].includes(b.status)) return json({ error: 'status' }, 400);
    return json({ ok: !!(await setStatus(env, id, b.status)) });
  }
  return null;
}
