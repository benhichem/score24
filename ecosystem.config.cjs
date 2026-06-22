module.exports = {
  apps: [
    {
      name: "daily-fetcher",
      script: "src/fetch_daily_data.ts",
      interpreter: "bun",
      cron_restart: "0 1 * * *", // Runs daily at 1:00 AM UTC
      autorestart: false,        // Don't restart after the cron job finishes
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "./logs/daily-fetcher.log",
      error_file: "./logs/daily-fetcher-error.log",
      merge_logs: true
    },
    {
      name: "live-odds-server",
      script: "src/live-odds-system/server.ts",
      interpreter: "bun",
      autorestart: true,         // Keep the WebSocket server always running
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "./logs/live-odds-server.log",
      error_file: "./logs/live-odds-server-error.log",
      merge_logs: true
    }
  ]
};
