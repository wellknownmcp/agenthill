/**
 * PM2 — two processes.
 *
 * The server runs on tsx. Do NOT point PM2 at node_modules/.bin/tsx: that is a
 * shell shim, and PM2 hands it to node, which chokes on the first line. Call
 * node with the tsx preflight + loader, the way animam-mcp does.
 *
 * The environment is sourced from ../../.env before `pm2 start` (see
 * scripts/deploy.sh). Never rely on Prisma's implicit dotenv for anything other
 * than Prisma: everything else reads process.env, which PM2 froze at start.
 */
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const tsx = path.join(root, "node_modules", "tsx", "dist");

module.exports = {
  apps: [
    {
      name: "agenthill-server",
      cwd: path.join(root, "apps", "server"),
      script: process.execPath,
      args: ["--require", path.join(tsx, "preflight.cjs"), "--import", `file://${path.join(tsx, "loader.mjs")}`, "src/index.ts"],
      env: { NODE_ENV: "production", PORT: "3303" },
      max_memory_restart: "400M",
      time: true,
    },
    {
      name: "agenthill-web",
      cwd: path.join(root, "apps", "web"),
      script: path.join(root, "node_modules", "next", "dist", "bin", "next"),
      args: ["start", "-p", "3304"],
      env: { NODE_ENV: "production", PORT: "3304" },
      max_memory_restart: "500M",
      time: true,
    },
  ],
};
