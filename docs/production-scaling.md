# Production scaling

The existing `npm start` command remains the compatible combined deployment. For horizontal scaling, build once and run each role independently:

| Role | Command | Recommended replicas |
| --- | --- | --- |
| API and dashboard socket | `npm run start:api` | 2 or more behind a load balancer |
| Persistent queue worker | `npm run start:worker` | 2 or more |
| Scheduler | `npm run start:scheduler` | 1 |
| Backfill execution | `npm run start:backfill` | On boot and as a scheduled job |
| Discord gateway | `npm run start:sharded --workspace bot` | 1 manager with Discord shards |

The API-only entrypoint always disables the embedded worker and schedulers. Queue claims and leases are atomic in MongoDB, so additional queue workers can be added without claiming the same job simultaneously. Expired leases are recovered automatically.

## Environment

- `BACKGROUND_JOB_CONCURRENCY`: jobs processed concurrently by each worker, default `3`, maximum `20`.
- `BACKGROUND_WORKER_ENABLED`: enables the compatibility-mode worker in `backend/dist/server.js`.
- `SCHEDULER_ENABLED`: enables schedulers in the combined `backend/dist/server.js` compatibility deployment.
- `BOT_EVENT_CONCURRENCY`: concurrent Discord gateway event handlers, default `50`.
- `BOT_EVENT_QUEUE_MAX`: maximum pending gateway events before overload protection, default `1000`.
- `BOT_MEMORY_RESTART_MB`: RSS threshold sustained for three samples before a safe restart, default `450`.
- `BOT_SHARDING_ENABLED=true`: makes the combined production supervisor use the shard manager.
- `BOT_TOTAL_SHARDS=auto`: lets Discord determine shard count; set a positive integer to pin it.
- `ORVITEK_NODE_MAX_OLD_SPACE_MB`: heap limit used by the combined supervisor, default `512`.

Keep `MONGODB_URI`, `BOT_API_TOKEN`, and the bot/backend realtime configuration identical across replicas. Redis remains optional for sessions; persistent jobs and distributed leases use MongoDB.

## Operations

- `GET /health` and `GET /api/health` report MongoDB, Redis, bot/shard state, queue depth, failed jobs, active workers, and oldest pending job age.
- `GET /api/health/metrics` reports process CPU/memory and queue metrics.
- Backup capture, staged restore, scheduled giveaway transitions, and their recovery paths run through persistent idempotent jobs.
- Fatal process errors use non-zero exits. The production supervisor restarts backend and bot independently and allows up to 25 seconds for graceful shutdown.
