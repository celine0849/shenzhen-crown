// SQLite 数据库初始化与业务数据访问层
// 数据来源：前端 H5 通过 POST /api/chongguan/scores 提交的成绩
// 处理过程：校验 -> 写入 scores 表 -> 失效缓存 -> 聚合查询
// 最终结果：提供榜单、个人状态、原始记录等查询接口
//
// 万人在线优化要点：
// 1. 使用 better-sqlite3 同步 API，避免回调开销
// 2. 开启 WAL 模式提升并发读性能
// 3. 添加内存缓存层（3 秒），减少重复聚合查询
// 4. 关键字段建立索引（日期、玩家、战场）

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "crown.db");

// 缓存配置：榜单数据缓存 3 秒，避免高频聚合查询压垮数据库
const LEADERBOARD_CACHE_TTL = 3000;
let leaderboardCache = { data: null, expireAt: 0 };

// 战队与战场白名单：统一从 teams.js 读取，前后端单一来源，避免漂移
const { TEAMS: TEAM_OBJS, BATTLES: BATTLE_OBJS, TACTICS } = require("./teams");
const TEAMS = TEAM_OBJS.map((t) => t.name);
const BATTLES = BATTLE_OBJS.map((b) => b.name);

const DAILY_LIMIT = 10;

// 战场状态标签计算（与原前端 app.js 逻辑一致）
function battleStatus(leader, second) {
  if (!leader.power) return "🔥 激烈争夺中";
  const gap = leader.power - second.power;
  if (gap <= 0) return "🔥 激烈争夺中";
  if (gap <= 120) return "⚡ 即将反超";
  if (leader.guard > leader.sprint && gap > 280) return "🛡 防线稳固";
  if (gap > 520) return "👑 暂居王座";
  if (leader.guard < leader.sprint * 0.35 && gap <= 260) return "🚨 护盾告急";
  const tags = ["🔥 激烈争夺中", "⚡ 即将反超", "🛡 防线稳固", "👑 暂居王座", "🚨 护盾告急"];
  return tags[Math.floor(Math.random() * tags.length)];
}

// 初始化数据库
function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB 缓存
  db.pragma("temp_store = MEMORY");

  // 成绩主表（device_id 为玩家唯一标识，name 可随时更改）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      team TEXT NOT NULL,
      battle TEXT NOT NULL,
      tactic TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0),
      submit_date TEXT NOT NULL,
      submit_time TEXT NOT NULL,
      daily_attempt INTEGER NOT NULL CHECK (daily_attempt >= 1),
      max_combo INTEGER DEFAULT 0,
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(submit_date);
    CREATE INDEX IF NOT EXISTS idx_scores_device_day ON scores(device_id, submit_date);
    CREATE INDEX IF NOT EXISTS idx_scores_battle_team ON scores(battle, team);
    CREATE INDEX IF NOT EXISTS idx_scores_team_date ON scores(team, submit_date);

    -- 玩家表：以 device_id 为唯一标识，name 可随时更改
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      team TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 元数据表：存储活动重置时间等关键信息
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 兼容旧库：如果 scores 表缺少 device_id 列则自动添加
  try {
    db.exec("ALTER TABLE scores ADD COLUMN device_id TEXT NOT NULL DEFAULT ''");
  } catch (_) { /* 列已存在，忽略 */ }

  return db;
}

// 以设备为唯一标识注册/更新玩家：首次提交创建记录，后续更新 name（可改名）
// 返回 { ok: true, firstBind: boolean, playerId: number }
function upsertPlayer(db, deviceId, name, team) {
  const row = db.prepare("SELECT id FROM players WHERE device_id = ?").get(deviceId);
  if (!row) {
    // 首次提交：创建玩家记录
    const info = db.prepare(
      "INSERT INTO players (device_id, name, team) VALUES (?, ?, ?)"
    ).run(deviceId, name, team || null);
    return { ok: true, firstBind: true, playerId: info.lastInsertRowid };
  }
  // 已存在：更新 name（用户可随时改名）和最后活跃时间
  db.prepare(
    "UPDATE players SET name = ?, team = ?, last_seen = datetime('now') WHERE device_id = ?"
  ).run(name, team || null, deviceId);
  return { ok: true, firstBind: false, playerId: row.id };
}

// 获取中国时区的当天日期 (YYYY-MM-DD)
function todayKey() {
  const now = new Date();
  // 强制按东八区计算日期
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const cn = new Date(utc + 8 * 3600000);
  const y = cn.getFullYear();
  const m = String(cn.getMonth() + 1).padStart(2, "0");
  const d = String(cn.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const cn = new Date(utc + 8 * 3600000);
  return [cn.getHours(), cn.getMinutes(), cn.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

// 校验字段合法性
function validateRecord(record) {
  if (!record || typeof record !== "object") return "请求体非法";
  const { name, team, battle, tactic, score } = record;
  if (!name || !String(name).trim() || String(name).length > 20) return "姓名不能为空且不超过 20 字";
  if (!TEAMS.includes(team)) return "战队非法";
  if (!BATTLES.includes(battle)) return "战场非法";
  if (!TACTICS.includes(tactic)) return "战术非法";
  if (!Number.isInteger(score) || score < 0) return "分数必须为非负整数";
  return null;
}

// 写入一条成绩，返回入库后的完整信息
// 玩家唯一标识为 device_id，name 可随时更改
function insertScore(db, record, extras = {}) {
  const date = todayKey();
  const time = nowTime();
  const deviceId = extras.deviceId || "";
  // 服务端重新计算当日序号（按设备统计），避免前端伪造
  const countStmt = db.prepare(
    "SELECT COUNT(*) AS cnt FROM scores WHERE device_id = ? AND submit_date = ?"
  );
  const { cnt } = countStmt.get(deviceId, date);
  const dailyAttempt = cnt + 1;

  const stmt = db.prepare(`
    INSERT INTO scores (device_id, name, team, battle, tactic, score, submit_date, submit_time, daily_attempt, max_combo, user_agent, ip_hash)
    VALUES (@device_id, @name, @team, @battle, @tactic, @score, @submit_date, @submit_time, @daily_attempt, @max_combo, @user_agent, @ip_hash)
  `);
  const info = stmt.run({
    device_id: deviceId,
    name: String(record.name).trim(),
    team: record.team,
    battle: record.battle,
    tactic: record.tactic,
    score: record.score,
    submit_date: date,
    submit_time: time,
    daily_attempt: dailyAttempt,
    max_combo: record.maxCombo || 0,
    user_agent: extras.userAgent || null,
    ip_hash: extras.ipHash || null,
  });

  // 失效榜单缓存
  leaderboardCache.expireAt = 0;

  return {
    id: info.lastInsertRowid,
    todayAttempts: dailyAttempt,
    todayBest: getTodayBest(db, deviceId),
    accepted: true,
  };
}

// 查询某设备今日已挑战次数
function getTodayAttempts(db, deviceId) {
  const stmt = db.prepare(
    "SELECT COUNT(*) AS cnt FROM scores WHERE device_id = ? AND submit_date = ?"
  );
  return stmt.get(deviceId, todayKey()).cnt;
}

// 查询某设备今日最高分
function getTodayBest(db, deviceId) {
  const stmt = db.prepare(
    "SELECT MAX(score) AS best FROM scores WHERE device_id = ? AND submit_date = ?"
  );
  return stmt.get(deviceId, todayKey()).best || 0;
}

// 获取某设备今日状态
function getPlayerTodayStatus(db, deviceId) {
  const attempts = getTodayAttempts(db, deviceId);
  const best = getTodayBest(db, deviceId);
  // 查询当前玩家最新 name（可能已改名）
  const player = db.prepare("SELECT name, team FROM players WHERE device_id = ?").get(deviceId);
  return {
    name: player ? player.name : "",
    team: player ? player.team : "",
    date: todayKey(),
    todayAttempts: attempts,
    remainingAttempts: Math.max(DAILY_LIMIT - attempts, 0),
    todayBest: best,
  };
}

// 获取每日有效成绩（同一 device_id+date 取最高分，name 取该条记录提交时的值）
function getDailyBestRecords(db, from, to) {
  const params = [];
  let where = "";
  if (from && to) {
    where = "WHERE submit_date BETWEEN ? AND ?";
    params.push(from, to);
  } else if (from) {
    where = "WHERE submit_date >= ?";
    params.push(from);
  }

  const sql = `
    SELECT * FROM (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY device_id, submit_date ORDER BY score DESC, created_at ASC) AS rn
      FROM scores ${where}
    ) WHERE rn = 1
    ORDER BY submit_date DESC, score DESC
  `;
  return db.prepare(sql).all(...params);
}

// 获取原始记录（用于前端调试）
function getRawRecords(db, from, to) {
  const params = [];
  let where = "";
  if (from && to) {
    where = "WHERE submit_date BETWEEN ? AND ?";
    params.push(from, to);
  } else if (from) {
    where = "WHERE submit_date >= ?";
    params.push(from);
  }
  return db.prepare(`SELECT * FROM scores ${where} ORDER BY created_at DESC LIMIT 5000`).all(...params);
}

// 聚合计算榜单
function buildLeaderboard(db) {
  // 命中缓存
  if (leaderboardCache.data && Date.now() < leaderboardCache.expireAt) {
    return leaderboardCache.data;
  }

  const dailyBest = getDailyBestRecords(db);

  // 战场维度统计
  const battleStats = BATTLES.map((battle) => {
    const rows = TEAMS.map((team) => {
      const relevant = dailyBest.filter((r) => r.team === team && r.battle === battle);
      const sprint = relevant.filter((r) => r.tactic === "发起进攻").reduce((s, r) => s + r.score, 0);
      const guard = relevant.filter((r) => r.tactic === "坚守防线").reduce((s, r) => s + r.score, 0);
      return { team, battle, sprint, guard, power: sprint + guard };
    });
    rows.sort((a, b) => b.power - a.power);
    const leader = rows[0];
    const second = rows[1] || { team: "暂无", power: 0, sprint: 0, guard: 0 };
    return {
      battle,
      leader: leader.power > 0 ? leader.team : "暂无",
      power: leader.power,
      sprint: leader.sprint,
      guard: leader.guard,
      second: second.power > 0 ? second.team : "暂无",
      gap: Math.max(leader.power - second.power, 0),
      tag: battleStatus(leader, second),
      rows,
    };
  });

  // 战队维度统计（参与人数按设备去重）
  const teamStats = TEAMS.map((team) => {
    const recordsForTeam = dailyBest.filter((r) => r.team === team);
    const occupied = battleStats.filter((b) => b.leader === team && b.power > 0).length;
    const participants = new Set(recordsForTeam.map((r) => r.device_id)).size;
    const power = recordsForTeam.reduce((s, r) => s + r.score, 0);
    const high = recordsForTeam.reduce((m, r) => Math.max(m, r.score), 0);
    return { team, occupied, participants, power, high };
  });
  teamStats.sort(
    (a, b) => b.occupied - a.occupied || b.power - a.power || b.participants - a.participants || b.high - a.high
  );

  // 今日高光球员
  const today = todayKey();
  const todayRecords = dailyBest.filter((r) => r.submit_date === today);
  const sortedToday = todayRecords.slice().sort((a, b) => b.score - a.score);
  const mvp = sortedToday[0];
  const bestAttack = todayRecords.filter((r) => r.tactic === "发起进攻").sort((a, b) => b.score - a.score)[0];
  const bestDefend = todayRecords.filter((r) => r.tactic === "坚守防线").sort((a, b) => b.score - a.score)[0];
  const comboKing = todayRecords.slice().sort((a, b) => (b.max_combo || 0) - (a.max_combo || 0))[0];

  // 实时动态播报
  const ticker = [];
  if (teamStats[0] && teamStats[0].power > 0) {
    ticker.unshift(`👑 ${teamStats[0].team}暂居冠军席位`);
  }
  battleStats.forEach((stat) => {
    if (stat.power > 0) {
      if (stat.gap <= 120) ticker.push(`🔥 ${stat.battle}差距仅剩${stat.gap}战力`);
      ticker.push(`🛡 ${stat.leader}正在加固${stat.battle}防线`);
    }
  });
  if (teamStats[1] && teamStats[1].power > 0) {
    ticker.push(`⚔ ${teamStats[1].team}正在强势追击`);
  }
  if (ticker.length === 0) {
    ticker.push("⚡ 战场等待开球，第一脚由你打响", "🔥 五大战场已进入待命状态");
  }

  const result = {
    champion: teamStats[0] && teamStats[0].power > 0
      ? {
          team: teamStats[0].team,
          occupied: teamStats[0].occupied,
          power: teamStats[0].power,
          participants: teamStats[0].participants,
          high: teamStats[0].high,
        }
      : null,
    teams: teamStats.map((t, i) => ({ rank: i + 1, ...t })),
    battles: battleStats.map((b) => ({
      battle: b.battle,
      leader: b.leader,
      power: b.power,
      sprint: b.sprint,
      guard: b.guard,
      second: b.second,
      gap: b.gap,
      tag: b.tag,
      rows: b.rows,
    })),
    todayHighlights: {
      mvp: mvp ? { name: mvp.name, team: mvp.team, score: mvp.score, battle: mvp.battle } : null,
      bestAttack: bestAttack ? { name: bestAttack.name, team: bestAttack.team, score: bestAttack.score, battle: bestAttack.battle } : null,
      bestDefend: bestDefend ? { name: bestDefend.name, team: bestDefend.team, score: bestDefend.score, battle: bestDefend.battle } : null,
      comboKing: comboKing ? { name: comboKing.name, team: comboKing.team, maxCombo: comboKing.max_combo || 0 } : null,
    },
    ticker,
    generatedAt: new Date().toISOString(),
  };

  leaderboardCache = { data: result, expireAt: Date.now() + LEADERBOARD_CACHE_TTL };
  return result;
}

// 主动失效缓存
function invalidateCache() {
  leaderboardCache.expireAt = 0;
}

// 活动开始时间自动重置：到达活动开始时间时清空旧数据
// activityStartStr: ISO 8601 时间字符串（如 "2026-06-28T08:00:00+08:00"）
// 返回 { reset: boolean, reason: string }
function checkAndResetOnStart(db, activityStartStr) {
  if (!activityStartStr) return { reset: false, reason: "未配置活动开始时间" };

  const now = new Date();
  const start = new Date(activityStartStr);
  if (isNaN(start.getTime())) return { reset: false, reason: "活动开始时间格式无效" };
  if (now < start) return { reset: false, reason: "活动尚未开始" };

  // 检查上次重置时间：如果已在活动开始之后重置过，则跳过
  const meta = db.prepare("SELECT value FROM meta WHERE key = ?").get("last_reset_at");
  const lastReset = meta ? new Date(meta.value) : null;
  if (lastReset && lastReset >= start) {
    return { reset: false, reason: "已在活动开始后重置过，无需重复" };
  }

  // 清空成绩和玩家数据，重置自增序列
  db.exec(`
    DELETE FROM scores;
    DELETE FROM players;
    DELETE FROM sqlite_sequence WHERE name IN ('scores', 'players');
    VACUUM;
  `);
  // 记录本次重置时间
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_reset_at', ?)"
  ).run(now.toISOString());
  // 失效榜单缓存
  invalidateCache();

  return { reset: true, reason: `已清空旧数据（活动开始时间：${activityStartStr}）` };
}

module.exports = {
  initDb,
  insertScore,
  getTodayAttempts,
  getTodayBest,
  getPlayerTodayStatus,
  getDailyBestRecords,
  getRawRecords,
  buildLeaderboard,
  invalidateCache,
  validateRecord,
  upsertPlayer,
  checkAndResetOnStart,
  todayKey,
  nowTime,
  DAILY_LIMIT,
  TEAMS,
  BATTLES,
  TACTICS,
};
