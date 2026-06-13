# ============================================================
# Vocabulario - 西语学习平台 Docker 镜像（多阶段构建）
# 使用 PostgreSQL 数据库（通过 DATABASE_URL 连接）
# ============================================================

# ---- 阶段 1: 构建 ----
FROM node:20-slim AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# 安装所有依赖（含开发依赖用于构建）
RUN cd client && npm ci && cd ..
RUN cd server && npm ci && cd ..

# 复制源码
COPY . .

# 构建前后端
RUN cd client && npm run build && cd ..
RUN cd server && npm run build && cd ..

# ---- 阶段 2: 运行 ----
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/package*.json ./

# 仅安装 server 的生产依赖
RUN cd server && npm ci --omit=dev

# 创建运行时上传目录（TTS 音频等暂存文件）
RUN mkdir -p /app/server/uploads

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "server/dist/index.js"]
