"""Заливает фото монет из img/ в R2 через сайт (/api/img/put). Запуск в GitHub Actions после изменений в img/.
python tools/img_sync.py [SITE]   — SHA коммита берётся из GITHUB_SHA или git rev-parse HEAD."""
import json, os, subprocess, sys, time
import requests
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = sys.argv[1] if len(sys.argv) > 1 else 'https://jadiger.com'
SHA = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
man = json.load(open(os.path.join(ROOT, 'img', 'manifest.json')))
state = requests.get(f'{SITE}/api/img/state', timeout=60).json()
import re
shard = lambda p: int(re.search(r'(\d+)', p.split('/')[-1]).group(1)) // 100
todo = sorted([p for p, h in man.items() if state.get(p) != h], key=shard)
print('файлов в манифесте', len(man), 'залить', len(todo), flush=True)
batch, size, sent, bad = [], 0, 0, []
def flush():
    global batch, size, sent
    if not batch: return
    files = [(p, (os.path.basename(p), open(os.path.join(ROOT, 'img', p), 'rb').read())) for p in batch]
    for t in range(4):
        try:
            r = requests.post(f'{SITE}/api/img/put?sha={SHA}&m={shard(batch[0])}', files=files, timeout=120); d = r.json()
            if r.ok: sent += d['done']; bad.extend(d['bad']); break
            print('ошибка', r.status_code, d, flush=True)
        except Exception as e: print('сеть', e, flush=True)
        time.sleep(3 + 5 * t)
    batch, size = [], 0
for i, p in enumerate(todo):
    if batch and shard(batch[0]) != shard(p): flush()
    batch.append(p); size += os.path.getsize(os.path.join(ROOT, 'img', p))
    if len(batch) >= 25 or size > 3_000_000: flush()
    if i % 400 == 0: print(i, '/', len(todo), flush=True)
flush()
print('залито', sent, 'отклонено', len(bad), bad[:10])
if bad: sys.exit(1)
