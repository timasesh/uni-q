# Деплой uni-q на Render.com и схема в Supabase

Текущая версия приложения хранит данные в **SQLite** (файл). Фронтенд собирается в `dist/`, в production один процесс Node отдаёт **API + статику** и WebSocket очереди.

В репозитории есть **SQL-миграция для PostgreSQL** в `supabase/migrations/` — её можно выполнить в Supabase (отдельная БД для отчётов, бэкапов или будущей замены драйвера в коде).

---

## Часть A. Проект в Supabase (PostgreSQL)

1. Зайдите на [supabase.com](https://supabase.com) → **New project** → регион (например **Frankfurt**), задайте пароль БД.
2. Дождитесь статуса **Healthy**.
3. Откройте **SQL Editor** → **New query**.
4. Скопируйте содержимое файла  
   `supabase/migrations/20260412120000_initial.sql`  
   вставьте в редактор и нажмите **Run**.
5. (Опционально) **Table Editor** — проверьте, что таблицы созданы.
6. Строку подключения пригодится позже: **Project Settings → Database → Connection string** (режим **Session** или **Transaction** для pooler). Сейчас приложение **не читает** `DATABASE_URL`; это заготовка под миграцию на `pg` или ETL.

---

## Часть B. Репозиторий и Render

1. Выложите код на **GitHub** (или GitLab / Bitbucket, поддерживаемый Render).
2. Зайдите на [render.com](https://render.com) → **New** → **Blueprint** (или **Web Service** вручную).
3. **Blueprint:** подключите репозиторий, укажите файл `render.yaml`, подтвердите создание сервиса `uni-q`.
4. **Web Service вручную (без Blueprint):**
   - **Environment:** Docker  
   - **Dockerfile path:** `Dockerfile`  
   - **Build command:** (пусто — из Dockerfile)  
   - **Start command:** `npm start`  
   - **Instance type:** Free или выше.

---

## Часть C. Переменные окружения на Render

В **Environment** сервиса задайте:

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `NODE_ENV` | да | `production` (уже в `render.yaml`) |
| `WEB_ORIGIN` | **да** | Точный публичный URL сайта, **без слэша в конце**, например `https://uni-q.onrender.com`. Должен совпадать с адресом в браузере (CORS + cookie + Socket.IO). |
| `SESSION_SECRET` | да | Длинная случайная строка (в Blueprint генерируется автоматически). |
| `SQLITE_PATH` | желательно | Путь к файлу БД. По умолчанию в Blueprint: `./data/uni-q.sqlite` (каталог `data/` создаётся при старте). Для **постоянного** хранилища подключите **Disk** в Render и, например, `SQLITE_PATH=/data/uni-q.sqlite`. |
| `TRUST_PROXY` | да за HTTPS | `1` — чтобы за прокси Render корректно работали secure-cookie и IP (уже в `render.yaml`). |
| `SESSION_COOKIE_SECURE` | редко | `0` только для нестандартной отладки за прокси без HTTPS. |

После изменения `WEB_ORIGIN` сделайте **Manual Deploy → Clear build cache & deploy** при необходимости.

---

## Часть D. Постоянный SQLite (рекомендуется для продакшена)

На **Free** плане файловая система контейнера **сбрасывается** при деплое/перезапуске. Чтобы не терять очередь:

1. В Render откройте сервис → **Disks** → **Add disk** (платная опция на многих планах).
2. Mount path, например: `/data`.
3. Установите `SQLITE_PATH=/data/uni-q.sqlite` и передеплойте.

---

## Часть E. Проверка после деплоя

1. Откройте URL сервиса — должна открыться SPA.
2. Войдите как эдвайзер / админ (учётные данные из сидов в `server.ts` или свои после смены паролей).
3. В другой вкладке откройте панель студента — очередь и сокеты должны обновляться.

---

## Локальный запуск «как на Render»

```bash
npm run build
set NODE_ENV=production
set WEB_ORIGIN=http://localhost:5174
set PORT=5174
npm start
```

Откройте `http://localhost:5174` в браузере.

---

## Связка Render + Supabase в одном слове

- **Сейчас:** приложение = **SQLite** + Render.  
- **Supabase:** выполните SQL из `supabase/migrations/` — получите **ту же схему** в Postgres (удобно для BI, копий, будущей миграции кода на `DATABASE_URL`).

Когда понадобится хранить живые данные только в Supabase, потребуется заменить слой `better-sqlite3` в `server.ts` на клиент `pg` и адаптировать SQL (функции дат, `RETURNING`, транзакции). Структура таблиц для этого уже зафиксирована в миграции.
