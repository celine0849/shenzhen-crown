// GET /api/chongguan/leaderboard
// 聚合榜单：战队排名、战场占领、高光球员、实时播报

const { getSupabase } = require("./_shared/supabase");
const { TEAMS, BATTLES, DAILY_LIMIT } = require("./_shared/teams");
const { ok, todayKey, battleStatus } = require("./_shared/helpers");

const TEAM_NAMES = TEAMS.map((t) => t.name);
const BATTLE_NAMES = BATTLES.map((b) => b.name);

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  const supabase = getSupabase();
  const today = todayKey();

  // 获取所有原始成绩
  const { data: allScores, error: scoresError } = await supabase
    .from("chongguan_scores")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50000); // Supabase 默认限制 1000，需在控制台调高或分页

  if (scoresError) {
    console.error("[leaderboard] 查询失败:", scoresError.message);
    return fail("查询榜单数据失败", undefined, headers);
  }

  const scores = allScores || [];

  // 计算每日有效成绩（同 device_id + date 取最高分）
  const dailyBestMap = new Map(); // key: "deviceId|date"
  scores.forEach((s) => {
    const key = `${s.device_id}|${s.submit_date}`;
    const existing = dailyBestMap.get(key);
    if (!existing || s.score > existing.score) {
      dailyBestMap.set(key, s);
    }
  });
  const dailyBest = Array.from(dailyBestMap.values());

  // 战场维度统计
  const battleStats = BATTLE_NAMES.map((battle) => {
    const rows = TEAM_NAMES.map((team) => {
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

  // 战队维度统计
  const teamStats = TEAM_NAMES.map((team) => {
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

  return ok({
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
  }, headers);
};
