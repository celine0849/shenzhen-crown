# 《深圳丽兹行冲冠之旅》部署镜像
# 适用：腾讯云 CloudBase 云托管 / 容器服务 / 任意支持 Docker 的平台
# 数据：SQLite 文件在 /app/data，容器平台请务必把该目录挂载为持久卷，否则重建即丢数据。

FROM node:22-bookworm-slim

# 强制中国时区，避免日期判断偏差
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# 原生模块 better-sqlite3 优先用预编译包；无匹配 ABI 时现场编译，故装编译工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖（利用镜像层缓存），再拷源码
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080 \
    NODE_ENV=production \
    GLOBAL_RATE_LIMIT=240 \
    SUBMIT_RATE_LIMIT=30

EXPOSE 8080

# server.js 内部已用 cluster 多进程，容器内直接启动即可
CMD ["node", "server.js"]
