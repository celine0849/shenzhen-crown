// ============================================================
// 《深圳丽兹行冲冠之旅》前端配置文件
// 修改本文件即可调整活动参数，无需改动业务代码
// 配置会挂载到 window.CROWN_CONFIG，供 app.js 读取
//
// 部署模式：前端直连腾讯云开发 CloudBase（大陆原生访问，无需翻墙）
// ============================================================

window.CROWN_CONFIG = {
  // ---- 活动时间（东八区 ISO 格式，到时自动切换状态）----
  activityStart: "2026-08-01T08:00:00+08:00",
  activityEnd: "2026-08-03T23:59:59+08:00",

  // ---- 每人每日挑战次数上限 ----
  dailyLimit: 10,

  // ---- 腾讯云开发 CloudBase 环境 ID（从控制台 → 环境管理 获取）----
  cloudbaseEnv: "shenzhen-crown-d8gfabegcb4845e59",

  // ---- 召唤战友分享链接 ----
  shareUrl: "",
  shareTitle: "深圳丽兹行冲冠之旅",
  shareText: "十八大门店战队开球，来为你的门店抢占五大战场！",

  // ---- localStorage 存储键名 ----
  profileKey: "road-to-crown-profile-v1",
};
