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
npm run dev
```

Se alguma porta ficar presa por um processo antigo do projeto:

```bash
npm run stop
npm run dev
```

## Deploy Sharclaud

Use o projeto pela raiz.

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm start
```

O `npm start` de producao sobe o backend e o bot juntos. O backend tambem serve o build do frontend em `frontend/dist`.
Se a hospedagem nao definir `NODE_ENV`, o script de start define `NODE_ENV=production`.
Em producao na Shard, o backend forca `HOST=0.0.0.0` e `PORT=80`, que e a porta esperada pelo proxy `shardweb.app`.

Configure as variaveis no painel da Sharclaud usando `.env.example` como checklist. Em producao, nao use `localhost`, `127.0.0.1` ou `0.0.0.0` em URLs publicas: a aplicacao recusa iniciar com URLs locais.

```env
NODE_ENV="production"
FRONTEND_URL="https://ricardinho98.shardweb.app"
MONGODB_URI="mongodb+srv://usuario:senha@cluster.mongodb.net/ricardinho98?retryWrites=true&w=majority"
SESSION_SECRET="troque-por-um-segredo-grande-de-sessao"
JWT_SECRET="troque-por-um-segredo-grande-de-jwt"
BOT_API_TOKEN="troque-por-um-token-interno-do-bot"
DISCORD_BOT_TOKEN="token-do-bot"
DISCORD_CLIENT_ID="client-id-oauth"
DISCORD_CLIENT_SECRET="client-secret-oauth"
DISCORD_CALLBACK_URL="https://ricardinho98.shardweb.app/auth/discord/callback"
DASHBOARD_AUTH_REQUIRED="true"
DASHBOARD_AUTHORIZED_USER_IDS="123456789012345678,987654321098765432"
DEV_AUTH_ENABLED="false"
```

Quando frontend, API e bot rodam no mesmo dominio, `BACKEND_API_URL`, `BACKEND_SOCKET_URL`, `VITE_API_URL` e `VITE_SOCKET_URL` podem ficar vazias. O bot deriva as URLs a partir de `FRONTEND_URL`; o frontend usa `/api` e o dominio atual no build.

Configure `BACKEND_API_URL`, `BACKEND_SOCKET_URL`, `VITE_API_URL` e `VITE_SOCKET_URL` apenas se separar frontend/API em dominios diferentes.

Preencha tambem as variaveis da Twitch se for usar esses recursos.

## Desenvolvimento local

Use apenas o `.env` da raiz do projeto para desenvolvimento. Se nenhuma URI de MongoDB for informada em modo dev, o backend usa `mongodb://localhost:27017/ricardinho98`.

URLs locais de desenvolvimento:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000/api`
- Socket.IO: `http://localhost:4000`

## OAuth2 Discord

Em desenvolvimento, a dashboard pode abrir sem OAuth2 usando o usuario local `Admin Local`. Esse modo tambem emite JWT httpOnly para manter o mesmo fluxo interno do painel.

Em producao, `DASHBOARD_AUTH_REQUIRED` precisa ficar `true`; o modo local/dev fica bloqueado para evitar deploy aberto ou preso em usuario local.

Para exigir login Discord novamente, defina no `.env`:

```env
DASHBOARD_AUTH_REQUIRED="true"
```

Crie uma aplicacao no Discord Developer Portal e configure:

- Redirect URI: `https://ricardinho98.shardweb.app/auth/discord/callback`
- Escopos: `identify`, `email`, `guilds`

Para desenvolvimento local, preencha no `.env`:

```env
DISCORD_CLIENT_ID=""
DISCORD_CLIENT_SECRET=""
DISCORD_CALLBACK_URL="https://ricardinho98.shardweb.app/auth/discord/callback"
FRONTEND_URL="https://ricardinho98.shardweb.app"
JWT_SECRET="change-this-jwt-secret"
DASHBOARD_AUTH_REQUIRED="true"
DASHBOARD_VERIFICATION_MODE="temporary"
```

Use sempre a URL publica em `DISCORD_CALLBACK_URL` e `FRONTEND_URL` quando `DASHBOARD_AUTH_REQUIRED="true"`. O OAuth2 do Discord nao deve apontar para `localhost`.

`DASHBOARD_AUTHORIZED_USER_IDS` aceita IDs Discord separados por virgula. Esses usuarios recebem acesso administrativo mesmo que nao sejam donos/admin em um servidor retornado pelo OAuth. Quem autenticar sem permissao especial entra como visualizacao basica.

Quando `DASHBOARD_AUTH_REQUIRED="true"`, o backend usa Discord OAuth2, salva a sessao em JWT httpOnly, redireciona para `/auth/success` e depois o frontend envia o usuario para `/dashboard`.

Enquanto a validacao avancada de cargos nao estiver pronta, `DASHBOARD_VERIFICATION_MODE="temporary"` libera o acesso quando o usuario autenticado clicar em `Verificar`. A estrutura de middleware ja separa os checks de administrador, dono do servidor e cargo configurado no painel.

Redis tambem fica opcional no ambiente local. Para usar Redis como store de sessao, rode o Redis e defina:

```env
REDIS_SESSION_ENABLED="true"
```

## Lives

O painel inclui o gerenciamento de alertas da Twitch dentro da area `Lives`.

Configure no `.env`:

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
