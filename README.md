# Jadiger на Cloudflare (jadiger.com)

Сайт работает на Cloudflare Pages, API на Pages Functions (`functions/api`), база данных в Cloudflare D1. Вход только через Google: кнопка Google выдаёт подписанный токен, сервер проверяет его по ключам Google и ставит свою сессию в защищённую cookie на 90 дней.

```
public/             сайт: index.html и pack/ с фото монет
functions/api/      API: вход, коллекция, вишлист, фото, распознавание
schema.sql          таблицы базы D1
wrangler.toml       настройки: ID базы и Google Client ID
```

## 1. Google: получить Client ID (около 10 минут)

1. Откройте https://console.cloud.google.com/ и создайте проект «Jadiger».
2. Откройте **APIs & Services → OAuth consent screen** (в новом интерфейсе **Google Auth Platform → Branding**). Тип выберите **External**. Укажите название Jadiger и email поддержки, а в **Authorized domains** добавьте `jadiger.com`.
   Права нужны только `openid`, `email` и `profile`. Это базовые права, поэтому проверка приложения в Google не нужна. Переведите приложение в режим **In production** (Publishing status → Publish app), иначе войти смогут только тестовые пользователи.
3. Откройте **Credentials → Create credentials → OAuth client ID**. Выберите тип **Web application** и в **Authorized JavaScript origins** добавьте:
   - `https://jadiger.com`
   - `https://www.jadiger.com`
   - `http://localhost:8788` (для локальной проверки)

   Поле Redirect URIs заполнять не нужно.
4. Скопируйте **Client ID** (вида `1234-abc.apps.googleusercontent.com`) в `wrangler.toml`, в строку `GOOGLE_CLIENT_ID`.

## 2. Cloudflare: база и деплой

Нужен Node.js LTS (https://nodejs.org). Команды запускаются в папке проекта, в PowerShell или cmd.

```bash
npx wrangler login                                   # откроет браузер, войдите в Cloudflare
npx wrangler d1 create jadiger                       # скопируйте database_id в wrangler.toml
npx wrangler d1 execute jadiger --remote --file schema.sql
npx wrangler pages project create jadiger --production-branch main
npx wrangler pages deploy
```

После деплоя сайт откроется на `https://jadiger.pages.dev`.

## 3. Подключить домен

В Cloudflare откройте **Workers & Pages → jadiger → Custom domains → Set up a custom domain**. Добавьте `jadiger.com`, затем `www.jadiger.com`. Домен уже в Cloudflare, поэтому DNS-записи создадутся сами, а SSL выпустится за несколько минут.

## 4. Распознавание монет по фото (по желанию)

Функция работает через Claude API и стоит денег за каждый запрос. Пока ключ не задан, кнопка сообщает, что распознавание не подключено.

```bash
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name jadiger
```

Ключ создаётся на https://console.anthropic.com. Лимиты задаются в `wrangler.toml`: `AI_DAILY_LIMIT` — распознаваний в день на пользователя (10), `AI_DAILY_BUDGET_USD` — общий потолок расходов сайта в сутки (по UTC, $3); после него распознавание выключается до следующего дня. Расход считается по фактическим токенам из ответа API и ценам `AI_PRICE_*`. Инструкция с каталогом отправляется как кэшируемый system-промпт, поэтому повторные запросы в течение 5 минут примерно в 5 раз дешевле. Дополнительно можно задать лимит расходов на сам ключ в консоли Anthropic.

## Обновление сайта

Измените файлы и выполните `npx wrangler pages deploy`. Можно просто запустить `deploy.cmd`.

## Локальная проверка

```bash
npx wrangler d1 execute jadiger --local --file schema.sql
npx wrangler pages dev --port 8788
```

Сайт откроется на http://localhost:8788. Для входа адрес `http://localhost:8788` должен быть в Authorized JavaScript origins.

## Что хранится

| Таблица | Содержимое |
|---|---|
| users | Google ID, имя, email, ссылка на аватар |
| sessions | хэши токенов сессий (сами токены хранятся только в cookie браузера) |
| items | коллекция: количество, состояние, цены, где и когда куплено, заметка |
| wish | вишлист |
| photos | фото собственных экземпляров |
| ai_usage | счётчик распознаваний по дням |

Пользователь может удалить аккаунт и все свои данные в кабинете («Профиль и данные»).

Бесплатного тарифа D1 (5 ГБ, 5 млн чтений в день) хватит на тысячи коллекционеров.

## Публичные коллекции

`jadiger.com/u/<адрес>` — коллекция пользователя, если он открыл её в «Профиль и данные». Таблица `profiles` (создаётся сама при первом запросе),
API: `GET/PUT /api/profile`, `GET /api/u/<адрес>` (только id монет, количество и состояние — без цен, мест покупки и заметок).
Страницу с мета-тегами отдаёт `functions/u/[handle].js`.

## Автообновление каталога

`.github/workflows/update.yml` раз в сутки (01:17 UTC) запускает `tools/update.py`:
- Казахстан — магазин kazcoins (новые id после последнего известного): характеристики, цена, фото аверса и реверса, форма и отверстия по прозрачности PNG;
- Узбекистан — каталог cbu.uz (новые страницы монет), фото с сайта ЦБ;
- Кыргызстан — таблица выпусков nbkr.kg (без фото, монета показывается макетом).

Новые монеты пишутся в `public/auto/` (coins.js, миниатюры и текстуры) и в `public/og/`, `public/sitemap.xml`; сайт добавляет их к основному каталогу
с id после последнего. Журнал последнего запуска — `tools/last_update.log`. Ручной запуск: Actions → «Обновление каталога» → Run workflow,
или локально `python tools/update.py` (`--dry` — без записи).

## Рыночные цены (Numista)

`tools/numista.py` запускается в том же ежедневном GitHub Actions после обновления каталога, если задан секрет репозитория
`NUMISTA_API_KEY` (бесплатный ключ: https://en.numista.com/api/). Бесплатный тариф — 2000 запросов в месяц, поэтому монеты
обрабатываются порциями (до 120 запросов в день): сопоставление с типом Numista → выпуск года → оценки по состояниям в валюте страны.
Сначала идут монеты без цены Нацбанка. Результат — `public/auto/market.json`, состояние — `tools/numista_state.json`, журнал — `tools/last_numista.log`.
На сайте рыночная оценка используется после оценки владельца и до цены Нацбанка; в карточке монеты показана ссылка «Numista · N#…» (требование лицензии Numista).
