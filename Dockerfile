# 《冲冠之路》Docker 镜像
# 基础镜像：node:22-bookworm-slim（Node.js 22 LTS）
# 构建阶段：安装构建工具 -> npm ci -> 清理构建工具
# 运行阶段：非 root 用户运行，数据卷挂载 /app/data

FROM node:22-bookworm-slim AS builder

# 安装 better-sqlite3 构建所需工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单。package-lock.json 必须进入镜像，保证每次构建依赖版本一致。
COPY package.json package-lock.json ./

# 使用 npm ci 安装生产依赖（避免 pnpm 11 兼容性问题）
RUN npm ci --omit=dev

# ============ 运行阶段 ============
FROM node:22-bookworm-slim AS runner

# 安装 better-sqlite3 运行时所需的原生库
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

WORKDIR /app

# 从构建阶段复制 node_modules 和源码
COPY --from=builder /app/node_modules ./node_modules
COPY package.json server.js db.js ./
COPY public ./public

# 创建数据目录并赋权
RUN mkdir -p /app/data && chown -R app:app /app

USER app

ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Asia/Shanghai
ENV DISABLE_CLUSTER=0

EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
