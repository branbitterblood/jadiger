// Страница монеты: та же SPA (index.html), но с заголовком, описанием, OG-тегами и текстом
// характеристик в HTML — для поисковиков и превью ссылок в мессенджерах. Скрипт сам откроет монету по адресу.

const SITE = 'https://jadiger.com';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CTRY = {
  kz: ['Казахстан', 'Национальный банк РК', 'тенге', '₸'], uz: ['Узбекистан', 'Центральный банк Республики Узбекистан', 'сум', 'сум'],
  kg: ['Кыргызстан', 'Национальный банк Кыргызской Республики', 'сом', 'сом'], tj: ['Таджикистан', 'Национальный банк Таджикистана', 'сомони', 'сомони'],
  tm: ['Туркменистан', 'Центральный банк Туркменистана', 'манат', 'манат'],
  mn: ['Монголия', 'Банк Монголии', 'тугриков', '₮'],
  su: ['СССР', 'Государственный банк СССР', 'руб.', 'руб.'],
  ru: ['Россия', 'Банк России', 'рублей', '₽'],
  by: ['Беларусь', 'Национальный банк Республики Беларусь', 'рублей', 'Br'],
  am: ['Армения', 'Центральный банк Республики Армения', 'драмов', '֏'],
  az: ['Азербайджан', 'Центральный банк Азербайджанской Республики', 'манат', '₼'],
  ua: ['Украина', 'Национальный банк Украины', 'гривен', '₴'],
  jp: ['Япония', 'Правительство Японии (Монетный двор Японии)', 'иен', '¥'],
  ph: ['Филиппины', 'Центральный банк Филиппин', 'песо', '₱'],
};
const fmtN = n => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
// новые выпуски, добавленные автоматически: public/auto/coins.js (см. tools/update.py)
async function autoCoin(env, request, cc, slug) {
  try {
    const r = await env.ASSETS.fetch(new URL('/auto/coins.js', request.url)); if (!r.ok) return null;
    const t = await r.text(); const A = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const a = (A.coins || []).find(x => x.r[10] === cc && x.slug === slug); if (!a) return null;
    const [title, date, nomV, metal, w, d, q, mint, section, series] = a.r, [name, issuer, cur, sym] = CTRY[cc];
    let cu = cur; if (cc === 'ua') { if (+nomV >= 100000) cu = 'карбованцев'; else { const x = Math.round(+nomV) % 100, y = x % 10; cu = x > 10 && x < 20 ? 'гривен' : y === 1 ? 'гривна' : y >= 2 && y <= 4 ? 'гривны' : 'гривен'; } }
    const nom = +nomV ? `${fmtN(nomV)} ${cu}` : '', year = date.slice(-4);
    const specs = [['Страна', name], ['Эмитент', issuer], ['Раздел', section], ['Серия', series], [date.length === 4 ? 'Год выпуска' : 'Дата выпуска', date],
      ['Номинал', nom || '—'], ['Металл', metal], ...(w ? [['Вес', w + ' г']] : []), ...(+d ? [['Диаметр', d + ' мм']] : []), ['Качество', q || '—'], ['Тираж', mint ? fmtN(mint) + ' шт.' : '—'],
      ...(a.price ? [['Цена в магазине НБ', fmtN(a.price) + ' ' + sym]] : [])];
    const desc = `Памятная монета «${title}» (${name}, ${year}): номинал ${nom || '—'}, ${metal}` + (w ? `, ${w} г` : '') + (+d ? `, ${d} мм` : '') +
      (mint ? `, тираж ${fmtN(mint)} шт.` : '') + `. Серия «${series}». Смотрите монету в 3D и ведите учёт коллекции на Jadiger.`;
    return [a.id, `${title} — ${nom}, ${metal}, ${year}`.replace(' — , ', ' — '), desc, specs, !!a.photo];
  } catch (e) { return null; }
}

// общий кусок <head> для трёх языков: canonical + hreflang
export const altLinks = (path) => `<link rel="alternate" hreflang="ru" href="${SITE}${path}">\n<link rel="alternate" hreflang="kk" href="${SITE}/kk${path}">\n<link rel="alternate" hreflang="en" href="${SITE}/en${path}">\n<link rel="alternate" hreflang="x-default" href="${SITE}${path}">`;
export function setLang(html, lang) {
  // переводы названий монет подключаются только на /en и /kk (в русской версии они не нужны)
  return lang === 'ru' ? html : html.replace('<html lang="ru">', `<html lang="${lang}">`)
    .replace(/<!--i18n:(\w+)-->/, (m, v) => `<script src="/i18n/${lang}.js?v=${v}"></script>`);
}
export const PFX = { ru: '', en: '/en', kk: '/kk' };
// превью главной (og:image с логотипом) убираем там, где страница ставит свои теги
export const stripHomeOg = html => html.replace(/<!--og-home-->[\s\S]*?<!--\/og-home-->\n?/, '');
export const homeImg = lang => `${SITE}/og/home-${lang === 'en' || lang === 'kk' ? lang : 'ru'}.jpg`;
const TXT = {
  ru: { cat: 'Памятные монеты', sides: 'аверс и реверс', all: 'Весь каталог монет' },
  en: { cat: 'Commemorative coins', sides: 'obverse and reverse', all: 'Full coin catalog' },
  kk: { cat: 'Естелік монеталар', sides: 'аверсі мен реверсі', all: 'Монеталардың толық каталогы' },
};

// данные страниц монет: public/i/cp/<lang>/<n>.json (64 части на язык, n — хэш адреса; см. cat/pages.py)
const h64 = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h % 64; };
const CP = new Map();
async function coinData(env, request, lang, key) {
  const l = lang === 'en' || lang === 'kk' ? lang : 'ru', n = h64(key), ck = l + n;
  if (!CP.has(ck)) {
    try { const r = await env.ASSETS.fetch(new URL(`/i/cp/${l}/${n}.json`, request.url)); CP.set(ck, r.ok ? await r.json() : {}); } catch (e) { return null; }
  }
  return CP.get(ck)[key] || null;
}
export async function coinPage(ctx, cc, lang = 'ru', slugIn) {
  const { request, env, params } = ctx;
  const X = TXT[lang] || TXT.ru, slug = String(slugIn ?? params.slug ?? '').toLowerCase();
  const key = cc + '/' + slug;
  const c = await coinData(env, request, lang, key) || await autoCoin(env, request, cc, slug);
  const res = await env.ASSETS.fetch(new URL('/', request.url));
  let html = stripHomeOg(setLang(await res.text(), lang));
  if (!c) {
    html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex">');
    return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const [id, title, desc, specs, hasPhoto] = c;
  const url = `${SITE}${PFX[lang] || ''}/${key}`;
  const img = hasPhoto ? `https://img.jadiger.com/og/${id}.jpg` : homeImg(lang);
  // страница каталога, а не товар: без цены и отзывов разметка Product считается в Google ошибкой
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url,
    inLanguage: lang, isPartOf: { '@type': 'WebSite', name: 'Jadiger', url: SITE + '/' },
    about: { '@type': 'Thing', name: title, description: X.cat },
    ...(hasPhoto ? { primaryImageOfPage: { '@type': 'ImageObject', url: img, width: 1200, height: 630 } } : {}) };
  const meta = `<title>${esc(title)} · Jadiger</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
${altLinks('/' + key)}
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  html = html.replace(/<meta name="description"[^>]*>\n?/, '').replace(/<title>[^<]*<\/title>/, meta);
  // текст для поисковиков и браузеров без JS
  const seo = `<noscript><article style="max-width:760px;margin:24px auto;padding:0 24px">
<h1>${esc(title)}</h1><p>${esc(desc)}</p>
<table>${specs.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>
${hasPhoto ? `<img src="https://img.jadiger.com/og/${id}.jpg" alt="${esc(title)} — ${X.sides}" width="600" height="315">` : ''}
<p><a href="${(PFX[lang] || '') + '/'}">${X.all}</a></p></article></noscript>`;
  html = html.replace('<body>', '<body>\n' + seo);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
