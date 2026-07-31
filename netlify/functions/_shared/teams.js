// 战队/战场数据源（从项目根目录 teams.js 复制，Functions 内独立使用）
// 与根目录 teams.js 保持同步，修改时两边一起改。

module.exports = {
  GAME: {
    name: "深圳丽兹行冲冠之旅",
    subtitle: "十八大门店战队，五大战场，抢占冲冠王座",
  },
  TEAMS: [
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
  BATTLES: [
    { name: "客户突破战场", description: "每一次主动追聊、精准匹配、持续推进，都是向客户信任更近一步。" },
    { name: "房源深耕战场", description: "每一次面见争取、房源分析、专业反馈，都是在为结果积累弹药。" },
    { name: "AI助攻战场", description: "AI不是装备展示，而是每场都要上场的战术板。" },
    { name: "团队协同战场", description: "个人突破背后有团队支撑，真正的胜利来自并肩作战。" },
    { name: "临门一脚战场", description: "关键机会出现时，敢推进、敢争取、敢完成最后一脚。" },
  ],
  TACTICS: ["发起进攻", "坚守防线"],
  DAILY_LIMIT: 10,
};
