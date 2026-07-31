(function () {
  const ACTIVITY_START = new Date("2026-06-28T08:00:00+08:00");
  const ACTIVITY_END = new Date("2026-06-30T23:59:59+08:00");
  const DAILY_LIMIT = 10;
  const STORAGE_KEY = "road-to-crown-records-v1";
  const PROFILE_KEY = "road-to-crown-profile-v1";

  const teams = [
    "汇悦台战队",
    "嘉裕公馆战队",
    "誉峰观园战队",
    "保利天悦战队",
    "珠江新城旗舰战队",
    "凯旋新世界战队",
  ];

  const battles = [
    ["客户突破战场", "每一次主动追聊、精准匹配、持续推进，都是向客户信任更近一步。"],
    ["房源深耕战场", "每一次面见争取、房源分析、专业反馈，都是在为结果积累弹药。"],
    ["AI助攻战场", "AI不是装备展示，而是每场都要上场的战术板。"],
    ["团队协同战场", "个人突破背后有团队支撑，真正的胜利来自并肩作战。"],
    ["临门一脚战场", "关键机会出现时，敢推进、敢争取、敢完成最后一脚。"],
  ];

  const normalTexts = ["追聊", "面见", "报盘", "带看", "复盘", "推进"];
  const bonusTexts = ["AI助攻", "团队协同", "专业判断", "勇气冲刺"];
  const noiseTexts = ["失焦", "犹豫", "等待", "低反馈", "断节奏"];
  const teamIcons = ["HY", "JY", "YF", "BL", "ZJ", "KX"];
  const battleTags = ["🔥 激烈争夺中", "⚡ 即将反超", "🛡 防线稳固", "👑 暂居王座", "🚨 护盾告急"];

  const state = {
    profile: { name: "", team: teams[0], battle: battles[0][0], tactic: "发起进攻" },
    score: 0,
    combo: 0,
    maxCombo: 0,
    lastComboSfx: 0,
    rushSfxPlayed: false,
    beforeBattle: null,
    running: false,
    timers: [],
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

  function getRecords() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function setRecords(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
  }

  function loadProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      state.profile = { ...state.profile, ...saved };
    } catch {
      state.profile = { name: "", team: teams[0], battle: battles[0][0], tactic: "发起进攻" };
    }
  }

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

  function dailyBestRecords(records) {
    const map = new Map();
    records.forEach((record) => {
      const key = `${record.name}__${record.team}__${record.date}`;
      const prev = map.get(key);
      if (!prev || record.score > prev.score) map.set(key, record);
    });
    return Array.from(map.values());
  }

  function aggregate(records = getRecords()) {
    const best = dailyBestRecords(records);
    const battleStats = battles.map(([battle]) => {
      const rows = teams.map((team) => {
        const relevant = best.filter((r) => r.team === team && r.battle === battle);
        const sprint = relevant.filter((r) => r.tactic === "发起进攻").reduce((sum, r) => sum + r.score, 0);
        const guard = relevant.filter((r) => r.tactic === "坚守防线").reduce((sum, r) => sum + r.score, 0);
        return { team, battle, sprint, guard, power: sprint + guard };
      });
      rows.sort((a, b) => b.power - a.power);
      const leader = rows[0];
      const second = rows[1] || { team: "暂无", power: 0, sprint: 0, guard: 0 };
      return { battle, rows, leader, second, gap: Math.max(leader.power - second.power, 0), tag: battleStatus(leader, second) };
    });

    const teamStats = teams.map((team) => {
      const recordsForTeam = best.filter((r) => r.team === team);
      const occupied = battleStats.filter((b) => b.leader.team === team && b.leader.power > 0).length;
      const participants = new Set(recordsForTeam.map((r) => r.name)).size;
      const power = recordsForTeam.reduce((sum, r) => sum + r.score, 0);
      const high = recordsForTeam.reduce((max, r) => Math.max(max, r.score), 0);
      return { team, occupied, participants, power, high };
    });
    teamStats.sort((a, b) => b.occupied - a.occupied || b.power - a.power || b.participants - a.participants || b.high - a.high);

    const todayRecords = getRecords().filter((r) => r.date === todayKey());
    const todayPlayers = dailyBestRecords(todayRecords).sort((a, b) => b.score - a.score).slice(0, 10);

    return { best, battleStats, teamStats, todayRecords, todayPlayers };
  }

  function battleStatus(leader, second) {
    if (!leader.power) return "🔥 激烈争夺中";
    const gap = leader.power - second.power;
    if (gap <= 0) return "🔥 激烈争夺中";
    if (gap <= 120) return "⚡ 即将反超";
    if (leader.guard > leader.sprint && gap > 280) return "🛡 防线稳固";
    if (gap > 520) return "👑 暂居王座";
    if (leader.guard < leader.sprint * 0.35 && gap <= 260) return "🚨 护盾告急";
    return battleTags[Math.floor(Math.random() * battleTags.length)];
  }

  function renderHomeChampion() {
    const { teamStats } = aggregate();
    const champion = teamStats[0];
    $("#homeChampion").innerHTML =
      champion && champion.power > 0
        ? `<div><span>当前冠军席位</span><strong>👑 ${champion.team}</strong><span>占领 ${champion.occupied}/5 个战场｜总战力 ${champion.power}</span></div><b>${champion.occupied}</b>`
        : `<div><span>当前冠军席位</span><strong>等待开球</strong><span>完成首局挑战后，战况将在这里点亮。</span></div><b>0</b>`;
  }

  function renderChoices() {
    const { teamStats, battleStats } = aggregate();
    const teamRank = new Map(teamStats.map((team, index) => [team.team, { ...team, rank: index + 1 }]));

    $("#teamChoices").innerHTML = teams
      .map((team, index) => {
        const stat = teamRank.get(team) || { rank: index + 1, power: 0 };
        return `<button type="button" class="team-card" data-value="${team}">
          <span class="badge">${teamIcons[index]}</span>
          <h3>${team}</h3>
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

  function attemptsForToday(name, team) {
    return getRecords().filter((r) => r.name === name && r.team === team && r.date === todayKey()).length;
  }

  function bestToday(name, team) {
    return getRecords()
      .filter((r) => r.name === name && r.team === team && r.date === todayKey())
      .reduce((best, r) => Math.max(best, r.score), 0);
  }

  function updateQuotaNote() {
    const name = $("#playerName").value.trim() || state.profile.name;
    const count = name ? attemptsForToday(name, state.profile.team) : 0;
    const remaining = Math.max(DAILY_LIMIT - count, 0);
    const now = new Date();
    const status =
      now < ACTIVITY_START
        ? "活动未开始，可先体验流程"
        : now > ACTIVITY_END
          ? "活动已结束，可查看战报"
          : `今日剩余 ${remaining} 次挑战机会`;
    $("#quotaNote").textContent = status;
    $("#enterGameBtn").disabled = Boolean(name && remaining <= 0);
  }

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

  function beginGame() {
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.lastComboSfx = 0;
    state.rushSfxPlayed = false;
    state.beforeBattle = aggregate().battleStats.find((battle) => battle.battle === state.profile.battle);
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

  function finishGame() {
    if (!state.running) return;
    state.running = false;
    clearGameTimers();
    $("#arena").querySelectorAll(".target").forEach((node) => node.remove());
    $("#injecting").classList.add("show");

    state.timers.push(setTimeout(() => {
      const count = attemptsForToday(state.profile.name, state.profile.team) + 1;
      const record = {
        name: state.profile.name,
        team: state.profile.team,
        battle: state.profile.battle,
        tactic: state.profile.tactic,
        score: state.score,
        date: todayKey(),
        time: nowTime(),
        dailyAttempt: count,
        maxCombo: state.maxCombo,
      };
      const records = getRecords();
      records.push(record);
      setRecords(records);
      renderResult(count, records);
    }, 920));
  }

  function renderResult(count, records) {
    const afterBattle = aggregate(records).battleStats.find((battle) => battle.battle === state.profile.battle);
    const wasLeader = state.beforeBattle?.leader?.team;
    const isLeader = afterBattle?.leader?.team;
    const changed = wasLeader && isLeader && wasLeader !== isLeader && afterBattle.leader.power > 0;
    const selectedRow = afterBattle.rows.find((row) => row.team === state.profile.team) || { power: 0 };
    const targetLeader = afterBattle.leader.team === state.profile.team ? afterBattle.second : afterBattle.leader;
    const diff = afterBattle.leader.team === state.profile.team
      ? Math.max(afterBattle.leader.power - afterBattle.second.power, 0)
      : Math.max(targetLeader.power - selectedRow.power, 0);
    const isAttack = state.profile.tactic === "发起进攻";

    $("#resultTag").textContent = isAttack ? "⚔ 进攻完成！" : "🛡 防守完成！";
    $("#finalScore").textContent = state.score;
    $("#impactCopy").textContent = `你已为【${state.profile.team}】在【${state.profile.battle}】贡献 ${state.score} ${isAttack ? "冲刺值" : "守护值"}。`;
    $("#resultSubtitle").textContent = changed
      ? "战场易主！"
      : afterBattle.leader.team === state.profile.team && !isAttack
        ? "防线加固！"
        : afterBattle.leader.team === state.profile.team
          ? "领先扩大！"
          : "距离反超更近一步！";
    $("#resultContext").innerHTML = `
      <div><span>${state.profile.battle} 当前占领</span><strong>${afterBattle.leader.power ? afterBattle.leader.team : "暂无"}</strong></div>
      <div><span>${afterBattle.leader.team === state.profile.team ? "当前领先优势" : "距离反超还差"}</span><strong>${diff} 战力</strong></div>
    `;
    $("#todayAttempts").textContent = `${count}/${DAILY_LIMIT}`;
    $("#todayBest").textContent = bestToday(state.profile.name, state.profile.team);
    $("#resultPanel").classList.toggle("flash", changed);
    $("#playAgainBtn").textContent = isAttack ? "再战一局" : "继续守住";
    showScreen("resultScreen");
    if (window.AudioManager) {
      window.AudioManager.playSfx(changed ? "leaderChange" : "success");
    }
  }

  function renderReports() {
    const { battleStats, teamStats, todayRecords, todayPlayers } = aggregate();
    const champion = teamStats[0];
    $("#championStrip").innerHTML =
      champion && champion.power > 0
        ? `<div><span>当前排名第一战队</span><strong>👑 ${champion.team}</strong><span>占领战场：${champion.occupied}/5｜总战力：${champion.power}</span></div><b>${champion.occupied}/5</b>`
        : `<div><span>当前排名第一战队</span><strong>等待开球</strong><span>完成挑战后，冠军席位将实时刷新。</span></div><b>0/5</b>`;

    $("#teamBoard").innerHTML = teamStats.some((team) => team.power > 0)
      ? teamStats.map((team, index) => teamRow(team, index)).join("")
      : empty("暂无门店战力，先完成一局挑战。");

    $("#battleBoard").innerHTML = battleStats.map((stat) => reportBattleCard(stat)).join("");
    $("#playerBoard").innerHTML = renderHighlights(todayRecords, todayPlayers);
    $("#liveTicker").innerHTML = renderTicker(battleStats, teamStats);
  }

  function teamRow(team, index) {
    const icon = index === 0 ? "👑" : index === 1 ? "⚔" : index === 2 ? "🛡" : index + 1;
    const status = index === 0 ? "暂居王座" : index === 1 ? "强势追击" : index === 2 ? "蓄势反超" : "等待爆发";
    return `<article class="rank-row ${index === 0 ? "top-1" : ""}">
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

  function renderHighlights(todayRecords, todayPlayers) {
    if (!todayRecords.length) return empty("今日暂无高光球员，等你来打第一脚。");
    const mvp = todayPlayers[0];
    const attack = topBy(todayRecords.filter((r) => r.tactic === "发起进攻"), "score");
    const defend = topBy(todayRecords.filter((r) => r.tactic === "坚守防线"), "score");
    const combo = topBy(todayRecords, "maxCombo");
    const cards = [
      ["👑", "今日MVP", mvp, mvp.score],
      ["⚔", "最强进攻", attack, attack?.score || 0],
      ["🛡", "最强防守", defend, defend?.score || 0],
      ["⚡", "Combo王", combo, combo?.maxCombo || 0],
    ];
    return cards.map(([icon, label, record, value]) => {
      if (!record) return `<article class="highlight-card"><span>${icon}</span><div><h4>${label}</h4><p>等待上榜</p></div><strong>0</strong></article>`;
      return `<article class="highlight-card"><span>${icon}</span><div><h4>${label}：${record.name}</h4><p>${record.team}｜${record.battle}</p></div><strong>${value}</strong></article>`;
    }).join("");
  }

  function topBy(records, key) {
    return records.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
  }

  function renderTicker(battleStats, teamStats) {
    const lines = [];
    battleStats.forEach((stat) => {
      if (stat.leader.power > 0) {
        if (stat.gap <= 120) lines.push(`🔥 ${stat.battle}差距仅剩${stat.gap}战力`);
        lines.push(`🛡 ${stat.leader.team}正在加固${stat.battle}防线`);
      }
    });
    if (teamStats[0]?.power > 0) lines.unshift(`👑 ${teamStats[0].team}暂居冠军席位`);
    if (teamStats[1]?.power > 0) lines.push(`⚔ ${teamStats[1].team}正在强势追击`);
    const safeLines = lines.length ? lines : ["⚡ 战场等待开球，第一脚由你打响", "🔥 五大战场已进入待命状态"];
    return `<div class="ticker-track">${safeLines.concat(safeLines).map((line) => `<div class="ticker-line">${line}</div>`).join("")}</div>`;
  }

  function empty(text) {
    return `<div class="empty">${text}</div>`;
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-target]");
      if (target) showScreen(target.dataset.target);
    });

    $("#startBtn").addEventListener("click", () => showScreen("nameScreen"));
    $("#playAgainBtn").addEventListener("click", () => showScreen("battleScreen"));
    $("#shareBtn").addEventListener("click", () => {
      if (navigator.share) {
        navigator.share({ title: "冲冠之路", text: "下半场开球，来为战队抢占五大战场！", url: location.href }).catch(() => {});
      } else {
        $("#resultSubtitle").textContent = "已准备好召唤战友，把当前链接转发给队友即可上场！";
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

    $("#enterGameBtn").addEventListener("click", () => {
      const name = state.profile.name || $("#playerName").value.trim();
      if (!name) {
        showScreen("nameScreen");
        return;
      }
      state.profile.name = name;
      if (attemptsForToday(name, state.profile.team) >= DAILY_LIMIT) {
        updateQuotaNote();
        showScreen("nameScreen");
        return;
      }
      saveProfile();
      beginGame();
    });


  }

  if (window.AudioManager) window.AudioManager.init();
  loadProfile();
  renderChoices();
  renderHomeChampion();
  bindEvents();
  updateQuotaNote();
  if (window.AudioManager) window.AudioManager.playMainBgm();
})();
