// Английская версия: /en, /en/<cc>/<slug>, /en/u/<handle> — та же SPA, язык определяется по адресу
import { coinPage, altLinks, setLang, stripHomeOg, homeImg } from '../_lib/coinpage.js';
import { userPage } from '../_lib/userpage.js';

const SITE = 'https://jadiger.com';
export async function onRequestGet(ctx) {
  const parts = [].concat(ctx.params.path || []).filter(Boolean);
  if (parts.length === 2 && /^(kz|uz|kg|tj|tm|mn|su|ru|by|am|az|ua|jp|ph|ge|eu|pl|tr)$/.test(parts[0])) return coinPage(ctx, parts[0], 'en', parts[1]);
  if (parts.length === 2 && parts[0] === 'u') return userPage(ctx, 'en', parts[1]);
  if (parts.length && !(parts.length === 1 && parts[0] === 'index.html')) {
    // статические файлы (pack, og, auto…) — с корня сайта
    const u = new URL(ctx.request.url); u.pathname = '/' + parts.join('/');
    const r = await ctx.env.ASSETS.fetch(u);
    if (r.ok) return r;
  }
  const res = await ctx.env.ASSETS.fetch(new URL('/', ctx.request.url));
  let html = stripHomeOg(setLang(await res.text(), 'en'));
  const title = 'Jadiger — Commemorative Coins of the World in 3D';
  const desc = 'Catalog of commemorative and bullion coins of Kazakhstan, Uzbekistan, Kyrgyzstan, Tajikistan, Turkmenistan, Mongolia, the USSR, Russia, Belarus, Ukraine, Armenia, Azerbaijan, Japan and the Philippines in 3D: specs, mintages, central bank prices and your personal collection tracker.';
  html = html.replace(/<meta name="description"[^>]*>\n?/, '').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${SITE}/en/">
${altLinks('/')}
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${SITE}/en/">
<meta property="og:type" content="website">
<meta property="og:image" content="${homeImg('en')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`);
  return new Response(html, { status: parts.length && parts[0] !== 'index.html' ? 404 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
