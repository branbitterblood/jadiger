// Главная «/»: казахскоязычных посетителей из Казахстана сразу ведём на /kk/.
// Явный выбор языка (кнопки RU · ҚАЗ · EN ставят cookie jd_lang) всегда важнее автоопределения.
const BOT = /bot|crawl|spider|slurp|yandex|google|bing|facebookexternalhit|telegram|whatsapp|preview/i;

export function onRequestGet(ctx) {
  const { request } = ctx;
  const cookie = request.headers.get('cookie') || '';
  const chosen = (/(?:^|;\s*)jd_lang=(ru|kk|en)\b/.exec(cookie) || [])[1];
  const go = to => new Response(null, { status: 302, headers: { location: to + new URL(request.url).search, 'cache-control': 'private, no-store', vary: 'Accept-Language, Cookie' } });
  if (chosen === 'kk' || chosen === 'en') return go('/' + chosen + '/');
  if (chosen === 'ru' || BOT.test(request.headers.get('user-agent') || '')) return ctx.next();
  const langs = (request.headers.get('accept-language') || '').toLowerCase().split(',').map(s => s.trim().split(';')[0]).filter(Boolean);
  const kkFirst = /^kk\b/.test(langs[0] || '');
  const kkAny = langs.some(l => /^kk\b/.test(l));
  const country = request.cf && request.cf.country;
  if (kkFirst || (country === 'KZ' && kkAny)) return go('/kk/');
  return ctx.next();
}
