FROM        node:slim

LABEL       author="Blast" maintainer="blastlindu@gmail.com"


RUN         apt-get update && \
            apt-get install -y --no-install-recommends git git-lfs curl gpg vim net-tools lsof procps locales ca-certificates openssl openssh-client jq && \
            apt-get install -y --no-install-recommends yarn nasm && \
            yarn global add gulp && \
            npm config set registry https://registry.npmmirror.com && \
            npm install -g nrm npm-check && \
            npm install -g hexo-cli && \
            npm install -g cnpm --registry=https://registry.npmmirror.com && \
            apt-get clean && \
            yarn cache clean && \
            npm cache clean --force

RUN         curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
            apt-get update && \
            apt-get -y \
                install \
                --no-install-recommends \
                wget \
                dos2unix \
                build-essential \
                autoconf \
                automake \
                gettext \
                libtool \
                pkg-config \
                gettext \
                libpng-dev \
                gh && \
            apt-get clean

       
RUN         apt update \
            && apt-get install git -y \
            && apt -y install ffmpeg iproute2 git sqlite3 libsqlite3-dev python3 python3-dev ca-certificates dnsutils tzdata zip tar curl build-essential libtool iputils-ping libnss3 tini \
            && useradd -m -d /home/container container

RUN         npm install npm@9.8.1 typescript ts-node @types/node --location=global

USER        container
ENV         USER=container HOME=/home/container
WORKDIR     /home/container


STOPSIGNAL SIGINT

COPY        --chown=container:container ./../entrypoint.sh /entrypoint.sh
RUN         chmod +x /entrypoint.sh
ENTRYPOINT    ["/usr/bin/tini", "-g", "--"]
CMD         ["/entrypoint.sh"]
