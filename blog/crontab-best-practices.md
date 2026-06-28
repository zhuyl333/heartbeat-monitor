# Linux Crontab Best Practices: Monitoring, Logging, and Alerting

Cron is the unsung hero of Linux administration. It runs your backups, rotates your logs, renews your SSL certificates, syncs your data, and cleans up temp files — all without asking for thanks.

But cron is also **silent when things go wrong**. A missing crontab entry, a broken script, or an expired credential can go unnoticed for days or weeks. By the time you find out, the damage is done.

This guide covers crontab best practices for anyone who manages scheduled tasks — from basic hygiene to production-grade monitoring and alerting.

---

## Crontab Basics: The Quick Refresher

A crontab entry has five time fields followed by a command:

```
minute hour day-of-month month day-of-week  command
  0      2       *            *        *     /usr/local/bin/backup.sh
```

| Field | Range | Notes |
|---|---|---|
| minute | 0–59 | |
| hour | 0–23 | Use 0 for midnight, 12 for noon |
| day of month | 1–31 | Use `*` for "every" |
| month | 1–12 (or JAN–DEC) | |
| day of week | 0–7 (0=Sun, 7=Sun, or SUN–SAT) | 0 and 7 both mean Sunday |

Edit your crontab with:

```bash
crontab -e
```

List current entries with:

```bash
crontab -l
```

**Best Practice #0:** Always use `crontab -e` — never edit the spool files in `/var/spool/cron/crontabs/` directly. A syntax error in a spool file can disable all cron jobs for that user.

---

## 1. Logging: Know What Your Jobs Are Doing

By default, cron captures stdout and stderr and either discards them (if no MAILTO is set) or emails them. Neither is ideal for production.

### Set up per-job logging

Every cron entry should redirect output to a dedicated log file:

```bash
0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
```

**What this does:**
- `>> /var/log/backup.log` appends stdout to a log file
- `2>&1` redirects stderr to the same place

### Add timestamps to your script output

Inside your script, use `echo` with timestamps so you can correlate logs with events:

```bash
#!/bin/bash
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "Starting backup..."
# ... backup logic ...
log "Backup complete."
```

Your log file will look like:

```
[2026-06-28 02:00:01] Starting backup...
[2026-06-28 02:00:01] Running pg_dump...
[2026-06-28 02:15:33] Backup complete.
```

### Set up log rotation

Don't let logs grow forever. Use `logrotate` to manage them:

```bash
# /etc/logrotate.d/backup
/var/log/backup.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
}
```

This keeps 30 days of compressed logs — enough for debugging, not so much that you waste disk.

---

## 2. Exit Codes: Make Every Script Accountable

Cron doesn't care about your script's exit code. But you should. A non-zero exit code is the only signal cron has that something went wrong.

### Use `set -euo pipefail`

This is the single most impactful change you can make to your shell scripts:

```bash
#!/bin/bash
set -euo pipefail
```

- **`set -e`** — Exit immediately if any command returns a non-zero exit code.
- **`set -u`** — Treat unset variables as an error.
- **`set -o pipefail`** — If any command in a pipeline fails, the pipeline's exit code reflects that failure.

**Before `pipefail`:**

```bash
false | echo "still runs"    # exit code: 0 (from echo)
```

**After `pipefail`:**

```bash
set -o pipefail
false | echo "still runs"    # exit code: 1 (from false)
```

### Always `exit 0` on success, `exit 1` (or higher) on failure

Even if your script is simple, explicitly exit:

```bash
# Good
if [ "$?" -eq 0 ]; then
    echo "Success"
    exit 0
else
    echo "Failed"
    exit 1
fi
```

### Use distinct exit codes for different failure modes

A common convention:

| Exit Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Misuse (bad argument, missing config) |
| 3+ | Application-specific (see your script's docs) |

---

## 3. Alerting on Failure: Don't Wait to Find Out

Logging is great for debugging. Exit codes are great for accountability. But neither wakes you up at 3 AM when a job fails.

### Option A: MAILTO (cron's built-in)

```bash
MAILTO=admin@example.com

0 2 * * * /usr/local/bin/backup.sh
```

Cron emails you the job's stdout/stderr output. **Caveats:** Unreliable in modern email environments, doesn't catch "never ran," and can be filtered by spam. Still, it's better than nothing — use it as a safety net, not a primary alert.

### Option B: Heartbeat ping (recommended)

This is the best approach for production workloads. Your script pings a URL when it completes successfully. If the ping doesn't arrive on schedule, you get alerted.

### Option C: Custom notification scripts

Inside your script, send notifications directly:

```bash
notify_slack() {
    curl -s -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"$1\"}" \
        "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
}

notify_slack "Backup completed successfully"
```

This works but requires embedding webhooks in every script. A heartbeat service abstracts this away.

---

## 4. Heartbeat Ping Example: Production-Ready Pattern

Here's a complete crontab entry with heartbeat monitoring via [Heartbeat Monitor](https://heartbeat.hermes.run):

```bash
# Crontab entry
MAILTO=admin@example.com

# Nightly backup at 2 AM with heartbeat monitoring
0 2 * * * /usr/local/bin/backup.sh
```

And the corresponding script with heartbeat ping:

```bash
#!/bin/bash
# /usr/local/bin/backup.sh
set -euo pipefail

HEARTBEAT_URL="https://heartbeat.hermes.run/ping/a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# Redirect all script output to log
exec >> /var/log/backup.log 2>&1

echo "[$(date)] Backup starting..."

mysqldump --all-databases | gzip > /backups/full-$(date +%Y%m%d).sql.gz

# Verify backup integrity
gunzip -t /backups/full-$(date +%Y%m%d).sql.gz || {
    echo "ERROR: Backup file is corrupt"
    exit 1
}

echo "[$(date)] Backup verified OK"

# Ping heartbeat — only reached if everything succeeded
curl -fsS -m 10 --retry 5 -o /dev/null "$HEARTBEAT_URL"

echo "[$(date)] Backup complete and reported"
```

**What this achieves:**

1. Every failure before the final curl stops the script (`set -e`).
2. The heartbeat ping is **only** sent on complete success.
3. If the script never starts (server down, cron broken), the ping never arrives.
4. A local log file exists for detailed debugging.
5. MAILTO provides a secondary notification channel.

---

## 5. Cleanup Practices: Preventing Rot and Technical Debt

### Rotate logs automatically

Set up `logrotate` (as shown in section 1) for every per-job log file. A server with 50 cron jobs generating daily logs can fill a disk in a month.

### Clean up temporary files

Every cron job should clean up after itself:

```bash
#!/bin/bash
# Always clean up, even on failure
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

TEMP_DIR=$(mktemp -d)
# ... rest of script ...
```

### Monitor disk space

A cron job that checks disk space and alert if it's running low:

```bash
0 8 * * * /usr/local/bin/disk-check.sh
```

Inside `disk-check.sh`:

```bash
#!/bin/bash
THRESHOLD=90
USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    curl -fsS "https://heartbeat.hermes.run/ping/disk-full-alert"
fi
```

### Document your crontab

Add comments to your crontab so future-you (or a teammate) understands what each entry does:

```bash
# ┌─────────────────────── Daily backup (retained 30 days)
# │ ┌────────────────────── Runs MySQL + filesystem backup
# │ │ ┌──────────────────── Sends heartbeat on success
# │ │ │
# 0 2 * * * /usr/local/bin/backup.sh

# Run log rotation at 6 AM (after backups complete)
0 6 * * * /usr/sbin/logrotate /etc/logrotate.conf
```

### Version control your crontab

Treat your crontab like code:

```bash
# Export crontab to a tracked file
crontab -l > ~/dotfiles/crontab/production

# After editing, check it in:
git add crontab/production && git commit -m "update: added nightly health check"
```

This gives you an audit trail and makes recovery from a corrupted crontab trivial.

---

## Summary: The Production Crontab Checklist

| Best Practice | Why It Matters |
|---|---|
| Use `set -euo pipefail` in all scripts | Prevents silent mid-script failures |
| Log stdout+stderr per job | Enables post-mortem debugging |
| Rotate logs with logrotate | Prevents disk from filling up |
| Add a heartbeat ping for critical jobs | Catches failures and "never ran" cases |
| Set MAILTO as secondary alert | Safety net for basic errors |
| Trap EXIT to clean up temp files | Prevents accumulation of garbage |
| Use `crontab -e`, never edit spool files | Prevents syntax errors from disabling cron |
| Version control your crontab | Provides audit trail and easy recovery |
| Add comments to every entry | Helps teammates understand intent |

Cron is simple, powerful, and — when set up correctly — rock-solid reliable. The secret isn't better tools; it's treating scheduled tasks with the same rigor you'd apply to any production system: **log it, monitor it, alert on it, and clean up after it.**

The five minutes you spend today adding a heartbeat ping to your critical cron jobs will save you hours of debugging later.

---

*Ready to add heartbeat monitoring to your crontab? [Get started free at Heartbeat Monitor](https://heartbeat.hermes.run).*
