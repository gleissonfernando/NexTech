# Ricardinho98

Dashboard, API e bots Discord executados em producao na Shard.

## Deploy Shard

Use o projeto pela raiz.

Build:

```bash
npm install && npm run build
```

Start:

```bash
npm start
```

O `npm start` define `NODE_ENV=production`, sobe o backend e os bots, e serve o frontend compilado. O backend usa `0.0.0.0:80`, conforme o proxy da hospedagem.

Cadastre no painel da Shard todas as variaveis listadas em `.env.example`. Os valores principais sao:

```env
SITE_ORIGIN="https://ricardinho98.shardweb.app"
FRONTEND_URL="https://ricardinho98.shardweb.app"
MONGODB_URI="mongodb+srv://..."
SESSION_SECRET="segredo-forte"
JWT_SECRET="outro-segredo-forte"
BOT_API_TOKEN="token-interno"
DISCORD_BOT_TOKEN="token-do-bot"
DISCORD_CLIENT_ID="client-id"
DISCORD_CLIENT_SECRET="client-secret"
DISCORD_OAUTH_REDIRECT_URI="https://ricardinho98.shardweb.app/auth/discord/callback"
DISCORD_CALLBACK_URL="https://ricardinho98.shardweb.app/auth/discord/callback"
DASHBOARD_DEV_USER_IDS="1426287249020158018"
TWITCH_CLIENT_ID=""
TWITCH_CLIENT_SECRET=""
```

O runtime recusa MongoDB e URLs publicas locais. Nao existe login local: o acesso ao painel sempre usa Discord OAuth2.

## Permissao Dev

Somente IDs presentes em `DASHBOARD_DEV_USER_IDS` podem cadastrar e gerenciar bots. Para autorizar mais de um Dev, separe os IDs do Discord por virgula.

Usuarios comuns nao conseguem usar as rotas de cadastro diretamente pela API.

## Clips

O monitor consulta a Twitch a cada 30 segundos. Configuracoes antigas com outro intervalo sao normalizadas automaticamente para 30 segundos.

Os canais sao processados com concorrencia controlada para evitar fila longa. Um clipe so e registrado como enviado depois que o Discord confirma a mensagem; falhas temporarias sao tentadas novamente no ciclo seguinte.

A Twitch pode levar algum tempo para disponibilizar um clipe novo na API. O sistema usa uma janela retroativa configurada por `CLIPS_LOOKBACK_MS` para encontrar o clipe assim que ele aparecer, sem duplicar mensagens.

## Multi-bot

Cadastre bots na aba Dev. Cada processo recebe seu escopo interno por `DASHBOARD_BOT_ID`, e os modulos liberados ficam isolados por bot e servidor.

## Redis

Redis e opcional, mas deve ser remoto quando ativado:

```env
REDIS_SESSION_ENABLED="true"
REDIS_URL="rediss://..."
```
