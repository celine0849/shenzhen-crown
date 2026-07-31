// 共用工具函数（响应格式化、校验、日期等）

function ok(data) {
  return { statusCode: 200, body: JSON.stringify({ success: true, data }) };
}
function fail(message, data) {
  return {
    statusCode: typeof message === "number" ? message : (message === "too many" ? 429 : 400),
    body: JSON.stringify({ success: false, message: typeof message === "string" ? message : "请求失败", ...(data ? { data } : {}) }),
  };
}

// 中国时区当天日期 YYYY-MM-DD
function todayKey() {
  const now = new Date();
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

// 战场状态标签（与 db.js / app.js 逻辑一致）
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

module.exports = { ok, fail, todayKey, nowTime, battleStatus };
