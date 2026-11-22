// Telegram-бот Jadiger: привязка аккаунта, уведомления о новых выпусках и о монетах из «Хочу», случайная монета.
// Токен — секрет TELEGRAM_BOT_TOKEN в настройках Cloudflare Pages (в репозитории его нет).
const SITE = 'https://jadiger.com';
const CCS = ['kz', 'uz', 'kg', 'tj', 'tm', 'mn', 'su', 'ru', 'by'];
const PFX = { ru: '', en: '/en', kk: '/kk' };
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const now = () => Math.floor(Date.now() / 1000);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fmtN = n => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const T = {
  ru: {
    hello: 'Привет! Я бот каталога монет <b>Jadiger</b>.\n\nЯ присылаю:\n• новые выпуски нацбанков, как только они появляются в каталоге;\n• сообщение, когда монета из вашего списка «Хочу» поступает в продажу.\n\nЧтобы подключить уведомления, откройте <a href="{site}/#profile">Личный кабинет</a> на jadiger.com и нажмите «Подключить Telegram».\n\n/coin — случайная монета',
    linked: 'Готово! Telegram подключён к вашему аккаунту Jadiger.\n\nБуду присылать новые выпуски и монеты из «Хочу», которые поступят в продажу. Страны и типы уведомлений можно выбрать в <a href="{site}/#profile">Личном кабинете</a>.\n\n/coin — случайная монета · /stop — отключить',
    badcode: 'Ссылка устарела. Откройте Личный кабинет на jadiger.com и нажмите «Подключить Telegram» ещё раз.',
    stopped: 'Уведомления отключены. Подключить снова можно в Личном кабинете на jadiger.com.',
    notlinked: 'Этот чат не подключён к аккаунту Jadiger.',
    help: '/coin — случайная монета\n/stop — отключить уведомления\n\nНастройки — в <a href="{site}/#profile">Личном кабинете</a> на jadiger.com',
    unlinked: 'Telegram отключён от аккаунта Jadiger на сайте.',
    newh: n => n === 1 ? '🆕 Новый выпуск в каталоге:' : '🆕 Новые выпуски в каталоге:',
    wishh: '⭐ Из вашего списка «Хочу» — теперь в продаже у нацбанка:',
    more: n => `…и ещё ${n}`, all: 'Все новинки на сайте', price: 'цена',
    cmds: [['coin', 'Случайная монета'], ['help', 'Помощь'], ['stop', 'Отключить уведомления']],
  },
  kk: {
    hello: 'Сәлем! Мен <b>Jadiger</b> монеталар каталогының ботымын.\n\nМен жіберемін:\n• ұлттық банктердің жаңа шығарылымдарын, каталогқа түсе салысымен;\n• «Қалаймын» тізіміңіздегі монета сатылымға шыққанда хабар.\n\nХабарламаларды қосу үшін jadiger.com сайтындағы <a href="{site}/kk/#profile">Жеке кабинетті</a> ашып, «Telegram қосу» батырмасын басыңыз.\n\n/coin — кездейсоқ монета',
    linked: 'Дайын! Telegram Jadiger аккаунтыңызға қосылды.\n\nЖаңа шығарылымдар мен «Қалаймын» тізіміндегі сатылымға шыққан монеталарды жіберемін. Елдер мен хабарлама түрлерін <a href="{site}/kk/#profile">Жеке кабинетте</a> таңдауға болады.\n\n/coin — кездейсоқ монета · /stop — өшіру',
    badcode: 'Сілтеменің мерзімі өтті. jadiger.com сайтындағы Жеке кабинетті ашып, «Telegram қосу» батырмасын қайта басыңыз.',
    stopped: 'Хабарламалар өшірілді. Қайта қосу — jadiger.com сайтындағы Жеке кабинетте.',
    notlinked: 'Бұл чат Jadiger аккаунтына қосылмаған.',
    help: '/coin — кездейсоқ монета\n/stop — хабарламаларды өшіру\n\nБаптаулар — jadiger.com сайтындағы <a href="{site}/kk/#profile">Жеке кабинетте</a>',
    unlinked: 'Telegram сайттағы Jadiger аккаунтынан ажыратылды.',
    newh: n => n === 1 ? '🆕 Каталогта жаңа шығарылым:' : '🆕 Каталогта жаңа шығарылымдар:',
    wishh: '⭐ «Қалаймын» тізіміңізден — енді ұлттық банкте сатылымда:',
    more: n => `…тағы ${n}`, all: 'Барлық жаңалықтар сайтта', price: 'бағасы',
    cmds: [['coin', 'Кездейсоқ монета'], ['help', 'Көмек'], ['stop', 'Хабарламаларды өшіру']],
  },
  en: {
    hello: 'Hi! I am the bot of the <b>Jadiger</b> coin catalog.\n\nI send:\n• new central bank issues as soon as they appear in the catalog;\n• a message when a coin from your wishlist goes on sale.\n\nTo turn on notifications, open <a href="{site}/en/#profile">My account</a> on jadiger.com and tap “Connect Telegram”.\n\n/coin — a random coin',
    linked: 'Done! Telegram is connected to your Jadiger account.\n\nI will send new issues and wishlist coins that go on sale. Choose countries and notification types in <a href="{site}/en/#profile">My account</a>.\n\n/coin — a random coin · /stop — turn off',
    badcode: 'This link has expired. Open My account on jadiger.com and tap “Connect Telegram” again.',
    stopped: 'Notifications are off. You can connect again in My account on jadiger.com.',
    notlinked: 'This chat is not connected to a Jadiger account.',
    help: '/coin — a random coin\n/stop — turn off notifications\n\nSettings are in <a href="{site}/en/#profile">My account</a> on jadiger.com',
    unlinked: 'Telegram has been disconnected from your Jadiger account.',
    newh: n => n === 1 ? '🆕 New issue in the catalog:' : '🆕 New issues in the catalog:',
    wishh: '⭐ From your wishlist — now on sale at the central bank:',
    more: n => `…and ${n} more`, all: 'All new issues on the site', price: 'price',
    cmds: [['coin', 'A random coin'], ['help', 'Help'], ['stop', 'Turn off notifications']],
  },
};
const CUR = { kz: '₸', uz: 'UZS', kg: 'KGS', tj: 'TJS', tm: 'TMT', mn: '₮', su: '', ru: '₽', by: 'BYN' };
const tx = (lang, k) => { const v = (T[lang] || T.ru)[k]; return typeof v === 'string' ? v.replaceAll('{site}', SITE) : v; };
const langOf = l => (l === 'kk' || l === 'en' ? l : l && /^(kk|kz)/.test(l) ? 'kk' : l && !/^(ru|uk|be)/.test(l) ? 'en' : 'ru');

async function api(env, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) { return { ok: false, description: String(e) }; }
}
const send = (env, chat_id, text, extra = {}) => api(env, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const hookSecret = env => sha('jadiger-tg-hook:' + env.TELEGRAM_BOT_TOKEN).then(h => h.slice(0, 48));

async function ensure(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS tg (user_id TEXT PRIMARY KEY, chat_id INTEGER NOT NULL, lang TEXT, cc TEXT NOT NULL DEFAULT \'\', new_on INTEGER NOT NULL DEFAULT 1, wish_on INTEGER NOT NULL DEFAULT 1, created INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS tg_code (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, lang TEXT, exp INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'),
  ]);
}
const getMeta = async (env, k) => { const r = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const setMeta = (env, k, v) => env.DB.prepare('INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)).run();

async function botName(env) {
  let n = await getMeta(env, 'tg_bot');
  if (!n) { const d = await api(env, 'getMe', {}); n = d.result && d.result.username; if (n) await setMeta(env, 'tg_bot', n); }
  return n;
}

// справочник монет (public/i/cat.json) и новые выпуски (public/auto/coins.js)
async function catalog(ctx) {
  const { env, request } = ctx;
  const cat = await (await env.ASSETS.fetch(new URL('/i/cat.json', request.url))).json();
  let auto = { coins: [], prices: {} };
  try { const t = await (await env.ASSETS.fetch(new URL('/auto/coins.js', request.url))).text(); auto = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) {}
  for (const c of auto.coins || []) cat[c.id] = cat[c.id] || [c.r[10] || 'kz', c.slug, c.r[0], c.r[0], c.r[0], c.price || 0, c.r[2], String(c.r[1]).slice(-4), c.photo ? 1 : 0];
  for (const [id, p] of Object.entries(auto.prices || {})) if (cat[id]) cat[id][5] = p;
  return { cat, auto };
}
const coinLine = (c, id, lang) => {
  const [cc, slug, ru, en, kk, price, nom, year] = c, title = lang === 'en' ? en : lang === 'kk' ? kk : ru;
  const p = price ? ` · ${tx(lang, 'price')} ${fmtN(price)} ${CUR[cc]}` : '';
  return `• <a href="${SITE}${PFX[lang]}/${cc}/${slug}">${esc(title)}</a> (${year}${+nom ? `, ${fmtN(nom)}` : ''})${p}`;
};

async function randomCoin(ctx, chat_id, lang) {
  const { env } = ctx; const { cat } = await catalog(ctx);
  const ids = Object.keys(cat).filter(id => cat[id][8]); const id = ids[Math.floor(Math.random() * ids.length)], c = cat[id];
  const title = lang === 'en' ? c[3] : lang === 'kk' ? c[4] : c[2];
  const link = `${SITE}${PFX[lang]}/${c[0]}/${c[1]}`;
  const btn = lang === 'en' ? 'View in 3D' : lang === 'kk' ? '3D-да көру' : 'Смотреть в 3D';
  return api(env, 'sendPhoto', { chat_id, photo: `${SITE}/og/${id}.jpg`, caption: `<b>${esc(title)}</b>\n${c[7]}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: btn, url: link }]] } });
}

async function hook(ctx) {
  const { env, request } = ctx;
  if (request.headers.get('x-telegram-bot-api-secret-token') !== await hookSecret(env)) return json({ ok: false }, 403);
  const u = await request.json().catch(() => ({})); const msg = u.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || typeof msg.text !== 'string') return json({ ok: true });
  await ensure(env);
  const chat = msg.chat.id, text = msg.text.trim();
  const row = await env.DB.prepare('SELECT user_id, lang FROM tg WHERE chat_id = ?').bind(chat).first();
  let lang = row && row.lang || langOf(msg.from && msg.from.language_code);
  const [cmd, arg] = text.split(/\s+/, 2), c = cmd.toLowerCase().replace(/@.*$/, '');
  if (c === '/start' && arg) {
    const k = await env.DB.prepare('SELECT user_id, lang FROM tg_code WHERE code = ? AND exp > ?').bind(arg, now()).first();
    if (!k) { await send(env, chat, tx(lang, 'badcode')); return json({ ok: true }); }
    lang = langOf(k.lang);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM tg WHERE chat_id = ? AND user_id <> ?').bind(chat, k.user_id),
      env.DB.prepare(`INSERT INTO tg (user_id, chat_id, lang, created) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(user_id) DO UPDATE SET chat_id = ?2, lang = ?3`).bind(k.user_id, chat, lang, now()),
      env.DB.prepare('DELETE FROM tg_code WHERE code = ? OR exp < ?').bind(arg, now()),
    ]);
    await send(env, chat, tx(lang, 'linked'));
  } else if (c === '/start') await send(env, chat, tx(lang, row ? 'linked' : 'hello'));
  else if (c === '/stop') { if (row) await env.DB.prepare('DELETE FROM tg WHERE chat_id = ?').bind(chat).run(); await send(env, chat, tx(lang, row ? 'stopped' : 'notlinked')); }
  else if (c === '/coin' || c === '/random') await randomCoin(ctx, chat, lang);
  else await send(env, chat, tx(lang, row ? 'help' : 'hello'));
  return json({ ok: true });
}

// рассылка: вызывается после ночного обновления каталога (GitHub Actions). Повторный вызов ничего не дублирует.
async function notify(ctx) {
  const { env } = ctx; await ensure(env);
  const last = +(await getMeta(env, 'tg_notify_at') || 0); if (now() - last < 120) return json({ ok: true, skipped: 'too_soon' });
  await setMeta(env, 'tg_notify_at', now());
  const { cat, auto } = await catalog(ctx);
  const priced = Object.keys(cat).filter(id => cat[id][5] > 0);
  const autoIds = (auto.coins || []).map(c => c.id);
  const prevP = await getMeta(env, 'tg_priced'), prevA = await getMeta(env, 'tg_auto');
  await setMeta(env, 'tg_priced', JSON.stringify(priced)); await setMeta(env, 'tg_auto', JSON.stringify(autoIds));
  if (prevP === null || prevA === null) return json({ ok: true, init: true, priced: priced.length });   // первый запуск: только запоминаем
  const oldP = new Set(JSON.parse(prevP)), oldA = new Set(JSON.parse(prevA));
  const fresh = autoIds.filter(id => !oldA.has(id)), onSale = priced.filter(id => !oldP.has(id)).map(Number);
  if (!fresh.length && !onSale.length) return json({ ok: true, fresh: 0, onSale: 0 });
  const users = (await env.DB.prepare('SELECT user_id, chat_id, lang, cc, new_on, wish_on FROM tg').all()).results;
  let sent = 0;
  for (const u of users) {
    const lang = langOf(u.lang), ccs = u.cc ? u.cc.split(',') : null, parts = [];
    const nw = u.new_on ? fresh.filter(id => cat[id] && (!ccs || ccs.includes(cat[id][0]))) : [];
    if (nw.length) parts.push(tx(lang, 'newh')(nw.length) + '\n' + nw.slice(0, 12).map(id => coinLine(cat[id], id, lang)).join('\n') + (nw.length > 12 ? '\n' + tx(lang, 'more')(nw.length - 12) : ''));
    if (u.wish_on && onSale.length) {
      const w = (await env.DB.prepare(`SELECT coin_id FROM wish WHERE user_id = ? AND coin_id IN (${onSale.map(() => '?').join(',')})`).bind(u.user_id, ...onSale).all()).results.map(r => r.coin_id);
      if (w.length) parts.push(tx(lang, 'wishh') + '\n' + w.slice(0, 12).map(id => coinLine(cat[id], id, lang)).join('\n'));
    }
    if (!parts.length) continue;
    const d = await send(env, u.chat_id, parts.join('\n\n'));
    if (d.ok) sent++; else if (d.error_code === 403) await env.DB.prepare('DELETE FROM tg WHERE chat_id = ?').bind(u.chat_id).run();   // бот заблокирован
  }
  return json({ ok: true, fresh: fresh.length, onSale: onSale.length, sent });
}

async function setup(ctx) {
  const { env, request } = ctx; await ensure(env);
  const host = new URL(request.url).origin;
  const r1 = await api(env, 'setWebhook', { url: `${host}/api/tg/hook`, secret_token: await hookSecret(env), allowed_updates: ['message'], drop_pending_updates: true });
  for (const l of ['ru', 'kk', 'en']) await api(env, 'setMyCommands', { commands: T[l].cmds.map(([command, description]) => ({ command, description })), ...(l === 'ru' ? {} : { language_code: l }) });
  await api(env, 'setMyDescription', { description: 'Каталог памятных монет jadiger.com: новые выпуски нацбанков и монеты из вашего списка «Хочу». / Commemorative coin catalog: new central bank issues and your wishlist alerts.' });
  await setMeta(env, 'tg_bot', ''); const bot = await botName(env);
  return json({ ok: !!r1.ok, webhook: r1.description || r1.ok, bot });
}

// публичные маршруты (без входа на сайт)
export async function tgPublic(ctx, path, m) {
  if (!path.startsWith('tg/')) return null;
  if (!ctx.env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'tg_off' }, 503);
  if (path === 'tg/hook' && m === 'POST') return hook(ctx);
  if (path === 'tg/notify' && m === 'POST') return notify(ctx);
  if (path === 'tg/setup' && m === 'GET') return setup(ctx);
  return null;
}

// маршруты для вошедшего пользователя: /api/tg
export async function tgUser(ctx, path, m, uid) {
  if (path !== 'tg' && path !== 'tg/link') return null;
  const { env, request } = ctx;
  if (!env.TELEGRAM_BOT_TOKEN) return json({ on: false });
  await ensure(env);
  if (path === 'tg/link' && m === 'POST') {
    const b = await request.json().catch(() => ({})); const a = new Uint8Array(16); crypto.getRandomValues(a); const code = hex(a);
    await env.DB.prepare('INSERT INTO tg_code (code, user_id, lang, exp) VALUES (?, ?, ?, ?)').bind(code, String(uid), langOf(b.lang), now() + 1800).run();
    const bot = await botName(env); if (!bot) return json({ error: 'tg_bot' }, 503);
    return json({ url: `https://t.me/${bot}?start=${code}`, bot });
  }
  const row = await env.DB.prepare('SELECT chat_id, cc, new_on, wish_on, lang FROM tg WHERE user_id = ?').bind(String(uid)).first();
  if (m === 'GET') return json({ on: true, linked: !!row, bot: await botName(env), cc: row ? row.cc : '', new_on: row ? !!row.new_on : true, wish_on: row ? !!row.wish_on : true });
  if (m === 'PUT') {
    if (!row) return json({ error: 'not_linked' }, 400);
    const b = await request.json().catch(() => ({}));
    const cc = (Array.isArray(b.cc) ? b.cc : []).filter(x => CCS.includes(x));
    await env.DB.prepare('UPDATE tg SET cc = ?, new_on = ?, wish_on = ?, lang = COALESCE(?, lang) WHERE user_id = ?')
      .bind(cc.length === CCS.length ? '' : (cc.join(',') || '-'), b.new_on ? 1 : 0, b.wish_on ? 1 : 0, b.lang ? langOf(b.lang) : null, String(uid)).run();
    return json({ ok: true });
  }
  if (m === 'DELETE') {
    if (row) { await env.DB.prepare('DELETE FROM tg WHERE user_id = ?').bind(String(uid)).run(); await send(env, row.chat_id, tx(langOf(row.lang), 'unlinked')); }
    return json({ ok: true });
  }
  return null;
}
