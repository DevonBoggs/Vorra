// Database System — SQLite persistence via better-sqlite3
// All operations are synchronous (better-sqlite3 is sync by design)

const path = require('path');
const { app } = require('electron');

let db = null;

/**
 * Initialize the SQLite database.
 * Creates the kv_store table and future-proofing tables.
 * @returns {import('better-sqlite3').Database}
 */
function initDB() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'vorra.db');

  console.log(`[Vorra:DB] Opening database at ${dbPath}`);
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Core key-value store (mirrors localStorage approach)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
  `);

  // Future normalized tables — created now, populated later
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_histories (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
  `);

  console.log('[Vorra:DB] Database initialized');
  return db;
}

/**
 * Get a value from the kv_store by key.
 * @param {string} key
 * @returns {*} Parsed JSON value, or null if not found
 */
function getValue(key) {
  const stmt = db.prepare('SELECT value FROM kv_store WHERE key = ?');
  const row = stmt.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/**
 * Set a value in the kv_store.
 * @param {string} key
 * @param {*} value — will be JSON.stringified
 */
function setValue(key, value) {
  const stmt = db.prepare(`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  stmt.run(key, serialized, Date.now());
}

/**
 * Get all key-value pairs from the kv_store.
 * @returns {Object} { key: parsedValue, ... }
 */
function getAllData() {
  const stmt = db.prepare('SELECT key, value FROM kv_store');
  const rows = stmt.all();
  const result = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

/**
 * Import a JSON object into the kv_store (bulk upsert).
 * Used for restoring backups or migrating from localStorage.
 * @param {Object} jsonObj — { key: value, ... }
 */
function importData(jsonObj) {
  const stmt = db.prepare(`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const importMany = db.transaction((data) => {
    const now = Date.now();
    for (const [key, value] of Object.entries(data)) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      stmt.run(key, serialized, now);
    }
  });
  importMany(jsonObj);
  console.log(`[Vorra:DB] Imported ${Object.keys(jsonObj).length} key(s)`);
}

/**
 * Export all kv_store data as a JSON string with metadata.
 * @returns {string} JSON string
 */
function exportData() {
  const data = getAllData();
  const exported = {
    version: require('../package.json').version || '7.3.0',
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(exported, null, 2);
}

/**
 * Get the file path of the database.
 * @returns {string}
 */
function getDbPath() {
  return path.join(app.getPath('userData'), 'vorra.db');
}

/**
 * Close the database connection gracefully.
 */
function closeDB() {
  if (db) {
    try {
      db.close();
      console.log('[Vorra:DB] Database closed');
    } catch (err) {
      console.error('[Vorra:DB] Error closing database:', err.message);
    }
    db = null;
  }
}

/**
 * Get the raw database instance (for backup system, etc.).
 * @returns {import('better-sqlite3').Database}
 */
function getDB() {
  return db;
}

module.exports = {
  initDB,
  getValue,
  setValue,
  getAllData,
  importData,
  exportData,
  getDbPath,
  closeDB,
  getDB,
};
