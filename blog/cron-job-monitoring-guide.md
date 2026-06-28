# Cron Job Monitoring: How to Get Alerted When Your Scheduled Tasks Fail

If you manage Linux servers, you rely on cron jobs. They rotate logs, run backups, sync data, send reports, and keep the entire machine humming. They're also famously invisible — you only think about them when something breaks.

And here's the uncomfortable truth: **most cron jobs are running in the dark.** Unless you actively check logs (and who has time for that?), you won't know a job failed until a user complains, a backup is missing, or your disk fills up at 3 AM.

Effective **cron job monitoring** bridges the gap between "the job ran" and "the job succeeded." This guide walks through the problem of silent cron failures and three practical ways to monitor your scheduled tasks — from simple logging to modern heartbeat-based alerting.

---

## The Problem: Silent Failures Cost You Time and Trust

Cron itself does not care if a job succeeds or fails. It launches your command, gathers stdout/stderr (if you configure MAILTO), and moves on. If the exit code is non-zero? Cron doesn't raise an alarm. If your Python script hits an unhandled exception at 2 AM? Silence.

A few real-world examples of stealthy failures:

- A database backup script crashes because the backup disk is full — by the time you notice, you've lost 3 days of snapshots.
- An SSL renewal cron job silently fails due to an expired API token — your certificate expires and your site goes down.
- A log rotation job exits early because a log file was unexpectedly renamed — your disk fills up by noon.

These failures share a common trait: **no alert, no notification, no awareness until it's an emergency.** The fix isn't better scripts — it's better monitoring.

---

## Three Ways to Monitor Your Cron Jobs

### 1. Log-Based Monitoring (The Old Way)

The simplest approach: redirect all output to a log file and check it periodically.

```bash
# In your crontab:
0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
```

Then use a separate monitoring tool (like `logwatch`, `graylog`, or a custom grep-based script) to scan for error keywords:

```bash
grep -i "error\|failed\|exit 1" /var/log/backup.log
```

**Pros:** Zero setup cost, works with any existing logging pipeline.
**Cons:** Reactive — you see failures only when you look. No real-time alerting unless you layer on a log shipper. Easy to miss errors buried in verbose output.

### 2. External Monitoring Services (SaaS Checks)

Services like Pingdom, UptimeRobot, or StatusCake can hit an HTTP endpoint exposed by your cron job and alert you if the response changes.

You'd set up a lightweight HTTP server (or a shared endpoint) that your cron job updates with its latest status:

```bash
# Run after your backup completes successfully
curl -s "https://uptimerobot.com/webhook/xxx?status=ok"
```

**Pros:** No self-hosted infrastructure, excellent dashboards.
**Cons:** Requires a publicly accessible endpoint or custom webhook infrastructure. Can't distinguish between "job didn't run" and "job ran but produced stale data." Usually costs per monitor.

### 3. Heartbeat URLs (The Modern Approach)

Heartbeat monitoring flips the script. Instead of your monitoring tool *checking* on the job, the job itself *reports* its health by pinging a unique URL on completion. If the ping doesn't arrive within an expected window, you get an alert.

This is the approach used by services like **Heartbeat Monitor** (and it's the one I'd recommend for most teams).

```bash
# Add to the END of your cron script — only runs if everything succeeded
curl -fsS -m 10 --retry 5 -o /dev/null \
  "https://heartbeat.hermes.run/ping/your-unique-monitor-id"
```

**Pros:** Catches "job never ran" (the ping simply doesn't arrive). Works behind NAT/firewalls (outbound-only HTTP). As simple as a single curl command. Get alerts via email, Slack, or Discord.

**Cons:** Requires network access. Minimal overhead (~a few KB per ping).

---

## How Heartbeat Monitor Catches Every Failure

[Heartbeat Monitor](https://heartbeat.hermes.run) is purpose-built for exactly this use case. You create a monitor, get a unique ping URL, drop it into your cron job, and forget about it.

The flow is dead simple:

1. **Create a monitor** — give it a name, a grace period (e.g., 30 minutes), and set your alert channel (email, Slack, Discord).
2. **Get your ping URL** — a unique HTTPS endpoint tied to that monitor.
3. **Add the ping to your cron job** — usually the last line of the script.
4. **Done** — if the ping fails to arrive within the grace window, you're notified immediately.

Unlike traditional uptime monitors that poll your server, heartbeat monitoring catches:

- **The job never started** — cron daemon crashed, crontab was misconfigured, server was down.
- **The job started but crashed mid-way** — the script exited before the curl ping ever ran.
- **The job is running too slowly** — the ping arrives late, triggering a grace-period alert.

And because the ping is just an outbound HTTPS request, it works from **any environment** — bare-metal servers, Docker containers, Kubernetes cron jobs, Raspberry Pis, even cloud functions.

---

## A Complete Setup Example

Let's walk through setting up a real cron job with Heartbeat Monitor from scratch.

### Step 1: Create the monitor

Head to your **Heartbeat Monitor dashboard** → **Create Monitor**.

Give it a name like `Nightly Database Backup` and set:
- **Expected interval:** 24 hours
- **Grace period:** 30 minutes (gives your backup time to complete)
- **Alert channels:** Your Slack webhook + email

Copy the generated ping URL:

```
https://heartbeat.hermes.run/ping/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Step 2: Update your backup script

Add the ping URL at the very end — **only after a successful run**:

```bash
#!/bin/bash
# /usr/local/bin/db-backup.sh

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/backups/db-${TIMESTAMP}.sql.gz"

echo "Starting database backup..."
pg_dump my_database | gzip > "$BACKUP_FILE"

echo "Uploading to S3..."
aws s3 cp "$BACKUP_FILE" s3://my-backups/daily/

# Only pings if everything above succeeded (set -e ensures this)
echo "Reporting success to Heartbeat Monitor..."
curl -fsS -m 10 --retry 5 -o /dev/null \
  "https://heartbeat.hermes.run/ping/a1b2c3d4-e5f6-7890-abcd-ef1234567890"

echo "Backup complete."
```

### Step 3: Schedule it in crontab

```bash
# Run every night at 2 AM
0 2 * * * /usr/local/bin/db-backup.sh >> /var/log/db-backup.log 2>&1
```

### Step 4: Test the alert

Simulate a failure by temporarily breaking your script (e.g., comment out the database credentials). Run it manually — the script will fail before reaching the curl ping. Within the grace period, you should receive a **Slack notification** or **email** saying:

> ❌ Nightly Database Backup has failed to ping. Expected check-in was 30 minutes ago.

---

## Putting It All Together

| Method | Real-time Alerting | Catches "Never Ran" | Works Off-Network | Setup Complexity |
|---|---|---|---|---|
| Log-based | ❌ (manual check) | ❌ | ✅ | Low |
| External polling | ✅ | ❌ | ❌ | Medium |
| **Heartbeat URL** | **✅** | **✅** | **✅** | **Low** |

For production cron jobs — backups, syncs, reports, health checks — heartbeat monitoring is the gold standard. It catches every failure mode, works from any environment, and requires exactly zero infrastructure on your end.

**Stop learning about cron failures from angry users.** Set up heartbeat monitoring today and let the alerts come to you.

---

*Ready to give it a try? [Create your first monitor at Heartbeat Monitor](https://heartbeat.hermes.run) — it takes under 60 seconds.*
