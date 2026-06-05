# Database boundary

O bot nao possui conexao direta com PostgreSQL, Prisma ou Redis.

Qualquer leitura ou escrita de configuracoes, logs, tickets, lives ou estatisticas deve passar pela API em `backend`.
