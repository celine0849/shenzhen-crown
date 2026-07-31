// GET /api/chongguan/config
// 返回战队列表、战场、游戏名称等配置信息（前端启动时拉取）

const { GAME, TEAMS, BATTLES, TACTICS } = require("./_shared/teams");
const { ok } = require("./_shared/helpers");

exports.handler = async (event) => {
  // 设置 CORS 头
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  // 活动时间从环境变量读取（Netlify 控制台配置），或用默认值
  const activityStart = process.env.ACTIVITY_START || "2026-08-01T08:00:00+08:00";
  const activityEnd = process.env.ACTIVITY_END || "2026-08-03T23:59:59+08:00";
  const dailyLimit = parseInt(process.env.DAILY_LIMIT || "10", 10);

  return ok({
    gameName: GAME.name,
    subtitle: GAME.subtitle,
    teams: TEAMS,
    battles: BATTLES,
    tactics: TACTICS,
    activityStart,
    activityEnd,
    dailyLimit,
    shareTitle: "深圳丽兹行冲冠之旅",
    shareText: "下半场开球，来为门店战队抢占五大战场！",
  }, headers);
};
