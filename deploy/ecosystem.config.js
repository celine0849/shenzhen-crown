// PM2 进程守护配置（用于「轻量服务器 / 任意 Linux VPS」路径）
// 注意：server.js 内部已用 cluster 按 CPU 核数开多进程，
// 所以这里用 fork 单实例即可，避免 PM2 再套一层 cluster 导致进程翻倍。
module.exports = {
  apps: [
    {
      name: "shenzhen-crown",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 8080,                       // 监听端口（Nginx 反代到它）
        TZ: "Asia/Shanghai",
        GLOBAL_RATE_LIMIT: 240,           // 全局每分钟最大请求数
        SUBMIT_RATE_LIMIT: 30,            // 单个 IP 每分钟最多提交次数
        // DISABLE_CLUSTER: "1",          // 如需关闭内部多进程可取消注释
      },
    },
  ],
};
