FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

MAINTAINER Yiqiu Jia <yiqiujia@hotmail.com>

RUN echo $(date "+%Y-%m-%d_%H:%M:%S") >> /.image_times && \
    echo $(date "+%Y-%m-%d_%H:%M:%S") > /.image_time && \
    echo "land007/speech-socket" >> /.image_names && \
    echo "land007/speech-socket" > /.image_name

ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    net-tools vim curl wget unzip screen openssh-server git subversion locales software-properties-common uuid-runtime tzdata \
    fonts-wqy-microhei ttf-wqy-zenhei && \
    apt-get clean

## Set LOCALE to UTF8
RUN echo "zh_CN.UTF-8 UTF-8" > /etc/locale.gen && \
    locale-gen zh_CN.UTF-8 && \
    dpkg-reconfigure locales && \
    /usr/sbin/update-locale LANG=zh_CN.UTF-8
ENV LC_ALL zh_CN.UTF-8

# SSH Configuration
RUN sed -i 's/#Port 22/Port 20022/g' /etc/ssh/sshd_config && \
    echo "MaxAuthTries 20" >> /etc/ssh/sshd_config && \
    echo "ClientAliveInterval 30" >> /etc/ssh/sshd_config && \
    echo "ClientAliveCountMax 3" >> /etc/ssh/sshd_config && \
    sed -i 's/^#PermitRootLogin.*/PermitRootLogin yes/g' /etc/ssh/sshd_config

# User Configuration
RUN useradd -s /bin/bash -m land007 && \
    echo "land007:1234567" | /usr/sbin/chpasswd && \
    sed -i 's/^land007:x.*/land007:x:0:1000::\/home\/land007:\/bin\/bash/g' /etc/passwd

# Timezone Configuration
RUN cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# Add scripts
ADD *.sh /

RUN apt-get update && apt-get install -y build-essential cmake pkg-config python3 ca-certificates dos2unix && apt-get clean && \
    update-ca-certificates -f

# 安装 NVM
RUN curl https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

# 设置环境变量
ENV NVM_DIR=/root/.nvm
ENV SHIPPABLE_NODE_VERSION=v20.3.1
ENV NODE_PATH=$NVM_DIR/versions/node/$SHIPPABLE_NODE_VERSION/lib/node_modules
ENV PATH=$NVM_DIR/versions/node/$SHIPPABLE_NODE_VERSION/bin:$PATH

RUN . $HOME/.nvm/nvm.sh && nvm install $SHIPPABLE_NODE_VERSION && nvm alias default $SHIPPABLE_NODE_VERSION && nvm use default

# 清理npm缓存
RUN . $HOME/.nvm/nvm.sh && npm cache clean --force

# 安装全局npm包
RUN . $HOME/.nvm/nvm.sh && npm install -g node-gyp supervisor http-server yarn typescript

# 分开安装项目依赖，以减少并发问题
RUN . $HOME/.nvm/nvm.sh && cd /root && npm install socket.io ws express cors http-proxy bagpipe eventproxy chokidar request nodemailer await-signal log4js moment cors && \
    ln -s /root/node_modules /node_modules

# Define working directory.
ADD node /node
RUN ln -s /node $HOME/ && ln -s /node /home/land007 && \
    mv /node /node_ && \
    chmod +x /*.sh
WORKDIR /node
VOLUME ["/node"]
RUN echo "/check.sh /node" >> /start.sh && \
    echo "echo \$PATH" >> /start.sh && \
    echo "echo \$NODE_PATH" >> /start.sh && \
    echo "which supervisor" >> /start.sh && \
    echo "supervisor -w /node/ -i node_modules /node/server.js" >> /start.sh

EXPOSE 20022/tcp 80/tcp

# 确保 nvm 的路径在全局可用
RUN echo "source $NVM_DIR/nvm.sh" >> /root/.bashrc
RUN echo "export PATH=$PATH" >> /root/.bashrc
RUN echo "export NODE_PATH=$NODE_PATH" >> /root/.bashrc

CMD /task.sh && /start.sh && bash

ENV AZURE_SUBSCRIPTION_KEY=2v8jUPflWcdfm2l
ENV AZURE_REGION=southeastasia

#docker build -t land007/speech-socket:latest .
#> docker buildx build --platform linux/amd64,linux/arm64/v8,linux/arm/v7 -t land007/speech-socket:latest --push .