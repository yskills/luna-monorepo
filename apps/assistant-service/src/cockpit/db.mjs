import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// Separate database for the cockpit (lists, money, metrics, briefings),
// independent of the assistant memory. Prepared statements only.
const MIGRATIONS = [
  `CREATE TABLE lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_list_items_list ON list_items(list_id);
  CREATE TABLE money_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booked_on TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    category TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_money_booked ON money_entries(booked_on);
  CREATE TABLE metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    captured_at TEXT NOT NULL
  );
  CREATE INDEX idx_metrics_source_metric_time ON metrics(source, metric, captured_at);
  CREATE TABLE briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    trigger TEXT NOT NULL,
    facts_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    summary_source TEXT NOT NULL
  );`,
  // Connector credentials, encrypted with AES-256-GCM before they reach this table.
  `CREATE TABLE connector_secrets (
    provider TEXT PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
]

export function openCockpitDb(filePath) {
  const resolved = filePath === ':memory:' ? filePath : path.resolve(filePath)
  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
  }
  const db = new Database(resolved)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const version = db.pragma('user_version', { simple: true })
  for (let index = version; index < MIGRATIONS.length; index += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[index])
      db.pragma(`user_version = ${index + 1}`)
    })()
  }
  return db
}
