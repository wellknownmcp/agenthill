/** PM2 — two processes, both restarted by scripts/deploy.sh. */
module.exports = {
  apps: [
    {
      name: "agenthill-server",
      cwd: "/home/debian/sites/agenthill/apps/server",
      script: "../../node_modules/.bin/tsx",
      args: "src/index.ts",
      env: { NODE_ENV: "production", PORT: "3303" },
      max_memory_restart: "400M",
      time: true,
    },
    {
      name: "agenthill-web",
      cwd: "/home/debian/sites/agenthill/apps/web",
      script: "../../node_modules/.bin/next",
      args: "start -p 3304",
      env: { NODE_ENV: "production", PORT: "3304" },
      max_memory_restart: "500M",
      time: true,
    },
  ],
};
