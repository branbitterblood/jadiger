// Публичная коллекция jadiger.com/u/<handle>: та же SPA, но с заголовком, описанием и OG-превью для мессенджеров.
import { COINS } from './coins.js';
import { publicCollection } from './profiles.js';
import { COINS_EN } from './coins_en.js';
import { COINS_KK } from './coins_kk.js';
import { altLinks, setLang, PFX, stripHomeOg, homeImg } from './coinpage.js';

const SITE = 'https://jadiger.com';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BY = {};
const byId = lang => BY[lang] || (BY[lang] = Object.fromEntries(Object.entries({ en: COINS_EN, kk: COINS_KK }[lang] || COINS).map(([k, v]) => [v[0], { path: k, title: v[1], photo: v[4] }])));
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

export async function userPage(ctx, lang, handle) {
  const { request, env } = ctx, en = lang === 'en', kk = lang === 'kk', P = PFX[lang] || '';
  const res = await env.ASSETS.fetch(new URL('/', request.url));
  let html = stripHomeOg(setLang(await res.text(), lang));
  let pc = null;
  try { pc = await publicCollection(env.DB, handle); } catch (e) {}
  if (!pc) {
    html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex">');
    return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const B = byId(lang);
  if (en) pc.title = pc.title.replace(/^Коллекция — /, 'Collection — ').replace(/^Коллекция @/, 'Collection @');
  if (kk) pc.title = pc.title.replace(/^Коллекция — /, 'Коллекция — ');
  const ids = Object.keys(pc.items).map(Number).filter(id => B[id]).sort((a, b) => b - a);
  const n = ids.length, w = pc.wish ? pc.wish.filter(id => B[id]).length : 0;
  const cover = ids.find(id => B[id].photo);
  const url = `${SITE}${P}/u/${pc.handle}`;
  const title = kk ? `${pc.title}: ${n} монета` : en ? `${pc.title}: ${n} coin${n === 1 ? '' : 's'}` : `${pc.title}: ${n} ${plural(n, 'монета', 'монеты', 'монет')}`;
  const desc = kk ? `Jadiger-дегі естелік монеталар коллекциясы: ${n} монета` + (w ? `, тағы ${w} тілектер тізімінде` : '') +
      (ids.length ? '. Олардың ішінде: ' + ids.slice(0, 3).map(id => '«' + B[id].title + '»').join(', ') : '') + '. Әр монетаны 3D форматта қараңыз.'
    : en ? `A commemorative coin collection on Jadiger: ${n} coin${n === 1 ? '' : 's'}` + (w ? `, ${w} more in the wishlist` : '') +
      (ids.length ? '. Including ' + ids.slice(0, 3).map(id => '“' + B[id].title + '”').join(', ') : '') + '. View every coin in 3D.'
    : `Коллекция памятных монет на Jadiger: ${n} ${plural(n, 'монета', 'монеты', 'монет')}` + (w ? `, ещё ${w} в вишлисте` : '') +
    (ids.length ? '. Среди них: ' + ids.slice(0, 3).map(id => '«' + B[id].title + '»').join(', ') : '') + '. Смотрите каждую монету в 3D.';
  const img = cover != null ? `${SITE}/og/${cover}.jpg` : homeImg(lang);
  const meta = `<title>${esc(title)} · Jadiger</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
${altLinks('/u/' + pc.handle)}
<meta property="og:type" content="profile">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`;
  html = html.replace(/<meta name="description"[^>]*>\n?/, '').replace(/<title>[^<]*<\/title>/, meta);
  const seo = `<noscript><article style="max-width:760px;margin:24px auto;padding:0 24px">
<h1>${esc(title)}</h1><p>${esc(desc)}</p>
<ul>${ids.slice(0, 500).map(id => `<li><a href="${P}/${B[id].path}">${esc(B[id].title)}</a></li>`).join('')}</ul>
<p><a href="${P}/">${kk ? 'Монеталардың толық каталогы' : en ? 'Full coin catalog' : 'Весь каталог монет'}</a></p></article></noscript>`;
  html = html.replace('<body>', '<body>\n' + seo);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
