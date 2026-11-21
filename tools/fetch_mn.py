"""Разовая выгрузка каталога памятных монет Монголбанка (erdenesiinsan.mn) с фото — для подготовки каталога Jadiger."""
import json, os, time, requests
B = 'https://www.erdenesiinsan.mn'
OUT = 'mn_raw'; os.makedirs(f'{OUT}/img', exist_ok=True)
S = requests.Session(); S.headers['User-Agent'] = 'Mozilla/5.0 Jadiger catalog (jadiger.com)'
d = S.get(B + '/api/coins', timeout=60).json()['data']['data']
json.dump(d, open(f'{OUT}/coins.json', 'w'), ensure_ascii=False, indent=0)
ok = 0
for c in d:
    code = c['COIN_NUMBER']
    for side in ('f', 'b'):
        p = f'{OUT}/img/{code}_{side}.png'
        if os.path.exists(p): continue
        for k in range(3):
            try:
                r = S.get(f'{B}/api/cdr', params={'folder': code, 'filename': f'{code}_lg_{side}.png'}, timeout=60)
                if r.status_code == 200 and len(r.content) > 2000: open(p, 'wb').write(r.content); ok += 1; break
            except Exception as e: print(code, side, e)
            time.sleep(2)
        time.sleep(0.3)
print('coins', len(d), 'images', ok)
