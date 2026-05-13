import sqlite3

conn = sqlite3.connect('data/uni-q.sqlite-shm')
cursor = conn.cursor()

# Посмотреть таблицы
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
print(cursor.fetchall())

conn.close()