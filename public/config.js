// ============================================================
// 《深圳丽兹行冲冠之旅》前端配置文件
// 修改本文件即可调整活动参数，无需改动业务代码
// 配置会挂载到 window.CROWN_CONFIG，供 app.js 读取
//
// 部署模式：前端直连 Supabase（纯静态，无需后端/Functions）
// ============================================================

window.CROWN_CONFIG = {
  // ---- 活动时间（东八区 ISO 格式，到时自动切换状态）----
  activityStart: "2026-08-01T08:00:00+08:00",
  activityEnd: "2026-08-03T23:59:59+08:00",

  // ---- 每人每日挑战次数上限 ----
  dailyLimit: 10,

  // ---- Supabase 连接信息（从 Supabase 控制台 → Settings → API Keys 获取）----
  // 填入你的 Project URL 和 public anon key（publishable key）
  supabaseUrl: "https://jarcimaypcyvmrzluunv.supabase.co",
  supabaseAnonKey: "sb_publishable_MIhgynTsKwObVP-PCy8GLQ_5w8AX8X-",

  // ---- 召唤战友分享链接 ----
  shareUrl: "",
  shareTitle: "深圳丽兹行冲冠之旅",
  shareText: "十八大门店战队开球，来为你的门店抢占五大战场！",

  // ---- localStorage 存储键名 ----
  profileKey: "road-to-crown-profile-v1",
};
// env updated
// redeploy to load new env vars 1785550712
