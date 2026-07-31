// 《冲冠之路》前端业务逻辑（前后端不分离版）
// 数据来源：Express 后端 API（/api/chongguan/*）
// 处理过程：fetch 获取榜单/状态 -> 渲染 UI -> 游戏结束 POST 提交成绩
// 最终结果：所有成绩持久化到 SQLite，万人在线共享同一份榜单
//
// 保留的能力：
// - 个人偏好（姓名/战队/战场/战术）仍存 localStorage，方便下次进入
// - 全部 UI/动画/游戏逻辑保持不变
// - 音频管理保持不变

(function () {
  // 从 config.js 读取配置（活动日期、每日次数、分享链接、API路径等）
  const CFG = window.CROWN_CONFIG || {};
  // 活动时间可由服务端 /config 覆盖（见 loadServerConfig）
  let ACTIVITY_START = new Date(CFG.activityStart || "2026-08-01T08:00:00+08:00");
  let ACTIVITY_END = new Date(CFG.activityEnd || "2026-08-31T23:59:59+08:00");
  const DAILY_LIMIT = CFG.dailyLimit || 10;
  const PROFILE_KEY = CFG.profileKey || "road-to-crown-profile-v1";
  const API_BASE = CFG.apiBase || "/api/chongguan";

  // 设备唯一标识：首次访问生成 UUID 存 localStorage，后续所有请求携带
  // 同一设备（同一浏览器）无论怎么改名，次数统计都以 device_id 为准
  const DEVICE_KEY = "road-to-crown-device-id";
  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // 生成 UUID v4
      id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  const deviceId = getDeviceId();

  // 战队 / 战场 / 游戏信息在启动时从服务端 /config 拉取（单一来源 teams.js）
  // teams: [{ name, short, color }]   battles: [[name, description]]
  let teams = [];
  let battles = [];
  let gameName = "深圳丽兹行冲冠之旅";
  let gameSubtitle = "十八大门店战队，五大战场，抢占冲冠王座";
  const teamMeta = new Map(); // name -> { name, short, color }

  const normalTexts = ["追聊", "面见", "报盘", "带看", "复盘", "推进"];
  const bonusTexts = ["AI助攻", "团队协同", "专业判断", "勇气冲刺"];
  const noiseTexts = ["失焦", "犹豫", "等待", "低反馈", "断节奏"];
  const battleTags = ["🔥 激烈争夺中", "⚡ 即将反超", "🛡 防线稳固", "👑 暂居王座", "🚨 护盾告急"];

  const state = {
    profile: { name: "", team: "", battle: "", tactic: "发起进攻" },
    score: 0,
    combo: 0,
    maxCombo: 0,
    lastComboSfx: 0,
    rushSfxPlayed: false,
    beforeBattle: null,
    running: false,
    timers: [],
    // 本地缓存的今日状态，避免每次都查询接口
    todayCache: { attempts: 0, best: 0 },
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const pad = (n) => String(n).padStart(2, "0");
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const nowTime = () => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // ============ API 封装（所有请求自动携带设备标识）============

  async function apiGet(path) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { "X-Device-Id": deviceId },
      });
      const json = await res.json();
      return json.success ? json.data : null;
    } catch (e) {
      console.warn("[apiGet]", path, e);
      return null;
    }
  }

  async function apiPost(path, body) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": deviceId },
        body: JSON.stringify({ ...body, deviceId }),
      });
      return await res.json();
    } catch (e) {
      console.warn("[apiPost]", path, e);
      return { success: false, message: "网络异常" };
    }
  }

  // ============ 离线 / 本地兜底（双击 index.html 直接体验，无需服务器）============
  // 当 fetch 后端失败（例如直接以 file:// 打开、或后端未启动）时，
  // 自动切换到内置的 18 队数据 + 浏览器 localStorage 模拟计分与榜单。
  // 正式通过服务端运行时，下面的 USE_MOCK 始终为 false，完全走真实后端。
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

  function mockLoad() {
    try { return JSON.parse(localStorage.getItem(MOCK_KEY) || "[]"); } catch { return []; }
  }
  function mockSave(arr) {
    localStorage.setItem(MOCK_KEY, JSON.stringify(arr));
  }
  // 首次进入离线模式时，注入一些模拟战绩，让榜单看起来"有血有肉"
  function mockSeed() {
    if (localStorage.getItem(MOCK_KEY + ":seeded")) return;
    const arr = mockLoad();
    MOCK.teams.forEach((t, i) => {
      const n = 2 + (i % 3);
      for (let k = 0; k < n; k++) {
        arr.push({
          name: "队员" + (k + 1),
          team: t.name,
          battle: MOCK.battles[0].name,
          tactic: k % 2 ? "坚守防线" : "发起进攻",
          score: 380 + i * 41 + k * 67 + ((i * 7 + k * 13) % 120),
          maxCombo: 8 + (i + k) % 22,
          deviceId: "seed",
          ts: Date.now() - k * 60000,
        });
      }
    });
    mockSave(arr);
    localStorage.setItem(MOCK_KEY + ":seeded", "1");
  }
  function mockSubmit(body) {
    const arr = mockLoad();
    arr.push({ ...body, ts: Date.now() });
    mockSave(arr);
    const mine = arr.filter((s) => s.deviceId === body.deviceId);
    return {
      success: true,
      data: {
        todayAttempts: mine.length,
        todayBest: Math.max(0, ...mine.map((s) => s.score || 0)),
      },
    };
  }
  function mockPlayerToday() {
    const mine = mockLoad().filter((s) => s.deviceId === deviceId);
    return {
      todayAttempts: mine.length,
      todayBest: Math.max(0, ...mine.map((s) => s.score || 0)),
      remainingAttempts: Math.max(0, DAILY_LIMIT - mine.length),
    };
  }
  // 从本地战绩聚合出与真实后端同构的榜单结构
  function mockLeaderboard() {
    const scores = mockLoad();
    const tm = {};
    MOCK.teams.forEach((t) => { tm[t.name] = { power: 0, high: 0, parts: new Set(), byBattle: {} }; });
    scores.forEach((s) => {
      const m = tm[s.team];
      if (!m) return;
      m.power += s.score || 0;
      m.high = Math.max(m.high, s.score || 0);
      m.parts.add(s.deviceId || s.name || "anon");
      m.byBattle[s.battle] = (m.byBattle[s.battle] || 0) + (s.score || 0);
    });
    const teamStats = MOCK.teams.map((t) => {
      const m = tm[t.name];
      return { team: t.name, occupied: 0, participants: m.parts.size, power: m.power, high: m.high };
    });
    const battleStats = MOCK.battles.map((b) => {
      const rows = MOCK.teams.map((t) => {
        const p = tm[t.name].byBattle[b.name] || 0;
        return { team: t.name, battle: b.name, sprint: p, guard: 0, power: p };
      });
      const sorted = [...rows].sort((a, b) => b.power - a.power);
      const leader = sorted[0] && sorted[0].power > 0 ? sorted[0] : { team: "暂无", power: 0 };
      const second = sorted[1] && sorted[1].power > 0 ? sorted[1] : { team: "暂无", power: 0 };
      if (leader.team !== "暂无") {
        const ts = teamStats.find((x) => x.team === leader.team);
        if (ts) ts.occupied += 1;
      }
      return {
        battle: b.name,
        rows,
        leader: leader.team,
        second: second.team,
        sprint: leader.power,
        guard: 0,
        power: leader.power,
        gap: Math.max(leader.power - second.power, 0),
        tag: "🔥 激烈争夺中",
      };
    });
    const ranked = [...teamStats].sort(
      (a, b) => (b.occupied - a.occupied) || (b.power - a.power) || (b.participants - a.participants) || (b.high - a.high)
    );
    const champion = ranked[0] && ranked[0].power > 0 ? ranked[0] : null;
    return { teams: teamStats, battles: battleStats, champion, todayHighlights: { mvp: null, bestAttack: null, bestDefend: null, comboKing: null }, ticker: [] };
  }

  // ============ 战队头像 / 配置加载 ============

  // 自动生成战队头像：圆形彩色底 + 缩写（无需图片素材，支持任意数量战队）
  function teamAvatar(teamObj) {
    const name = (teamObj && teamObj.name) || "";
    const short = (teamObj && teamObj.short) || name.slice(0, 2) || "?";
    const color = (teamObj && teamObj.color) || "#8A8FA3";
    return `<span class="team-avatar" style="background:${color}">${short}</span>`;
  }

  // 启动时从服务端拉取战队/战场/游戏信息（单一来源 teams.js）
  async function loadServerConfig() {
    USE_MOCK = false;
    try {
      const res = await fetch(`${API_BASE}/config`);
      const json = await res.json();
      if (json && json.success && json.data && (json.data.teams || []).length) {
        const d = json.data;
        teams = (d.teams || []).map((t) => ({
          name: t.name,
          short: t.short || (t.name || "").slice(0, 2),
          color: t.color || "#8A8FA3",
        }));
        battles = (d.battles || []).map((b) => [b.name, b.description || ""]);
        if (d.gameName) gameName = d.gameName;
        if (d.subtitle) gameSubtitle = d.subtitle;
        if (d.activityStart) ACTIVITY_START = new Date(d.activityStart);
        if (d.activityEnd) ACTIVITY_END = new Date(d.activityEnd);
        teams.forEach((t) => teamMeta.set(t.name, t));
        return;
      }
    } catch (e) {
      console.warn("[config] 拉取失败，使用本地兜底", e);
    }
    // 兜底：服务端不可用（如以 file:// 直接打开）时，使用内置离线数据 + 本地模拟
    USE_MOCK = true;
    mockSeed();
    teams = MOCK.teams.map((t) => ({ name: t.name, short: t.short, color: t.color }));
    battles = MOCK.battles.map((b) => [b.name, b.desc]);
    gameName = MOCK.gameName;
    gameSubtitle = MOCK.subtitle;
    if (MOCK.activityStart) ACTIVITY_START = new Date(MOCK.activityStart);
    if (MOCK.activityEnd) ACTIVITY_END = new Date(MOCK.activityEnd);
    teams.forEach((t) => teamMeta.set(t.name, t));
  }

  // 把游戏名 / 副标题 / 活动时间写入页面
  function applyGameMeta() {
    if (gameName) document.title = gameName;
    const gt = document.getElementById("gameTitle");
    if (gt) gt.textContent = gameName;
    const gs = document.getElementById("gameSubtitle");
    if (gs) gs.textContent = gameSubtitle;
    const tc = document.getElementById("timeChip");
    if (tc) {
      const fmt = (iso) => {
        try {
          const d = new Date(iso);
          return `${d.getMonth() + 1}月${d.getDate()}日${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        } catch {
          return "";
        }
      };
      if (ACTIVITY_START && ACTIVITY_END && !isNaN(ACTIVITY_START) && !isNaN(ACTIVITY_END)) {
        tc.textContent = `${fmt(ACTIVITY_START)} - ${fmt(ACTIVITY_END)}`;
      }
    }
  }

  // 获取榜单并适配为前端原有数据结构
  // 数据来源：GET /api/chongguan/leaderboard
  // 处理过程：将后端扁平结构还原为渲染函数所需的对象结构
  // 最终结果：返回 { teamStats, battleStats, todayHighlights, ticker, champion }
  async function aggregate() {
    const data = USE_MOCK ? mockLeaderboard() : await apiGet("/leaderboard");
    if (!data) {
      return {
        champion: null,
        teamStats: teams.map((t) => ({ team: t.name, occupied: 0, participants: 0, power: 0, high: 0 })),
        battleStats: battles.map(([battle]) => ({
          battle,
          rows: teams.map((t) => ({ team: t.name, battle, sprint: 0, guard: 0, power: 0 })),
          leader: { team: "暂无", power: 0, sprint: 0, guard: 0 },
          second: { team: "暂无", power: 0, sprint: 0, guard: 0 },
          gap: 0,
          tag: "🔥 激烈争夺中",
        })),
        todayHighlights: { mvp: null, bestAttack: null, bestDefend: null, comboKing: null },
        ticker: [],
      };
    }

    // 适配战场统计：后端 leader/second 为字符串，前端需要对象
    const battleStats = data.battles.map((b) => {
      const rows = b.rows || teams.map((team) => ({ team, battle: b.battle, sprint: 0, guard: 0, power: 0 }));
      const leaderRow = rows.find((r) => r.team === b.leader) || { team: b.leader, sprint: b.sprint, guard: b.guard, power: b.power };
      const secondRow = rows.find((r) => r.team === b.second) || { team: b.second, power: 0, sprint: 0, guard: 0 };
      return {
        battle: b.battle,
        rows,
        leader: { ...leaderRow, team: b.leader, sprint: b.sprint, guard: b.guard, power: b.power },
        second: { ...secondRow, team: b.second },
        gap: b.gap,
        tag: b.tag,
      };
    });

    const teamStats = data.teams.map((t) => ({
      team: t.team,
      occupied: t.occupied,
      participants: t.participants,
      power: t.power,
      high: t.high,
    }));

    return {
      champion: data.champion,
      teamStats,
      battleStats,
      todayHighlights: data.todayHighlights || { mvp: null, bestAttack: null, bestDefend: null, comboKing: null },
      ticker: data.ticker || [],
    };
  }

  // 查询本设备今日状态（次数 + 最高分），后端按 device_id 识别玩家
  async function fetchPlayerToday() {
    if (USE_MOCK) return mockPlayerToday();
    const data = await apiGet(`/players/today?deviceId=${encodeURIComponent(deviceId)}`);
    if (!data) return { todayAttempts: 0, todayBest: 0, remainingAttempts: DAILY_LIMIT };
    // 同步本地缓存
    state.todayCache = { attempts: data.todayAttempts, best: data.todayBest };
    return data;
  }

  // ============ 本地 profile 读写 ============

  function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
  }

  function loadProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      state.profile = { ...state.profile, ...saved };
    } catch {
      state.profile = { name: "", team: "", battle: "", tactic: "发起进攻" };
    }
  }

  // ============ 屏幕切换 ============

  function showScreen(id) {
    $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
    if (window.AudioManager) {
      if (id === "gameScreen") {
        window.AudioManager.fadeToGameBgm();
      } else {
        window.AudioManager.fadeToMainBgm();
        window.AudioManager.setGameRush(false);
      }
    }
    if (id === "homeScreen") renderHomeChampion();
    if (id === "teamScreen") renderChoices();
    if (id === "battleScreen") renderChoices();
    if (id === "tacticScreen") updateTacticScreen();
    if (id === "reportScreen") renderReports();
    if (id === "nameScreen") updateQuotaNote();
  }

  function selectValue(container, value) {
    container.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.value === value);
    });
  }

  // ============ 渲染：首页冠军预览 ============

  async function renderHomeChampion() {
    const { champion } = await aggregate();
    $("#homeChampion").innerHTML =
      champion && champion.power > 0
        ? `<div>${teamAvatar(teamMeta.get(champion.team))}<span>当前冠军席位</span><strong>👑 ${champion.team}</strong><span>占领 ${champion.occupied}/5 个战场｜总战力 ${champion.power}</span></div><b>${champion.occupied}</b>`
        : `<div><span>当前冠军席位</span><strong>等待开球</strong><span>完成首局挑战后，战况将在这里点亮。</span></div><b>0</b>`;
  }

  // ============ 渲染：战队/战场选择 ============

  async function renderChoices() {
    const { teamStats, battleStats } = await aggregate();
    const teamRank = new Map(teamStats.map((team, index) => [team.team, { ...team, rank: index + 1 }]));

    $("#teamChoices").innerHTML = teams
      .map((team, index) => {
        const stat = teamRank.get(team.name) || { rank: index + 1, power: 0 };
        return `<button type="button" class="team-card" data-value="${team.name}">
          ${teamAvatar(team)}
          <h3>${team.name}</h3>
          <p><span>当前排名</span><strong>No.${stat.rank}</strong></p>
          <p><span>当前总战力</span><strong>${stat.power}</strong></p>
        </button>`;
      })
      .join("");

    $("#battleChoices").innerHTML = battleStats.map((stat) => battleCard(stat)).join("");

    selectValue($("#teamChoices"), state.profile.team);
    selectValue($("#battleChoices"), state.profile.battle);
    selectValue($("#tacticChoices"), state.profile.tactic);
    $("#playerName").value = state.profile.name || $("#playerName").value || "";
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
      <span class="status-tag">${stat.tag}</span>
      <h3>${stat.battle}</h3>
      <p>${desc}</p>
      <div class="battle-meta">
        <div><span>当前占领</span><strong>${leaderName}</strong></div>
        <div><span>当前总战力</span><strong>${stat.leader.power}</strong></div>
      </div>
      <div class="battle-lines">
        <div><span>冲刺值 ${stat.leader.sprint}</span><div class="meter attack"><b style="width:${sprintWidth}%"></b></div></div>
        <div><span>守护值 ${stat.leader.guard}</span><div class="meter defend"><b style="width:${guardWidth}%"></b></div></div>
      </div>
      <p>第二名：${secondText}</p>
    </button>`;
  }

  function updateTeamCallout() {
    $("#teamCallout").innerHTML = `<span>你已加入</span><strong>【${state.profile.team}】</strong><span>下半场开球，准备进入战场。</span>`;
  }

  function updateTacticScreen() {
    $("#tacticBattleName").textContent = `当前战场：${state.profile.battle}`;
    selectValue($("#tacticChoices"), state.profile.tactic);
  }

  // ============ 今日次数提示 ============

  async function updateQuotaNote() {
    const name = $("#playerName").value.trim() || state.profile.name;
    const now = new Date();
    let remaining = DAILY_LIMIT;
    if (name) {
      const status = await fetchPlayerToday();
      remaining = status.remainingAttempts;
    }
    const status =
      now < ACTIVITY_START
        ? "活动未开始，可先体验流程"
        : now > ACTIVITY_END
          ? "活动已结束，可查看战报"
          : `今日剩余 ${remaining} 次挑战机会`;
    $("#quotaNote").textContent = status;
    $("#enterGameBtn").disabled = Boolean(name && remaining <= 0);
  }

  // ============ 游戏流程 ============

  function clearGameTimers() {
    state.timers.forEach((timer) => clearTimeout(timer));
    state.timers = [];
  }

  function startCountdown() {
    const countdown = $("#countdown");
    let n = 3;
    countdown.textContent = n;
    countdown.classList.add("show");
    const tick = () => {
      n -= 1;
      if (n === 0) {
        countdown.textContent = "开球";
        state.timers.push(setTimeout(() => {
          countdown.classList.remove("show");
          runGame();
        }, 520));
      } else {
        countdown.textContent = n;
        state.timers.push(setTimeout(tick, 760));
      }
    };
    state.timers.push(setTimeout(tick, 760));
  }

  async function beginGame() {
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.lastComboSfx = 0;
    state.rushSfxPlayed = false;
    // 进入游戏前先快照战场状态，用于结算时对比是否易主
    const snapshot = await aggregate();
    state.beforeBattle = snapshot.battleStats.find((battle) => battle.battle === state.profile.battle);
    $("#scoreNow").textContent = "0";
    $("#comboNow").textContent = "0";
    $("#timeLeft").textContent = "60";
    $("#arena").classList.remove("combo-rush", "final-rush");
    $("#injecting").classList.remove("show");
    $("#arena").querySelectorAll(".target,.floating-score,.hit-ring").forEach((node) => node.remove());
    $("#matchMeta").textContent = `【${state.profile.team}】｜【${state.profile.battle}】｜【${state.profile.tactic === "发起进攻" ? "进攻" : "防守"}】`;
    $("#matchMeta").className = `match-meta ${state.profile.tactic === "发起进攻" ? "attack-mode" : "defend-mode"}`;
    showScreen("gameScreen");
    startCountdown();
  }

  function randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function makeTarget() {
    if (!state.running) return;
    const arena = $("#arena");
    const roll = Math.random();
    const type = roll > 0.84 ? "bonus" : roll < 0.18 ? "noise" : "normal";
    const text = type === "bonus" ? randomItem(bonusTexts) : type === "noise" ? randomItem(noiseTexts) : randomItem(normalTexts);
    const target = document.createElement("button");
    target.className = `target ${type}`;
    target.type = "button";
    target.textContent = text;

    const rect = arena.getBoundingClientRect();
    const size = type === "bonus" ? 84 : 76;
    target.style.width = `${size}px`;
    target.style.height = `${size}px`;
    target.style.left = `${Math.random() * Math.max(rect.width - size - 8, 1) + 4}px`;
    target.style.top = `${Math.random() * Math.max(rect.height - size - 8, 1) + 4}px`;

    target.addEventListener("click", () => hitTarget(target, type));
    arena.appendChild(target);
    state.timers.push(setTimeout(() => target.remove(), type === "bonus" ? 760 : 920));
  }

  function hitTarget(target, type) {
    if (!state.running || !target.isConnected) return;

    let delta = 0;
    if (type === "noise") {
      delta = -18;
      state.combo = 0;
      if (window.AudioManager) window.AudioManager.playSfx("miss");
    } else {
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const comboBonus = Math.min(Math.floor(state.combo / 4) * 4, 36);
      delta = type === "bonus" ? 46 + comboBonus : 18 + comboBonus;
      if (window.AudioManager) window.AudioManager.playSfx(type === "bonus" ? "bonus" : "hit");
      const milestone = Math.floor(state.combo / 10) * 10;
      if (milestone >= 10 && milestone > state.lastComboSfx) {
        state.lastComboSfx = milestone;
        if (window.AudioManager) window.AudioManager.playSfx("combo");
      }
    }
    state.score = Math.max(0, state.score + delta);
    $("#scoreNow").textContent = state.score;
    $("#comboNow").textContent = state.combo;
    $("#arena").classList.toggle("combo-rush", state.combo >= 10);
    showFloat(target, delta);
    showHitRing(target, delta);
    target.remove();
  }

  function showFloat(target, delta) {
    const arena = $("#arena");
    const float = document.createElement("div");
    float.className = "floating-score";
    float.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    float.style.left = target.style.left;
    float.style.top = target.style.top;
    float.style.color = delta > 0 ? "var(--gold)" : "var(--red)";
    arena.appendChild(float);
    state.timers.push(setTimeout(() => float.remove(), 720));
  }

  function showHitRing(target, delta) {
    const arena = $("#arena");
    const ring = document.createElement("div");
    ring.className = "hit-ring";
    ring.style.left = target.style.left;
    ring.style.top = target.style.top;
    ring.style.borderColor = delta > 0 ? "var(--gold)" : "var(--red)";
    arena.appendChild(ring);
    state.timers.push(setTimeout(() => ring.remove(), 540));
  }

  function runGame() {
    state.running = true;
    const started = Date.now();
    const duration = 60000;

    const spawn = () => {
      makeTarget();
      if (Math.random() > 0.38) makeTarget();
      if (state.running) state.timers.push(setTimeout(spawn, Math.max(300, 820 - state.combo * 8)));
    };

    const clock = () => {
      const left = Math.max(0, Math.ceil((duration - (Date.now() - started)) / 1000));
      $("#timeLeft").textContent = left;
      $("#arena").classList.toggle("final-rush", left <= 10);
      if (left <= 10 && !state.rushSfxPlayed) {
        state.rushSfxPlayed = true;
        if (window.AudioManager) {
          window.AudioManager.setGameRush(true);
          window.AudioManager.playSfx("combo");
        }
      }
      if (left <= 0) {
        finishGame();
      } else {
        state.timers.push(setTimeout(clock, 250));
      }
    };

    spawn();
    clock();
  }

  async function finishGame() {
    if (!state.running) return;
    state.running = false;
    clearGameTimers();
    $("#arena").querySelectorAll(".target").forEach((node) => node.remove());
    $("#injecting").classList.add("show");

    // 数据来源：本局游戏得分
    // 处理过程：POST 到后端 -> 后端校验并写入 SQLite -> 失效缓存
    // 最终结果：返回今日次数和今日最高分，驱动结算页渲染
    const submitResult = USE_MOCK
      ? mockSubmit({
          name: state.profile.name,
          team: state.profile.team,
          battle: state.profile.battle,
          tactic: state.profile.tactic,
          score: state.score,
          maxCombo: state.maxCombo,
          deviceId,
        })
      : await apiPost("/scores", {
          name: state.profile.name,
          team: state.profile.team,
          battle: state.profile.battle,
          tactic: state.profile.tactic,
          score: state.score,
          maxCombo: state.maxCombo,
        });

    const accepted = submitResult.success;
    const count = accepted ? submitResult.data.todayAttempts : state.todayCache.attempts + 1;
    const todayBest = accepted ? submitResult.data.todayBest : state.todayCache.best;

    // 重新拉取榜单计算战场是否易主
    const afterData = await aggregate();
    const afterBattle = afterData.battleStats.find((battle) => battle.battle === state.profile.battle);
    renderResult(count, todayBest, afterBattle, !accepted ? submitResult.message : null);
  }

  function renderResult(count, todayBest, afterBattle, errorMsg) {
    const wasLeader = state.beforeBattle?.leader?.team;
    const isLeader = afterBattle?.leader?.team;
    const changed = wasLeader && isLeader && wasLeader !== isLeader && afterBattle.leader.power > 0;
    const selectedRow = afterBattle?.rows?.find((row) => row.team === state.profile.team) || { power: 0 };
    const targetLeader = afterBattle?.leader?.team === state.profile.team ? afterBattle.second : afterBattle?.leader;
    const diff =
      afterBattle?.leader?.team === state.profile.team
        ? Math.max(afterBattle.leader.power - afterBattle.second.power, 0)
        : Math.max((targetLeader?.power || 0) - selectedRow.power, 0);
    const isAttack = state.profile.tactic === "发起进攻";

    $("#resultTag").textContent = errorMsg ? "⚠ 提交失败" : isAttack ? "⚔ 进攻完成！" : "🛡 防守完成！";
    $("#finalScore").textContent = state.score;
    $("#impactCopy").textContent = errorMsg
      ? `${errorMsg}，本局得分 ${state.score} 未计入榜单。`
      : `你已为【${state.profile.team}】在【${state.profile.battle}】贡献 ${state.score} ${isAttack ? "冲刺值" : "守护值"}。`;
    $("#resultSubtitle").textContent = changed
      ? "战场易主！"
      : afterBattle?.leader?.team === state.profile.team && !isAttack
        ? "防线加固！"
        : afterBattle?.leader?.team === state.profile.team
          ? "领先扩大！"
          : "距离反超更近一步！";
    $("#resultContext").innerHTML = `
      <div><span>${state.profile.battle} 当前占领</span><strong>${afterBattle?.leader?.power ? afterBattle.leader.team : "暂无"}</strong></div>
      <div><span>${afterBattle?.leader?.team === state.profile.team ? "当前领先优势" : "距离反超还差"}</span><strong>${diff} 战力</strong></div>
    `;
    $("#todayAttempts").textContent = `${count}/${DAILY_LIMIT}`;
    $("#todayBest").textContent = todayBest;
    $("#resultPanel").classList.toggle("flash", changed);
    $("#playAgainBtn").textContent = isAttack ? "再战一局" : "继续守住";
    showScreen("resultScreen");
    if (window.AudioManager) {
      window.AudioManager.playSfx(changed ? "leaderChange" : "success");
    }
  }

  // ============ 渲染：实时战报 ============

  async function renderReports() {
    const { champion, teamStats, battleStats, todayHighlights, ticker } = await aggregate();
    $("#championStrip").innerHTML =
      champion && champion.power > 0
        ? `<div>${teamAvatar(teamMeta.get(champion.team))}<span>当前排名第一战队</span><strong>👑 ${champion.team}</strong><span>占领战场：${champion.occupied}/5｜总战力：${champion.power}</span></div><b>${champion.occupied}/5</b>`
        : `<div><span>当前排名第一战队</span><strong>等待开球</strong><span>完成挑战后，冠军席位将实时刷新。</span></div><b>0/5</b>`;

    $("#teamBoard").innerHTML = teamStats.some((team) => team.power > 0)
      ? teamStats.map((team, index) => teamRow(team, index)).join("")
      : empty("暂无门店战力，先完成一局挑战。");

    $("#battleBoard").innerHTML = battleStats.map((stat) => reportBattleCard(stat)).join("");
    $("#playerBoard").innerHTML = renderHighlights(todayHighlights);
    $("#liveTicker").innerHTML = renderTicker(ticker, teamStats);
  }

  function teamRow(team, index) {
    const icon = index === 0 ? "👑" : index === 1 ? "⚔" : index === 2 ? "🛡" : index + 1;
    const status = index === 0 ? "暂居王座" : index === 1 ? "强势追击" : index === 2 ? "蓄势反超" : "等待爆发";
    return `<article class="rank-row ${index === 0 ? "top-1" : ""}">
      ${teamAvatar(teamMeta.get(team.team))}
      <span class="rank">${icon}</span>
      <div><h4>第${index + 1}名：${team.team}</h4><p>占领 ${team.occupied} 个战场｜参与 ${team.participants} 人｜状态：${status}</p></div>
      <strong>${team.power}</strong>
    </article>`;
  }

  function reportBattleCard(stat) {
    const total = Math.max(stat.leader.sprint + stat.leader.guard, 1);
    const sprintWidth = Math.round((stat.leader.sprint / total) * 100);
    const guardWidth = Math.round((stat.leader.guard / total) * 100);
    const secondText = stat.second.power > 0 ? `${stat.second.team}，差距 ${stat.gap}` : "暂无第二名";
    return `<article class="battle-report-card">
      <header>
        <div><h4>${stat.battle}</h4><p>${stat.leader.power ? `当前占领：${stat.leader.team}` : "当前占领：暂无"}</p></div>
        <strong>${stat.leader.power}</strong>
      </header>
      <span class="status-tag">${stat.tag}</span>
      <div class="battle-lines">
        <div><span>冲刺值 ${stat.leader.sprint}</span><div class="meter attack"><b style="width:${sprintWidth}%"></b></div></div>
        <div><span>守护值 ${stat.leader.guard}</span><div class="meter defend"><b style="width:${guardWidth}%"></b></div></div>
      </div>
      <p>第二名：${secondText}</p>
    </article>`;
  }

  // 数据来源：后端 todayHighlights（已聚合好的 mvp/bestAttack/bestDefend/comboKing）
  // 处理过程：直接映射为高光卡片
  // 最终结果：渲染 4 张高光球员卡片
  function renderHighlights(highlights) {
    if (!highlights || (!highlights.mvp && !highlights.bestAttack && !highlights.bestDefend && !highlights.comboKing)) {
      return empty("今日暂无高光球员，等你来打第一脚。");
    }
    const cards = [
      ["👑", "今日MVP", highlights.mvp, highlights.mvp?.score || 0],
      ["⚔", "最强进攻", highlights.bestAttack, highlights.bestAttack?.score || 0],
      ["🛡", "最强防守", highlights.bestDefend, highlights.bestDefend?.score || 0],
      ["⚡", "Combo王", highlights.comboKing, highlights.comboKing?.maxCombo || 0],
    ];
    return cards.map(([icon, label, record, value]) => {
      if (!record) return `<article class="highlight-card"><span>${icon}</span><div><h4>${label}</h4><p>等待上榜</p></div><strong>0</strong></article>`;
      return `<article class="highlight-card"><span>${icon}</span><div><h4>${label}：${record.name}</h4><p>${record.team || ""}${record.battle ? "｜" + record.battle : ""}</p></div><strong>${value}</strong></article>`;
    }).join("");
  }

  function renderTicker(ticker, teamStats) {
    const lines = Array.isArray(ticker) && ticker.length ? ticker : [];
    if (teamStats[0]?.power > 0 && !lines.some((l) => l.includes(teamStats[0].team))) {
      lines.unshift(`👑 ${teamStats[0].team}暂居冠军席位`);
    }
    const safeLines = lines.length ? lines : ["⚡ 战场等待开球，第一脚由你打响", "🔥 五大战场已进入待命状态"];
    return `<div class="ticker-track">${safeLines.concat(safeLines).map((line) => `<div class="ticker-line">${line}</div>`).join("")}</div>`;
  }

  function empty(text) {
    return `<div class="empty">${text}</div>`;
  }



  // ============ 事件绑定 ============

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-target]");
      if (target) showScreen(target.dataset.target);
    });

    $("#startBtn").addEventListener("click", () => showScreen("nameScreen"));
    $("#playAgainBtn").addEventListener("click", () => showScreen("battleScreen"));
    $("#shareBtn").addEventListener("click", async () => {
      // 召唤战友：优先用 Web Share（移动端原生分享面板），否则复制链接到剪贴板
      const shareUrl = (CFG.shareUrl && CFG.shareUrl.trim()) || location.href;
      const shareTitle = CFG.shareTitle || "冲冠之路";
      const shareText = CFG.shareText || "来为战队抢占五大战场！";
      // 移动端优先调用系统分享
      if (navigator.share) {
        try {
          await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
          return;
        } catch (_) { /* 用户取消分享，继续走剪贴板 */ }
      }
      // PC 端 / 不支持 Web Share：复制链接到剪贴板
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          $("#resultSubtitle").textContent = "✅ 活动链接已复制，去粘贴给战友吧！";
        } else {
          // 兜底：用临时 input + execCommand
          const tmp = document.createElement("input");
          tmp.value = shareUrl;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand("copy");
          document.body.removeChild(tmp);
          $("#resultSubtitle").textContent = "✅ 活动链接已复制，去粘贴给战友吧！";
        }
      } catch (_) {
        $("#resultSubtitle").textContent = "复制失败，请手动复制链接：" + shareUrl;
      }
    });
    $("#playerName").addEventListener("input", updateQuotaNote);

    $("#nameForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("#playerName").value.trim();
      if (!name) return;
      state.profile.name = name;
      saveProfile();
      showScreen("teamScreen");
    });

    $("#teamChoices").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      state.profile.team = button.dataset.value;
      selectValue($("#teamChoices"), state.profile.team);
      updateTeamCallout();
      updateQuotaNote();
      saveProfile();
    });

    $("#teamNextBtn").addEventListener("click", () => showScreen("battleScreen"));

    $("#battleChoices").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      state.profile.battle = button.dataset.value;
      selectValue($("#battleChoices"), state.profile.battle);
      saveProfile();
    });

    $("#battleNextBtn").addEventListener("click", () => showScreen("tacticScreen"));

    $("#tacticChoices").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      state.profile.tactic = button.dataset.value;
      selectValue($("#tacticChoices"), state.profile.tactic);
      saveProfile();
    });

    $("#enterGameBtn").addEventListener("click", async () => {
      const name = state.profile.name || $("#playerName").value.trim();
      if (!name) {
        showScreen("nameScreen");
        return;
      }
      state.profile.name = name;
      const status = await fetchPlayerToday();
      if (status.todayAttempts >= DAILY_LIMIT) {
        updateQuotaNote();
        showScreen("nameScreen");
        return;
      }
      saveProfile();
      beginGame();
    });


  }

  // ============ 启动 ============

  // 先拉取服务端配置（战队/战场/游戏信息），再渲染界面
  async function boot() {
    if (window.AudioManager) window.AudioManager.init();
    await loadServerConfig();
    loadProfile();
    // 若本地没有偏好，默认选中第一个战队 / 战场
    if (!state.profile.team && teams[0]) state.profile.team = teams[0].name;
    if (!state.profile.battle && battles[0]) state.profile.battle = battles[0][0];
    applyGameMeta();
    renderChoices();
    renderHomeChampion();
    bindEvents();
    updateQuotaNote();
    if (window.AudioManager) window.AudioManager.playMainBgm();
  }

  boot();
})();
