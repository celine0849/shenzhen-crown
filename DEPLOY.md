# 《冲冠之路》服务器手动更新说明

本项目不需要 CI/CD。每次更新代码后，在服务器项目目录手动执行下面命令即可。

## Docker 部署

进入项目目录：

```bash
cd /www/wwwroot/lizhihang
```

拉取最新代码：

```bash
git pull origin main
```

无缓存重新构建镜像，并重启容器：

```bash
docker compose build --no-cache --pull
docker compose up -d --force-recreate
```

查看服务状态：

```bash
docker compose ps
docker compose logs -f --tail=100
```

## 普通 npm 部署

如果服务器不是 Docker，而是直接用 Node.js 启动：

```bash
cd /www/wwwroot/lizhihang
git pull origin main
npm ci --omit=dev
npm start
```

## 验证

打开：

```text
http://gitee.zhuo.click/issues?v=latest
```

封面图验证：

```text
http://gitee.zhuo.click/assets/images/share-cover.jpg
```
