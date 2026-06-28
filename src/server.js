/**
 * Heartbeat Monitor - Main Server
 * 
 * A cron job / API health monitoring service.
 * Users create monitors, get a unique ping URL,
 * and receive alerts when their jobs stop reporting.
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// API Routes
// ============================================================

app.get('/api/status', (req, res) => {
  const total = db.get('SELECT COUNT(*) as count FROM monitors');
  const active = db.get('SELECT COUNT(*) as count FROM monitors WHERE is_paused = 0');
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    monitors: {
      total: total ? total.count : 0,
      active: active ? active.count : 0,
    },
  });
});

app.post('/api/monitors', (req, res) => {
  const { name, grace_seconds } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }

  const id = crypto.randomUUID();
  const slug = crypto.randomBytes(8).toString('hex');
  const grace = Math.max(60, Math.min(86400, parseInt(grace_seconds) || 300));

  db.run(
    'INSERT INTO monitors (id, name, slug, grace_seconds) VALUES (?, ?, ?, ?)',
    [id, name.trim(), slug, grace]
  );

  res.status(201).json({
    id,
    name: name.trim(),
    slug,
    grace_seconds: grace,
    ping_url: `/ping/${slug}`,
    created_at: new Date().toISOString(),
  });
});

app.get('/api/monitors', (req, res) => {
  const monitors = db.all(`
    SELECT m.*,
      (SELECT received_at FROM pings WHERE monitor_id = m.id AND status = 'ok' ORDER BY received_at DESC LIMIT 1) as last_ping,
      (SELECT COUNT(*) FROM alerts WHERE monitor_id = m.id AND acknowledged = 0) as unacknowledged_alerts
    FROM monitors m
    ORDER BY m.created_at DESC
  `);

  res.json(monitors.map(m => ({
    ...m,
    ping_url: `/ping/${m.slug}`,
  })));
});

app.get('/api/monitors/:id', (req, res) => {
  const monitor = db.get(`
    SELECT m.*,
      (SELECT received_at FROM pings WHERE monitor_id = m.id AND status = 'ok' ORDER BY received_at DESC LIMIT 1) as last_ping,
      (SELECT COUNT(*) FROM pings WHERE monitor_id = m.id) as total_pings,
      (SELECT COUNT(*) FROM alerts WHERE monitor_id = m.id) as total_alerts
    FROM monitors m WHERE m.id = ?
  `, [req.params.id]);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  res.json(monitor);
});

app.delete('/api/monitors/:id', (req, res) => {
  const monitor = db.get('SELECT id FROM monitors WHERE id = ?', [req.params.id]);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  db.run('DELETE FROM pings WHERE monitor_id = ?', [req.params.id]);
  db.run('DELETE FROM alerts WHERE monitor_id = ?', [req.params.id]);
  db.run('DELETE FROM notification_channels WHERE monitor_id = ?', [req.params.id]);
  db.run('DELETE FROM monitors WHERE id = ?', [req.params.id]);

  res.json({ message: 'Monitor deleted' });
});

app.patch('/api/monitors/:id/pause', (req, res) => {
  const monitor = db.get('SELECT id, is_paused FROM monitors WHERE id = ?', [req.params.id]);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const newState = monitor.is_paused ? 0 : 1;
  db.run("UPDATE monitors SET is_paused = ?, updated_at = datetime('now') WHERE id = ?",
    [newState, req.params.id]);

  res.json({ id: req.params.id, is_paused: newState === 1 });
});

app.get('/api/monitors/:id/pings', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = parseInt(req.query.offset) || 0;

  const pings = db.all(
    'SELECT * FROM pings WHERE monitor_id = ? ORDER BY received_at DESC LIMIT ? OFFSET ?',
    [req.params.id, limit, offset]
  );

  res.json(pings);
});

app.get('/api/monitors/:id/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);

  const alerts = db.all(
    'SELECT * FROM alerts WHERE monitor_id = ? ORDER BY created_at DESC LIMIT ?',
    [req.params.id, limit]
  );

  res.json(alerts);
});

app.post('/api/monitors/:id/channels', (req, res) => {
  const { channel_type, config } = req.body;

  const validTypes = ['email', 'webhook', 'slack', 'discord'];
  if (!validTypes.includes(channel_type)) {
    return res.status(400).json({ error: `Invalid channel type. Valid: ${validTypes.join(', ')}` });
  }

  const monitor = db.get('SELECT id FROM monitors WHERE id = ?', [req.params.id]);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const result = db.run(
    'INSERT INTO notification_channels (monitor_id, channel_type, config) VALUES (?, ?, ?)',
    [req.params.id, channel_type, JSON.stringify(config)]
  );

  res.status(201).json({
    id: result.lastInsertRowid,
    channel_type,
    config,
  });
});

app.get('/api/monitors/:id/channels', (req, res) => {
  const channels = db.all(
    'SELECT * FROM notification_channels WHERE monitor_id = ?',
    [req.params.id]
  );

  res.json(channels.map(c => ({
    ...c,
    config: JSON.parse(c.config),
  })));
});

app.delete('/api/monitors/:id/channels/:channelId', (req, res) => {
  db.run('DELETE FROM notification_channels WHERE id = ? AND monitor_id = ?',
    [req.params.channelId, req.params.id]);
  res.json({ message: 'Channel deleted' });
});

// ============================================================
// Heartbeat Endpoints
// ============================================================

app.get('/ping/:slug', (req, res) => {
  const monitor = db.get('SELECT * FROM monitors WHERE slug = ?', [req.params.slug]);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found. Check your slug.' });
  }

  if (monitor.is_paused) {
    return res.json({ status: 'paused', message: 'Monitor is paused' });
  }

  db.run(
    "INSERT INTO pings (monitor_id, source_ip, status) VALUES (?, ?, 'ok')",
    [monitor.id, req.ip || req.connection?.remoteAddress || 'unknown']
  );

  res.json({
    status: 'ok',
    monitor: monitor.name,
    next_check: `in ${monitor.grace_seconds}s`,
  });
});

app.post('/ping/:slug', (req, res) => {
  req.method = 'GET';
  app.handle(req, res);
});

app.get('/check/:slug', (req, res) => {
  const monitor = db.get('SELECT * FROM monitors WHERE slug = ?', [req.params.slug]);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const lastPing = db.get(`
    SELECT received_at FROM pings
    WHERE monitor_id = ? AND status = 'ok'
    ORDER BY received_at DESC LIMIT 1
  `, [monitor.id]);

  if (!lastPing) {
    return res.json({
      name: monitor.name,
      status: 'pending',
      message: 'Waiting for first ping',
    });
  }

  const elapsed = (Date.now() - new Date(lastPing.received_at + 'Z').getTime()) / 1000;
  const isDown = elapsed > monitor.grace_seconds;

  res.json({
    name: monitor.name,
    status: isDown ? 'down' : 'up',
    last_ping: lastPing.received_at,
    elapsed_seconds: Math.floor(elapsed),
    grace_seconds: monitor.grace_seconds,
  });
});

// ============================================================
// Start Server (async init first)
// ============================================================

async function start() {
  await db.init();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ❤️  Heartbeat Monitor v1.0.0`);
    console.log(`  ─────────────────────────────`);
    console.log(`  Server:    http://localhost:${PORT}`);
    console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
    console.log(`  API:       http://localhost:${PORT}/api/status\n`);

    scheduler.start();
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
