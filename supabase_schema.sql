-- ============================================================
-- 《深圳丽兹行冲冠之旅》Supabase PostgreSQL 建表脚本
-- ------------------------------------------------------------
-- 使用方法：
-- 1. 在 Supabase 控制台 → SQL Editor 中执行本脚本
-- 2. 或在 Settings → Database → Connection string 里用 psql 执行
--
-- 注意事项：
-- - 建完表后，去 Authentication → Policies 确认 RLS 已关闭（或按需配置）
-- - 本脚本使用 anon key 公开读写（适合内部活动游戏）
-- - 如需更安全：开启 RLS + 用 Supabase Auth 做登录鉴权
-- ============================================================

-- 成绩主表
create table if not exists public.chongguan_scores (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  name text not null,
  team text not null,
  battle text not null,
  tactic text not null,
  score integer not null check (score >= 0),
  submit_date date not null default current_date,
  submit_time time not null default now(),
  daily_attempt integer not null check (daily_attempt >= 1),
  max_combo integer default 0,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),

  -- ★ 18 个门店战队白名单（与 teams.js 完全一致）★
  constraint chongguan_team_check check (
    team in (
      '中城瑧海店',
      '深北别墅店',
      '香山美墅店',
      '曦城别墅店',
      '香蜜湖旗舰店',
      '华润城店',
      '后海旗舰店',
      '红树湾店',
      '中心路店',
      '红树西岸店',
      '海上世界双玺店',
      '纯水岸店',
      '顶级豪宅一部',
      '天鹅湖花园店',
      '卓越半岛店',
      '宝安中心旗舰店',
      '深圳湾旗舰店',
      '职能总部'
    )
  ),

  -- 5 大战场白名单
  constraint chongguan_battle_check check (
    battle in (
      '客户突破战场',
      '房源深耕战场',
      'AI助攻战场',
      '团队协同战场',
      '临门一脚战场'
    )
  ),

  -- 战术白名单
  constraint chongguan_tactic_check check (
    tactic in ('发起进攻', '坚守防线')
  )
);

-- 索引优化查询性能
create index if not exists idx_chongguan_scores_date
  on public.chongguan_scores (submit_date);
create index if not exists idx_chongguan_scores_device_day
  on public.chongguan_scores (device_id, submit_date);
create index if not exists idx_chongguan_scores_battle_team
  on public.chongguan_scores (battle, team);
create index if not exists idx_chongguan_scores_team_date
  on public.chongguan_scores (team, submit_date);

-- 玩家表：以 device_id 为唯一标识，name 可随时更改
create table if not exists public.chongguan_players (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  name text not null,
  team text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- 元数据表：存储活动重置时间等关键信息
create table if not exists public.chongguan_meta (
  key text primary key,
  value text not null
);

-- 每日有效成绩视图：同一 device_id + 日期 只取最高分
create or replace view public.chongguan_daily_best as
select distinct on (device_id, submit_date)
  id,
  device_id,
  name,
  team,
  battle,
  tactic,
  score,
  submit_date,
  submit_time,
  daily_attempt,
  max_combo,
  created_at
from public.chongguan_scores
order by device_id, submit_date, score desc, created_at asc;

-- 战场统计视图
create or replace view public.chongguan_battle_stats as
select
  battle,
  team,
  coalesce(sum(case when tactic = '发起进攻' then score else 0 end), 0) as sprint,
  coalesce(sum(case when tactic = '坚守防线' then score else 0 end), 0) as guard,
  coalesce(sum(score), 0) as power
from public.chongguan_daily_best
group by battle, team;

-- 门店总战力视图
create or replace view public.chongguan_team_stats as
select
  team,
  coalesce(sum(score), 0) as power,
  count(distinct device_id) as participants,
  coalesce(max(score), 0) as high
from public.chongguan_daily_best
group by team;

-- ============================================================
-- RLS（行级安全）策略说明
-- ============================================================
-- 内部活动场景建议：关闭 RLS（默认），允许匿名读写。
-- 如果需要开启 RLS（更安全），取消下面注释并执行：
--
-- alter table public.chongguan_scores enable row level security;
-- alter table public.chongguan_players enable row level security;
--
-- create policy "允许匿名读取" on public.chongguan_scores
--   for select using (true);
-- create policy "允许匿名插入" on public.chongguan_scores
--   for insert with check (true);
-- create policy "允许匿名读取玩家" on public.chongguan_players
--   for select using (true);
-- create policy "允许匿名插入玩家" on public.chongguan_players
--   for insert with check (true);
-- create policy "允许匿名更新玩家" on public.chongguan_players
--   for update using (true);
