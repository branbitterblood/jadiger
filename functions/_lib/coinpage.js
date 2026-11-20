// Страница монеты: та же SPA (index.html), но с заголовком, описанием, OG-тегами и текстом
// характеристик в HTML — для поисковиков и превью ссылок в мессенджерах. Скрипт сам откроет монету по адресу.
import { COINS } from './coins.js';

const SITE = 'https://jadiger.com';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function coinPage(ctx, cc) {
  const { request, env, params } = ctx;
  const key = cc + '/' + String(params.slug || '').toLowerCase();
  const c = COINS[key];
  const res = await env.ASSETS.fetch(new URL('/', request.url));
  let html = await res.text();
  if (!c) {
    html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex">');
    return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const [id, title, desc, specs, hasPhoto] = c;
  const url = `${SITE}/${key}`;
  const img = hasPhoto ? `${SITE}/og/${id}.jpg` : `${SITE}/icon-512.png`;
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: title, description: desc, url,
    ...(hasPhoto ? { image: img } : {}), category: 'Памятные монеты' };
  const meta = `<title>${esc(title)} · Jadiger</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
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
${hasPhoto ? `<img src="/og/${id}.jpg" alt="${esc(title)} — аверс и реверс" width="600" height="315">` : ''}
<p><a href="/">Весь каталог монет</a></p></article></noscript>`;
  html = html.replace('<body>', '<body>\n' + seo);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
