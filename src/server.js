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

// express.static serves public/index.html at root (landing page)

// ============================================================
// API Routes
// ============================================================

/**
 * GET /api/status - Health check for the service itself
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    monitors: {
      total: db.prepare('SELECT COUNT(*) as count FROM monitors').get().count,
      active: db.prepare('SELECT COUNT(*) as count FROM monitors WHERE is_paused = 0').get().count,
    },
  });
});

/**
 * POST /api/monitors - Create a new monitor
 */
app.post('/api/monitors', (req, res) => {
  const { name, grace_seconds } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }

  const id = crypto.randomUUID();
  const slug = crypto.randomBytes(8).toString('hex');
  const grace = Math.max(60, Math.min(86400, parseInt(grace_seconds) || 300));

  db.prepare(`
    INSERT INTO monitors (id, name, slug, grace_seconds)
    VALUES (?, ?, ?, ?)
  `).run(id, name.trim(), slug, grace);

  res.status(201).json({
    id,
    name: name.trim(),
    slug,
    grace_seconds: grace,
    ping_url: `/ping/${slug}`,
    created_at: new Date().toISOString(),
  });
});

/**
 * GET /api/monitors - List all monitors
 */
app.get('/api/monitors', (req, res) => {
  const monitors = db.prepare(`
    SELECT m.*,
      (SELECT received_at FROM pings WHERE monitor_id = m.id AND status = 'ok' ORDER BY received_at DESC LIMIT 1) as last_ping,
      (SELECT COUNT(*) FROM alerts WHERE monitor_id = m.id AND acknowledged = 0) as unacknowledged_alerts
    FROM monitors m
    ORDER BY m.created_at DESC
  `).all();

  res.json(monitors.map(m => ({
    ...m,
    ping_url: `/ping/${m.slug}`,
  })));
});

/**
 * GET /api/monitors/:id - Get a single monitor
 */
app.get('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare(`
    SELECT m.*,
      (SELECT received_at FROM pings WHERE monitor_id = m.id AND status = 'ok' ORDER BY received_at DESC LIMIT 1) as last_ping,
      (SELECT COUNT(*) FROM pings WHERE monitor_id = m.id) as total_pings,
      (SELECT COUNT(*) FROM alerts WHERE monitor_id = m.id) as total_alerts
    FROM monitors m WHERE m.id = ?
  `).get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  res.json(monitor);
});

/**
 * DELETE /api/monitors/:id - Delete a monitor
 */
app.delete('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare('SELECT id FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  db.prepare('DELETE FROM pings WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM alerts WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM notification_channels WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);

  res.json({ message: 'Monitor deleted' });
});

/**
 * PATCH /api/monitors/:id/pause - Toggle pause
 */
app.patch('/api/monitors/:id/pause', (req, res) => {
  const monitor = db.prepare('SELECT id, is_paused FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const newState = monitor.is_paused ? 0 : 1;
  db.prepare('UPDATE monitors SET is_paused = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(newState, req.params.id);

  res.json({ id: req.params.id, is_paused: newState === 1 });
});

/**
 * GET /api/monitors/:id/pings - Get ping history
 */
app.get('/api/monitors/:id/pings', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = parseInt(req.query.offset) || 0;

  const pings = db.prepare(`
    SELECT * FROM pings WHERE monitor_id = ?
    ORDER BY received_at DESC LIMIT ? OFFSET ?
  `).all(req.params.id, limit, offset);

  res.json(pings);
});

/**
 * GET /api/monitors/:id/alerts - Get alert history
 */
app.get('/api/monitors/:id/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);

  const alerts = db.prepare(`
    SELECT * FROM alerts WHERE monitor_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.params.id, limit);

  res.json(alerts);
});

/**
 * POST /api/monitors/:id/channels - Add notification channel
 */
app.post('/api/monitors/:id/channels', (req, res) => {
  const { channel_type, config } = req.body;

  const validTypes = ['email', 'webhook', 'slack', 'discord'];
  if (!validTypes.includes(channel_type)) {
    return res.status(400).json({ error: `Invalid channel type. Valid: ${validTypes.join(', ')}` });
  }

  const monitor = db.prepare('SELECT id FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const result = db.prepare(`
    INSERT INTO notification_channels (monitor_id, channel_type, config)
    VALUES (?, ?, ?)
  `).run(req.params.id, channel_type, JSON.stringify(config));

  res.status(201).json({
    id: result.lastInsertRowid,
    channel_type,
    config,
  });
});

/**
 * GET /api/monitors/:id/channels - List notification channels
 */
app.get('/api/monitors/:id/channels', (req, res) => {
  const channels = db.prepare(
    'SELECT * FROM notification_channels WHERE monitor_id = ?'
  ).all(req.params.id);

  res.json(channels.map(c => ({
    ...c,
    config: JSON.parse(c.config),
  })));
});

/**
 * DELETE /api/monitors/:id/channels/:channelId - Remove notification channel
 */
app.delete('/api/monitors/:id/channels/:channelId', (req, res) => {
  db.prepare('DELETE FROM notification_channels WHERE id = ? AND monitor_id = ?')
    .run(req.params.channelId, req.params.id);

  res.json({ message: 'Channel deleted' });
});

// ============================================================
// Heartbeat Endpoints
// ============================================================

/**
 * GET /ping/:slug - Receive a heartbeat ping
 * This is the URL that users configure in their cron jobs
 */
app.get('/ping/:slug', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE slug = ?').get(req.params.slug);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found. Check your slug.' });
  }

  if (monitor.is_paused) {
    return res.json({ status: 'paused', message: 'Monitor is paused' });
  }

  db.prepare(`
    INSERT INTO pings (monitor_id, source_ip, status)
    VALUES (?, ?, 'ok')
  `).run(monitor.id, req.ip || req.connection?.remoteAddress || 'unknown');

  res.json({
    status: 'ok',
    monitor: monitor.name,
    next_check: `in ${monitor.grace_seconds}s`,
  });
});

/**
 * POST /ping/:slug - Same as GET but via POST
 */
app.post('/ping/:slug', (req, res) => {
  // Forward to GET handler
  req.method = 'GET';
  app.handle(req, res);
});

/**
 * GET /check/:slug - Check current status of a monitor (public)
 */
app.get('/check/:slug', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE slug = ?').get(req.params.slug);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const lastPing = db.prepare(`
    SELECT received_at FROM pings
    WHERE monitor_id = ? AND status = 'ok'
    ORDER BY received_at DESC LIMIT 1
  `).get(monitor.id);

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
// Start Server
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ❤️  Heartbeat Monitor v1.0.0`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Server:    http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  API:       http://localhost:${PORT}/api/status\n`);

  // Start background scheduler
  scheduler.start();
});
