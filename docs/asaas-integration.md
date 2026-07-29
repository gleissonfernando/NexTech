# Integração Asaas

## Variáveis de ambiente

Configure somente no ambiente seguro da hospedagem:

```env
ASAAS_API_URL=https://api.asaas.com/v3
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=
ASAAS_WEBHOOK_URL=https://nextech.discloud.app/api/webhooks/asaas
PAYMENTS_ENABLED=true
PAYMENTS_ALLOW_LIVE_CHARGES=true
```

`ASAAS_BASE_URL` continua aceito como compatibilidade. Nunca exponha `ASAAS_API_KEY` no frontend.

## Endpoints

- `POST /api/payments/pix`
- `POST /api/payments/card`
- `POST /api/subscriptions/create`
- `POST /api/webhooks/asaas`

O webhook oficial para cadastrar no Asaas é:

```text
https://nextech.discloud.app/api/webhooks/asaas
```

## Eventos processados

- `PAYMENT_CREATED`
- `PAYMENT_CONFIRMED`
- `PAYMENT_RECEIVED`
- `PAYMENT_OVERDUE`
- `PAYMENT_REFUNDED`
- `PAYMENT_DELETED`
- `SUBSCRIPTION_CREATED`
- `SUBSCRIPTION_UPDATED`
- `SUBSCRIPTION_DELETED`

Eventos são registrados em `payment_events` com payload completo, hash, status, request id, payment id e resultado. Eventos duplicados com mesmo `eventId` ou hash não são processados novamente.

## Fluxo

1. Cliente cria cobrança Pix/cartão ou assinatura.
2. Asaas envia o evento para `/api/webhooks/asaas`.
3. O backend valida `ASAAS_WEBHOOK_TOKEN`.
4. O webhook responde `200` rapidamente.
5. O processamento ocorre em segundo plano.
6. `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` marcam a ordem como aprovada e ativam a assinatura.
7. `PAYMENT_OVERDUE` suspende a assinatura/workspace.
8. `PAYMENT_REFUNDED` cancela a assinatura/workspace e revoga acesso.

## Cadastro no Asaas

Nome do webhook:

```text
NexTech
```

URL:

```text
https://nextech.discloud.app/api/webhooks/asaas
```

Configure o token no Asaas com o mesmo valor de `ASAAS_WEBHOOK_TOKEN`.
