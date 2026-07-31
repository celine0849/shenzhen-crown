// GET /api/health
// 健康检查接口

const { ok } = require("./_shared/helpers");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  return ok({
    status: "ok",
    time: new Date().toISOString(),
    platform: "netlify-functions + supabase",
  }, headers);
};
