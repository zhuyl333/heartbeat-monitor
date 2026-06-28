/**
 * Alert notifier - sends notifications via configured channels
 */
const nodemailer = require('nodemailer');
const db = require('./db');

class Notifier {
  constructor() {
    this.transporters = new Map();
  }

  /**
   * Send alerts for a failed monitor
   */
  async sendAlert(monitor, reason) {
    const channels = db.prepare(
      'SELECT * FROM notification_channels WHERE monitor_id = ?'
    ).all(monitor.id);

    if (channels.length === 0) {
      console.log(`[Notifier] No notification channels for ${monitor.name}, skipping alert`);
      return;
    }

    const message = this._buildMessage(monitor, reason);

    for (const channel of channels) {
      try {
        await this._sendViaChannel(channel, message);
        console.log(`[Notifier] Alert sent via ${channel.channel_type} for ${monitor.name}`);
      } catch (err) {
        console.error(`[Notifier] Failed to send ${channel.channel_type} alert:`, err.message);
      }
    }

    // Log the alert
    db.prepare(`
      INSERT INTO alerts (monitor_id, alert_type, message)
      VALUES (?, ?, ?)
    `).run(monitor.id, 'down', message.text);
  }

  _buildMessage(monitor, reason) {
    const checkUrl = `https://heartbeat.hermes.run/check/${monitor.slug}`;
    return {
      subject: `⚠️ [Heartbeat] ${monitor.name} is DOWN`,
      text: `Monitor: ${monitor.name}
Status: DOWN
Reason: ${reason}
Last ping: ${monitor.last_ping || 'Never'}
Grace period: ${monitor.grace_seconds}s
Check URL: ${checkUrl}`,
      html: `<h2>⚠️ ${monitor.name} is DOWN</h2>
<p><strong>Reason:</strong> ${reason}</p>
<p><strong>Last ping:</strong> ${monitor.last_ping || 'Never'}</p>
<p><strong>Grace period:</strong> ${monitor.grace_seconds}s</p>
<p><a href="${checkUrl}">Check URL</a></p>`
    };
  }

  async _sendViaChannel(channel, message) {
    const config = JSON.parse(channel.config);

    switch (channel.channel_type) {
      case 'email':
        await this._sendEmail(config, message);
        break;
      case 'webhook':
        await this._sendWebhook(config, message);
        break;
      case 'slack':
        await this._sendSlack(config, message);
        break;
      case 'discord':
        await this._sendDiscord(config, message);
        break;
      default:
        console.warn(`[Notifier] Unknown channel type: ${channel.channel_type}`);
    }
  }

  async _sendEmail(config, message) {
    // For MVP: use console.log and suggest configuring SMTP
    console.log(`[Email Alert] To: ${config.to}`);
    console.log(`[Email Alert] Subject: ${message.subject}`);
    console.log(`[Email Alert] Body: ${message.text}`);

    // If SMTP is configured, send for real
    if (process.env.SMTP_HOST) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'alert@heartbeat.hermes.run',
        to: config.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    }
  }

  async _sendWebhook(config, message) {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'monitor.down',
        monitor: message.text,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
  }

  async _sendSlack(config, message) {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message.text,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*⚠️ ${message.subject}*` },
          },
          { type: 'section', text: { type: 'mrkdwn', text: message.text } },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Slack returned ${response.status}`);
    }
  }

  async _sendDiscord(config, message) {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: message.subject,
          description: message.text,
          color: 0xFF0000,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Discord returned ${response.status}`);
    }
  }
}

module.exports = new Notifier();
