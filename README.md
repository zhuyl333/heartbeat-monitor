# ❤️ Heartbeat Monitor

Dead-simple cron job / scheduled task monitoring. Get alerted the moment your scripts stop reporting.

## How it works

```bash
# Your current cron job
0 3 * * * /usr/local/bin/backup.sh

# Add heartbeat monitoring - just append a curl
0 3 * * * /usr/local/bin/backup.sh && curl -s https://heartbeat-monitor-production.up.railway.app/ping/your-unique-slug
```

If your job finishes successfully, it pings the monitor. If no ping arrives within the grace period, you get an alert.

## Quick Start

### 1. Create a monitor

```bash
curl -X POST https://heartbeat-monitor-production.up.railway.app/api/monitors \
  -H "Content-Type: application/json" \
  -d '{"name": "Database Backup", "grace_seconds": 300}'
```

Response:
```json
{
  "id": "uuid",
  "name": "Database Backup",
  "slug": "a1b2c3d4e5f6a7b8",
  "grace_seconds": 300,
  "ping_url": "/ping/a1b2c3d4e5f6a7b8"
}
```

### 2. Add the ping URL to your script

```
0 3 * * * /backup.sh && curl -s https://heartbeat-monitor-production.up.railway.app/ping/a1b2c3d4e5f6a7b8
```

### 3. Check status

```bash
curl https://heartbeat-monitor-production.up.railway.app/check/a1b2c3d4e5f6a7b8
```

## API Reference

### Service Status
```
GET /api/status
```

### Monitors

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/monitors` | Create a monitor |
| `GET` | `/api/monitors` | List all monitors |
| `GET` | `/api/monitors/:id` | Get monitor details |
| `DELETE` | `/api/monitors/:id` | Delete a monitor |
| `PATCH` | `/api/monitors/:id/pause` | Toggle pause/resume |

### Heartbeat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/ping/:slug` | Send a heartbeat (job completed) |
| `POST` | `/ping/:slug` | Same as GET |
| `GET` | `/check/:slug` | Public status check (no auth) |

### Ping History & Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/monitors/:id/pings` | Ping history |
| `GET` | `/api/monitors/:id/alerts` | Alert history |

### Notification Channels

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/monitors/:id/channels` | Add channel (email/webhook/slack/discord) |
| `GET` | `/api/monitors/:id/channels` | List channels |
| `DELETE` | `/api/monitors/:id/channels/:channelId` | Remove channel |

#### Adding an email notification channel

```bash
curl -X POST https://heartbeat-monitor-production.up.railway.app/api/monitors/<id>/channels \
  -H "Content-Type: application/json" \
  -d '{"channel_type": "email", "config": {"to": "you@example.com"}}'
```

**Note:** Email delivery requires SMTP to be configured on the server (set via environment variables). Currently logs to console if not configured.

#### Adding a Slack webhook

```bash
curl -X POST https://heartbeat-monitor-production.up.railway.app/api/monitors/<id>/channels \
  -H "Content-Type: application/json" \
  -d '{"channel_type": "slack", "config": {"url": "https://hooks.slack.com/services/..."}}'
```

## Platform Support

- **Shell scripts** — `your_command && curl -s https://.../ping/slug`
- **Python** — `subprocess.run` or `requests.get` at the end of your script
- **Windows Task Scheduler** — Add a PowerShell step: `Invoke-WebRequest https://.../ping/slug`
- **CI/CD pipelines** — Add a step after your job

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `SMTP_HOST` | SMTP server for email alerts | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `SMTP_FROM` | From address for alerts | `alert@heartbeat.railway.app` |

## Deployment

The service runs on Railway. Push to main branch → auto-deploys.

```bash
git push origin main
```

## Self-hosting

```bash
git clone https://github.com/zhuyl333/heartbeat-monitor
cd heartbeat-monitor
npm install
cp .env.example .env
node src/server.js
```

Requires Node.js 18+.

## License

MIT
