// scripts/create-admin.ts
import Database from 'better-sqlite3'; // или твой ORM
import bcrypt from 'bcrypt';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'uni-q.sqlite'));

async function createAdmin() {
  const email = 'S.Mussa@almau.edu.kz';
  const password = 'admin2026';
  const hashedPassword = await bcrypt.hash(password, 10);

  db.prepare(`
    INSERT INTO users (email, password, role, created_at)
    VALUES (?, ?, 'admin', datetime('now'))
    ON CONFLICT(email) DO UPDATE SET role = 'admin'
  `).run(email, hashedPassword, );

  console.log('✅ Админ создан:', email);
  db.close();
}

createAdmin().catch(console.error);