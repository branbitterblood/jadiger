"""Рыночные цены монет из Numista (https://en.numista.com/api/) -> public/auto/market.json.

Запускается каждый день в GitHub Actions после tools/update.py. Ключ — секрет NUMISTA_API_KEY.
Бесплатный тариф Numista: 2000 запросов в месяц, поэтому работаем порциями:
  1) сопоставление монеты каталога с типом Numista (поиск по эмитенту, году, весу; 1 запрос);
  2) выпуск нужного года (/issues; 1 запрос, кешируется навсегда);
  3) оценки по состояниям (/prices в валюте страны монеты; 1 запрос, обновляем раз в ~60 дней).
Сначала обрабатываем монеты без цены Нацбанка (старые и распроданные) — для них оценка нужнее всего.
Состояние сопоставления: tools/numista_state.json (коммитится вместе с данными).
"""
import json, os, re, sys, time, unicodedata, datetime as dt
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('NUMISTA_API_KEY', '').strip()
API = 'https://api.numista.com/v3'
STATE_P = os.path.join(ROOT, 'tools', 'numista_state.json')
OUT_P = os.path.join(ROOT, 'public', 'auto', 'market.json')
MONTHLY = int(os.environ.get('NUMISTA_MONTHLY', '1900'))   # запас до лимита 2000
DAILY = int(os.environ.get('NUMISTA_DAILY', '120'))
REFRESH_DAYS = 60
CUR = {'kz': 'KZT', 'uz': 'UZS', 'kg': 'KGS', 'tj': 'TJS', 'tm': 'TMT', 'mn': 'MNT', 'su': 'KZT'}
ISSUER_HINT = {'kz': 'kazakhstan', 'uz': 'uzbekistan', 'kg': 'kyrgyzstan', 'tj': 'tajikistan', 'tm': 'turkmenistan', 'mn': 'mongolia', 'su': 'soviet union'}
LOG = []


def log(*a):
    s = ' '.join(str(x) for x in a); LOG.append(s); print(s, flush=True)


class Budget(Exception): pass


def main():
    if not KEY:
        print('NUMISTA_API_KEY не задан — пропускаю рыночные цены'); return
    st = json.load(open(STATE_P)) if os.path.exists(STATE_P) else {'map': {}, 'usage': {}, 'issuers': {}}
    out = json.load(open(OUT_P)) if os.path.exists(OUT_P) else {'source': 'Numista', 'coins': {}}
    month = dt.date.today().strftime('%Y-%m'); today = dt.date.today().isoformat()
    used = {'n': 0}
    S = requests.Session(); S.headers.update({'Numista-API-Key': KEY, 'User-Agent': 'Jadiger catalog (jadiger.com)'})

    def get(path, **params):
        if st['usage'].get(month, 0) >= MONTHLY or used['n'] >= DAILY: raise Budget()
        for k in range(3):
            r = S.get(API + path, params=params, timeout=40)
            st['usage'][month] = st['usage'].get(month, 0) + 1; used['n'] += 1
            if r.status_code == 429: raise Budget()
            if r.status_code in (500, 502, 503): time.sleep(5 * (k + 1)); continue
            if r.status_code == 404: return None
            if r.status_code == 401: sys.exit('Numista: неверный API-ключ')
            r.raise_for_status(); time.sleep(0.4); return r.json()
        return None

    coins = json.load(open(os.path.join(ROOT, 'tools', 'coins_index.json')))
    # авто-добавленные монеты тоже участвуют
    try:
        t = open(os.path.join(ROOT, 'public', 'auto', 'coins.js')).read(); A = json.loads(t[t.index('{'):t.rindex('}') + 1])
        for a in A.get('coins', []):
            r = a['r']; coins.append({'id': a['id'], 'cc': r[10], 'year': r[1][-4:], 'nom': r[2], 'w': r[4], 'd': r[5], 'metal': r[3], 'en': r[0], 'ru': r[0], 'nb': bool(a.get('price')), 'path': r[10] + '/' + a['slug']})
    except Exception as e: log('auto coins:', e)

    try:
        # коды эмитентов Numista (один запрос, кешируется)
        if not st['issuers']:
            iss = get('/issuers') or {}
            for it in iss.get('issuers', []):
                if it.get('level', 1) != 1: continue
                for cc, hint in ISSUER_HINT.items():
                    if it.get('code') == hint or (cc not in st['issuers'] and hint in (it.get('code', '') + ' ' + it.get('name', '').lower())):
                        st['issuers'][cc] = it['code']
            log('эмитенты:', st['issuers'])
        # очередь: сначала без цены НБ, затем остальные; новые сопоставления, затем устаревшие цены
        def retry(m):  # несопоставленные монеты пробуем снова раз в 90 дней — каталог Numista пополняется
            return not m or m.get('status') != 'none' or (dt.date.today() - dt.date.fromisoformat(m.get('upd', '2000-01-01'))).days >= 90
        def stale(c):
            m = out['coins'].get(str(c['id']))
            return not m or (dt.date.today() - dt.date.fromisoformat(m['upd'])).days >= REFRESH_DAYS
        queue = sorted([c for c in coins if c['cc'] in st['issuers'] and retry(st['map'].get(str(c['id']))) and stale(c)],
                       key=lambda c: (c['nb'], str(c['id']) in st['map'], int(c['year'] or 0)))
        for c in queue:
            cid = str(c['id']); m = st['map'].get(cid)
            if not m or m.get('status') == 'none':
                m = match(c, st['issuers'][c['cc']], get); m['upd'] = today; st['map'][cid] = m
                log('сопоставление', cid, c['en'], '→', m)
                if m['status'] != 'ok': continue
            if not m.get('issue'):
                iss = get(f"/types/{m['type']}/issues") or []
                cand = [i for i in iss if str(i.get('gregorian_year') or i.get('year')) == c['year']] or (iss if len(iss) == 1 else [])
                if not cand: m['status'] = 'none'; m['why'] = 'нет выпуска года'; continue
                m['issue'] = cand[0]['id']
            pr = get(f"/types/{m['type']}/issues/{m['issue']}/prices", currency=CUR[c['cc']])
            if pr is None: continue
            g = {p['grade']: round(p['price']) for p in pr.get('prices', []) if p.get('price')}
            out['coins'][cid] = {'t': m['type'], 'c': pr.get('currency', CUR[c['cc']]), 'g': g, 'upd': today}
            log('цены', cid, c['en'], g, pr.get('currency'))
    except Budget:
        log('лимит запросов на сегодня/месяц исчерпан, продолжим завтра')
    out['updated'] = today
    json.dump(out, open(OUT_P, 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(st, open(STATE_P, 'w'), ensure_ascii=False, indent=0)
    n_ok = sum(1 for v in st['map'].values() if v.get('status') == 'ok')
    log(f"итого: сопоставлено {n_ok}, с ценами {sum(1 for v in out['coins'].values() if v['g'])}, запросов за {month}: {st['usage'].get(month, 0)}")
    with open(os.path.join(ROOT, 'tools', 'last_numista.log'), 'w') as f: f.write('\n'.join(LOG[-300:]) + '\n')


def norm(s):
    # казахская латиница (ARǴYMAQ, QAZAQ KÚRESI) -> без диакритики, как в названиях Numista (Argymaq, Kuresi)
    s = unicodedata.normalize('NFKD', (s or '').lower()); s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9а-яёәіңғүұқөһ]+', ' ', s).strip()


STOP = {'the', 'of', 'and', 'years', 'year', 'anniversary', 'th', 'tenge', 'som', 'sum', 'somoni', 'manat', 'togrog', 'oz', 'gold', 'silver', 'copper', 'gilded', 'shaped', 'style', 'mongolian', 'a', 'in', 'to', 'jyl'}


def match(c, issuer, get):
    """Ищем тип Numista: эмитент + год + вес; среди кандидатов — тот, где совпадает номинал и больше общих слов в названии."""
    year = c['year']; w = float(c['w'] or 0)
    words = [x for x in norm(re.sub(r'\(.*?\)', ' ', c['en'])).split() if x not in STOP and not x.isdigit() and len(x) > 2]
    base = dict(issuer=issuer, date=year, count=100)
    if w > 0: base['weight'] = f'{w - 0.3:.2f}-{w + 0.3:.2f}'
    res = []
    if words:   # сначала поиск по словам названия — самый точный и дешёвый вариант
        res = (get('/types', q=' '.join(words[:4]), **base) or {}).get('types', [])
    if not res: res = (get('/types', **base) or {}).get('types', [])
    if not res and w > 0:
        base.pop('weight'); res = (get('/types', **base) or {}).get('types', [])
    nom = str(int(float(c['nom']))) if c['nom'] and float(c['nom']) > 0 else ''
    words = set(norm(c['en']).split()) - STOP
    best = []
    for t in res:
        title = t.get('title', ''); tn = re.sub(r'(?<=\d)[ ,.](?=\d{3}\b)', '', title)
        if nom and not re.search(rf'(^|\D){nom}(\D|$)', tn): continue
        if int(t.get('min_year') or 0) > int(year) or int(t.get('max_year') or 9999) < int(year): continue
        score = len(words & set(norm(title).split()))
        best.append((score, t))
    best.sort(key=lambda x: -x[0])
    if not best: return {'status': 'none', 'why': f'нет кандидатов ({len(res)} в поиске)'}
    if len(best) > 1 and best[0][0] == best[1][0]:
        return {'status': 'none', 'why': 'неоднозначно: ' + ' | '.join(t['title'] for _, t in best[:4])}
    if best[0][0] == 0 and len(best) > 1:
        return {'status': 'none', 'why': 'нет совпадения названия'}
    t = best[0][1]
    return {'status': 'ok', 'type': t['id'], 'title': t['title']}


if __name__ == '__main__':
    main()
