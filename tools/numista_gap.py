"""Поиск монет, которых нет в каталоге: список типов Numista по эмитенту и подробности по кандидатам.

Запуск — вручную в GitHub Actions (workflow «Поиск пропущенных монет»), ключ — секрет NUMISTA_API_KEY.
Квоту Numista делим с ежедневным tools/numista.py: счётчик запросов общий (tools/numista_state.json → usage).

  GAP_STEP=list     GAP_CC=mn,tm,uz,tj   — все типы монет эмитента (по 50 на страницу) → tools/gap/<cc>.json
  GAP_STEP=details  GAP_MAX=100          — подробности (металл, вес, размер, тираж, фото и их лицензии)
                                           для id из tools/gap/want.json, которых ещё нет в tools/gap/<cc>.json
"""
import json, os, sys, time, datetime as dt
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('NUMISTA_API_KEY', '').strip()
API = 'https://api.numista.com/v3'
STATE_P = os.path.join(ROOT, 'tools', 'numista_state.json')
GAP = os.path.join(ROOT, 'tools', 'gap')
MONTHLY = int(os.environ.get('NUMISTA_MONTHLY', '1900'))
MAXN = int(os.environ.get('GAP_MAX', '100'))
ISSUER = {'kz': 'kazakhstan', 'kg': 'kirghizistan', 'mn': 'mongolie', 'tj': 'tadjikistan', 'tm': 'turkmenistan', 'uz': 'uzbekistan_section'}


class Budget(Exception): pass


def main():
    if not KEY: sys.exit('NUMISTA_API_KEY не задан')
    os.makedirs(GAP, exist_ok=True)
    st = json.load(open(STATE_P)); month = dt.date.today().strftime('%Y-%m'); used = {'n': 0}
    S = requests.Session(); S.headers.update({'Numista-API-Key': KEY, 'User-Agent': 'Jadiger catalog (jadiger.com)'})

    def get(path, **params):
        if st['usage'].get(month, 0) >= MONTHLY or used['n'] >= MAXN: raise Budget()
        for k in range(3):
            r = S.get(API + path, params=params, timeout=40)
            st['usage'][month] = st['usage'].get(month, 0) + 1; used['n'] += 1
            if r.status_code == 429: raise Budget()
            if r.status_code in (500, 502, 503): time.sleep(5 * (k + 1)); continue
            if r.status_code == 404: return None
            r.raise_for_status(); time.sleep(0.4); return r.json()

    def load(cc):
        p = os.path.join(GAP, f'{cc}.json')
        return json.load(open(p)) if os.path.exists(p) else {'types': {}, 'pages': 0, 'total': None, 'details': {}}

    def save(cc, d): json.dump(d, open(os.path.join(GAP, f'{cc}.json'), 'w'), ensure_ascii=False, indent=0)

    step = os.environ.get('GAP_STEP', 'list')
    try:
        if step == 'list':
            for cc in os.environ.get('GAP_CC', 'mn,tm,uz,tj').split(','):
                d = load(cc)
                while d['total'] is None or d['pages'] * 50 < d['total']:
                    j = get('/types', issuer=ISSUER[cc], category='coin', count=50, page=d['pages'] + 1, lang='en') or {}
                    d['total'] = j.get('count', 0); d['pages'] += 1
                    for t in j.get('types', []):
                        d['types'][str(t['id'])] = {k: t.get(k) for k in ('title', 'min_year', 'max_year', 'object_type')}
                    save(cc, d)
                    if not j.get('types'): break
                print(cc, 'типов:', len(d['types']), 'из', d['total'])
        else:
            want = json.load(open(os.path.join(GAP, 'want.json')))   # {cc: [id, ...]}
            for cc, ids in want.items():
                d = load(cc)
                for i in ids:
                    if str(i) in d['details']: continue
                    t = get(f'/types/{i}', lang='en') or {}
                    keep = {k: t.get(k) for k in ('title', 'type', 'min_year', 'max_year', 'value', 'composition', 'weight', 'size', 'size2',
                                                   'thickness', 'shape', 'technique', 'orientation', 'series', 'commemorated_topic', 'url')}
                    for side in ('obverse', 'reverse'):
                        s = t.get(side) or {}
                        keep[side] = {k: s.get(k) for k in ('picture', 'picture_copyright', 'picture_copyright_url', 'picture_license_name',
                                                            'picture_license_url', 'description', 'lettering')}
                    iss = (get(f'/types/{i}/issues') or []) if os.environ.get('GAP_ISSUES') == '1' else []
                    keep['issues'] = [{k: x.get(k) for k in ('year', 'gregorian_year', 'mintage', 'comment')} for x in iss]
                    d['details'][str(i)] = keep; save(cc, d)
                print(cc, 'подробностей:', len(d['details']))
    except Budget:
        print('лимит запросов на этот запуск/месяц исчерпан — продолжу в следующий раз')
    json.dump(st, open(STATE_P, 'w'), ensure_ascii=False, indent=0)
    print('запросов за запуск:', used['n'], '· за месяц:', st['usage'][month])


if __name__ == '__main__':
    main()
