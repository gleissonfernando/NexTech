# Ricardinho98

Dashboard, API e bots Discord para uso em hospedagem.

Este repositorio nao deve conter tokens, secrets, IDs reais de servidor, IDs reais de dev ou dominio real de producao. Configure tudo no painel da hospedagem usando variaveis de ambiente.

## Deploy Na Hospedagem

Use o projeto pela raiz.

Na ShardCloud/Sharclaude, configure:

```text
Build command: npm install && npm run build
Start command: npm start
Node entry: index.js
```

O arquivo `.shardcloud` ja aponta o comando de producao para `npm start` e memoria base de 1024 MB. O script de start define `NODE_ENV=production`, `HOST=0.0.0.0` e `PORT=80` quando a hospedagem nao informar esses valores. Nao use URL local na hospedagem.

Build:

```bash
npm install && npm run build
```

Start:

```bash
npm start
```

O `npm start` sobe backend, frontend compilado e processos de bot em modo de producao. A hospedagem deve fornecer as variaveis de ambiente listadas em `.env.example`.

Em producao, o bot principal roda em modo leve quando `BOT_ENABLED_MODULES` nao estiver definido. Para habilitar modulos especificos, configure uma lista como `BOT_ENABLED_MODULES=giveaway,logs,welcome,leave`. Para voltar ao comportamento antigo de ligar todos os modulos, use `BOT_DEFAULT_ALL_MODULES=true`. Bots cadastrados no painel DEV tambem nao iniciam automaticamente em producao a menos que `START_REGISTERED_DEV_BOTS=true`.

## Fluxo Seguro De Deploy

Antes de subir qualquer alteracao, rode o preflight principal:

```bash
npm run deploy:check
```

Esse comando builda API, bot e painel, valida `.shardcloud`, sintaxe JS, comandos do Discord e arquivos `dist`.

Para uma checagem mais rapida usando o build existente:

```bash
npm run deploy:check:fast
```

Para validar tambem o `.env` local:

```bash
npm run deploy:check:env
```

Se passar, faca commit e push na `main`:

```bash
git add .
git commit -m "sua mensagem"
git push origin main
```

O GitHub Actions executa `npm run deploy:check`, `npm run build`, `shard-cloud/action@main`, `commit 5b061ec4-2c46-4506-b567-56c463f7a9d9`, `restart 5b061ec4-2c46-4506-b567-56c463f7a9d9` e valida:

```text
https://ricardinho98.shardweb.app/
https://ricardinho98.shardweb.app/api/health
https://ricardinho98.shardweb.app/api/_shardcloud/health
```

Nao suba direto sem rodar `npm run deploy:check`. Segredos ficam na ShardCloud/GitHub, nunca no Git.

## Variaveis Na Hospedagem

Se a hospedagem tiver limite de variaveis, use somente uma variavel:

```text
APP_CONFIG_JSON
```

Valor: um JSON com todas as configuracoes.

Exemplo de estrutura, sem valores reais:

```json
{
  "SITE_ORIGIN": "https://seu-dominio-da-hospedagem.example.com",
  "FRONTEND_URL": "https://seu-dominio-da-hospedagem.example.com",
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
https://github.com/gleissonfernando/Ricardinho98.git
```
