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

Ключ создаётся на https://console.anthropic.com. Лимит задаётся в `wrangler.toml` (`AI_DAILY_LIMIT`, по умолчанию 30 запросов в день на пользователя).

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
