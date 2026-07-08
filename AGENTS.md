# Project Agent Rules

- Deploys are manual on Discloud. Do not add GitHub Actions, push-based deploys, or automatic deploy workflows.
- Keep `discloud.config` in the project root aligned with the real production entrypoint: `index.js` starts `scripts/start-production.mjs`.
- Keep health checks through `/health` or `/api/health`; avoid adding provider-specific health paths unless the hosting provider requires them.
- Avoid realtime feedback loops in bot setup flows. Bot sync endpoints should be idempotent and only emit socket events when persisted data actually changes.
- In production, do not auto-start all registered DEV bots unless `START_REGISTERED_DEV_BOTS=true` is explicitly configured; starting every bot at once can trigger request-abuse blocking.
- Keep the backend and bot internal auth header contract aligned: the bot sends `x-bot-token` with `BOT_API_TOKEN`, and the backend must accept both `x-bot-token` and legacy `bot-token`. Do not change one side without updating `scripts/deploy-check.mjs`.
