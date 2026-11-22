"""Заливает фото монет из img/ в R2 через сайт (/api/img/put). Запуск в GitHub Actions после изменений в img/.
python tools/img_sync.py [SITE]   — SHA коммита берётся из GITHUB_SHA или git rev-parse HEAD."""
import json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
import requests
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = sys.argv[1] if len(sys.argv) > 1 else 'https://jadiger.com'
SHA = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
man = json.load(open(os.path.join(ROOT, 'img', 'manifest.json')))
state = requests.get(f'{SITE}/api/img/state', timeout=60).json()
shard = lambda p: int(re.search(r'(\d+)', p.split('/')[-1]).group(1)) // 100   # шард манифеста: 100 монет
todo = sorted([p for p, h in man.items() if state.get(p) != h], key=shard)
print('файлов в манифесте', len(man), 'залить', len(todo), flush=True)
batches, cur, size = [], [], 0
for p in todo:
    if cur and (shard(cur[0]) != shard(p) or len(cur) >= 25 or size > 3_000_000): batches.append(cur); cur, size = [], 0
    cur.append(p); size += os.path.getsize(os.path.join(ROOT, 'img', p))
if cur: batches.append(cur)
def put(batch):
    files = [(p, (os.path.basename(p), open(os.path.join(ROOT, 'img', p), 'rb').read())) for p in batch]
    for t in range(5):
        try:
            r = requests.post(f'{SITE}/api/img/put?sha={SHA}&m={shard(batch[0])}', files=files, timeout=120); d = r.json()
            if r.ok: return d['done'], d['bad']
            print('ошибка', r.status_code, d, flush=True)
        except Exception as e: print('сеть', e, flush=True)
        time.sleep(3 + 5 * t)
    return 0, []
sent, bad = 0, []
with ThreadPoolExecutor(6) as ex:
    for k, (n, b) in enumerate(ex.map(put, batches)):
        sent += n; bad += b
        if k % 40 == 0: print(f'{k}/{len(batches)} пакетов, залито {sent}', flush=True)
print('залито', sent, 'из', len(todo), 'отклонено', len(bad), bad[:10])
if bad or sent < len(todo): sys.exit(1)
