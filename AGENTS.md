# Project Agent Rules

- Do not use direct Shardcloud project update/upload endpoints for deploys. In this app they return `user cannot update project` and create failed deploy records.
- For deployment changes, commit and push to `origin/main`, then use the Shardcloud panel or a properly authorized owner integration to redeploy.
- It is okay to query Shardcloud status, deploy history, and runtime logs for diagnostics, but do not attempt `/file` uploads or deploy-token upload workarounds.
