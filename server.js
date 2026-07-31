// 《深圳丽兹行冲冠之旅》Express 服务器入口
// 架构：前后端不分离，Express 同时提供静态 H5 与 JSON API
// 数据：SQLite（better-sqlite3）
//
// 万人在线优化：
// 1. cluster 多进程：根据 CPU 核数启动多个 worker，共享 8080 端口
// 2. better-sqlite3 同步 + WAL 模式，并发读写性能稳定
// 3. 榜单接口内存缓存 3 秒，消除重复聚合查询
// 4. 全局限流 + 提交接口单独限流，防刷防灌
// 5. helmet 安全头 + compression gzip，降低带宽
//
// 启动：node server.js  或  npm start
// 端口：默认 8080，可用 PORT 环境变量覆盖

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cluster = require("cluster");
const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

// 强制中国时区，避免服务器时区差异影响日期判断
process.env.TZ = "Asia/Shanghai";

const {
  initDb,
  insertScore,
  getPlayerTodayStatus,
  getRawRecords,
  buildLeaderboard,
  validateRecord,
  getTodayAttempts,
  upsertPlayer,
  checkAndResetOnStart,
  DAILY_LIMIT,
} = require("./db");

// 战队/战场唯一数据源（与前端 /config 共用）
const { TEAMS: TEAM_OBJS, BATTLES: BATTLE_OBJS, TACTICS, GAME } = require("./teams");

// 从前端 public/config.js 读取活动配置（前后端共用同一份配置）
// 解析 activityStart / activityEnd / dailyLimit / 分享文案
function loadConfigMeta() {
  const meta = { activityStart: "", activityEnd: "", dailyLimit: 10, shareTitle: "深圳丽兹行冲冠之旅", shareText: "下半场开球，来为门店战队抢占五大战场！" };
  try {
    const content = fs.readFileSync(path.join(__dirname, "public", "config.js"), "utf-8");
    const pick = (key) => {
      const m = content.match(new RegExp(key + "\\s*:\\s*[\"']([^\"']+)[\"']"));
      return m ? m[1] : null;
    };
    const start = pick("activityStart");
    const end = pick("activityEnd");
    const limit = pick("dailyLimit");
    const title = pick("shareTitle");
    const text = pick("shareText");
    if (start) meta.activityStart = start;
    if (end) meta.activityEnd = end;
    if (limit) meta.dailyLimit = parseInt(limit, 10) || 10;
    if (title) meta.shareTitle = title;
    if (text) meta.shareText = text;
  } catch (_) { /* 忽略，使用默认值 */ }
  return meta;
}
const CONFIG_META = loadConfigMeta();
const ACTIVITY_START = CONFIG_META.activityStart;

const PORT = process.env.PORT || 8080;
const CPU_COUNT = Math.min(os.cpus().length, 4); // 最多 4 个 worker，SQLite 写入不宜过多进程

// 在 cluster 模式下，主进程只负责 fork，子进程才启动 http 服务
if (cluster.isPrimary && process.env.DISABLE_CLUSTER !== "1") {
  console.log(`[master] 启动 ${CPU_COUNT} 个 worker 进程，端口 ${PORT}`);
  for (let i = 0; i < CPU_COUNT; i += 1) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code) => {
    console.warn(`[master] worker ${worker.process.pid} 退出 code=${code}，重新拉起`);
    cluster.fork();
  });
} else {
  startWorker();
}

function startWorker() {
  const db = initDb();

  // 启动时检查：如果已到达活动开始时间且未重置过，自动清空旧数据
  if (ACTIVITY_START) {
    const result = checkAndResetOnStart(db, ACTIVITY_START);
    if (result.reset) {
      console.log(`[reset] ${result.reason}`);
    }
  }

  const app = express();

  app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
  app.use(compression());
  app.use(express.json({ limit: "32kb" }));
  app.use(morgan("tiny"));

  // 静态文件：H5 主站
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir, {
    etag: true,
    maxAge: "5m",
    setHeaders: (res, filePath) => {
      // HTML 不缓存，确保用户拿到最新版本
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));

  // 全局限流：每个 IP 每分钟最多 GLOBAL_RATE_LIMIT 次请求（默认 240，约 4 QPS）
  const GLOBAL_RATE_LIMIT = parseInt(process.env.GLOBAL_RATE_LIMIT || "240", 10);
  app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    max: GLOBAL_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "请求过于频繁，请稍后再试" },
  }));

  // 提交成绩接口限流：每个 IP 每分钟最多 SUBMIT_RATE_LIMIT 次（默认 30）
  const SUBMIT_RATE_LIMIT = parseInt(process.env.SUBMIT_RATE_LIMIT || "30", 10);
  const submitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: SUBMIT_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "提交过于频繁，请稍后再试" },
  });

  // 工具函数
  function ok(data) {
    return { success: true, data };
  }
  function fail(message, data) {
    return { success: false, message, ...(data ? { data } : {}) };
  }
  function ipHash(req) {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    return crypto.createHash("md5").update(String(ip)).digest("hex").slice(0, 12);
  }

  // 获取设备 ID：优先从前端请求体/header 读取（前端生成 UUID 存 localStorage），
  // 后备方案用 IP+UA 生成指纹（兼容未传 deviceId 的旧客户端）
  function getDeviceId(req) {
    // 优先从请求体读取
    if (req.body && req.body.deviceId) return String(req.body.deviceId).trim();
    // 其次从 header 读取
    if (req.headers["x-device-id"]) return String(req.headers["x-device-id"]).trim();
    // 后备：IP+UA 指纹
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const ua = req.headers["user-agent"] || "unknown";
    return crypto.createHash("sha256").update(ip + "|" + ua).digest("hex").slice(0, 32);
  }

  // ============ API 路由 ============

  // 健康检查
  app.get("/api/health", (req, res) => {
    res.json(ok({ status: "ok", time: new Date().toISOString(), pid: process.pid }));
  });

  // 5. 游戏配置：战队 / 战场 / 游戏信息（前端启动拉取，单一来源）
  // 数据来源：teams.js（战队头像配色）+ public/config.js（活动时间/分享）
  // 最终结果：返回 teams(name/short/color)、battles、gameName、subtitle、tactics、活动时间
  app.get("/api/chongguan/config", (req, res) => {
    res.json(ok({
      gameName: GAME.name,
      subtitle: GAME.subtitle,
      teams: TEAM_OBJS,
      battles: BATTLE_OBJS,
      tactics: TACTICS,
      activityStart: CONFIG_META.activityStart,
      activityEnd: CONFIG_META.activityEnd,
      dailyLimit: CONFIG_META.dailyLimit,
      shareTitle: CONFIG_META.shareTitle,
      shareText: CONFIG_META.shareText,
    }));
  });

  // 1. 提交成绩
  // 数据来源：前端游戏结束后 POST 的本局成绩
  // 处理过程：校验字段 -> 检查每日次数 -> 写入数据库 -> 失效缓存
  // 最终结果：返回入库 id、今日次数、今日最高分
  app.post("/api/chongguan/scores", submitLimiter, (req, res) => {
    const record = req.body || {};
    const err = validateRecord(record);
    if (err) return res.status(400).json(fail(err));

    const name = String(record.name).trim();
    const devId = getDeviceId(req);

    // 以设备为唯一标识注册/更新玩家（name 可随时更改）
    upsertPlayer(db, devId, name, record.team);

    // 服务端重新校验每日次数（按设备统计，不完全信任前端）
    const attempts = getTodayAttempts(db, devId);
    if (attempts >= DAILY_LIMIT) {
      return res.status(429).json(fail("今日挑战次数已用完", {
        todayAttempts: attempts,
        todayBest: require("./db").getTodayBest(db, devId),
      }));
    }

    try {
      const result = insertScore(db, record, {
        deviceId: devId,
        userAgent: req.headers["user-agent"],
        ipHash: ipHash(req),
      });
      res.json(ok(result));
    } catch (e) {
      console.error("[submit] 写入失败", e);
      res.status(500).json(fail("服务器内部错误"));
    }
  });

  // 2. 获取个人今日状态
  // 数据来源：前端进入游戏前查询
  // 处理过程：按 device_id+今日 统计次数和最高分
  // 最终结果：返回今日次数、剩余次数、今日最高分、当前 name
  app.get("/api/chongguan/players/today", (req, res) => {
    // device_id 从 header 或 query 读取
    const devId = String(req.headers["x-device-id"] || req.query.deviceId || "").trim();
    if (!devId) return res.status(400).json(fail("deviceId 必填（通过 header X-Device-Id 或 query 传入）"));
    res.json(ok(getPlayerTodayStatus(db, devId)));
  });

  // 3. 获取原始记录
  // 数据来源：数据库 scores 表
  // 处理过程：按日期范围过滤
  // 最终结果：返回原始记录数组（最多 5000 条）
  app.get("/api/chongguan/records", (req, res) => {
    const from = req.query.from;
    const to = req.query.to;
    const records = getRawRecords(db, from, to);
    res.json(ok(records));
  });

  // 4. 获取聚合榜单
  // 数据来源：scores 表 + 内存缓存
  // 处理过程：每日有效成绩聚合 -> 战场/战队统计 -> 高光球员 -> 实时播报
  // 最终结果：返回 champion、teams、battles、todayHighlights、ticker
  app.get("/api/chongguan/leaderboard", (req, res) => {
    const data = buildLeaderboard(db);
    res.json(ok(data));
  });

  // 兜底：所有未匹配路由返回 index.html（H5 单页应用）
  app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`[worker ${process.pid}] 服务已启动：http://0.0.0.0:${PORT}`);
    if (ACTIVITY_START) {
      console.log(`[worker ${process.pid}] 活动开始时间：${ACTIVITY_START}（到达后自动重置数据）`);
    }
    // 每小时检查一次：运行中到达活动开始时间也自动重置
    setInterval(() => {
      if (!ACTIVITY_START) return;
      const result = checkAndResetOnStart(db, ACTIVITY_START);
      if (result.reset) {
        console.log(`[reset] ${result.reason}`);
      }
    }, 60 * 60 * 1000); // 1 小时
  });
}
