# 《深圳丽兹行冲冠之旅》上线指南（GitHub + Supabase + Netlify）

> 本指南手把手带你从零到线上，全程约 20 分钟。

---

## 第一步：注册三个平台（全部免费）

### 1. GitHub（代码仓库）
1. 打开 https://github.com → 注册/登录
2. 点击 **New repository** → 名字填 `shenzhen-crown` → 选 **Private**（内部活动不公开）→ 创建

### 2. Supabase（云数据库）
1. 打开 https://supabase.com → 用 GitHub 登录（最快）
2. 点击 **New Project** → 组织选你的 → 名字填 `crown-game` → 数据库密码**记下来** → 区域选 **Singapore (ap-southeast-1)**（离深圳近）→ 创建
3. 等项目启动完成（约 1 分钟），进入：
   - 左侧 **Settings → API** → 找到 **Project URL** 和 **anon public key**，复制保存
   - 左侧 **SQL Editor** → 点 **New Query** → 把本项目 `supabase_schema.sql` 的内容粘贴进去 → 点 **Run**

### 3. Netlify（托管 + API）
1. 打开 https://netlify.com → 注册/登录（可用 GitHub 账号直接登录）
2. 进入控制台后准备绑定仓库

---

## 第二步：推送代码到 GitHub

```bash
# 在 shenzhen-crown 目录下执行
cd shenzhen-crown

# 初始化 Git（如果还没有）
git init
git add .
git commit -m "feat: 深圳丽兹行冲冠之旅 - 18门店战队版"

# 关联你刚建的 GitHub 仓库（替换 YOUR_USERNAME）
git remote add origin https://github.com/YOUR_USERNAME/shenzhen-crown.git
git branch -M main
git push -u origin main
```

---

## 第三步：在 Netlify 绑定并部署

### 方式 A：通过 Git 自动部署（推荐，每次 push 自动更新）

1. 在 Netlify 控制台点 **Add new site → Import an existing project**
2. 选 **GitHub** → 授权后找到 `shenzhen-crown` 仓库
3. 配置构建设置：
   - **Build command**: 留空（纯静态，无需构建）
   - **Publish directory**: `public`
4. 点 **Deploy site**
5. 部署成功后，进入 **Site settings → Environment variables**，添加以下变量：

| 变量名 | 值 |
|---|---|
| `SUPABASE_URL` | 你的 Supabase Project URL（如 `https://xxxxx.supabase.co`）|
| `SUPABASE_ANON_KEY` | 你的 Supabase anon public key（以 `eyJ` 开头）|
| `ACTIVITY_START` | `2026-08-01T08:00:00+08:00`（按实际活动时间改）|
| `ACTIVITY_END` | `2026-08-03T23:59:59+08:00`（按实际活动时间改）|
| `DAILY_LIMIT` | `10` |

6. 添加完变量后，去 **Deploys** 页面点 **Retry deploy**（让环境变量生效）

### 方式 B：拖拽部署（最快，适合临时测试）

1. 在 Netlify 控制台点 **Add new site → Deploy manually**
2. 把整个 `shenzhen-crown` 文件夹**拖进去**
3. 部署完成后同样添加环境变量并重新部署

---

## 第四步：验证上线

打开 Netlify 给你的域名（类似 `https://xxx-xxx.netlify.app`），检查：

- [ ] 首页显示「深圳丽兹行冲冠之旅」+ 18 个战队卡片
- [ ] 选队 → 选战场 → 玩一局 → 提交成绩成功
- [ ] 排名榜能看到刚提交的战绩
- [ ] 刷新页面数据不丢失（存在 Supabase 里了）

---

## 第五步（可选）：绑自定义域名

1. Netlify 控制台 → **Domain settings → Add custom domain**
2. 输入你的域名（如 `crown.yourcompany.com`）
3. 按提示去域名 DNS 管理处添加 CNAME 记录指向 Netlify
4. Netlify 会自动签发 HTTPS 证书

---

## 常见问题

### Q: 提示"缺少环境变量 SUPABASE_URL"
**A:** 在 Netlify 控制台 → Site settings → Environment variables 中添加，然后重新部署。

### Q: Supabase 查询报错 "relation does not exist"
**A:** 还没执行建表脚本。去 Supabase SQL Editor 执行 `supabase_schema.sql`。

### Q: 数据量大了会慢吗？
**A:** 18 队 × 每天 10 次 × 几百人 = 日增几千条，Supabase 免费版轻松扛住。如果上万条，建议给 `submit_date` 加索引（脚本里已加）。

### Q: 想清空所有数据重来？
**A:** Supabase 控制台 → Table editor → chongguan_scores → 清空即可。或用 SQL: `TRUNCATE chongguan_scores, chongguan_players;`

### Q: 本地还能跑吗？
**A:** 能！`npm start` 或 `node server.js` 照常使用 SQLite 版本，互不影响。Netlify 版走 Supabase，本地版走 SQLite。

---

## 架构图

```
玩家手机/浏览器
    │
    ▼
┌─────────────┐     静态文件 (HTML/CSS/JS)
│   Netlify    │◄────── public/
│  (CDN 托管)  │
│              │
│  ┌────────┐ │     Serverless Functions (API)
│  │ config │ │──► 返回 18 队配置
│  │ scores │ │──► 写入成绩到 Supabase
│  │leaderb │ │──► 聚合榜单查询
│  │players │ │──► 个人今日状态
│  └────────┘ │
└──────┬──────┘
       │  @supabase/supabase-js
       ▼
┌─────────────┐
│   Supabase  │     PostgreSQL 云数据库
│  (免费额度) │     成绩 / 玩家 / 战报
└─────────────┘
```

---

## 文件说明

| 文件/目录 | 作用 |
|---|---|
| `public/` | 前端静态文件（H5 页面）|
| `netlify/functions/` | Netlify Serverless API（替代原 server.js）|
| `netlify/functions/_shared/` | 共用模块（Supabase 客户端、战队数据、工具函数）|
| `netlify.toml` | Netlify 构建配置、重写规则、缓存策略 |
| `supabase_schema.sql` | Supabase 建表脚本（18 阶约束 + 索引 + 视图）|
| `teams.js` | 战队/战场单一数据源（Functions 内有独立副本）|
| `server.js` + `db.js` | 本地开发用（SQLite 版），上线不需要 |
| `deploy/` | 轻量服务器部署脚本（备选方案，不走 Netlify 时用）|
