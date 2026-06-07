# Ricardinho98

Dashboard, API e bots Discord para uso em hospedagem.

Este repositorio nao deve conter tokens, secrets, IDs reais de servidor, IDs reais de dev ou dominio real de producao. Configure tudo no painel da hospedagem usando variaveis de ambiente.

## Deploy Na Hospedagem

Use o projeto pela raiz.

Build:

```bash
npm install && npm run build
```

Start:

```bash
npm start
```

O `npm start` sobe backend, frontend compilado e processos de bot em modo de producao. A hospedagem deve fornecer as variaveis de ambiente listadas em `.env.example`.

## Variaveis

Copie `.env.example` apenas como referencia. Troque todos os valores de exemplo no painel da hospedagem.

Exemplo seguro:

```env
SITE_ORIGIN="https://seu-dominio-da-hospedagem.example.com"
FRONTEND_URL="https://seu-dominio-da-hospedagem.example.com"
MONGODB_URI="mongodb+srv://usuario:senha@cluster.example.net/nome-do-banco?retryWrites=true&w=majority"
SESSION_SECRET="gere-um-segredo-forte"
JWT_SECRET="gere-outro-segredo-forte"
BOT_API_TOKEN="gere-um-token-interno"
DISCORD_BOT_TOKEN="token-do-bot-discord"
DISCORD_CLIENT_ID="client-id-do-discord"
DISCORD_CLIENT_SECRET="client-secret-do-discord"
DISCORD_OAUTH_REDIRECT_URI="https://seu-dominio-da-hospedagem.example.com/auth/discord/callback"
DISCORD_CALLBACK_URL="https://seu-dominio-da-hospedagem.example.com/auth/discord/callback"
DASHBOARD_DEV_USER_IDS="id-discord-dev-1,id-discord-dev-2"
DASHBOARD_GUILD_IDS="id-servidor-discord-1,id-servidor-discord-2"
```

Credenciais de integracoes tambem devem ficar somente na hospedagem:

```env
TWITCH_CLIENT_ID="client-id-da-twitch"
TWITCH_CLIENT_SECRET="client-secret-da-twitch"
X_CONSUMER_KEY="consumer-key-do-x"
X_CONSUMER_SECRET="consumer-secret-do-x"
X_BEARER_TOKEN="bearer-token-do-x"
```

## Seguranca

- Nao commite `.env`.
- Nao commite tokens reais.
- Nao coloque IDs reais no README.
- Nao coloque dominio real no README.
- Se algum segredo foi exposto em chat, log ou commit, rotacione o segredo no provedor antes de usar em producao.

## Modulos

O painel suporta modulos por bot e servidor:

- Boas-vindas e saida
- Lives Twitch
- Clips Twitch
- Rede Social dos Membros
- X Monitor
- Tickets
- Logs
- Moderacao
- Cargos

Cada bot cadastrado pode ter modulos liberados separadamente na aba de administracao.

## X Monitor

O X Monitor usa a API v2 do X via `X_BEARER_TOKEN` configurado na hospedagem. A dashboard valida o perfil, salva a conta no banco e o bot monitora novas publicacoes para enviar no canal configurado.

## Banco De Dados

Use um MongoDB remoto configurado por `MONGODB_URI`.

Colecoes usadas pelo sistema incluem:

- `User`
- `Guild`
- `GuildSettings`
- `LogEntry`
- `social_notifications`
- `social_members`
- `social_panels`
- `x_accounts`
- `x_posts_sent`
- `clips_config`
- `clips_sent`
- `Bot`
- `BotGuildConfig`

## Git

Repositorio de destino:

```text
https://github.com/gleissonfernando/Ricardinho98.git
```
