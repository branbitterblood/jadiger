"""Автообновление каталога Jadiger: новые выпуски Нацбанков Казахстана, Узбекистана и Кыргызстана.

Запуск: python tools/update.py [--dry]   (из корня репозитория; GitHub Actions — раз в сутки)

Основной каталог (id 0..N-1) вшит в public/index.html. Новые монеты дописываются «поверх» него:
  public/auto/coins.js      — window.JADIGER_AUTO = {base, coins:[...], prices:{...}, kz_seen:[...], ...}
  public/auto/t/<id>.json   — миниатюры [герб, сюжет] (data:URL webp, 200 px)
  public/auto/f/<id>.json   — текстуры для 3D [герб, сюжет] (512 px)
  public/og/<id>.jpg        — превью ссылки 1200×630
  public/sitemap.xml        — адреса страниц монет
Сайт подключает coins.js до основного скрипта и добавляет монеты с id = N, N+1, …;
страницы /kz|uz|kg/<slug> для них отдаёт functions/_lib/coinpage.js.
"""
import base64, io, json, os, re, sys, time, unicodedata, urllib.parse
from datetime import datetime, timezone

import numpy as np
import requests
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
AUTO_JS = os.path.join(PUB, 'auto', 'coins.js')
SITE = 'https://jadiger.com'
DRY = '--dry' in sys.argv
S = requests.Session()
S.headers['User-Agent'] = 'Mozilla/5.0 (Jadiger catalog updater; +https://jadiger.com)'
LOG = []


def log(*a):
    msg = ' '.join(str(x) for x in a); LOG.append(msg); print(msg, flush=True)


def get(url, binary=False, tries=3, timeout=40):
    for i in range(tries):
        try:
            r = S.get(url, timeout=timeout)
            if r.status_code == 200:
                if binary: return r.content
                if r.encoding in (None, 'ISO-8859-1'): r.encoding = r.apparent_encoding
                return r.text
            if r.status_code in (403, 404, 410): return None
        except Exception as e:
            if i == tries - 1: log('  ! сеть:', url, type(e).__name__)
        time.sleep(2 + 3 * i)
    return None


# ---------------- основной каталог из index.html ----------------
def read_main():
    h = open(os.path.join(PUB, 'index.html'), encoding='utf-8').read()
    grab = lambda name: json.loads(re.search(r'const ' + name + r' = (.*);(?: //[^\n]*)?\n', h).group(1))
    return grab('RAW'), grab('SLUGS'), grab('SRC_URL')


def load_auto():
    if os.path.exists(AUTO_JS):
        t = open(AUTO_JS, encoding='utf-8').read()
        return json.loads(t[t.index('{'):t.rindex('}') + 1])
    return {}


def save_auto(a):
    os.makedirs(os.path.dirname(AUTO_JS), exist_ok=True)
    with open(AUTO_JS, 'w', encoding='utf-8') as f:
        f.write('// Новые выпуски, добавленные автоматически (tools/update.py). Не править руками.\nwindow.JADIGER_AUTO = ')
        json.dump(a, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')


# ---------------- общие утилиты ----------------
PRE = str.maketrans({'қ': 'q', 'Қ': 'q', 'ғ': 'g', 'Ғ': 'g', 'ұ': 'u', 'Ұ': 'u', 'ү': 'u', 'Ү': 'u', 'ө': 'o', 'Ө': 'o', 'ә': 'a', 'Ә': 'a',
                     'і': 'i', 'І': 'i', 'һ': 'h', 'ң': 'ng', 'Ң': 'ng', 'ӯ': 'u', 'ҳ': 'h', 'ӣ': 'i', 'ҷ': 'j', 'Ҷ': 'j'})
RU = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя', ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'iu', 'ia']))


def translit(s):
    s = s.translate(PRE).lower()
    s = ''.join(RU.get(ch, ch) for ch in s)
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.replace("'", '')).strip('-')[:70].strip('-')


def norm(s):
    s = unicodedata.normalize('NFKC', str(s)).lower().replace('ё', 'е')
    return re.sub(r'[^0-9a-zа-яәғқңөұүһіáéíóúýǵńşçğ]', '', s)


def metal_tag(m):
    m = (m or '').lower()
    return 'au' if 'au' in m else 'ag' if 'ag' in m else translit(m) or 'cuni'


def make_slug(row, cc, taken):
    base = f"{translit(row[0]) or 'coin'}-{row[1][-4:]}"
    for cand in (base, f'{base}-{row[2]}', f'{base}-{row[2]}-{metal_tag(row[3])}'):
        if (cc, cand) not in taken: return cand
    k = 2
    while (cc, f'{base}-{k}') in taken: k += 1
    return f'{base}-{k}'


def data_url(im, size, q):
    im = im.copy(); im.thumbnail((size, size), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()


BG = (190, 190, 192)


def coin_mask(im):
    """маска монеты: по прозрачности (PNG магазина) или по отличию от фона в углах (JPG)."""
    a = np.array(im.convert('RGBA')).astype(int)
    if (a[..., 3] < 20).mean() > 0.03: m = a[..., 3] > 40
    else:
        rgb = a[..., :3]; b = np.r_[rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)]
        m = np.abs(rgb - np.median(b, 0)).max(2) > 30
    return m


def prepare(im):
    """→ (картинка RGBA, обрезанная по монете, квадратная с прозрачными полями; круглая ли; дыры [[cx,cy,r]])"""
    im = im.convert('RGBA'); m = coin_mask(im)
    ys, xs = np.where(m)
    if len(xs) < 2000: raise ValueError('монета не найдена на фото')
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = im.crop((x0, y0, x1, y1)); mk = m[y0:y1, x0:x1]
    w, h = x1 - x0, y1 - y0
    # круглая: заполнение вписанного эллипса и соотношение сторон
    yy, xx = np.mgrid[0:h, 0:w]; ell = ((xx + .5 - w / 2) / (w / 2)) ** 2 + ((yy + .5 - h / 2) / (h / 2)) ** 2 <= 1
    inside = mk[ell].mean(); outside = mk[~ell].mean() if (~ell).any() else 0
    round_ = abs(w / h - 1) < 0.03 and inside > 0.95 and outside < 0.12
    # отверстия: прозрачные участки внутри силуэта
    holes = []
    try:
        from scipy import ndimage
        filled = ndimage.binary_fill_holes(mk); hole = filled & ~mk
        lab, n = ndimage.label(hole)
        for k in range(1, n + 1):
            pts = np.argwhere(lab == k)
            if len(pts) < 0.0008 * w * h: continue
            cy, cx = pts.mean(0); r = np.sqrt(len(pts) / np.pi)
            holes.append([round(float((cx + .5) / w), 4), round(float((cy + .5) / h), 4), round(float(r / w), 4)])
    except ImportError:
        pass
    return crop, mk, round_, holes, w / h


def round_texture(crop, size=512):
    w, h = crop.size; s = max(w, h)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(crop, ((s - w) // 2, (s - h) // 2))
    sq = sq.resize((size, size), Image.LANCZOS)
    flat = Image.alpha_composite(Image.new('RGBA', (size, size), BG + (255,)), sq)
    m = Image.new('L', (size * 4, size * 4), 0); ImageDraw.Draw(m).ellipse((6, 6, size * 4 - 7, size * 4 - 7), fill=255)
    flat.putalpha(m.resize((size, size), Image.LANCZOS)); return flat


def shaped_texture(crop, size=512):
    w, h = crop.size; sc = size / max(w, h)
    rgb = Image.alpha_composite(Image.new('RGBA', crop.size, (232, 233, 236, 255)), crop)
    rgb.putalpha(crop.getchannel('A'))
    return rgb.resize((max(1, round(w * sc)), max(1, round(h * sc))), Image.LANCZOS)


def contour01(mk, n=160):
    """контур силуэта в долях ширины/высоты (как в shapes.json)."""
    import cv2
    m = mk.astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(float)
    ap = cv2.approxPolyDP(np.round(c * 4).astype(np.int32).reshape(-1, 1, 2), 3.0, True)[:, 0, :] / 4.0
    h, w = m.shape
    return [round(float(v), 4) for x, y in ap for v in ((x + .5) / w, (y + .5) / h)]


def circle01(n=128):
    return [round(float(v), 4) for k in range(n) for v in (.5 + .5 * np.cos(2 * np.pi * k / n), .5 + .5 * np.sin(2 * np.pi * k / n))]


def build_images(cid, design, emblem):
    """design/emblem: PIL → пишет t/f паки, возвращает shape (или None для круглой)."""
    d = prepare(design); e = prepare(emblem)
    shape = None
    if d[2] and e[2] and not d[3] and not e[3]:
        tex = [round_texture(e[0]), round_texture(d[0])]
    else:
        tex = [shaped_texture(e[0]), shaped_texture(d[0])]
        if d[2] and e[2]:   # круглая с отверстием
            shape = dict(ar=1.0, k='круглая, с отверстием', f=circle01(), b=circle01(), h=e[3] or d[3])
        else:
            shape = dict(ar=round(float(e[4]), 4), k='фигурная', f=contour01(d[1]), b=contour01(e[1]))
            if e[3] or d[3]: shape['h'] = e[3] or d[3]
    if not DRY:
        for kind, size, q in (('t', 200, 80), ('f', 512, 86)):
            os.makedirs(os.path.join(PUB, 'auto', kind), exist_ok=True)
            json.dump([data_url(x, size, q) for x in tex], open(os.path.join(PUB, 'auto', kind, f'{cid}.json'), 'w'))
        og = Image.new('RGB', (1200, 630), (14, 17, 22))
        for k, x in enumerate((tex[1], tex[0])):
            y = x.copy(); y.thumbnail((540, 540), Image.LANCZOS)
            og.paste(y, (330 + k * 540 - y.width // 2, 315 - y.height // 2), y)
        og.save(os.path.join(PUB, 'og', f'{cid}.jpg'), quality=68, optimize=True, progressive=True)
    return shape


def fetch_image(url):
    b = get(url, binary=True)
    if b is None and 'api-kazcoins' in url:   # api-kazcoins иногда закрыт — тот же файл через прокси картинок магазина
        b = get('https://kazcoins.nationalbank.kz/_next/image?url=' + urllib.parse.quote(url, safe='') + '&w=3840&q=100', binary=True)
    if not b: raise ValueError('не скачалась картинка ' + url)
    return Image.open(io.BytesIO(b))


# ---------------- Казахстан: магазин kazcoins ----------------
def kz_coin(kid):
    h = get(f'https://kazcoins.nationalbank.kz/ru/catalog/{kid}')
    if not h: return None
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', h)
    txt = ''.join(json.loads('"' + c + '"') for c in chunks)
    dec = json.JSONDecoder()
    for mm in re.finditer('\\{"id":%d,' % kid, txt):
        try: o, _ = dec.raw_decode(txt, mm.start())
        except Exception: continue
        if o.get('id') == kid and 'circulation' in o and o.get('avers_image'): return o
    return None


def kz_series_name(raw, known):
    raw = re.sub(r'\s+', ' ', (raw or '').strip(' «»"'))
    if not raw: return 'Без серии'
    for s in known:
        if norm(s) == norm(raw): return s
    if not raw.isupper(): return raw
    # ВЕРХНИЙ РЕГИСТР → «Как в предложении», имена собственные — по словарю из названий серий каталога
    proper = {w.lower(): w for s in known for w in s.split()[1:] if w[:1].isupper()}
    words = raw.lower().split()
    return ' '.join((w[:1].upper() + w[1:]) if i == 0 else proper.get(w, w) for i, w in enumerate(words))


def kz_update(main, auto, taken):
    seen = set(auto.setdefault('kz_seen', list(range(1, 743))))
    known_series = sorted({r[9] for r in main if (r[10:] or ['kz'])[0] == 'kz'})
    have = {(norm(r[0]), str(r[2]), metal_tag(r[3])) for r in main + [c['r'] for c in auto['coins']] if (r[10:] or ['kz'])[0] == 'kz'}
    top = max(seen); added = 0
    for kid in range(top - 40, top + 61):   # магазин выкладывает новинки с id чуть выше последнего; пропуски бывают
        if kid in seen or kid < 1: continue
        o = kz_coin(kid); time.sleep(0.4)
        if not o: continue
        nom = str((o.get('nominal') or {}).get('denomination') or '0')
        metal = (o.get('metal') or {}).get('name') or ''
        title = re.sub(r'^[«"]+|[»"]+$', '', re.sub(r'\s+', ' ', o.get('name') or '').strip())
        key = (norm(title), nom, metal_tag(metal))
        seen.add(kid)
        if key in have: log(f'KZ {kid}: «{title}» уже в каталоге'); continue
        d = o.get('prod_date') or ''
        date = '.'.join(reversed(d.split('-'))) if re.match(r'\d{4}-\d\d-\d\d', d) else d[:4]
        mat = (o.get('material_type') or {}).get('name') or ''
        sec = 'Золото' if 'Золот' in mat or metal.startswith('Au') else 'Серебро' if 'Серебр' in mat or metal.startswith('Ag') else 'Недрагоценные'
        diam = (o.get('diameter') or {}).get('value') or ''
        fnum = lambda x: f'{float(x):.2f}' if re.match(r'^[\d.]+$', str(x or '')) else ''
        row = [title, date, nom, metal, fnum(o.get('mass') or o.get('weight')), fnum(diam), ((o.get('quality') or {}).get('name') or '').lower(),
               str(o.get('circulation') or ''), sec, kz_series_name((o.get('series') or {}).get('name_'), known_series), 'kz']
        cid = auto['base'] + len(auto['coins'])
        entry = dict(id=cid, r=row, src=f'https://kazcoins.nationalbank.kz/ru/catalog/{kid}', kz=kid, added=today())
        if o.get('price'): entry['price'] = int(o['price'])
        try:
            entry['shape'] = build_images(cid, fetch_image(o['avers_image']), fetch_image(o['revers_image'])); entry['photo'] = True
            if not entry['shape']: del entry['shape']
        except Exception as e:
            log(f'  ! KZ {kid}: фото не обработано ({e}), монета будет с макетом'); entry['photo'] = False
        entry['slug'] = make_slug(row, 'kz', taken); taken.add(('kz', entry['slug']))
        auto['coins'].append(entry); have.add(key); added += 1
        log(f'KZ + {cid} «{title}» {date} {nom} тенге {metal} → /kz/{entry["slug"]}')
    # цены и наличие для уже добавленных автоматически
    for c in auto['coins']:
        if c.get('kz') and c['added'] >= days_ago(120):
            o = kz_coin(c['kz']); time.sleep(0.4)
            if o and o.get('price'): c['price'] = int(o['price'])
    auto['kz_seen'] = sorted(seen)
    return added


# ---------------- Узбекистан: cbu.uz ----------------
def uz_update(main, auto, src_url, taken):
    from bs4 import BeautifulSoup
    B = 'https://cbu.uz'
    h = get(B + '/ru/banknotes-coins/commemorative-coins/catalog/')
    if not h: log('UZ: каталог cbu.uz не открылся'); return 0
    soup = BeautifulSoup(h, 'html.parser')
    links = sorted({B + a['href'] for a in soup.select('a[href]') if re.fullmatch(r'/ru/banknotes-coins/commemorative-coins/catalog/\d{4}/\d+/', a['href'])})
    known = {re.search(r'/(\d+)/$', u).group(1) for u in src_url.values() if 'cbu.uz' in u}
    known |= set(auto.setdefault('uz_seen', []))
    if not auto['uz_seen']:   # первый запуск: всё, что не попало в каталог при ручной сборке (сувениры, наборы, дубли), — считаем просмотренным
        auto['uz_seen'] = sorted({re.search(r'/(\d+)/$', u).group(1) for u in links} - known); known |= set(auto['uz_seen'])
        log('UZ: первый запуск, отмечено просмотренными', len(auto['uz_seen']))
    added = 0
    skip = re.compile(r'gov|reestr|parliament|finance|ccitt|minjust|openinfo|fondbozori|AppStore|GooglePlay|qr_code|images\.jpg|photo_2023_11|social')
    for u in links:
        uid = re.search(r'/(\d+)/$', u).group(1)
        if uid in known: continue
        auto['uz_seen'].append(uid); known.add(uid)
        dh = get(u)
        if not dh: continue
        d = BeautifulSoup(dh, 'html.parser'); txt = d.get_text('\n')
        g = lambda p: (m.group(1).strip() if (m := re.search(p, txt)) else '')
        title = re.sub(r'^[«"\s]+|[»"\s.]+$', '', d.h1.get_text(strip=True) if d.h1 else '')
        if 'сувенир' in title.lower() or 'набор' in title.lower(): log(f'UZ {uid}: «{title}» пропущено (сувенир/набор)'); continue
        metal = g(r'Тип металла:\s*([^\n]+)'); gold = metal.startswith('З')
        w = re.sub(r'[^\d,.]', '', g(r'Вес \(грамм\):\s*([^\n]+)')).replace(',', '.')
        nom = re.sub(r'\D', '', g(r'Номинал \(сум\):\s*([^\n]*)')) or '0'
        q = g(r'Качество:\s*([^\n]+)')
        year = re.search(r'catalog/(\d{4})', u).group(1)
        t = title[:1].upper() + title[1:].lower() if title.isupper() else title
        row = [t, year, nom, 'Au 999,9' if gold else 'Ag 999,9', f'{float(w):.2f}' if w else '', '', 'proof' if q.upper() == 'PROOF' else q.lower(), '',
               'Золото' if gold else 'Серебро', 'Без серии', 'uz']
        imgs = []
        for e in d.select('a[href*="upload/iblock"], img[src*="upload/iblock"]'):
            s = e.get('href') or e.get('src')
            if not skip.search(s) and s not in imgs: imgs.append(s)
        cid = auto['base'] + len(auto['coins'])
        entry = dict(id=cid, r=row, src=u, added=today(), photo=False)
        if len(imgs) >= 2:
            try:   # cbu: [0] сюжет, [1] герб
                entry['shape'] = build_images(cid, fetch_image(B + imgs[0]), fetch_image(B + imgs[1])); entry['photo'] = True
                if not entry['shape']: del entry['shape']
            except Exception as e: log(f'  ! UZ {uid}: фото не обработано ({e})')
        entry['slug'] = make_slug(row, 'uz', taken); taken.add(('uz', entry['slug']))
        auto['coins'].append(entry); added += 1
        log(f'UZ + {cid} «{t}» {year} {nom} сум → /uz/{entry["slug"]}')
    return added


# ---------------- Кыргызстан: таблица nbkr.kg ----------------
def kg_update(main, auto, taken):
    from bs4 import BeautifulSoup
    h = get('https://www.nbkr.kg/index1.jsp?item=1306&lang=RUS') or get('https://nbkr.kg/index1.jsp?item=1306&lang=RUS')
    if not h: log('KG: каталог nbkr.kg не открылся'); return 0
    soup = BeautifulSoup(h, 'html.parser'); cl = lambda s: re.sub(r'\s+', ' ', s.replace('\xa0', ' ')).strip()
    have = {(norm(r[0]), r[1]) for r in main + [c['r'] for c in auto['coins']] if (r[10:] or [''])[0] == 'kg'}
    have_t = {norm(r[0]) for r in main + [c['r'] for c in auto['coins']] if (r[10:] or [''])[0] == 'kg'}
    added = 0
    first = 'kg_seen' not in auto; seen = set(auto.setdefault('kg_seen', []))
    num = lambda s: float(m.group(0).replace(',', '.')) if (m := re.search(r'\d+(?:[.,]\d+)?', (s or '').replace(' ', ''))) else 0
    for tb in soup.find_all('table'):
        rows = [[cl(c.get_text(' ')) for c in tr.find_all(['td', 'th'])] for tr in tb.find_all('tr')]
        rows = [r for r in rows if any(r)]
        if not rows or 'Дата выпуска' not in ' '.join(rows[0]): continue
        for r in rows[1:]:
            if len(r) < 5: continue
            title, nomS, metalS, priceS, date = r[:5]
            if not re.match(r'\d\d\.\d\d\.\d{4}$', date): continue
            title = re.sub(r'\s+-\s+', ' — ', title)
            k = norm(title) + '|' + date
            if k in seen or (norm(title), date) in have or norm(title) in have_t: continue
            seen.add(k); auto['kg_seen'] = sorted(seen)
            if first: continue   # первый запуск: всё из таблицы уже разобрано вручную
            m = metalS.lower(); gold = 'золот' in m and 'серебро' not in m and 'напыл' not in m; cuni = 'медь' in m
            metal = ('Au ' + ('916' if '916' in m else '999')) if gold else 'CuNi' if cuni else 'Ag 925'
            nom = str(int(num(nomS)))
            row = [title, date, nom, metal, '', '', '', '', 'Золото' if gold else 'Недрагоценные' if cuni else 'Серебро', 'Без серии', 'kg']
            cid = auto['base'] + len(auto['coins'])
            entry = dict(id=cid, r=row, src='https://www.nbkr.kg/index1.jsp?item=1306&lang=RUS', added=today(), photo=False)
            if re.search(r'\d', priceS) and 'заверш' not in priceS: entry['price'] = int(num(priceS.replace(' ', '')))
            entry['slug'] = make_slug(row, 'kg', taken); taken.add(('kg', entry['slug']))
            auto['coins'].append(entry); have.add((norm(title), date)); added += 1
            log(f'KG + {cid} «{title}» {date} {nom} сом (без фото, макет) → /kg/{entry["slug"]}')
    return added


def today(): return datetime.now(timezone.utc).strftime('%Y-%m-%d')
def days_ago(n): return datetime.fromtimestamp(time.time() - n * 86400, timezone.utc).strftime('%Y-%m-%d')


def write_sitemap(main_slugs, main, auto):
    paths = [f'{(r[10:] or ["kz"])[0]}/{s}' for r, s in zip(main, main_slugs)] + [f'{c["r"][10]}/{c["slug"]}' for c in auto['coins']]
    urls = [f'{SITE}/', f'{SITE}/en/'] + [f'{SITE}/{p}' for p in paths] + [f'{SITE}/en/{p}' for p in paths]
    with open(os.path.join(PUB, 'sitemap.xml'), 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        f.writelines(f'<url><loc>{u}</loc></url>\n' for u in urls); f.write('</urlset>\n')


def main():
    raw, slugs, src_url = read_main()
    auto = load_auto()
    base = len(raw)
    if auto.get('base') != base:   # основной каталог пересобран и уже включает эти монеты (или первый запуск)
        if auto.get('coins'): log(f'основной каталог: {base} монет; автодобавленные до {base} уже в нём')
        auto['coins'] = [c for c in auto.get('coins', []) if c['id'] >= base]
        auto['base'] = base
    auto.setdefault('coins', [])
    taken = {((r[10:] or ['kz'])[0], s) for r, s in zip(raw, slugs)} | {(c['r'][10], c['slug']) for c in auto['coins']}
    n0 = len(auto['coins'])
    for name, fn in (('KZ', lambda: kz_update(raw, auto, taken)), ('UZ', lambda: uz_update(raw, auto, src_url, taken)), ('KG', lambda: kg_update(raw, auto, taken))):
        try: fn()
        except Exception as e: log(f'{name}: ошибка {type(e).__name__}: {e}')
    auto['checked'] = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    new = len(auto['coins']) - n0
    log(f'итого новых монет: {new}; всего автодобавленных: {len(auto["coins"])}')
    if DRY: return
    with open(os.path.join(ROOT, 'tools', 'last_update.log'), 'w') as f: f.write(auto['checked'] + '\n' + '\n'.join(LOG) + '\n')
    old = load_auto(); old.pop('checked', None); cur = dict(auto); cur.pop('checked', None)
    if json.dumps(old, sort_keys=True, ensure_ascii=False) == json.dumps(cur, sort_keys=True, ensure_ascii=False) and new == 0:
        log('изменений нет'); return
    save_auto(auto); write_sitemap(slugs, raw, auto)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f: f.write(f'new={new}\n')


if __name__ == '__main__':
    main()
