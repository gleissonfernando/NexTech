# Projeto Discord Dashboard

Dashboard, API e bots Discord para uso em hospedagem.

Este repositorio nao deve conter tokens, secrets, IDs reais de servidor, IDs reais de dev ou dominio real de producao. Configure tudo no painel da hospedagem usando variaveis de ambiente.

## Deploy manual na Discloud

Use o projeto pela raiz.

Este projeto e um monorepo Node.js/TypeScript com dashboard React, API Express e bot Discord. O deploy na Discloud e manual; nao use GitHub Actions, push automatico ou workflow de deploy automatico.

### Pre-requisitos

- Node.js compativel com `VERSION=latest` na Discloud.
- MongoDB remoto configurado em `MONGODB_URI`.
- Token do bot Discord e credenciais OAuth do Discord.
- Token da API Discloud guardado como segredo.

### CLI da Discloud

Instale e autentique a CLI:

```bash
npm install -g discloud-cli
discloud --version
discloud --login
```

Se precisar recriar a configuracao interativamente, use:

```bash
discloud init
```

O arquivo versionado na raiz ja contem a configuracao usada por este projeto:

```text
NAME=OrviteK
TYPE=bot
MAIN=index.js
RAM=512
VERSION=latest
BUILD=npm install && npm run build
START=npm start
```

O `MAIN=index.js` chama `scripts/start-production.mjs`, que sobe backend, frontend compilado e bot em modo de producao. O `BUILD` compila os tres workspaces antes do start.

### Variaveis de ambiente

Configure as variaveis no painel da Discloud. Nao envie `.env` real no deploy e nao commite segredos.

Use `.env.example` apenas como modelo. Para reduzir quantidade de variaveis no painel, prefira `APP_CONFIG_JSON` ou `APP_CONFIG_B64` com os mesmos nomes documentados no exemplo.

Obrigatorias para producao:

```text
SITE_ORIGIN
FRONTEND_URL
MONGODB_URI
SESSION_SECRET
JWT_SECRET
BOT_API_TOKEN
DISCORD_BOT_TOKEN
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_OAUTH_REDIRECT_URI
DISCORD_CALLBACK_URL
```

O token da Discloud deve ser tratado como segredo e nunca deve aparecer em README, `.env.example`, logs ou commits.

### Deploy e atualizacao manual

Build:

```bash
npm install && npm run build
```

Start:

```bash
npm start
```

Validacao local antes do upload:

```bash
npm run deploy:check
```

Upload manual:

```bash
discloud up
discloud status
```

Dependendo da versao da CLI, o comando de upload tambem pode aparecer como `discloud app up`. Confira `discloud --help` se necessario.

Para atualizar o sistema manualmente, aplique as mudancas, rode o preflight, confira o `discloud.config` e execute novo upload:

```bash
npm install
npm run deploy:check
discloud up
discloud status
```

Em producao, o bot principal roda em modo leve quando `BOT_ENABLED_MODULES` nao estiver definido. Para habilitar modulos especificos, configure uma lista como `BOT_ENABLED_MODULES=giveaway,logs,welcome,leave`. Para voltar ao comportamento antigo de ligar todos os modulos, use `BOT_DEFAULT_ALL_MODULES=true`. Bots cadastrados no painel DEV nao iniciam automaticamente apos deploy/restart por padrao em producao, para evitar rajadas de requisicoes na hospedagem; use `START_REGISTERED_DEV_BOTS=true` apenas quando quiser religar todos automaticamente.

## Fluxo Seguro De Deploy

Antes de subir qualquer alteracao, rode o preflight principal:

```bash
npm run deploy:check
```

Esse comando builda API, bot e painel, valida `discloud.config`, sintaxe JS, comandos do Discord e arquivos `dist`.

Para uma checagem mais rapida usando o build existente:

```bash
npm run deploy:check:fast
```

Para validar tambem o `.env` local:

```bash
npm run deploy:check:env
```

Depois do deploy manual, valide URLs de exemplo como:

```text
https://seu-dominio.example.com/
https://seu-dominio.example.com/api/health
```

Nao suba direto sem rodar `npm run deploy:check`. Segredos ficam no painel da Discloud, nunca no Git.

## Variaveis Na Discloud

Se a Discloud tiver limite de variaveis, use somente uma variavel:

```text
APP_CONFIG_JSON
```

Valor: um JSON com todas as configuracoes.

Exemplo de estrutura, sem valores reais:

```json
{
  "SITE_ORIGIN": "https://seu-dominio.example.com",
  "FRONTEND_URL": "https://seu-dominio.example.com",
  "MONGODB_URI": "mongodb+srv://usuario:senha@cluster.example.net/nome-do-banco?retryWrites=true&w=majority",
  "SESSION_SECRET": "gere-um-segredo-forte",
  "JWT_SECRET": "gere-outro-segredo-forte",
  "BOT_API_TOKEN": "gere-um-token-interno",
  "DISCORD_BOT_TOKEN": "token-do-bot-discord",
  "DISCORD_CLIENT_ID": "client-id-do-discord",
  "DISCORD_CLIENT_SECRET": "client-secret-do-discord",
  "DISCORD_OAUTH_REDIRECT_URI": "https://seu-dominio-da-hospedagem.example.com/auth/discord/callback",
  "DISCORD_CALLBACK_URL": "https://seu-dominio-da-hospedagem.example.com/auth/discord/callback",
  "DASHBOARD_DEV_USER_IDS": "id-discord-dev-1,id-discord-dev-2",
  "DASHBOARD_GUILD_IDS": "id-servidor-discord-1,id-servidor-discord-2",
  "DASHBOARD_VERIFICATION_MODE": "roles",
  "TWITCH_CLIENT_ID": "client-id-da-twitch",
  "TWITCH_CLIENT_SECRET": "client-secret-da-twitch",
  "TWITCH_BROADCASTER_ACCESS_TOKEN": "token-do-broadcaster-com-scopes",
  "TWITCH_OAUTH_REDIRECT_URI": "https://seu-dominio-da-hospedagem.example.com/api/giveaways/oauth/twitch/callback",
  "KICK_CLIENT_ID": "client-id-da-kick",
  "KICK_CLIENT_SECRET": "api-key-ou-client-secret-da-kick",
  "KICK_OAUTH_REDIRECT_URI": "https://seu-dominio-da-hospedagem.example.com/api/giveaways/oauth/kick/callback",
  "KICK_WEBHOOK_PUBLIC_KEY": "",
  "X_CONSUMER_KEY": "consumer-key-do-x",
  "X_CONSUMER_SECRET": "consumer-secret-do-x",
  "X_BEARER_TOKEN": "bearer-token-do-x"
}
```

Se o painel nao aceitar JSON com aspas, use:

```text
APP_CONFIG_B64
```

Valor: o mesmo JSON convertido para Base64.

Variaveis soltas ainda funcionam e sobrescrevem valores do JSON quando existirem, mas o caminho recomendado para hospedagem com limite e usar `APP_CONFIG_JSON` ou `APP_CONFIG_B64`.

## Arquivos de deploy

- `discloud.config`: configuracao manual da Discloud.
- `.discloudignore`: evita envio de `.git`, `.github`, `node_modules`, `.env`, logs e caches.
- `.env.example`: modelo sem segredos reais.

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
- Sorteio Twitch/Kick
- Rede Social dos Membros
- X Monitor
- Tickets
- Logs
- Moderacao
- Cargos
- FiveM / FAC Ausencia

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
- `giveaways`
- `giveaway_platform_accounts`
- `giveaway_kick_events`
- `Bot`
- `BotGuildConfig`
- `fivem_fac_settings`
- `fivem_fac_absences`

## Git

Repositorio de destino:

```text
https://github.com/seu-usuario/seu-repositorio.git
```
