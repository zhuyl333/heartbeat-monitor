/**
 * SQLite database wrapper using sql.js (pure JS, no native modules)
 * Provides an API similar to better-sqlite3
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'heartbeat.db');
const dataDir = path.dirname(DB_PATH);

let db = null;
let SQL = null;

/**
 * Initialize the database (must be called before use)
 */
async function init() {
  if (db) return db;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL-like behavior by running pragmas
  db.run('PRAGMA journal_mode = MEMORY');
  db.run('PRAGMA foreign_keys = ON');

  createTables();
  save();
  return db;
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      grace_seconds INTEGER DEFAULT 300,
      max_retries INTEGER DEFAULT 3,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_paused INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      received_at TEXT DEFAULT (datetime('now')),
      source_ip TEXT,
      status TEXT DEFAULT 'ok',
      FOREIGN KEY (monitor_id) REFERENCES monitors(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      acknowledged INTEGER DEFAULT 0,
      FOREIGN KEY (monitor_id) REFERENCES monitors(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notification_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      message TEXT NOT NULL,
      page TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      read INTEGER DEFAULT 0,
      replied INTEGER DEFAULT 0
    )
  `);

  // Create indexes
  try { db.run('CREATE INDEX IF NOT EXISTS idx_pings_monitor ON pings(monitor_id)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_pings_time ON pings(received_at)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_alerts_monitor ON alerts(monitor_id)'); } catch(e) {}
}

/**
 * Save database to disk
 */
function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Execute a query and return all rows as objects
 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

/**
 * Execute a query and return the first row as object
 */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

/**
 * Execute a statement (INSERT/UPDATE/DELETE) and return { changes, lastInsertRowid }
 */
function run(sql, params = []) {
  db.run(sql, params);
  save();
  
  // Get last insert ID
  const lastRow = get('SELECT last_insert_rowid() as id');
  return {
    changes: db.getRowsModified(),
    lastInsertRowid: lastRow ? lastRow.id : 0,
  };
}

/**
 * Prepare a statement for repeated use (simplified - just runs the statement)
 */
function prepare(sql) {
  return {
    run: (...args) => run(sql, args),
    get: (...args) => get(sql, args),
    all: (...args) => all(sql, args),
  };
}

// Auto-save every 30 seconds
setInterval(() => save(), 30000);

module.exports = { init, all, get, run, prepare, save };
