/**
 * Scheduled checker - periodically checks if any monitors missed their heartbeat
 */
const db = require('./db');
const notifier = require('./notifier');
const cron = require('node-cron');

class Scheduler {
  constructor() {
    this.alertedMonitors = new Map(); // track which monitors we've already alerted
  }

  start() {
    // Run every 60 seconds
    cron.schedule('* * * * *', () => {
      this.checkMonitors().catch(err => {
        console.error('[Scheduler] Check error:', err.message);
      });
    });

    // Also run cleanup every hour (delete old pings)
    cron.schedule('0 * * * *', () => {
      this.cleanup().catch(err => {
        console.error('[Scheduler] Cleanup error:', err.message);
      });
    });

    console.log('[Scheduler] Started - checking monitors every 60s');
  }

  async checkMonitors() {
    const now = new Date();
    const monitors = db.prepare('SELECT * FROM monitors WHERE is_paused = 0').all();

    for (const monitor of monitors) {
      const lastPing = db.prepare(`
        SELECT received_at FROM pings
        WHERE monitor_id = ? AND status = 'ok'
        ORDER BY received_at DESC LIMIT 1
      `).get(monitor.id);

      if (!lastPing) {
        // Never received a ping - wait for first one
        continue;
      }

      const lastPingTime = new Date(lastPing.received_at + 'Z');
      const elapsed = (now - lastPingTime) / 1000;
      const isDown = elapsed > monitor.grace_seconds;

      if (isDown) {
        const key = monitor.id;
        if (!this.alertedMonitors.has(key)) {
          this.alertedMonitors.set(key, now);
          const downtime = Math.floor(elapsed);
          const reason = `No ping received for ${downtime}s (grace: ${monitor.grace_seconds}s)`;
          console.log(`[Scheduler] ${monitor.name} is DOWN (${downtime}s since last ping)`);
          await notifier.sendAlert(monitor, reason);
        }
      } else {
        // Monitor is healthy - clear alert state if it was down
        if (this.alertedMonitors.has(monitor.id)) {
          const downSince = this.alertedMonitors.get(monitor.id);
          const downDuration = Math.floor((now - downSince) / 1000);
          console.log(`[Scheduler] ${monitor.name} is back UP (was down for ${downDuration}s)`);

          // Log recovery alert
          db.prepare(`
            INSERT INTO alerts (monitor_id, alert_type, message)
            VALUES (?, 'recovery', ?)
          `).run(monitor.id, `Monitor recovered after ${downDuration}s downtime`);

          this.alertedMonitors.delete(monitor.id);
        }
      }
    }
  }

  async cleanup() {
    // Delete pings older than 30 days
    const result = db.prepare(`
      DELETE FROM pings WHERE received_at < datetime('now', '-30 days')
    `).run();
    if (result.changes > 0) {
      console.log(`[Scheduler] Cleaned up ${result.changes} old ping records`);
    }

    // Delete acknowledged alerts older than 90 days
    const alertResult = db.prepare(`
      DELETE FROM alerts WHERE acknowledged = 1
      AND created_at < datetime('now', '-90 days')
    `).run();
    if (alertResult.changes > 0) {
      console.log(`[Scheduler] Cleaned up ${alertResult.changes} old alerts`);
    }
  }
}

module.exports = new Scheduler();
