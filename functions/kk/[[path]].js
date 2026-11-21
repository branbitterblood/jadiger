// Казахская версия: /kk, /kk/<cc>/<slug>, /kk/u/<handle> — та же SPA, язык определяется по адресу
import { coinPage, altLinks, setLang } from '../_lib/coinpage.js';
import { userPage } from '../_lib/userpage.js';

const SITE = 'https://jadiger.com';
export async function onRequestGet(ctx) {
  const parts = [].concat(ctx.params.path || []).filter(Boolean);
  if (parts.length === 2 && /^(kz|uz|kg|tj|tm)$/.test(parts[0])) return coinPage(ctx, parts[0], 'kk', parts[1]);
  if (parts.length === 2 && parts[0] === 'u') return userPage(ctx, 'kk', parts[1]);
  if (parts.length && !(parts.length === 1 && parts[0] === 'index.html')) {
    // статические файлы (pack, og, auto…) — с корня сайта
    const u = new URL(ctx.request.url); u.pathname = '/' + parts.join('/');
    const r = await ctx.env.ASSETS.fetch(u);
    if (r.ok) return r;
  }
  const res = await ctx.env.ASSETS.fetch(new URL('/', ctx.request.url));
  let html = setLang(await res.text(), 'kk');
  const title = 'Jadiger — Орталық Азияның коллекциялық монеталары 3D форматта';
  const desc = 'Қазақстан, Өзбекстан, Қырғызстан, Тәжікстан және Түрікменстанның естелік және инвестициялық монеталарының 3D каталогы: сипаттамалары, таралымы, ұлттық банктердің бағалары және жеке коллекция есебі.';
  html = html.replace(/<meta name="description"[^>]*>\n?/, '').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${SITE}/kk/">
${altLinks('/')}
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${SITE}/kk/">`);
  return new Response(html, { status: parts.length && parts[0] !== 'index.html' ? 404 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
