# Lavalink do sistema de música

Este diretório configura um nó Lavalink v4 separado do processo Node.js. O bot não inicia Java automaticamente.

1. Instale Java 17 ou superior e baixe o `Lavalink.jar` v4 oficial.
2. Coloque o JAR neste diretório e defina `LAVALINK_SERVER_PASSWORD`.
3. Inicie o nó aqui com `java -jar Lavalink.jar`.
4. No bot, configure `LAVALINK_URL` (por exemplo, `http://127.0.0.1:2333`) e a mesma senha em `LAVALINK_PASSWORD`.

Em produção, use um nó privado/externo acessível pela Shardcloud. Não exponha a porta sem senha ou firewall.
