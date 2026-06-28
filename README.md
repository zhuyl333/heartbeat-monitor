# ❤️ Heartbeat Monitor

Dead-simple cron job monitoring. Get alerted the moment your scheduled tasks fail.

## How it works

1. **Create a monitor** — give it a name and grace period
2. **Get a unique ping URL** — `https://heartbeat.hermes.run/ping/a1b2c3d`
3. **Add it to your crontab** — `0 3 * * * /backup.sh && curl -s https://heartbeat.hermes.run/ping/a1b2c3d`
4. **Get alerted if it fails** — email, Slack, Discord, or webhook

## Quick start

```bash
# Create a monitor (via API)
curl -X POST https://heartbeat.hermes.run/api/monitors \
  -H "Content-Type: application/json" \
  -d '{"name": "Daily Backup", "grace_seconds": 300}'

# Response: {"id":"...","slug":"a1b2c3d","ping_url":"/ping/a1b2c3d"}

# Add to your cron job
0 3 * * * /usr/local/bin/backup.sh && curl -s https://heartbeat.hermes.run/ping/a1b2c3d
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Service health |
| `POST` | `/api/monitors` | Create monitor |
| `GET` | `/api/monitors` | List monitors |
| `GET` | `/api/monitors/:id` | Get monitor details |
| `DELETE` | `/api/monitors/:id` | Delete monitor |
| `PATCH` | `/api/monitors/:id/pause` | Toggle pause |
| `GET/POST` | `/ping/:slug` | Send heartbeat |
| `GET` | `/check/:slug` | Public status check |

## Deploy your own

```bash
fly launch
fly deploy
```

Requires [Fly.io](https://fly.io) account.

## License

MIT
