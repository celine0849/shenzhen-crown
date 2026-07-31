// 《深圳丽兹行冲冠之旅》前端业务逻辑（Supabase 直连版）
// 部署模式：纯静态前端 → 直连 Supabase PostgreSQL → 无需后端/Functions
// 数据来源：Supabase（chongguan_scores / chongguan_players / 视图）
// 兜底：离线模式（USE_MOCK）+ localStorage，双击 index.html 可玩

(function () {
  const CFG = window.CROWN_CONFIG || {};
  let ACTIVITY_START = new Date(CFG.activityStart || "2026-08-01T08:00:00+08:00");
  let ACTIVITY_END = new Date(CFG.activityEnd || "2026-08-03T23:59:59+08:00");
  const DAILY_LIMIT = CFG.dailyLimit || 10;
  const PROFILE_KEY = CFG.profileKey || "road-to-crown-profile-v1";

  // ============ Supabase 客户端初始化 ============
  let supabase = null;
  function initSupabase() {
    try {
      if (window.supabase && CFG.supabaseUrl && CFG.supabaseAnonKey) {
        supabase = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
        console.log("[supabase] 客户端已初始化");
      }
    } catch (e) {
      console.warn("[supabase] 初始化失败:", e);
    }
  }

  // 设备唯一标识
  const DEVICE_KEY = "road-to-crown-device-id";
  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  const deviceId = getDeviceId();

  // 战队 / 战场数据（内置静态数据，与 teams.js 保持一致）
  let teams = [];
  let battles = [];
  let gameName = "深圳丽兹行冲冠之旅";
  let gameSubtitle = "十八大门店战队，五大战场，抢占冲冠王座";
  const teamMeta = new Map();

  const normalTexts = ["追聊", "面见", "报盘", "带看", "复盘", "推进"];
  const bonusTexts = ["AI助攻", "团队协同", "专业判断", "勇气冲刺"];
  const noiseTexts = ["失焦", "犹豫", "等待", "低反馈", "断节奏"];

  const state = {
    profile: { name: "", team: "", battle: "", tactic: "发起进攻" },
    score: 0, combo: 0, maxCombo: 0,
    lastComboSfx: 0, rushSfxPlayed: false,
    beforeBattle: null, running: false, timers: [],
    todayCache: { attempts: 0, best: 0 },
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, "0");

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ============ 离线兜底（与原版完全一致）============
  let USE_MOCK = false;
  const MOCK_KEY = "crown-mock-scores";

  const MOCK = {
    gameName: "深圳丽兹行冲冠之旅",
    subtitle: "十八大门店战队，五大战场，抢占冲冠王座",
    activityStart: "2026-08-01T08:00:00+08:00",
    activityEnd: "2026-08-03T23:59:00+08:00",
    teams: [
      { name: "中城瑧海店", short: "瑧海", color: "#E63946" },
      { name: "深北别墅店", short: "深北", color: "#F3722C" },
      { name: "香山美墅店", short: "香山", color: "#F8961E" },
      { name: "曦城别墅店", short: "曦城", color: "#F9C74F" },
      { name: "香蜜湖旗舰店", short: "香蜜", color: "#90BE6D" },
      { name: "华润城店", short: "华润", color: "#43AA8B" },
      { name: "后海旗舰店", short: "后海", color: "#4D908E" },
      { name: "红树湾店", short: "红树", color: "#577590" },
      { name: "中心路店", short: "中心", color: "#277DA1" },
      { name: "红树西岸店", short: "红西", color: "#4361EE" },
      { name: "海上世界双玺店", short: "双玺", color: "#3A0CA3" },
      { name: "纯水岸店", short: "纯水", color: "#7209B7" },
      { name: "顶级豪宅一部", short: "顶级", color: "#B5179E" },
      { name: "天鹅湖花园店", short: "天鹅", color: "#F72585" },
      { name: "卓越半岛店", short: "卓越", color: "#E5383B" },
      { name: "宝安中心旗舰店", short: "宝安", color: "#D00000" },
      { name: "深圳湾旗舰店", short: "深圳", color: "#FF7D00" },
      { name: "职能总部", short: "职能", color: "#06D6A0" },
    ],
    battles: [
      { name: "客户突破战场", desc: "每一次主动追聊、精准匹配、持续推进，都是向客户信任更近一步。" },
      { name: "房源深耕战场", desc: "每一次面见争取、房源分析、专业反馈，都是在为结果积累弹药。" },
      { name: "AI助攻战场", desc: "AI不是装备展示，而是每场都要上场的战术板。" },
      { name: "团队协同战场", desc: "个人突破背后有团队支撑，真正的胜利来自并肩作战。" },
      { name: "临门一脚战场", desc: "关键机会出现时，敢推进、敢争取、敢完成最后一脚。" },
    ],
  };

  function mockLoad() { try { return JSON.parse(localStorage.getItem(MOCK_KEY) || "[]"); } catch { return []; } }
  function mockSave(arr) { localStorage.setItem(MOCK_KEY, JSON.stringify(arr)); }
  function mockSeed() {
    if (localStorage.getItem(MOCK_KEY + ":seeded")) return;
    const arr = mockLoad();
    MOCK.teams.forEach((t, i) => {
      const n = 2 + (i % 3);
      for (let k = 0; k < n; k++) {
        arr.push({ name: "队员" + (k + 1), team: t.name, battle: MOCK.battles[0].name, tactic: k % 2 ? "坚守防线" : "发起进攻", score: 380 + i * 41 + k * 67 + ((i * 7 + k * 13) % 120), maxCombo: 8 + (i + k) % 22, deviceId: "seed", ts: Date.now() - k * 60000 });
      }
    });
    mockSave(arr);
    localStorage.setItem(MOCK_KEY + ":seeded", "1");
  }
  function mockSubmit(body) {
    const arr = mockLoad(); arr.push({ ...body, ts: Date.now() }); mockSave(arr);
    const mine = arr.filter((s) => s.deviceId === body.deviceId);
    return { success: true, data: { todayAttempts: mine.length, todayBest: Math.max(0, ...mine.map((s) => s.score || 0)) } };
  }
  function mockPlayerToday() {
    const mine = mockLoad().filter((s) => s.deviceId === deviceId);
    return { todayAttempts: mine.length, todayBest: Math.max(0, ...mine.map((s) => s.score || 0)), remainingAttempts: Math.max(0, DAILY_LIMIT - mine.length) };
  }
  function mockLeaderboard() {
    const scores = mockLoad();
    const tm = {};
    MOCK.teams.forEach((t) => { tm[t.name] = { power: 0, high: 0, parts: new Set(), byBattle: {} }; });
    scores.forEach((s) => { const m = tm[s.team]; if (!m) return; m.power += s.score || 0; m.high = Math.max(m.high, s.score || 0); m.parts.add(s.deviceId || s.name || "anon"); m.byBattle[s.battle] = (m.byBattle[s.battle] || 0) + (s.score || 0); });
    const teamStats = MOCK.teams.map((t) => { const m = tm[t.name]; return { team: t.name, occupied: 0, participants: m.parts.size, power: m.power, high: m.high }; });
    const battleStats = MOCK.battles.map((b) => {
      const rows = MOCK.teams.map((t) => { const p = tm[t.name].byBattle[b.name] || 0; return { team: t.name, battle: b.name, sprint: p, guard: 0, power: p }; });
      const sorted = [...rows].sort((a, b) => b.power - a.power);
      const leader = sorted[0]?.power > 0 ? sorted[0] : { team: "暂无", power: 0 };
      const second = sorted[1]?.power > 0 ? sorted[1] : { team: "暂无", power: 0 };
      if (leader.team !== "暂无") { const ts = teamStats.find((x) => x.team === leader.team); if (ts) ts.occupied += 1; }
      return { battle: b.name, rows, leader: leader.team, second: second.team, sprint: leader.power, guard: 0, power: leader.power, gap: Math.max(leader.power - second.power, 0), tag: "🔥 激烈争夺中" };
    });
    const ranked = [...teamStats].sort((a, b) => (b.occupied - a.occupied) || (b.power - a.power) || (b.participants - a.participants) || (b.high - a.high));
    const champion = ranked[0]?.power > 0 ? ranked[0] : null;
    return { teams: teamStats, battles: battleStats, champion, todayHighlights: { mvp: null, bestAttack: null, bestDefend: null, comboKing: null }, ticker: [] };
  }

  // ============ Supabase 直连查询 ============

  async function sbQuery(fn) {
    if (!supabase) return null;
    try { return await fn(); } catch (e) { console.warn("[supabase]", e.message); return null; }
  }

  // 从 Supabase 聚合榜单（替代原来的 GET /leaderboard）
  async function sbAggregate() {
    const [teamRes, battleRes] = await Promise.all([
      sbQuery(() => supabase.from("chongguan_team_stats").select("*")),
      sbQuery(() => supabase.from("chongguan_battle_stats").select("*")),
    ]);
    if (!teamRes || !battleRes || teamRes.error || battleRes.error) return null;

    const teamStats = (teamRes.data || []).map((t) => ({ team: t.team, occupied: 0, participants: t.participants || 0, power: t.power || 0, high: t.high || 0 }));
    const battleStats = (battleRes.data || []).map((b) => ({
      battle: b.battle, rows: [], leader: { team: "暂无", sprint: b.sprint || 0, guard: b.guard || 0, power: b.power || 0 },
      second: { team: "暂无", power: 0 }, gap: 0, tag: "🔥 激烈争夺中",
    }));

    // 为每个战场填充各队行数据
    battleStats.forEach((bs) => {
      bs.rows = teamStats.map((ts) => ({ team: ts.team, battle: bs.battle, sprint: 0, guard: 0, power: 0 }));
      const br = battleRes.data?.find((r) => r.battle === bs.battle);
      if (br) {
        bs.leader.sprint = br.sprint || 0; bs.leader.guard = br.guard || 0; bs.leader.power = br.power || 0;
        // 找到该战场战力最高的队伍作为 leader
        const leaderTeam = teamStats.find((t) => t.team === bs.leader.team);
        if (leaderTeam) leaderTeam.occupied = (leaderTeam.occupied || 0) + 1;
      }
    });

    // 排名 & 冠军
    const ranked = [...teamStats].sort((a, b) => (b.occupied - a.occupied) || (b.power - a.power));
    const champion = ranked[0]?.power > 0 ? ranked[0] : null;

    return { champion, teamStats, battleStats, todayHighlights: { mvp: null, bestAttack: null, bestDefend: null, comboKing: null }, ticker: [] };
  }

  // 查询今日状态（替代 GET /players/today）
  async function sbPlayerToday() {
    const today = todayKey();
    const res = await sbQuery(() => supabase.from("chongguan_scores")
      .select("score", { count: "exact", head: true })
      .eq("device_id", deviceId)
      .eq("submit_date", today));
    if (!res || res.error) return null;
    const count = res.count || 0;
    const bestRes = await sbQuery(() => supabase.from("chongguan_scores")
      .select("score").eq("device_id", deviceId).eq("submit_date", today)
      .order("score", { ascending: false }).limit(1).single());
    const best = bestRes && !bestRes.error ? (bestRes.data?.score || 0) : 0;
    return { todayAttempts: count, todayBest: best, remainingAttempts: Math.max(0, DAILY_LIMIT - count) };
  }

  // 提交成绩（替代 POST /scores）
  async function sbSubmitScore(record) {
    const today = todayKey();
    const now = new Date();
    // 先查今日次数
    const countRes = await sbQuery(() => supabase.from("chongguan_scores")
      .select("*", { count: "exact", head: true }).eq("device_id", deviceId).eq("submit_date", today));
    const attempts = (countRes?.count || 0);
    if (attempts >= DAILY_LIMIT) {
      const bestRes = await sbQuery(() => supabase.from("chongguan_scores").select("score")
        .eq("device_id", deviceId).eq("submit_date", today).order("score", { ascending: false }).limit(1).single());
      return { success: false, message: "今日挑战次数已用完", data: { todayAttempts: attempts, todayBest: bestRes?.data?.score || 0 } };
    }
    // upsert 玩家
    await sbQuery(() => supabase.from("chongguan_players").upsert(
      { device_id: deviceId, name: record.name, team: record.team, last_seen: now.toISOString() },
      { onConflict: "device_id" }
    ));
    // 插入成绩
    const insertRes = await sbQuery(() => supabase.from("chongguan_scores").insert({
      device_id: deviceId, name: record.name, team: record.team,
      battle: record.battle, tactic: record.tactic, score: record.score,
      submit_date: today, submit_time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      daily_attempt: attempts + 1, max_combo: record.maxCombo || 0,
    }).select("id").single());
    if (!insertRes || insertRes.error) return { success: false, message: "提交失败，请重试" };
    // 返回最新统计
    const finalCount = attempts + 1;
    const bestRes = await sbQuery(() => supabase.from("chongguan_scores").select("score")
      .eq("device_id", deviceId).eq("submit_date", today).order("score", { ascending: false }).limit(1).single());
    return { success: true, data: { todayAttempts: finalCount, todayBest: bestRes?.data?.score || record.score } };
  }

  // ============ 统一数据入口（优先 Supabase，降级 Mock）============

  async function aggregate() {
    if (USE_MOCK) return mockLeaderboard();
    const data = await sbAggregate();
    if (!data) {
      return {
        champion: null,
        teamStats: teams.map((t) => ({ team: t.name, occupied: 0, participants: 0, power: 0, high: 0 })),
        battleStats: battles.map(([battle]) => ({
          battle, rows: teams.map((team) => ({ team: team.name, battle, sprint: 0, guard: 0, power: 0 })),
          leader: { team: "暂无", power: 0, sprint: 0, guard: 0 },
          second: { team: "暂无", power: 0, sprint: 0, guard: 0 }, gap: 0, tag: "🔥 激烈争夺中",
        })),
        todayHighlights: { mvp: null, bestAttack: null, bestDefend: null, comboKing: null }, ticker: [],
      };
    }
    // 适配战场统计结构
    const battleStats = data.battleStats.map((b) => ({
      battle: b.battle, rows: b.rows || teams.map((team) => ({ team: team.name, battle: b.battle, sprint: 0, guard: 0, power: 0 })),
      leader: { ...(b.leader || {}), team: b.leader?.team || "暂无", sprint: b.sprint || 0, guard: b.guard || 0, power: b.power || 0 },
      second: { ...(b.second || {}), team: b.second?.team || "暂无" }, gap: b.gap || 0, tag: b.tag || "🔥 激烈争夺中",
    }));
    return { champion: data.champion, teamStats: data.teamStats, battleStats, todayHighlights: data.todayHighlights || {}, ticker: data.ticker || [] };
  }

  async function fetchPlayerToday() {
    if (USE_MOCK) return mockPlayerToday();
    const data = await sbPlayerToday();
    if (!data) return { todayAttempts: 0, todayBest: 0, remainingAttempts: DAILY_LIMIT };
    state.todayCache = { attempts: data.todayAttempts, best: data.todayBest };
    return data;
  }

  // ============ 启动配置加载 ============

  function teamAvatar(teamObj) {
    const name = (teamObj && teamObj.name) || "";
    const short = (teamObj && teamObj.short) || name.slice(0, 2) || "?";
    const color = (teamObj && teamObj.color) || "#8A8FA3";
    return `<span class="team-avatar" style="background:${color}">${short}</span>`;
  }

  async function loadConfig() {
    initSupabase();
    // 测试 Supabase 连通性
    if (supabase) {
      const testRes = await sbQuery(() => supabase.from("chongguan_meta").select("key").limit(1));
      if (testRes && !testRes.error) {
        console.log("[config] Supabase 连接正常，使用在线模式");
        USE_MOCK = false;
      } else {
        console.warn("[config] Supabase 连接失败，切换到离线模式");
        USE_MOCK = true;
      }
    } else {
      console.warn("[config] 未配置 Supabase，使用离线模式");
      USE_MOCK = true;
    }
    // 加载战队/战场数据（始终从内置数据读取，保证一致性）
    const src = USE_MOCK ? MOCK : { teams: MOCK.teams, battles: MOCK.battles, gameName, subtitle: gameSubtitle, activityStart: CFG.activityStart, activityEnd: CFG.activityEnd };
    teams = (src.teams || []).map((t) => ({ name: t.name, short: t.short || t.name.slice(0, 2), color: t.color || "#8A8FA3" }));
    battles = (src.battles || []).map((b) => [b.name, b.desc || b.description || ""]);
    if (src.gameName) gameName = src.gameName;
    if (src.subtitle) gameSubtitle = src.subtitle;
    if (src.activityStart) ACTIVITY_START = new Date(src.activityStart);
    if (src.activityEnd) ACTIVITY_END = new Date(src.activityEnd);
    teams.forEach((t) => teamMeta.set(t.name, t));
    if (USE_MOCK) mockSeed();
  }

  function applyGameMeta() {
    if (gameName) document.title = gameName;
    const gt = $("#gameTitle"); if (gt) gt.textContent = gameName;
    const gs = $("#gameSubtitle"); if (gs) gs.textContent = gameSubtitle;
    const tc = $("#timeChip");
    if (tc) {
      const fmt = (iso) => { try { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch { return ""; } };
      if (ACTIVITY_START && ACTIVITY_END && !isNaN(ACTIVITY_START) && !isNaN(ACTIVITY_END)) tc.textContent = `${fmt(ACTIVITY_START)} - ${fmt(ACTIVITY_END)}`;
    }
  }

  // ============ 屏幕切换 ============
  function showScreen(id) {
    $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
    if (window.AudioManager) { if (id === "gameScreen") window.AudioManager.fadeToGameBgm(); else { window.AudioManager.fadeToMainBgm(); window.AudioManager.setGameRush(false); } }
    if (id === "homeScreen") renderHomeChampion();
    if (id === "teamScreen") renderChoices();
    if (id === "battleScreen") renderChoices();
    if (id === "tacticScreen") updateTacticScreen();
    if (id === "reportScreen") renderReports();
    if (id === "nameScreen") updateQuotaNote();
  }
  function selectValue(container, value) { container.querySelectorAll("button").forEach((btn) => btn.classList.toggle("selected", btn.dataset.value === value)); }

  // ============ 渲染函数 ============
  async function renderHomeChampion() {
    paintHomeChampion(null);
    aggregate()
      .then((data) => paintHomeChampion(data && data.champion))
      .catch((e) => console.warn("[renderHomeChampion] 冠军拉取失败:", e && e.message));
  }

  function paintHomeChampion(champion) {
    $("#homeChampion").innerHTML = champion && champion.power > 0
      ? `<div>${teamAvatar(teamMeta.get(champion.team))}<span>当前冠军席位</span><strong>👑 ${champion.team}</strong><span>占领 ${champion.occupied}/5 个战场｜总战力 ${champion.power}</span></div><b>${champion.occupied}</b>`
      : `<div><span>当前冠军席位</span><strong>等待开球</strong><span>完成首局挑战后，战况将在这里点亮。</span></div><b>0</b>`;
  }

  async function renderChoices() {
    // ① 先同步渲染（静态战队/战场数据，绝不被网络请求阻塞）
    paintChoices(null);
    // ② 异步拉取最新战况，成功后再刷新（失败也不影响战队显示）
    aggregate()
      .then((data) => paintChoices(data))
      .catch((e) => console.warn("[renderChoices] 战况拉取失败，已用静态数据展示:", e && e.message));
  }

  // 同步绘制战队/战场选择；data 为 null 时用静态占位数据
  function paintChoices(data) {
    const teamRank = data && data.teamStats
      ? new Map(data.teamStats.map((team, index) => [team.team, { ...team, rank: index + 1 }]))
      : null;
    $("#teamChoices").innerHTML = teams.map((team, index) => {
      const stat = (teamRank && teamRank.get(team.name)) || { rank: index + 1, power: 0 };
      return `<button type="button" class="team-card" data-value="${team.name}">${teamAvatar(team)}<h3>${team.name}</h3><p><span>当前排名</span><strong>No.${stat.rank}</strong></p><p><span>当前总战力</span><strong>${stat.power}</strong></p></button>`;
    }).join("");
    const battleStats = (data && data.battleStats) || battles.map(([name]) => ({
      battle: name, rows: [], leader: { team: "暂无", sprint: 0, guard: 0, power: 0 },
      second: { team: "暂无", power: 0 }, gap: 0, tag: "🔥 激烈争夺中",
    }));
    $("#battleChoices").innerHTML = battleStats.map((stat) => battleCard(stat)).join("");
    selectValue($("#teamChoices"), state.profile.team);
    selectValue($("#battleChoices"), state.profile.battle);
    selectValue($("#tacticChoices"), state.profile.tactic);
    const nameEl = $("#playerName"); if (nameEl) nameEl.value = state.profile.name || nameEl.value || "";
    updateTeamCallout();
  }

  function battleCard(stat) {
    const total = Math.max(stat.leader.sprint + stat.leader.guard, 1);
    const sprintWidth = Math.round((stat.leader.sprint / total) * 100);
    const guardWidth = Math.round((stat.leader.guard / total) * 100);
    const desc = battles.find(([name]) => name === stat.battle)?.[1] || "";
    const leaderName = stat.leader.power > 0 ? stat.leader.team : "暂无占领";
    const secondText = stat.second.power > 0 ? `${stat.second.team}，差距 ${stat.gap}` : "暂无第二名";
    return `<button type="button" class="battle-card" data-value="${stat.battle}">
      <span class="status-tag">${stat.tag}</span><h3>${stat.battle}</h3><p>${desc}</p>
      <div class="battle-meta"><div><span>当前占领</span><strong>${leaderName}</strong></div><div><span>当前总战力</span><strong>${stat.leader.power}</strong></div></div>
      <div class="battle-lines"><div><span>冲刺值 ${stat.leader.sprint}</span><div class="meter attack"><b style="width:${sprintWidth}%"></b></div></div><div><span>守护值 ${stat.leader.guard}</span><div class="meter defend"><b style="width:${guardWidth}%"></b></div></div></div>
      <p>第二名：${secondText}</p>
    </button>`;
  }

  function updateTeamCallout() { $("#teamCallout").innerHTML = `<span>你已加入</span><strong>【${state.profile.team}】</strong><span>下半场开球，准备进入战场。</span>`; }
  function updateTacticScreen() { $("#tacticBattleName").textContent = `当前战场：${state.profile.battle}`; selectValue($("#tacticChoices"), state.profile.tactic); }

  function updateQuotaNote() {
    const name = $("#playerName").value.trim() || state.profile.name;
    const now = new Date(); let remaining = DAILY_LIMIT;
    // 先用默认值立即显示，不卡网络
    paintQuotaNote(name, now, remaining);
    // 异步拉取真实剩余次数
    if (name) { fetchPlayerToday().then((status) => { paintQuotaNote(name, now, status.remainingAttempts); }).catch(() => {}); }
  }

  function paintQuotaNote(name, now, remaining) {
    const status = now < ACTIVITY_START ? "活动未开始，可先体验流程" : now > ACTIVITY_END ? "活动已结束，可查看战报" : `今日剩余 ${remaining} 次挑战机会`;
    $("#quotaNote").textContent = status; $("#enterGameBtn").disabled = Boolean(name && remaining <= 0);
  }

  // ============ 游戏流程 ============
  function clearGameTimers() { state.timers.forEach((timer) => clearTimeout(timer)); state.timers = []; }

  function startCountdown() {
    const countdown = $("#countdown"); let n = 3;
    countdown.textContent = n; countdown.classList.add("show");
    const tick = () => { n -= 1; if (n === 0) { countdown.textContent = "开球"; state.timers.push(setTimeout(() => { countdown.classList.remove("show"); runGame(); }, 520)); } else { countdown.textContent = n; state.timers.push(setTimeout(tick, 760)); } };
    state.timers.push(setTimeout(tick, 760));
  }

  async function beginGame() {
    state.score = 0; state.combo = 0; state.maxCombo = 0; state.lastComboSfx = 0; state.rushSfxPlayed = false;
    // 异步拉取战况快照，不阻塞游戏启动
    aggregate()
      .then((snapshot) => { state.beforeBattle = (snapshot && snapshot.battleStats) ? snapshot.battleStats.find((battle) => battle.battle === state.profile.battle) : null; })
      .catch(() => {});
    $("#scoreNow").textContent = "0"; $("#comboNow").textContent = "0"; $("#timeLeft").textContent = "60";
    $("#arena").classList.remove("combo-rush", "final-rush"); $("#injecting").classList.remove("show");
    $("#arena").querySelectorAll(".target,.floating-score,.hit-ring").forEach((node) => node.remove());
    $("#matchMeta").textContent = `【${state.profile.team}】｜【${state.profile.battle}】｜【${state.profile.tactic === "发起进攻" ? "进攻" : "防守"}】`;
    $("#matchMeta").className = `match-meta ${state.profile.tactic === "发起进攻" ? "attack-mode" : "defend-mode"}`;
    showScreen("gameScreen"); startCountdown();
  }

  function randomItem(list) { return list[Math.floor(Math.random() * list.length)]; }

  function makeTarget() {
    if (!state.running) return; const arena = $("#arena");
    const roll = Math.random(); const type = roll > 0.84 ? "bonus" : roll < 0.18 ? "noise" : "normal";
    const text = type === "bonus" ? randomItem(bonusTexts) : type === "noise" ? randomItem(noiseTexts) : randomItem(normalTexts);
    const target = document.createElement("button"); target.className = `target ${type}`; target.type = "button"; target.textContent = text;
    const rect = arena.getBoundingClientRect(); const size = type === "bonus" ? 84 : 76;
    target.style.width = `${size}px`; target.style.height = `${size}px`;
    target.style.left = `${Math.random() * Math.max(rect.width - size - 8, 1) + 4}px`;
    target.style.top = `${Math.random() * Math.max(rect.height - size - 8, 1) + 4}px`;
    target.addEventListener("click", () => hitTarget(target, type)); arena.appendChild(target);
    state.timers.push(setTimeout(() => target.remove(), type === "bonus" ? 760 : 920));
  }

  function hitTarget(target, type) {
    if (!state.running || !target.isConnected) return; let delta = 0;
    if (type === "noise") { delta = -18; state.combo = 0; if (window.AudioManager) window.AudioManager.playSfx("miss"); }
    else { state.combo += 1; state.maxCombo = Math.max(state.maxCombo, state.combo); const comboBonus = Math.min(Math.floor(state.combo / 4) * 4, 36); delta = type === "bonus" ? 46 + comboBonus : 18 + comboBonus; if (window.AudioManager) window.AudioManager.playSfx(type === "bonus" ? "bonus" : "hit"); const milestone = Math.floor(state.combo / 10) * 10; if (milestone >= 10 && milestone > state.lastComboSfx) { state.lastComboSfx = milestone; if (window.AudioManager) window.AudioManager.playSfx("combo"); } }
    state.score = Math.max(0, state.score + delta); $("#scoreNow").textContent = state.score; $("#comboNow").textContent = state.combo;
    $("#arena").classList.toggle("combo-rush", state.combo >= 10); showFloat(target, delta); showHitRing(target, delta); target.remove();
  }

  function showFloat(target, delta) {
    const arena = $("#arena"); const float = document.createElement("div"); float.className = "floating-score"; float.textContent = delta > 0 ? `+${delta}` : `${delta}`; float.style.left = target.style.left; float.style.top = target.style.top; float.style.color = delta > 0 ? "var(--gold)" : "var(--red)"; arena.appendChild(float); state.timers.push(setTimeout(() => float.remove(), 720));
  }
  function showHitRing(target, delta) {
    const arena = $("#arena"); const ring = document.createElement("div"); ring.className = "hit-ring"; ring.style.left = target.style.left; ring.style.top = target.style.top; ring.style.borderColor = delta > 0 ? "var(--gold)" : "var(--red)"; arena.appendChild(ring); state.timers.push(setTimeout(() => ring.remove(), 540));
  }

  function runGame() {
    state.running = true; const started = Date.now(); const duration = 60000;
    const spawn = () => { makeTarget(); if (Math.random() > 0.38) makeTarget(); if (state.running) state.timers.push(setTimeout(spawn, Math.max(300, 820 - state.combo * 8))); };
    const clock = () => { const left = Math.max(0, Math.ceil((duration - (Date.now() - started)) / 1000)); $("#timeLeft").textContent = left; $("#arena").classList.toggle("final-rush", left <= 10); if (left <= 10 && !state.rushSfxPlayed) { state.rushSfxPlayed = true; if (window.AudioManager) { window.AudioManager.setGameRush(true); window.AudioManager.playSfx("combo"); } } if (left <= 0) finishGame(); else state.timers.push(setTimeout(clock, 250)); };
    spawn(); clock();
  }

  async function finishGame() {
    if (!state.running) return; state.running = false; clearGameTimers(); $("#arena").querySelectorAll(".target").forEach((node) => node.remove()); $("#injecting").classList.add("show");
    const submitResult = USE_MOCK ? mockSubmit({ name: state.profile.name, team: state.profile.team, battle: state.profile.battle, tactic: state.profile.tactic, score: state.score, maxCombo: state.maxCombo, deviceId }) : await sbSubmitScore({ name: state.profile.name, team: state.profile.team, battle: state.profile.battle, tactic: state.profile.tactic, score: state.score, maxCombo: state.maxCombo });
    const accepted = submitResult.success; const count = accepted ? submitResult.data.todayAttempts : state.todayCache.attempts + 1; const todayBest = accepted ? submitResult.data.todayBest : state.todayCache.best;
    // 先用静态数据立即显示结果，不卡在 aggregate()
    renderResult(count, todayBest, null, !accepted ? submitResult.message : null);
    // 异步拉取最新战况刷新结果页（可选优化）
    aggregate()
      .then((afterData) => { const afterBattle = (afterData && afterData.battleStats) ? afterData.battleStats.find((battle) => battle.battle === state.profile.battle) : null; renderResult(count, todayBest, afterBattle, null); })
      .catch(() => {});
  }

  function renderResult(count, todayBest, afterBattle, errorMsg) {
    const wasLeader = state.beforeBattle?.leader?.team; const isLeader = afterBattle?.leader?.team; const changed = wasLeader && isLeader && wasLeader !== isLeader && afterBattle.leader.power > 0;
    const selectedRow = afterBattle?.rows?.find((row) => row.team === state.profile.team) || { power: 0 };
    const targetLeader = afterBattle?.leader?.team === state.profile.team ? afterBattle.second : afterBattle?.leader;
    const diff = afterBattle?.leader?.team === state.profile.team ? Math.max(afterBattle.leader.power - afterBattle.second.power, 0) : Math.max((targetLeader?.power || 0) - selectedRow.power, 0);
    const isAttack = state.profile.tactic === "发起进攻";
    $("#resultTag").textContent = errorMsg ? "⚠ 提交失败" : isAttack ? "⚔ 进攻完成！" : "🛡 防守完成！";
    $("#finalScore").textContent = state.score;
    $("#impactCopy").textContent = errorMsg ? `${errorMsg}，本局得分 ${state.score} 未计入榜单。` : `你已为【${state.profile.team}】在【${state.profile.battle}】贡献 ${state.score} ${isAttack ? "冲刺值" : "守护值"}。`;
    $("#resultSubtitle").textContent = changed ? "战场易主！" : afterBattle?.leader?.team === state.profile.team && !isAttack ? "防线加固！" : afterBattle?.leader?.team === state.profile.team ? "领先扩大！" : "距离反超更近一步！";
    $("#resultContext").innerHTML = `<div><span>${state.profile.battle} 当前占领</span><strong>${afterBattle?.leader?.power ? afterBattle.leader.team : "暂无"}</strong></div><div><span>${afterBattle?.leader?.team === state.profile.team ? "当前领先优势" : "距离反超还差"}</span><strong>${diff} 战力</strong></div>`;
    $("#todayAttempts").textContent = `${count}/${DAILY_LIMIT}`; $("#todayBest").textContent = todayBest;
    $("#resultPanel").classList.toggle("flash", changed); $("#playAgainBtn").textContent = isAttack ? "再战一局" : "继续守住";
    showScreen("resultScreen"); if (window.AudioManager) window.AudioManager.playSfx(changed ? "leaderChange" : "success");
  }

  async function renderReports() {
    // 先用静态占位数据立即显示，不卡网络
    paintReports(null);
    // 异步拉取最新战况刷新
    aggregate()
      .then((data) => paintReports(data))
      .catch((e) => console.warn("[renderReports] 战报拉取失败:", e && e.message));
  }

  function paintReports(data) {
    const champion = (data && data.champion) || null;
    const teamStats = (data && data.teamStats) || teams.map((t) => ({ team: t.name, occupied: 0, participants: 0, power: 0, high: 0 }));
    const battleStats = (data && data.battleStats) || battles.map(([name]) => ({
      battle: name, rows: [], leader: { team: "暂无", sprint: 0, guard: 0, power: 0 },
      second: { team: "暂无", power: 0 }, gap: 0, tag: "🔥 激烈争夺中",
    }));
    const todayHighlights = (data && data.todayHighlights) || { mvp: null, bestAttack: null, bestDefend: null, comboKing: null };
    const ticker = (data && data.ticker) || [];
    $("#championStrip").innerHTML = champion && champion.power > 0 ? `<div>${teamAvatar(teamMeta.get(champion.team))}<span>当前排名第一战队</span><strong>👑 ${champion.team}</strong><span>占领战场：${champion.occupied}/5｜总战力：${champion.power}</span></div><b>${champion.occupied}/5</b>` : `<div><span>当前排名第一战队</span><strong>等待开球</strong><span>完成挑战后，冠军席位将实时刷新。</span></div><b>0/5</b>`;
    $("#teamBoard").innerHTML = teamStats.some((team) => team.power > 0) ? teamStats.map((team, index) => teamRow(team, index)).join("") : empty("暂无门店战力，先完成一局挑战。");
    $("#battleBoard").innerHTML = battleStats.map((stat) => reportBattleCard(stat)).join(""); $("#playerBoard").innerHTML = renderHighlights(todayHighlights); $("#liveTicker").innerHTML = renderTicker(ticker, teamStats);
  }

  function teamRow(team, index) { const icon = index === 0 ? "👑" : index === 1 ? "⚔" : index === 2 ? "🛡" : index + 1; const status = index === 0 ? "暂居王座" : index === 1 ? "强势追击" : index === 2 ? "蓄势反超" : "等待爆发"; return `<article class="rank-row ${index === 0 ? "top-1" : ""}">${teamAvatar(teamMeta.get(team.team))}<span class="rank">${icon}</span><div><h4>第${index + 1}名：${team.team}</h4><p>占领 ${team.occupied} 个战场｜参与 ${team.participants} 人｜状态：${status}</p></div><strong>${team.power}</strong></article>`; }

  function reportBattleCard(stat) {
    const total = Math.max(stat.leader.sprint + stat.leader.guard, 1); const sprintWidth = Math.round((stat.leader.sprint / total) * 100); const guardWidth = Math.round((stat.leader.guard / total) * 100); const secondText = stat.second.power > 0 ? `${stat.second.team}，差距 ${stat.gap}` : "暂无第二名";
    return `<article class="battle-report-card"><header><div><h4>${stat.battle}</h4><p>${stat.leader.power ? `当前占领：${stat.leader.team}` : "当前占领：暂无"}</p></div><strong>${stat.leader.power}</strong></header><span class="status-tag">${stat.tag}</span><div class="battle-lines"><div><span>冲刺值 ${stat.leader.sprint}</span><div class="meter attack"><b style="width:${sprintWidth}%"></b></div></div><div><span>守护值 ${stat.leader.guard}</span><div class="meter defend"><b style="width:${guardWidth}%"></b></div></div></div><p>第二名：${secondText}</p></article>`;
  }

  function renderHighlights(highlights) { if (!highlights || (!highlights.mvp && !highlights.bestAttack && !highlights.bestDefend && !highlights.comboKing)) return empty("今日暂无高光球员，等你来打第一脚。"); const cards = [["👑", "今日MVP", highlights.mvp, highlights.mvp?.score || 0], ["⚔", "最强进攻", highlights.bestAttack, highlights.bestAttack?.score || 0], ["🛡", "最强防守", highlights.bestDefend, highlights.bestDefend?.score || 0], ["⚡", "Combo王", highlights.comboKing, highlights.comboKing?.maxCombo || 0]]; return cards.map(([icon, label, record, value]) => { if (!record) return `<article class="highlight-card"><span>${icon}</span><div><h4>${label}</h4><p>等待上榜</p></div><strong>0</strong></article>`; return `<article class="highlight-card"><span>${icon}</span><div><h4>${label}：${record.name}</h4><p>${record.team || ""}${record.battle ? "｜" + record.battle : ""}</p></div><strong>${value}</strong></article>`; }).join(""); }

  function renderTicker(ticker, teamStats) { const lines = Array.isArray(ticker) && ticker.length ? ticker : []; if (teamStats[0]?.power > 0 && !lines.some((l) => l.includes(teamStats[0].team))) lines.unshift(`👑 ${teamStats[0].team}暂居冠军席位`); const safeLines = lines.length ? lines : ["⚡ 战场等待开球，第一脚由你打响", "🔥 五大战场已进入待命状态"]; return `<div class="ticker-track">${safeLines.concat(safeLines).map((line) => `<div class="ticker-line">${line}</div>`).join("")}</div>`; }
  function empty(text) { return `<div class="empty">${text}</div>`; }

  // ============ 事件绑定 ============
  function bindEvents() {
    document.addEventListener("click", (event) => { const target = event.target.closest("[data-target]"); if (target) showScreen(target.dataset.target); });
    $("#startBtn").addEventListener("click", () => showScreen("nameScreen"));
    $("#playAgainBtn").addEventListener("click", () => showScreen("battleScreen"));
    $("#shareBtn").addEventListener("click", async () => {
      const shareUrl = (CFG.shareUrl && CFG.shareUrl.trim()) || location.href; const shareTitle = CFG.shareTitle || "冲冠之旅"; const shareText = CFG.shareText || "来为战队抢占五大战场！";
      if (navigator.share) { try { await navigator.share({ title: shareTitle, text: shareText, url: shareUrl }); return; } catch (_) {} }
      try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(shareUrl); $("#resultSubtitle").textContent = "✅ 活动链接已复制，去粘贴给战友吧！"; } else { const tmp = document.createElement("input"); tmp.value = shareUrl; document.body.appendChild(tmp); tmp.select(); document.execCommand("copy"); document.body.removeChild(tmp); $("#resultSubtitle").textContent = "✅ 活动链接已复制，去粘贴给战友吧！"; } } catch (_) { $("#resultSubtitle").textContent = "复制失败，请手动复制链接：" + shareUrl; }
    });
    $("#playerName").addEventListener("input", updateQuotaNote);
    $("#nameForm").addEventListener("submit", (event) => { event.preventDefault(); const name = $("#playerName").value.trim(); if (!name) return; state.profile.name = name; saveProfile(); showScreen("teamScreen"); });
    $("#teamChoices").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; state.profile.team = button.dataset.value; selectValue($("#teamChoices"), state.profile.team); updateTeamCallout(); updateQuotaNote(); saveProfile(); });
    $("#teamNextBtn").addEventListener("click", () => showScreen("battleScreen"));
    $("#battleChoices").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; state.profile.battle = button.dataset.value; selectValue($("#battleChoices"), state.profile.battle); saveProfile(); });
    $("#battleNextBtn").addEventListener("click", () => showScreen("tacticScreen"));
    $("#tacticChoices").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; state.profile.tactic = button.dataset.value; selectValue($("#tacticChoices"), state.profile.tactic); saveProfile(); });
    $("#enterGameBtn").addEventListener("click", async () => { const name = state.profile.name || $("#playerName").value.trim(); if (!name) { showScreen("nameScreen"); return; } state.profile.name = name; saveProfile(); beginGame(); // 先进入游戏，不卡在查今日次数
      // 异步检查次数限制（超限会在提交时拦截）
      fetchPlayerToday().then((status) => { if (status.todayAttempts >= DAILY_LIMIT) updateQuotaNote(); }).catch(() => {}); });
  }

  function saveProfile() { localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile)); }
  function loadProfile() { try { const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); state.profile = { ...state.profile, ...saved }; } catch { state.profile = { name: "", team: "", battle: "", tactic: "发起进攻" }; } }

  // ============ 启动 ============
  async function boot() {
    if (window.AudioManager) window.AudioManager.init();
    await loadConfig();
    loadProfile();
    if (!state.profile.team && teams[0]) state.profile.team = teams[0].name;
    if (!state.profile.battle && battles[0]) state.profile.battle = battles[0][0];
    applyGameMeta(); renderChoices(); renderHomeChampion(); bindEvents(); updateQuotaNote();
    if (window.AudioManager) window.AudioManager.playMainBgm();
  }

  boot();
})();
