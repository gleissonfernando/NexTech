# Project Agent Rules

- Do not use direct Shardcloud project update/upload endpoints for deploys. In this app they return `user cannot update project` and create failed deploy records.
- For deployment changes, commit and push to `origin/main`, then use the Shardcloud panel or a properly authorized owner integration to redeploy.
- It is okay to query Shardcloud status, deploy history, and runtime logs for diagnostics, but do not attempt `/file` uploads or deploy-token upload workarounds.
- Keep Shardcloud health checks lightweight: `/_shardcloud/health` must not hit MongoDB, Redis, Discord, or any external API.
- Avoid realtime feedback loops in bot setup flows. Bot sync endpoints should be idempotent and only emit socket events when persisted data actually changes.
- In production, do not auto-start all registered DEV bots unless `START_REGISTERED_DEV_BOTS=true` is explicitly configured; starting every bot at once can trigger Shardcloud request-abuse blocking.
