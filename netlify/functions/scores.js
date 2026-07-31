// POST /api/chongguan/scores
// 提交成绩：校验 → 检查每日次数 → 写入 Supabase

const { getSupabase } = require("./_shared/supabase");
const { TEAMS, BATTLES, TACTICS, DAILY_LIMIT } = require("./_shared/teams");
const { ok, fail, todayKey, nowTime } = require("./_shared/helpers");

const TEAM_NAMES = TEAMS.map((t) => t.name);
const BATTLE_NAMES = BATTLES.map((b) => b.name);

function validateRecord(record) {
  if (!record || typeof record !== "object") return "请求体非法";
  const { name, team, battle, tactic, score } = record;
  if (!name || !String(name).trim() || String(name).length > 20) return "姓名不能为空且不超过 20 字";
  if (!TEAM_NAMES.includes(team)) return "战队非法";
  if (!BATTLE_NAMES.includes(battle)) return "战场非法";
  if (!TACTICS.includes(tactic)) return "战术非法";
  if (!Number.isInteger(score) || score < 0) return "分数必须为非负整数";
  return null;
}

function getDeviceId(event) {
  // 优先从 header
  const headerId = event.headers["x-device-id"] || event.headers["X-Device-Id"];
  if (headerId) return String(headerId).trim();
  // 其次从 body
  try {
    const body = JSON.parse(event.body || "{}");
    if (body.deviceId) return String(body.deviceId).trim();
  } catch (_) {}
  // 后备：IP+UA 指纹
  const ip = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  const ua = event.headers["user-agent"] || "unknown";
  // 简单 hash（serverless 环境无 crypto 模块，用简单实现）
  let hash = 0;
  for (let i = 0; i < (ip + "|" + ua).length; i++) {
    const char = (ip + "|" + ua).charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return "fp-" + Math.abs(hash).toString(36);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return fail("仅支持 POST", undefined, headers);
  }

  let record;
  try {
    record = JSON.parse(event.body || "{}");
  } catch (_) {
    return fail("请求体必须是合法 JSON", undefined, headers);
  }

  // 校验字段
  const err = validateRecord(record);
  if (err) return fail(err, undefined, headers);

  const name = String(record.name).trim();
  const devId = getDeviceId(event);
  const supabase = getSupabase();
  const today = todayKey();

  // 查询今日已提交次数
  const { count: todayCount } = await supabase
    .from("chongguan_scores")
    .select("*", { count: "exact", head: true })
    .eq("device_id", devId)
    .eq("submit_date", today);

  const attempts = todayCount || 0;

  if (attempts >= DAILY_LIMIT) {
    // 查询今日最高分
    const { data: bestRow } = await supabase
      .from("chongguan_scores")
      .select("score")
      .eq("device_id", devId)
      .eq("submit_date", today)
      .order("score", { ascending: false })
      .limit(1)
      .single();

    return fail(429, {
      message: "今日挑战次数已用完",
      todayAttempts: attempts,
      todayBest: bestRow?.score || 0,
    }, headers);
  }

  // upsert 玩家记录
  await supabase.from("chongguan_players").upsert(
    { device_id: devId, name, team: record.team, last_seen: new Date().toISOString() },
    { onConflict: "device_id" }
  );

  // 插入成绩
  const dailyAttempt = attempts + 1;
  const { data: inserted, error: insertError } = await supabase
    .from("chongguan_scores")
    .insert({
      device_id: devId,
      name,
      team: record.team,
      battle: record.battle,
      tactic: record.tactic,
      score: record.score,
      submit_date: today,
      submit_time: nowTime(),
      daily_attempt: dailyAttempt,
      max_combo: record.maxCombo || 0,
      user_agent: event.headers["user-agent"],
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[scores] 插入失败:", insertError.message);
    return fail("服务器内部错误", undefined, headers);
  }

  // 查询今日最高分（用于返回）
  const { data: bestRow } = await supabase
    .from("chongguan_scores")
    .select("score")
    .eq("device_id", devId)
    .eq("submit_date", today)
    .order("score", { ascending: false })
    .limit(1)
    .single();

  return ok({
    id: inserted?.id,
    todayAttempts: dailyAttempt,
    todayBest: bestRow?.score || 0,
    accepted: true,
  }, headers);
};
