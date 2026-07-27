# Auditoria de Modulos, Planos e Recursos

Data: 2026-07-27

## Resumo executivo

Foram encontrados 83 modulos liberaveis no painel DEV, 77 itens de menu no dashboard do cliente, 70 entradas no catalogo visual de modulos, 77 rotas montadas na API e 13 planos publicos/seeds.

O problema critico identificado esta na ponte entre planos e modulos: os planos gravavam `enabledModules` com chaves comerciais de entitlement, como `streamer.twitch_alerts`, `fivem.police` e `discord.logs`. O dashboard, o backend e o bot validam acesso com IDs de modulo, como `live`, `police-promotions`, `fivem-finance` e `logs`. Na pratica, um bot cadastrado por plano podia ficar sem os modulos esperados, mesmo que o plano comprado listasse o recurso.

## Fontes analisadas

- Planos e entitlements: `backend/src/services/planService.ts`
- Cadastro e liberacao de modulos de bots: `backend/src/services/devBotService.ts`
- Menus do dashboard: `frontend/src/components/layout/sidebar.tsx`
- Catalogo e renderizacao de views: `frontend/src/pages/Dashboard.tsx`
- Rotas da API: `backend/src/routes/index.ts`
- Comandos e servicos do bot: `bot/src/commands`, `bot/src/services`

## Totais encontrados

- Modulos cadastrados no DEV: 83
- Itens de menu do dashboard: 77
- Modulos no catalogo visual do dashboard: 70
- Planos publicos/seeds: 13
- Features comerciais de plano: 24
- Rotas raiz da API: 77
- Declaracoes de comandos/names em comandos e servicos do bot: 157

## Planos identificados

- Streamer Basico
- Streamer Completo
- Policia RP Basico
- Policia RP Completo
- Faccao RP Basico
- Faccao RP Completo
- Protecao de Cargos Basico
- Protecao de Cargos Completo
- Streaming Vitalicio
- Policia RP Vitalicio
- Faccao RP Vitalicio
- Protecao Discord Vitalicio
- Financeiro Vitalicio

Nao foram encontrados planos nomeados literalmente como Premium ou Enterprise. A estrutura atual usa Basico, Completo e Vitalicio.

## Categorias finais de organizacao

Sistema

├── Dashboard
├── Planos e Pagamentos
├── Comunidade
├── Streaming
├── FiveM
├── Policia
├── Seguranca
├── Servidor
├── Logs e Auditoria
├── Cursos e RH
├── Webhooks e Integracoes
├── Administracao
└── Desenvolvedor

## Recursos associados aos planos apos mapeamento

### Streamer

- Alertas Twitch: `live`
- Alertas Kick: `kick-integration`
- Automacao de clips: `clips`, `kick-clips`
- Sorteios: `giveaway`
- Logs Discord, quando incluso: `logs`

### Policia RP

- Policia RP: `fivem`, `fivem-corporations`, `police-absences`, `police-actions`, `police-iab`, `police-hr`, `rh-admin`, `police-daf-roster`, `police-courses`, `police-patrol-reports`, `police-qru`, `police-promotions`, `vehicle-abandonment`, `police-hidden-channel`, `visible-message`, `message-control`, `police-dm`, `police-subpoenas`, `police-open-duty`, `police-time-clock`, `auto-activity-clock`
- Hierarquia FiveM: `fivem-hierarchy`
- Financeiro FiveM: `fivem-finance`
- Encomendas RP: `fivem-orders`, `fivem-washing`, `fivem-drugs`, `fivem-ammo`
- Logs Discord, quando incluso: `logs`

### Faccao RP

- Faccao RP: `fivem`, `fivem-factions`, `fivem-absences`, `fivem-actions`, `manual-registration`, `faction-chest`, `ztk-webhook`, `fivem-captcha`, `fivem-commands`
- Encomendas RP: `fivem-orders`, `fivem-washing`, `fivem-drugs`, `fivem-ammo`
- Hierarquia FiveM: `fivem-hierarchy`
- Financeiro FiveM: `fivem-finance`
- Logs Discord, quando incluso: `logs`

### Protecao Discord

- Protecao de cargos: `moderation`, `advanced-permissions`, `account-age-security`
- Anti Ban: `anti-ban`
- SelfBot Protection: `safe-bot`
- Logs Discord, quando incluso: `logs`

### Financeiro

- Financeiro FiveM: `fivem-finance`
- Logs Discord: `logs`

## Recursos fora dos planos

Estes modulos existem no sistema, mas nao sao vinculados diretamente por nenhum entitlement comercial seedado hoje:

- `avisos`
- `bio-url-verification`
- `boosters`
- `emoji-cloner`
- `first-lady`
- `global-blacklist`
- `hide-empty-voice`
- `invite-cleanup`
- `manual-payments`
- `music`
- `network`
- `nex-tech-sales`
- `nextech-invites`
- `panels`
- `payment-gateway`
- `price-tables`
- `roles`
- `rules`
- `server-backup`
- `server-cloner`
- `server-generator`
- `subscription-presence`
- `suspicious-servers`
- `tag-verification`
- `temporary-voice`
- `tickets`
- `vanity-url-protection`
- `verification`
- `voice-recorder`
- `welcome`
- `leave`
- `x-monitor`

## Duplicidades e divergencias encontradas

- `courses` aparece no menu/catalogo, enquanto o DEV tambem possui `police-courses`; ha alias funcional para compatibilidade.
- `rh-admin` e `police-hr` representam o mesmo espaco funcional de RH policial; ha alias funcional para compatibilidade.
- `fivem-fac` aparece no menu como legado de `fivem-absences`.
- `faction-chest`, `nex-tech-sales`, `subscription-presence` e `nextech-invites` existem no DEV, mas nao aparecem como item principal no menu do cliente.
- `music`, `manual-registration`, `fivem-finance`, `fivem-actions`, `fivem`, `fivem-factions`, `fivem-corporations`, `fivem-ammo`, `police-courses`, `police-hr` e alguns modulos internos existem no DEV, mas nao possuem entrada propria no `moduleCatalog`.
- `discord.tickets` e `discord.courses` existem como features comerciais, mas nao sao usados por nenhum plano seedado atual.

## Correcao aprovada pela auditoria

Sem mover arquivos, sem remover recursos e sem alterar APIs, a correcao segura e criar uma camada explicita de mapeamento entre entitlement comercial e modulo real. Essa camada preserva os nomes publicos dos planos e passa a liberar os IDs que o dashboard, backend e bot ja entendem.

## Itens que nao devem ser movidos automaticamente agora

- Arquivos de frontend e backend em uso por imports diretos.
- Rotas Express ja montadas em `backend/src/routes/index.ts`.
- Comandos Discord existentes.
- Servicos com estado em memoria, cron, timers e workers.

Mover esses arquivos exigiria uma refatoracao grande de imports/exports, com risco alto e pouco ganho imediato. A organizacao funcional pode ser feita primeiro na camada de mapeamento, menus e relatorio.
