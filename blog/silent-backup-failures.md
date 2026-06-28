# Why Your Backup Scripts Are Silently Failing (And How to Fix It)

You scheduled the backup. You verified it worked once. You moved on to the next task.

Three months later, your manager asks you to restore a critical database from last week. You confidently open the backup directory — and find nothing. Or worse, you find a 47-byte file that contains only the word "Error."

Congratulations. You've joined the unfortunate majority of engineers who learned about silent backup failures the hard way.

This isn't a story about bad code. It's a story about **invisible failure modes** — and how to make sure your backups actually run, every single time.

---

## Common Reasons Backups Fail Silently

Backup scripts are uniquely vulnerable to silent failure. They often run overnight, touch filesystems that may not be mounted, and produce output nobody reads until they need it.

Here are the top culprits:

### 1. Disk full

Your backup ran, produced a 50 GB SQL dump, and then the script tried to write it to a disk that was 99% full. The `gzip` command exited with a non-zero code — but unless your script checks exit codes explicitly, the error is swallowed.

```bash
# This fails silently:
pg_dump mydb | gzip > /backups/db.sql.gz
# ^ If /backups is full, gzip fails — but the script continues
```

### 2. Missing mount points

An NFS mount or external volume went down during the night. Your backup script cheerfully wrote to a local path that *should* have been the mount target, but instead wrote to an empty directory on the root volume. No error. No alert. Just a missing backup at restore time.

### 3. Expired credentials

Database passwords, cloud provider API keys, and service account tokens all expire. Your backup script uses a credential that rotated last month. Now it connects, authenticates, and gets a polite "Access Denied" — logged to stdout, ignored by cron.

### 4. Database connection drops

A transient network hiccup or a restarted database server causes your backup connection to drop mid-stream. You get a partial dump. The file exists. It looks legitimate. But it's corrupt.

### 5. The job just… never runs

Cron daemon restarted? Crontab syntax error? Server went down for maintenance and never came back up? These are the scariest failures of all — because there's no error output to find. The job simply doesn't exist.

---

## Why "Email-From-Cron" Isn't Enough

Most people's first attempt at backup notification is cron's built-in MAILTO:

```bash
MAILTO=admin@example.com

0 2 * * * /usr/local/bin/backup.sh
```

The idea: cron emails you any stdout/stderr output from the job. If the job fails, you get an email with the error.

In practice, this fails for several reasons:

- **Email is unreliable.** Server's MTA isn't configured? The email sits in a local mail queue nobody checks. Spam filters eat it. Alias resolution breaks.
- **No output = no email.** If your script errors silently (e.g., `exit 1` without printing anything), cron sends nothing. You assume success.
- **Emails get ignored.** After the fifth nightly "Backup completed successfully" email, you train yourself to delete them. When a genuine failure email arrives, you delete it too.
- **Doesn't catch "never ran.** " If cron itself fails to start the job — the crontab is wrong, the daemon crashed, the server was offline — there's no process to generate stdout. No email. No nothing.

MAILTO is a useful safety net, but it's not a monitoring strategy.

---

## How Heartbeat Monitoring Catches What Everything Else Misses

Heartbeat monitoring solves the silent backup problem in a fundamentally different way. Instead of *checking* whether the backup succeeded, you have the backup *report* that it succeeded.

Here's the logic:

> **If the backup ran successfully → it pings a URL.**
> **If the backup fails → the ping never comes.**
> **If the backup never starts → the ping never comes.**

All three failure modes — crash, error, and never-ran — produce the exact same outcome: **a missing ping within the expected time window.** And that triggers an alert.

### Real curl example

Let's take a typical backup script and add heartbeat monitoring:

```bash
#!/bin/bash
# /usr/local/bin/backup.sh — MySQL backup with heartbeat monitoring

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backups"
BACKUP_FILE="${BACKUP_DIR}/mydb-${TIMESTAMP}.sql.gz"
HEARTBEAT_URL="https://heartbeat.hermes.run/ping/a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

# Run the backup (set -e ensures failure stops here)
echo "Starting MySQL backup..."
mysqldump --single-transaction --routines --triggers my_database | gzip > "$BACKUP_FILE"

# Verify the backup file is not empty
if [ ! -s "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file is empty!"
    exit 1
fi

echo "Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Upload to remote storage
echo "Uploading to S3..."
aws s3 cp "$BACKUP_FILE" "s3://my-bucket/backups/"

# Ping heartbeat — only reached if everything above succeeded
echo "Reporting success to Heartbeat Monitor..."
curl -fsS -m 10 --retry 5 -o /dev/null "$HEARTBEAT_URL"

echo "Backup complete successfully."
```

The key pattern: the `set -euo pipefail` at the top means **any error exits the script immediately**. The curl ping at the bottom **only runs if every prior command succeeded**. If the disk is full, the S3 upload fails, or the backup file is empty, the script exits before the curl line, and the ping never arrives.

On the Heartbeat Monitor dashboard, you configure:
- **Expected interval:** Every 24 hours
- **Grace period:** 1 hour (your backup might take 30-45 minutes)
- **Alert channels:** Slack webhook + email + Discord

If the ping doesn't arrive within 25 hours (24h + 1h grace), your phone buzzes. You know immediately, not when someone asks for a restore.

### Going further: failure pings

For even better diagnostics, you can send a separate ping on failure:

```bash
# On success:
curl -fsS "https://heartbeat.hermes.run/ping/SUCCESS_ID"

# On failure:
curl -fsS "https://heartbeat.hermes.run/ping/FAIL_ID"
```

Now you can distinguish between "the job crashed" (no ping at all) and "the job ran but failed" (a failure ping arrived). Some services, including Heartbeat Monitor, support start signals too — ping when the job begins so you can detect jobs that start but never finish.

---

## Production Checklist for Backup Script Monitoring

Use this checklist to bulletproof your backup script monitoring:

- [ ] **Use `set -euo pipefail`** in every backup script — stop on first error.
- [ ] **Add a heartbeat ping** at the end of each script — only on success.
- [ ] **Verify output size** — don't just check exit code, check the backup file is non-empty and matches expected size.
- [ ] **Log to a file** — keep a local log for forensic debugging, but don't rely on it for alerts.
- [ ] **Test your alerting** — intentionally break the script and confirm you receive the alert.
- [ ] **Monitor the monitor** — set up a separate "heartbeat check" that pings every hour just to confirm the monitoring service is reachable.
- [ ] **Document restore procedures** — knowing your backup failed is useless if nobody knows how to restore from the last good one.

---

## The Bottom Line

Silent backup failures aren't a matter of *if* — they're a matter of *when*. The only way to guarantee you'll know when a backup fails is to build alerting into the backup process itself.

Log files are for debugging. MAILTO is a suggestion. But a **heartbeat ping** is a contract: if this ping arrives, the backup succeeded. If it doesn't, someone gets paged.

When you're the one who needs to restore a production database at 3 AM on a Saturday, you'll be glad you set it up.

---

*Want to add heartbeat monitoring to your backups in under 5 minutes? [Create a free monitor at Heartbeat Monitor](https://heartbeat.hermes.run).*
