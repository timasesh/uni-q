// scripts/create-admin.ts
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'data', 'uni-q.sqlite'));

async function createAdmin() {
  // Создаём таблицу, если её нет
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT
    )
  `);

  const admins = [
    { login: 'S.Mussa@almau.edu.kz', password: 'admin2026' }
  ];

  for (const admin of admins) {
    const hashedPassword = await bcrypt.hash(admin.password, 10);

    try {
      db.prepare(`
        INSERT INTO admin_users (login, password_hash, name)
        VALUES (?, ?, ?)
      `).run(admin.login, hashedPassword, admin.login);

      console.log('✅ Админ создан:', admin.login);
    } catch (err: any) {
      if (err.message.includes('UNIQUE constraint failed')) {
        console.log('⚠️ Админ уже существует:', admin.login);
      } else {
        throw err;
      }
    }
  }

  db.close();
}

createAdmin().catch(console.error);