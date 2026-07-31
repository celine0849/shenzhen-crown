# 《深圳丽兹行冲冠之旅》发布部署指南

本游戏是 **Node.js (Express) + SQLite** 前后端不分离应用，**不是纯静态网页**，
必须运行在一个「能跑 Node 进程 + 有持久磁盘」的地方。本目录已为你准备好两套部署方案，
以及一键脚本。按你的托管方式二选一即可。

---

## 先选方案

| 方案 | 适合 | 持久化 | 难度 | 推荐度 |
|---|---|---|---|---|
| **A. 轻量应用服务器（Ubuntu）** | 正式活动、对外、要稳 | ✅ 服务器磁盘 | 低 | ⭐⭐⭐ 推荐 |
| **B. 容器云托管（CloudBase / 容器服务）** | 想用云平台、不碰服务器 | ⚠️ 需挂持久卷 | 中 | ⭐⭐ |

> 仅内部/给领导演示先看效果：本机 `npm start` + 内网穿透（ngrok / 花生壳）即可，
> 但断线即丢、数据在本地，**不适合正式活动**。

---

## 方案 A：腾讯云轻量应用服务器（推荐，最稳）

### 第 1 步：租一台服务器
- 腾讯云「轻量应用服务器」→ 镜像选 **Ubuntu 22.04 LTS** → 配置 **2 核 2G 起**（约 ¥60/月）。
- 在防火墙放行 **22 / 80 / 443** 三个端口（入站规则）。
- 记下服务器 **公网 IP**。

### 第 2 步：把项目传上去
把整个 `shenzhen-crown/` 目录上传到服务器（任选其一）：
```bash
# 方式一：scp（在你本机执行）
scp -r shenzhen-crown/ root@你的服务器IP:/opt/shenzhen-crown

# 方式二：先推到 Git 仓库，服务器上 git clone
```
> 上传前建议先 `rm -rf shenzhen-crown/data`，让服务器首次启动自动建库，避免带本地试玩数据。

### 第 3 步：一键启动
```bash
ssh root@你的服务器IP
cd /opt/shenzhen-crown
chmod +x deploy/start.sh
sudo bash deploy/start.sh
```
脚本会自动：装 Node 22 → 装生产依赖 → 装 PM2 → 启动守护进程（端口 8080）。
启动后用 `pm2 status` 看是否在跑，`pm2 logs shenzhen-crown` 看日志。

### 第 4 步：域名 + HTTPS（强烈建议，微信/H5 分享必须 https）
1. 买一个域名（如 `crown.yourcompany.com`），做 **A 记录**指向服务器 IP。
2. 在服务器装 Nginx + Certbot：
   ```bash
   apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
   ```
3. 把 `deploy/nginx.conf` 放到 `/etc/nginx/sites-available/crown`，**把里面 `example.com` 全换成你的域名**，然后：
   ```bash
   ln -s /etc/nginx/sites-available/crown /etc/nginx/sites-enabled/
   certbot --nginx -d 你的域名        # 自动签证书并改写配置
   nginx -t && systemctl reload nginx
   ```
4. 浏览器打开 `https://你的域名` 即可看到游戏。

### 第 5 步：开机自启（避免重启后没起来）
```bash
pm2 startup     # 按提示把输出的命令用 root 执行一次
pm2 save
```

---

## 方案 B：容器云托管（CloudBase 云托管 / 容器服务）

> 适合「不想管服务器」、直接用云平台容器跑。关键点：**SQLite 文件在 /app/data，
> 必须把这个目录挂成持久卷**，否则容器重建/扩缩容后战绩会清空。

### 第 1 步：准备镜像
项目已带 `deploy/Dockerfile`，平台一般能直接识别并构建。若平台要求 Dockerfile 在根目录，
把 `deploy/Dockerfile` 复制到项目根目录即可（内容已写好，监听 8080）。

### 第 2 步：创建服务
- 在 CloudBase 云托管 / 容器服务 新建服务，关联代码仓库或上传镜像。
- **运行端口**填 `8080`（与 Dockerfile 的 `EXPOSE`/CMD 一致）。
- **环境变量**（平台后台设置）：`NODE_ENV=production`（可选调 `GLOBAL_RATE_LIMIT`、`SUBMIT_RATE_LIMIT`）。
- **持久化挂载**：把容器路径 `/app/data` 挂载到平台的文件存储 / 云硬盘（**必做**）。

### 第 3 步：域名与 HTTPS
- 平台通常支持「绑定自定义域名 + 自动 HTTPS」，在控制台填域名并验证即可。
- 微信内打开 H5 必须 https，请务必开启。

### 第 4 步：验证
服务启动后，平台会给出一个临时访问地址，先点开确认能玩、榜单正常，再切自定义域名。

---

## 环境变量速查

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口（Nginx 反代到它） |
| `NODE_ENV` | — | 设为 `production` |
| `TZ` | `Asia/Shanghai` | 时区，已被 server.js 强制，无需关心 |
| `GLOBAL_RATE_LIMIT` | `240` | 全局每分钟最大请求数（防刷） |
| `SUBMIT_RATE_LIMIT` | `30` | 单 IP 每分钟最多提交次数 |
| `DISABLE_CLUSTER` | — | 设为 `1` 可关闭 server.js 内部多进程 |

---

## 数据备份与恢复

战绩存在 `data/crown.db`（SQLite）。正式活动建议每日备份：
```bash
# 服务器上
cp /opt/shenzhen-crown/data/crown.db /opt/shenzhen-crown/data/crown.db.bak-$(date +%F)
# 或用 sqlite 在线备份（不停服）
sqlite3 /opt/shenzhen-crown/data/crown.db ".backup '/path/backup.db'"
```
容器方案请在挂载的持久卷里同样定期备份。

---

## 常见问题

**Q1：better-sqlite3 安装/启动报编译错误？**
A：确保服务器/镜像装了编译工具（本包 Dockerfile 已含 `python3 make g++`；Ubuntu 裸机需 `apt-get install -y python3 make g++`）。Node 必须是 22+。

**Q2：端口被占用 / 打不开？**
A：确认 8080 没被别的服务占用；用 `pm2 logs` 看报错；防火墙/Nginx 是否放行。

**Q3：为什么不直接放 GitHub Pages / Netlify 静态版 / CloudStudio 静态托管？**
A：那些只托管前端静态文件，不会启动 `server.js`，后端 `/api/chongguan/*` 和数据库都不存在，游戏无法计分。除非把后端迁到 Supabase（改动较大，默认不推荐）。

**Q4：18 队同时在线顶得住吗？**
A：server.js 已做 cluster 多进程 + WAL + 榜单 3 秒缓存 + 限流，轻量 2 核 2G 应付门店活动绰绰有余。真要上万并发可升配或加负载均衡。

**Q5：要改门店/战场怎么办？**
A：只改根目录 `teams.js`（name/short/color），重启服务即可，其它代码不动。
