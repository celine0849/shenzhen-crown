// GET /api/chongguan/players/today?deviceId=xxx
// 返回某设备今日状态：次数、剩余次数、最高分

const { getSupabase } = require("./_shared/supabase");
const { DAILY_LIMIT } = require("./_shared/teams");
const { ok, fail, todayKey } = require("./_shared/helpers");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  // device_id 从 query 或 header 读取
  let devId = "";
  if (event.queryStringParameters && event.queryStringParameters.deviceId) {
    devId = String(event.queryStringParameters.deviceId).trim();
  }
  if (!devId) {
    devId = String(
      event.headers["x-device-id"] ||
      event.headers["X-Device-Id"] ||
      ""
    ).trim();
  }
  if (!devId) {
    return fail("deviceId 必填（通过 query 或 header X-Device-Id 传入）", undefined, headers);
  }

  const supabase = getSupabase();
  const today = todayKey();

  // 今日次数
  const { count: attempts } = await supabase
    .from("chongguan_scores")
    .select("*", { count: "exact", head: true })
    .eq("device_id", devId)
    .eq("submit_date", today);

  // 今日最高分
  const { data: bestRow } = await supabase
    .from("chongguan_scores")
    .select("score")
    .eq("device_id", devId)
    .eq("submit_date", today)
    .order("score", { ascending: false })
    .limit(1)
    .single();

  // 当前玩家名
  const { data: player } = await supabase
    .from("chongguan_players")
    .select("name, team")
    .eq("device_id", devId)
    .single();

  return ok({
    name: player?.name || "",
    team: player?.team || "",
    date: today,
    todayAttempts: attempts || 0,
    remainingAttempts: Math.max(DAILY_LIMIT - (attempts || 0), 0),
    todayBest: bestRow?.score || 0,
  }, headers);
};
