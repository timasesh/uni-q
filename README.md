# uni-q

Очередь для студентов и менеджеров (fullstack).

## Запуск

```bash
npm install
npm run dev
```

- Веб: `http://localhost:5173/`
- API/WebSocket: `http://localhost:5174/`

## Вход для менеджера

Перейдите на `/manager` (старый путь `/advisor` перенаправляется сюда).

Тестовые аккаунты:

- `smirnov` / `Manager2026!` (на уже существующей БД со старыми сидами может действовать `Advisor2026!`)
- `ivanov` / `Manager2026!`

## Звук при вызове студента

Положите файл `song.mp3` в `public/sound/`:

- `public/sound/song.mp3`

Тогда у студента при статусе **CALLED** проиграется мелодия.

