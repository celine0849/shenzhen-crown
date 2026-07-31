// Supabase 客户端初始化（所有 Netlify Functions 共用）
// 环境变量在 Netlify 控制台 → Site settings → Environment variables 中配置：
//   SUPABASE_URL     = https://xxxxx.supabase.co
//   SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6...

const { createClient } = require("@supabase/supabase-js");

let _client = null;

function getSupabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("缺少环境变量: SUPABASE_URL / SUPABASE_ANON_KEY");
    _client = createClient(url, key);
  }
  return _client;
}

module.exports = { getSupabase };
