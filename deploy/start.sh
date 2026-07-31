#!/usr/bin/env bash
# 《深圳丽兹行冲冠之旅》一键部署脚本（适用于 Ubuntu / Debian 轻量服务器）
# 用法：
#   chmod +x deploy/start.sh
#   sudo bash deploy/start.sh
# 脚本会：安装 Node 22 → 安装生产依赖 → 安装 PM2 → 启动守护进程
# （CentOS / Rocky 请把 apt-get 换成 dnf；详见 deploy/deploy.md）

set -e
echo "== 深圳丽兹行冲冠之旅 部署脚本 =="

# 1) 确保 Node >= 22（package.json 要求 >=22）
NODE_MAJOR=$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo 0)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "未检测到 Node 22，正在通过 NodeSource 安装..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node 版本: $(node -v)"

# 2) 安装生产依赖（不装 devDependencies）
echo "== 安装依赖 =="
npm install --omit=dev

# 3) 安装 PM2（若未安装）
if ! command -v pm2 >/dev/null 2>&1; then
  echo "== 安装 PM2 =="
  npm install -g pm2
fi

# 4) 启动守护进程（server.js 内部自带 cluster，PM2 用单实例 fork）
pm2 start deploy/ecosystem.config.js
pm2 save

echo ""
echo "== 启动完成 =="
echo "运行状态 : pm2 status"
echo "查看日志 : pm2 logs shenzhen-crown"
echo "重启服务 : pm2 restart shenzhen-crown"
echo "停止服务 : pm2 stop shenzhen-crown"
echo ""
echo "【重要】设置开机自启（请用 root 执行下面两条）："
echo "  pm2 startup"
echo "  pm2 save"
echo ""
echo "服务已在 0.0.0.0:8080 监听，下一步请配置 Nginx 反代 + 域名 HTTPS（见 deploy/deploy.md）。"
