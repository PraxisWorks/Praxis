module.exports = {
  apps: [
    {
      name: "praxis2-worker",
      script: "packages/worker/dist/index.js",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: ".env",
      },
      // Restart strategy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      // Give the worker enough time to drain active sessions before SIGKILL.
      // Worker's DRAIN_TIMEOUT_MS is 60s; allow 65s total.
      kill_timeout: 65000,
      // Logging
      error_file: "packages/worker/logs/worker-error.log",
      out_file: "packages/worker/logs/worker-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "praxis2-worker-dev",
      script: "packages/worker/dist/index.js",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: ".env",
        WORKER_NAME: "dev",
        WORKER_ID: "11111111-1111-1111-1111-111111111111",
        CLAUDE_CONFIG_DIR: "~/.claude-dev",
        CLAUDE_COMMAND: "CLAUDE_CONFIG_DIR=~/.claude-dev claude",
      },
      // Restart strategy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      kill_timeout: 65000,
      // Logging
      error_file: "packages/worker/logs/worker-dev-error.log",
      out_file: "packages/worker/logs/worker-dev-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
