# clamav/teamdrive-scanner

Imagem Docker para o Pterodactyl: ClamAV (`clamd` + `freshclam`) e Node.js 20 na mesma imagem, com o código do
`teamdrive-scanner` já embutido em `/opt/teamdrive-scanner` (fora de `/home/container`, já que esse caminho é
substituído pelo volume persistente do servidor).

O `entrypoint.sh`:
1. Cria `/home/container/clamav/{db,run}` (as assinaturas do ClamAV ficam no volume do servidor, sobrevivem a reinícios).
2. Gera `clamd.conf`/`freshclam.conf` ali dentro, lendo `MAX_FILE_MB`/`MAX_CONCURRENT_SCANS` das variáveis do egg.
3. Baixa as assinaturas na 1ª vez (`freshclam`) e atualiza de 6 em 6 horas em segundo plano.
4. Sobe o `clamd` (em `127.0.0.1:3310`) e espera ele responder.
5. Roda o comando de start do egg (`node /opt/teamdrive-scanner/src/server.js`).

Egg para importar no painel: `../eggs/egg-clamav-teamdrive-scanner.json`.

A imagem é publicada em `ghcr.io/blast-gm/unsdockers:clamav_teamdrive-scanner` pelo workflow
`.github/workflows/clamav.yml` a cada push em `clamav/**` na branch `main`.
