# Сборщики «Пятёрка»

Админка, Telegram-бот и Mini App для учёта килограммов и выплат. Один процесс в проде: API, статика и бот.

## Локально

```bash
cp .env.example .env
npm install
npm run db:up
npx prisma migrate deploy
npm run db:seed   # только на пустой базе
npm run dev
```

- Админка: http://localhost:5173
- API: http://localhost:3001
- Пароль: `ADMIN_PASSWORD` из `.env`

## Деплой (Docker)

Нужен сервер с Docker и публичный **https**-адрес (Telegram Mini App без TLS не откроется). Пароль Postgres в URL не должен содержать `@ : / #`.

1. Скопируйте `.env.example` в `.env` и задайте `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`.
2. `MINIAPP_URL` — публичный https URL, который смотрит на контейнер `app` (порт `PORT`, по умолчанию 3001).
3. Перед контейнером поставьте Caddy/nginx или Cloudflare Tunnel с TLS.
4. Запуск:

```bash
npm run prod:up
```

Миграции применяются при старте контейнера. Логи: `docker compose -f docker-compose.prod.yml logs -f app`.

После подъёма:

1. Откройте админку по https, войдите с `ADMIN_PASSWORD`.
2. Раздел **Telegram**: токен бота и URL Mini App.
3. Добавьте бота в группу и отправьте `/bind`.
4. В @BotFather: Menu Button → тот же https URL.

Остановка: `npm run prod:down`. Том Postgres сохраняется.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Vite + API с hot reload |
| `npm run build` | Сборка фронта |
| `npm start` | Прод-сервер (отдаёт `dist/` и `/api`) |
| `npm run db:migrate:deploy` | Миграции без reset |
| `npm run prod:up` | Сборка и запуск Docker |
