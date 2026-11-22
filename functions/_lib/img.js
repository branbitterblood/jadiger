// Фото монет в R2 (бакет jadiger-img, публичный адрес img.jadiger.com).
// Загрузка без ключей: GitHub Actions присылает файлы, а сайт пишет в R2 только те, чей SHA-256
// совпадает с img/manifest.json в публичном репозитории на указанном коммите. Чужой файл записать нельзя.
const REPO = 'branbitterblood/jadiger';
const PATH_RE = /^(i\/[tf]\/\d+[ab]\.webp|og\/\d+\.jpg)$/;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const ensure = env => env.DB.prepare('CREATE TABLE IF NOT EXISTS img_sync (path TEXT PRIMARY KEY, h TEXT NOT NULL)').run();

export async function imgRoutes(ctx, path, m) {
  if (path !== 'img/state' && path !== 'img/put') return null;
  const { env, request } = ctx;
  if (!env.IMG) return json({ error: 'no_bucket' }, 503);
  await ensure(env);
  if (path === 'img/state' && m === 'GET') {
    const rows = (await env.DB.prepare('SELECT path, h FROM img_sync').all()).results;
    return json(Object.fromEntries(rows.map(r => [r.path, r.h])));
  }
  if (path === 'img/put' && m === 'POST') {
    const sha = new URL(request.url).searchParams.get('sha') || '';
    if (!/^[0-9a-f]{40}$/.test(sha)) return json({ error: 'bad_sha' }, 400);
    const mr = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/img/manifest.json`, { cf: { cacheTtl: 86400 } });
    if (!mr.ok) return json({ error: 'no_manifest', status: mr.status }, 400);
    const man = await mr.json();
    const form = await request.formData();
    const done = [], bad = [], stmts = [];
    for (const [p, file] of form.entries()) {
      if (!PATH_RE.test(p) || typeof file === 'string' || !man[p]) { bad.push(p); continue; }
      const buf = await file.arrayBuffer();
      const h = hex(await crypto.subtle.digest('SHA-256', buf)).slice(0, 20);
      if (h !== man[p]) { bad.push(p); continue; }
      const og = p.startsWith('og/');
      await env.IMG.put(p, buf, { httpMetadata: { contentType: og ? 'image/jpeg' : 'image/webp', cacheControl: og ? 'public, max-age=86400' : 'public, max-age=31536000, immutable' } });
      stmts.push(env.DB.prepare('INSERT INTO img_sync (path, h) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET h = ?2').bind(p, h));
      done.push(p);
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, done: done.length, bad });
  }
  return null;
}
