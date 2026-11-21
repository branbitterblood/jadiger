// Страница монеты: та же SPA (index.html), но с заголовком, описанием, OG-тегами и текстом
// характеристик в HTML — для поисковиков и превью ссылок в мессенджерах. Скрипт сам откроет монету по адресу.
import { COINS } from './coins.js';
import { COINS_EN } from './coins_en.js';
import { COINS_KK } from './coins_kk.js';

const SITE = 'https://jadiger.com';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CTRY = {
  kz: ['Казахстан', 'Национальный банк РК', 'тенге', '₸'], uz: ['Узбекистан', 'Центральный банк Республики Узбекистан', 'сум', 'сум'],
  kg: ['Кыргызстан', 'Национальный банк Кыргызской Республики', 'сом', 'сом'], tj: ['Таджикистан', 'Национальный банк Таджикистана', 'сомони', 'сомони'],
  tm: ['Туркменистан', 'Центральный банк Туркменистана', 'манат', 'манат'],
  mn: ['Монголия', 'Банк Монголии', 'тугриков', '₮'],
  su: ['СССР', 'Государственный банк СССР', 'руб.', 'руб.'],
};
const fmtN = n => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
// новые выпуски, добавленные автоматически: public/auto/coins.js (см. tools/update.py)
async function autoCoin(env, request, cc, slug) {
  try {
    const r = await env.ASSETS.fetch(new URL('/auto/coins.js', request.url)); if (!r.ok) return null;
    const t = await r.text(); const A = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const a = (A.coins || []).find(x => x.r[10] === cc && x.slug === slug); if (!a) return null;
    const [title, date, nomV, metal, w, d, q, mint, section, series] = a.r, [name, issuer, cur, sym] = CTRY[cc];
    const nom = +nomV ? `${fmtN(nomV)} ${cur}` : '', year = date.slice(-4);
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
  return lang === 'ru' ? html : html.replace('<html lang="ru">', `<html lang="${lang}">`);
}
export const PFX = { ru: '', en: '/en', kk: '/kk' };
const TXT = {
  ru: { cat: 'Памятные монеты', sides: 'аверс и реверс', all: 'Весь каталог монет' },
  en: { cat: 'Commemorative coins', sides: 'obverse and reverse', all: 'Full coin catalog' },
  kk: { cat: 'Естелік монеталар', sides: 'аверсі мен реверсі', all: 'Монеталардың толық каталогы' },
};

export async function coinPage(ctx, cc, lang = 'ru', slugIn) {
  const { request, env, params } = ctx;
  const X = TXT[lang] || TXT.ru, slug = String(slugIn ?? params.slug ?? '').toLowerCase();
  const key = cc + '/' + slug;
  const c = ({ en: COINS_EN, kk: COINS_KK }[lang] || COINS)[key] || await autoCoin(env, request, cc, slug);
  const res = await env.ASSETS.fetch(new URL('/', request.url));
  let html = setLang(await res.text(), lang);
  if (!c) {
    html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex">');
    return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const [id, title, desc, specs, hasPhoto] = c;
  const url = `${SITE}${PFX[lang] || ''}/${key}`;
  const img = hasPhoto ? `${SITE}/og/${id}.jpg` : `${SITE}/icon-512.png`;
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: title, description: desc, url,
    ...(hasPhoto ? { image: img } : {}), category: X.cat };
  const meta = `<title>${esc(title)} · Jadiger</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
${altLinks('/' + key)}
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}">
${hasPhoto ? '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">' : '<meta name="twitter:card" content="summary">'}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  html = html.replace(/<meta name="description"[^>]*>\n?/, '').replace(/<title>[^<]*<\/title>/, meta);
  // текст для поисковиков и браузеров без JS
  const seo = `<noscript><article style="max-width:760px;margin:24px auto;padding:0 24px">
<h1>${esc(title)}</h1><p>${esc(desc)}</p>
<table>${specs.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>
${hasPhoto ? `<img src="/og/${id}.jpg" alt="${esc(title)} — ${X.sides}" width="600" height="315">` : ''}
<p><a href="${(PFX[lang] || '') + '/'}">${X.all}</a></p></article></noscript>`;
  html = html.replace('<body>', '<body>\n' + seo);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
