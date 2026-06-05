# Discord Bot Dashboard Platform

Arquitetura separada em tres aplicacoes independentes:

- `frontend`: dashboard React + TSX + Vite + Tailwind + componentes no estilo shadcn/ui.
- `backend`: API Node.js + Express + TypeScript + Prisma + PostgreSQL + Redis + Socket.IO.
- `bot`: bot Discord.js v14 + TypeScript, sem paginas HTML ou rotas web.

## Fluxo

```txt
Frontend
  |
  v
Backend API
  |-- PostgreSQL
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

Ou rode backend e frontend juntos:

```bash
npm start
```

Se alguma porta ficar presa por um processo antigo do projeto:

```bash
npm run stop
npm start
```

URLs padrao:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000/api`
- Socket.IO: `http://localhost:4000`

PostgreSQL roda em `postgresql://discord:discord@localhost:5432/discord_platform?schema=public`.

## OAuth2 Discord

Por padrao, a dashboard abre sem OAuth2 usando o usuario local `Admin Local`. Esse modo tambem emite JWT httpOnly para manter o mesmo fluxo interno do painel.

Para exigir login Discord novamente, defina no `backend/.env`:

```env
DASHBOARD_AUTH_REQUIRED="true"
```

Crie uma aplicacao no Discord Developer Portal e configure:

- Redirect URI: `http://localhost:4000/api/auth/discord/callback`
- Escopos: `identify`, `email`, `guilds`

Preencha no `backend/.env`:

```env
DISCORD_CLIENT_ID=""
DISCORD_CLIENT_SECRET=""
DISCORD_CALLBACK_URL="http://localhost:4000/api/auth/discord/callback"
FRONTEND_URL="http://localhost:5173"
JWT_SECRET="change-this-jwt-secret"
DASHBOARD_AUTH_REQUIRED="true"
DASHBOARD_VERIFICATION_MODE="temporary"
```

Quando `DASHBOARD_AUTH_REQUIRED="true"`, o backend usa Discord OAuth2, salva a sessao em JWT httpOnly e redireciona para `/dashboard`.

Enquanto a validacao avancada de cargos nao estiver pronta, `DASHBOARD_VERIFICATION_MODE="temporary"` libera o acesso quando o usuario autenticado clicar em `Verificar`. A estrutura de middleware ja separa os checks de administrador, dono do servidor e cargo configurado no painel.

Redis tambem fica opcional no ambiente local. Para usar Redis como store de sessao, rode o Redis e defina:

```env
REDIS_SESSION_ENABLED="true"
```

## Social Notifications

O painel inclui a pagina `Social Notifications`, com suporte inicial a alertas de lives da Twitch.

Configure no `backend/.env` e no `bot/.env`:

```env
TWITCH_CLIENT_ID=""
TWITCH_CLIENT_SECRET=""
TWITCH_MONITOR_INTERVAL_MS="300000"
```

Fluxo:

- O dono/admin do servidor cadastra o link do canal Twitch no dashboard.
- A API normaliza o canal, valida pela Twitch API e salva por `guildId`.
- O bot busca notificacoes ativas na API, consulta a Twitch a cada intervalo e envia uma embed quando detectar uma live nova.
- `lastStreamId` evita alertas duplicados da mesma live.
