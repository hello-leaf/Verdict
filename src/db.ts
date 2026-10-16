import Database from "better-sqlite3"
import { type Mode } from "./ai.js"

export type User = {
  id: number
  username: string | null
  first_name: string
  created_at: string
  last_seen: string
  sets_api: number
  api_key: string
  mode: Mode
  model: string
}

const dbPath = process.env.DATABASE_PATH ?? "verdict.db";
const db = new Database("verdict.db")

// create table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    api_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP
  )
`)

// chat history
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`)

function addColumn(name: string, type: string) {
  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all() as { name: string }[];

  if (!columns.some(column => column.name === name)) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN ${name} ${type}
    `);
  }
}

addColumn("sets_api", "INTEGER NOT NULL DEFAULT 0")
addColumn("api_key", "TEXT")
addColumn("mode", "TEXT NOT NULL DEFAULT 'author'")
addColumn("model", "TEXT")

const saveUserQuery = db.prepare(`
  INSERT INTO users (id, username, first_name)
  VALUES (@id, @username, @first_name)
  ON CONFLICT(id) DO UPDATE SET
    username = excluded.username,
    first_name = excluded.first_name,
    last_seen = CURRENT_TIMESTAMP
`)

export function saveUser(user: {
  id: number;
  username: string | undefined;
  first_name: string;
}) {
  saveUserQuery.run({
    id: user.id,
    username: user.username ?? null,
    first_name: user.first_name
  })
}

export function getUserCount(): number {
  const result = db
    .prepare("SELECT COUNT(*) AS total FROM users")
    .get() as { total: number };

  return result.total;
}

export function getUserById(userId: number): User | undefined {
  return db.prepare(
    "SELECT * FROM users WHERE id = ?"
  ).get(userId) as User | undefined
}

export function setUserField(id: number, field: string, value: string | number) {
  db.prepare(`
    UPDATE users
    SET ${field} = ?
    WHERE id = ?
  `).run(value, id)
}

// chat histories
export function saveChatMessage(
  userId: number,
  mode: string,
  role: "user" | "assistant",
  content: string
): void {
  db.prepare(`
    INSERT INTO chat_history (user_id, mode, role, content)
    VALUES (?, ?, ?, ?)
  `).run(userId, mode, role, content)
}

export function getChatHistory(
  userId: number,
  mode: string,
  limit = 10
): { role: "user" | "assistant"; content: string }[] {
  const rows = db.prepare(`
    SELECT role, content
    FROM chat_history
    WHERE user_id = ? AND mode = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, mode, limit) as {
    role: "user" | "assistant"
    content: string
  }[]

  return rows.reverse()
}

export function clearChatHistory(userId: number): void {
  db.prepare(`
    DELETE FROM chat_history
    WHERE user_id = ?
  `).run(userId)
}
