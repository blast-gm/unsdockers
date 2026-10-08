#!/bin/bash
cd /home/container

# Make internal Docker IP address available to processes.
INTERNAL_IP=$(ip route get 1 | awk '{print $(NF-2);exit}')
export INTERNAL_IP

# ClamAV (clamd + freshclam) lives under /home/container so its signature
# database survives restarts on the server's persistent volume.
CLAM_DIR=/home/container/clamav
DB_DIR="$CLAM_DIR/db"
RUN_DIR="$CLAM_DIR/run"
mkdir -p "$DB_DIR" "$RUN_DIR"

FRESHCLAM_CONF="$CLAM_DIR/freshclam.conf"
cat > "$FRESHCLAM_CONF" <<EOF
DatabaseMirror database.clamav.net
DatabaseDirectory $DB_DIR
UpdateLogFile $CLAM_DIR/freshclam.log
PidFile $RUN_DIR/freshclam.pid
Checks 24
EOF

CLAMD_CONF="$CLAM_DIR/clamd.conf"
cat > "$CLAMD_CONF" <<EOF
LocalSocket $RUN_DIR/clamd.sock
TCPSocket 3310
TCPAddr 127.0.0.1
PidFile $RUN_DIR/clamd.pid
DatabaseDirectory $DB_DIR
LogFile $CLAM_DIR/clamd.log
LogTime yes
LogClean no
StreamMaxLength ${MAX_FILE_MB:-2047}M
MaxFileSize ${MAX_FILE_MB:-2047}M
MaxScanSize 4000M
MaxRecursion 17
MaxFiles 20000
AlertExceedsMax yes
AlertEncrypted no
MaxThreads ${MAX_CONCURRENT_SCANS:-2}
MaxQueue 100
ConcurrentDatabaseReload ${CONCURRENT_DB_RELOAD:-yes}
SelfCheck 600
CommandReadTimeout 30
ReadTimeout 120
IdleTimeout 120
MaxScanTime 600000
ScanArchive yes
ScanPDF yes
ScanOLE2 yes
ScanHTML yes
ScanPE yes
ScanELF yes
ScanMail no
AlertBrokenExecutables no
Bytecode yes
BytecodeSecurity TrustSigned
DetectPUA no
EOF

echo "==> Verificando assinaturas do ClamAV (pode levar minutos na 1a vez)..."
if [ -z "$(ls -A "$DB_DIR" 2>/dev/null)" ]; then
  # O clamd não sobe sem pelo menos uma base de assinaturas no DB_DIR, então
  # insiste no freshclam (rede instável, mirror lento etc.) antes de seguir.
  for i in $(seq 1 10); do
    freshclam --config-file="$FRESHCLAM_CONF" && break
    echo "AVISO: freshclam falhou (tentativa $i/10); tentando de novo em 15s..."
    sleep 15
  done
  [ -n "$(ls -A "$DB_DIR" 2>/dev/null)" ] || echo "AVISO: sem assinaturas ainda; o clamd pode falhar ao subir. Veja $CLAM_DIR/freshclam.log."
fi

# Atualiza as assinaturas periodicamente em segundo plano (a cada 6h).
( while true; do sleep 21600; freshclam --config-file="$FRESHCLAM_CONF" >> "$CLAM_DIR/freshclam.log" 2>&1 || true; done ) &

echo "==> Iniciando clamd..."
clamd --config-file="$CLAMD_CONF" &

echo "==> Esperando clamd responder..."
for i in $(seq 1 90); do
  (exec 3<>/dev/tcp/127.0.0.1/3310 && printf 'zPING\0' >&3 && head -c4 <&3 | grep -q PONG) 2>/dev/null && break
  sleep 2
done
(exec 3<>/dev/tcp/127.0.0.1/3310 && printf 'zPING\0' >&3 && head -c4 <&3 | grep -q PONG) 2>/dev/null \
  && echo "clamd respondendo" \
  || echo "AVISO: clamd nao respondeu a tempo; o servico vai tentar seguir mesmo assim."

export CLAMD_HOST=127.0.0.1
export CLAMD_PORT=3310

# Print Node.js Version
node -v

# Replace Startup Variables
MODIFIED_STARTUP=$(echo -e ${STARTUP} | sed -e 's/{{/${/g' -e 's/}}/}/g')
echo ":/home/container$ ${MODIFIED_STARTUP}"

# Run the Server
eval ${MODIFIED_STARTUP}
