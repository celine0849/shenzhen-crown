// ============================================================
// 《深圳丽兹行冲冠之旅》Netlify Functions 中转代理
// 作用：浏览器(中国) → Netlify(海外) → Supabase(海外)
// 绕过中国大陆无法直接访问 supabase.co 的网络限制
// 前端不再直连 Supabase，也不暴露任何密钥
// ============================================================

const { createClient } = require("@supabase/supabase-js");

// 缓存 Supabase 客户端（避免每次冷启动重复创建）
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("缺少环境变量 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    }
    _supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log("[api] Supabase 客户端已创建 | URL:", url, "| Key前缀:", (key || "").slice(0, 12) + "...");
  }
  return _supabase;
}

// 统一响应头（同源调用也可加 CORS 以防万一）
const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}
function fail(status, message) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message }) };
}

// ============ 路由处理 ============

// 连通性测试（查一个真实存在的视图，验证网络+凭据）
async function handleMeta(supabase) {
  const { data, error } = await supabase.from("chongguan_team_stats").select("*").limit(1);
  if (error) throw error;
  return { ok: true, data };
}

// 聚合榜单（战队排行 + 五大战场占领）
async function handleLeaderboard(supabase, battles) {
  const [teamRes, battleRes] = await Promise.all([
    supabase.from("chongguan_team_stats").select("*"),
    supabase.from("chongguan_battle_stats").select("*"),
  ]);
  if (teamRes.error) throw teamRes.error;
  if (battleRes.error) throw battleRes.error;

  const teamStats = (teamRes.data || []).map((t) => ({
    team: t.team,
    occupied: 0,
    participants: t.participants || 0,
    power: t.power || 0,
    high: t.high || 0,
  }));

  // 按战场分组
  const byBattle = {};
  for (const row of battleRes.data || []) {
    (byBattle[row.battle] = byBattle[row.battle] || []).push(row);
  }

  // 前端传来的战场列表（保证未占领的战场也出现在结果里）
  const knownBattles = Array.isArray(battles) && battles.length ? battles : Object.keys(byBattle);
  const battleStats = [];
  for (const battle of knownBattles) {
    const rows = byBattle[battle] || [];
    const sorted = [...rows].sort((a, b) => (b.power || 0) - (a.power || 0));
    const top = sorted[0];
    const second = sorted[1];
    const leader = top
      ? { team: top.team, sprint: top.sprint || 0, guard: top.guard || 0, power: top.power || 0 }
      : { team: "暂无", sprint: 0, guard: 0, power: 0 };
    battleStats.push({
      battle,
      rows: rows.map((r) => ({ team: r.team, battle, sprint: r.sprint || 0, guard: r.guard || 0, power: r.power || 0 })),
      leader,
      second: second ? { team: second.team, power: second.power || 0 } : { team: "暂无", power: 0 },
      gap: top && second ? (top.power || 0) - (second.power || 0) : 0,
      tag: "🔥 激烈争夺中",
    });
    if (leader.team !== "暂无") {
      const lt = teamStats.find((t) => t.team === leader.team);
      if (lt) lt.occupied = (lt.occupied || 0) + 1;
    }
  }

  const ranked = [...teamStats].sort((a, b) => (b.occupied - a.occupied) || (b.power - a.power));
  const champion = ranked[0]?.power > 0 ? ranked[0] : null;

  return {
    champion,
    teamStats,
    battleStats,
    todayHighlights: { mvp: null, bestAttack: null, bestDefend: null, comboKing: null },
    ticker: [],
  };
}

// 查询今日状态
async function handlePlayerToday(supabase, deviceId, today, dailyLimit) {
  const limit = Number(dailyLimit) || 10;
  const { count, error: countError } = await supabase
    .from("chongguan_scores")
    .select("score", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .eq("submit_date", today);
  if (countError) throw countError;

  const { data: bestData, error: bestError } = await supabase
    .from("chongguan_scores")
    .select("score")
    .eq("device_id", deviceId)
    .eq("submit_date", today)
    .order("score", { ascending: false })
    .limit(1)
    .single();
  // PGRST116 = 无结果，不算错误
  if (bestError && bestError.code !== "PGRST116") throw bestError;

  const attempts = count || 0;
  return {
    todayAttempts: attempts,
    todayBest: bestData?.score || 0,
    remainingAttempts: Math.max(0, limit - attempts),
  };
}

// 提交成绩
async function handleSubmit(supabase, body, dailyLimit) {
  const limit = Number(dailyLimit) || 10;
  const today = body.submitDate;
  const deviceId = body.deviceId;

  // 先查今日次数
  const { count, error: countError } = await supabase
    .from("chongguan_scores")
    .select("*", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .eq("submit_date", today);
  if (countError) throw countError;

  const attempts = count || 0;
  if (attempts >= limit) {
    const { data: bestData } = await supabase
      .from("chongguan_scores")
      .select("score")
      .eq("device_id", deviceId)
      .eq("submit_date", today)
      .order("score", { ascending: false })
      .limit(1)
      .single();
    return { success: false, message: "今日挑战次数已用完", data: { todayAttempts: attempts, todayBest: bestData?.score || 0 } };
  }

  // upsert 玩家
  const { error: upsertError } = await supabase.from("chongguan_players").upsert(
    {
      device_id: deviceId,
      name: body.name,
      team: body.team,
      last_seen: new Date().toISOString(),
    },
    { onConflict: "device_id" }
  );
  if (upsertError) throw upsertError;

  // 插入成绩
  const { error: insertError } = await supabase.from("chongguan_scores").insert({
    device_id: deviceId,
    name: body.name,
    team: body.team,
    battle: body.battle,
    tactic: body.tactic,
    score: body.score,
    submit_date: today,
    submit_time: body.submitTime,
    daily_attempt: attempts + 1,
    max_combo: body.maxCombo || 0,
  });
  if (insertError) throw insertError;

  // 返回最新统计
  const { data: bestData } = await supabase
    .from("chongguan_scores")
    .select("score")
    .eq("device_id", deviceId)
    .eq("submit_date", today)
    .order("score", { ascending: false })
    .limit(1)
    .single();

  return { success: true, data: { todayAttempts: attempts + 1, todayBest: bestData?.score || body.score } };
}

// ============ 主入口 ============
exports.handler = async (event) => {
  // 预检请求
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const url = new URL(event.rawUrl || `https://localhost${event.path || ""}`);
  const action = url.searchParams.get("action") || "meta";

  try {
    const supabase = getSupabase();

    if (action === "meta") return ok(await handleMeta(supabase));

    if (action === "leaderboard") {
      // battles 列表由前端以逗号分隔传入，保证战场完整
      const battlesParam = url.searchParams.get("battles");
      const battles = battlesParam ? battlesParam.split("|").filter(Boolean) : [];
      return ok(await handleLeaderboard(supabase, battles));
    }

    if (action === "player-today") {
      const deviceId = url.searchParams.get("deviceId");
      const today = url.searchParams.get("today");
      const dailyLimit = url.searchParams.get("dailyLimit");
      if (!deviceId || !today) return fail(400, "缺少 deviceId 或 today 参数");
      return ok(await handlePlayerToday(supabase, deviceId, today, dailyLimit));
    }

    if (action === "submit") {
      if (event.httpMethod !== "POST") return fail(405, "submit 仅支持 POST");
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return fail(400, "请求体不是合法 JSON");
      }
      if (!body.deviceId || !body.team || !body.battle) return fail(400, "缺少必要字段");
      return ok(await handleSubmit(supabase, body, url.searchParams.get("dailyLimit")));
    }

    return fail(404, "未知 action: " + action);
  } catch (e) {
    const cause = e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : "";
    console.error("[api] 处理失败:", e.message, "| 根因:", cause);
    return fail(500, e.message + (cause ? " | 根因:" + cause : ""));
  }
};
