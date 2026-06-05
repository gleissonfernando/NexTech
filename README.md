# Discord Bot Dashboard Platform

Arquitetura separada em tres aplicacoes independentes:

- `frontend`: dashboard React + TSX + Vite + Tailwind + componentes no estilo shadcn/ui.
- `backend`: API Node.js + Express + TypeScript + Prisma + MongoDB + Redis + Socket.IO.
- `bot`: bot Discord.js v14 + TypeScript, sem paginas HTML ou rotas web.

## Fluxo

```txt
Frontend
  |
  v
Backend API
  |-- MongoDB
  |-- Redis
  v
Bot Discord
```

O frontend nunca acessa banco de dados diretamente. O bot nunca importa ou renderiza componentes do frontend. Todas as integracoes passam pela API HTTP ou por Socket.IO no backend.

## Primeiros passos

```bash
npm install
docker compose up -d
copy .env.example backend/.env
copy .env.example bot/.env
copy .env.example frontend/.env
npm run prisma:generate
npm run prisma:push
```

Depois, em terminais separados:

```bash
npm run dev:backend
npm run dev:frontend
npm run dev:bot
```

URLs padrao:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000/api`
- Socket.IO: `http://localhost:4000`

MongoDB roda em `mongodb://localhost:27017/discord_platform?replicaSet=rs0`.

## OAuth2 Discord

Crie uma aplicacao no Discord Developer Portal e configure:

- Redirect URI: `http://localhost:4000/api/auth/discord/callback`
- Escopos: `identify`, `email`, `guilds`

Preencha no `backend/.env`:

```env
DISCORD_CLIENT_ID=""
DISCORD_CLIENT_SECRET=""
DISCORD_CALLBACK_URL="http://localhost:4000/api/auth/discord/callback"
FRONTEND_URL="http://localhost:5173"
```

Para testar a interface sem OAuth durante desenvolvimento, defina `DEV_AUTH_ENABLED=true` no `backend/.env` e acesse o login normalmente.
