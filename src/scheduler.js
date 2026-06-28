/**
 * Scheduled checker - periodically checks if any monitors missed their heartbeat
 */
const db = require('./db');
const notifier = require('./notifier');
const cron = require('node-cron');

class Scheduler {
  constructor() {
    this.alertedMonitors = new Map();
  }

  start() {
    cron.schedule('* * * * *', () => {
      this.checkMonitors().catch(err => {
        console.error('[Scheduler] Check error:', err.message);
      });
    });

    cron.schedule('0 * * * *', () => {
      this.cleanup().catch(err => {
        console.error('[Scheduler] Cleanup error:', err.message);
      });
    });

    console.log('[Scheduler] Started - checking monitors every 60s');
  }

  async checkMonitors() {
    const now = new Date();
    const monitors = db.all('SELECT * FROM monitors WHERE is_paused = 0');

    for (const monitor of monitors) {
      const lastPing = db.get(`
        SELECT received_at FROM pings
        WHERE monitor_id = ? AND status = 'ok'
        ORDER BY received_at DESC LIMIT 1
      `, [monitor.id]);

      if (!lastPing) {
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
        if (this.alertedMonitors.has(monitor.id)) {
          const downSince = this.alertedMonitors.get(monitor.id);
          const downDuration = Math.floor((now - downSince) / 1000);
          console.log(`[Scheduler] ${monitor.name} is back UP (was down for ${downDuration}s)`);

          db.run(
            "INSERT INTO alerts (monitor_id, alert_type, message) VALUES (?, 'recovery', ?)",
            [monitor.id, `Monitor recovered after ${downDuration}s downtime`]
          );

          this.alertedMonitors.delete(monitor.id);
        }
      }
    }
  }

  async cleanup() {
    const result = db.run(
      "DELETE FROM pings WHERE received_at < datetime('now', '-30 days')"
    );
    if (result.changes > 0) {
      console.log(`[Scheduler] Cleaned up ${result.changes} old ping records`);
    }

    const alertResult = db.run(
      "DELETE FROM alerts WHERE acknowledged = 1 AND created_at < datetime('now', '-90 days')"
    );
    if (alertResult.changes > 0) {
      console.log(`[Scheduler] Cleaned up ${alertResult.changes} old alerts`);
    }
  }
}

module.exports = new Scheduler();
