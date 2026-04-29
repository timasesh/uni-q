# Деплой uni-q на Render.com и схема в Supabase

Текущая версия приложения хранит данные в **SQLite** (файл). Фронтенд собирается в `dist/`, в production один процесс Node отдаёт **API + статику** и WebSocket очереди.

В репозитории есть **SQL-миграция для PostgreSQL** в `supabase/migrations/` — выполните её в Supabase перед использованием `DATABASE_URL` для истории визитов (или для BI и копий).

---

## Часть A. Проект в Supabase (PostgreSQL)

1. Зайдите на [supabase.com](https://supabase.com) → **New project** → регион (например **Frankfurt**), задайте пароль БД.
2. Дождитесь статуса **Healthy**.
3. Откройте **SQL Editor** → **New query**.
4. Скопируйте содержимое файла  
   `supabase/migrations/20260412120000_initial.sql`  
   вставьте в редактор и нажмите **Run**.
5. (Опционально) **Table Editor** — проверьте, что таблицы созданы.
6. Строку подключения: **Project Settings → Database** (или **Connect**) → **Connection string**. Для **Render** почти всегда нужен **Session pooler** (порт **6543**, хост `*.pooler.supabase.com`), а не прямой **Database** на **5432** — см. ниже.
7. Передайте строку в **`DATABASE_URL`**: тогда **`ticket_visit_log`** пишется и читается из Postgres (история в админке и у менеджера), очередь и остальное остаются в SQLite на Render.

### Render и ошибка `ENETUNREACH` / IPv6

Прямой хост вида `db.xxxxx.supabase.co` на порту **5432** часто резолвится в **IPv6**. У платформы **Render** до такого адреса часто **нет маршрута** — в логах: `connect ENETUNREACH` и адрес вида `2406:…`.

**Надёжное решение:** в Supabase скопируйте URI **Session mode** (pooler), порт **6543**, пользователь обычно `postgres.<ref>`, пароль тот же, что у БД. Подставьте в `DATABASE_URL` на Render и передеплойте.

В приложении при заданном `DATABASE_URL` вызывается **`dns.setDefaultResultOrder("ipv4first")`**, чтобы при наличии и A, и AAAA-записей сначала использовался IPv4. Если у хоста только AAAA, без pooler это не поможет — нужен pooler или опция Supabase **IPv4** (если включена в проекте).

При недоступности Postgres история **по-прежнему в SQLite** на сервере; API отдаёт её из SQLite и пишет предупреждение в лог, чтобы интерфейс не ломался.

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
| `DATABASE_URL` | нет | URI PostgreSQL Supabase. Включает запись и чтение **`ticket_visit_log`** в облаке (история визитов). Остальные таблицы по-прежнему в SQLite. |
| `UNIQ_REPORT_TZ` | нет | IANA-таймзона для фильтра дат/отчётов в Postgres (рекомендуется `Asia/Almaty`, теперь по умолчанию она же). |
| `DATABASE_SSL` | нет | `0` — отключить SSL к Postgres (обычно не нужно для Supabase). |
| `DATABASE_DNS_IPV4_FIRST` | нет | `0` — не вызывать `dns.setDefaultResultOrder("ipv4first")` (по умолчанию включено при `DATABASE_URL`). |

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
2. Войдите как менеджер / админ (учётные данные из сидов в `server.ts` или свои после смены паролей).
3. В другой вкладке откройте панель студента — очередь и сокеты должны обновляться.

---

## Локальный запуск «как на Render»

```bash
npm run build
set NODE_ENV=production
set WEB_ORIGIN=http://localhost:5174
set PORT=5174
REM по умолчанию SQLite: папка data\ в корне проекта (см. SQLITE_PATH в .env.example)
npm start
```

Откройте `http://localhost:5174` в браузере.

---

## Связка Render + Supabase в одном слове

- **По умолчанию:** приложение = **SQLite** + Render.  
- **С `DATABASE_URL`:** история завершённых визитов (**`ticket_visit_log`**) дублируется в Supabase Postgres и отображается из неё; очередь, талоны (кроме деталей для «reopen» из SQLite), отзывы — в SQLite.  
- Выполните SQL из `supabase/migrations/` в Supabase, чтобы таблицы совпадали со схемой.

Полный перенос всех данных только в Supabase потребует заменить слой `better-sqlite3` в `server.ts` на `pg` для остальных таблиц. Структура для этого зафиксирована в миграции.
