const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'heartbeat.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    grace_seconds INTEGER DEFAULT 300,
    max_retries INTEGER DEFAULT 3,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    is_paused INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT NOT NULL,
    received_at TEXT DEFAULT (datetime('now')),
    source_ip TEXT,
    status TEXT DEFAULT 'ok',
    FOREIGN KEY (monitor_id) REFERENCES monitors(id)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    acknowledged INTEGER DEFAULT 0,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id)
  );

  CREATE TABLE IF NOT EXISTS notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (monitor_id) REFERENCES monitors(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pings_monitor ON pings(monitor_id);
  CREATE INDEX IF NOT EXISTS idx_pings_time ON pings(received_at);
  CREATE INDEX IF NOT EXISTS idx_alerts_monitor ON alerts(monitor_id);
`);

module.exports = db;
