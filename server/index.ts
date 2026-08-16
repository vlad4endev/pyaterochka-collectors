import "dotenv/config";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { app as api } from "./app";
import { startBot, stopBot } from "./bot";
import { startMaxBot, stopMaxBot } from "./maxBot";
import { db } from "./db";
import { ensureCurrentWeekPeriod } from "./lib/domain";
import { startDailyReportReminders, stopDailyReportReminders } from "./lib/scheduler";

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "0.0.0.0";
const distDir = join(process.cwd(), "dist");
const indexPath = join(distDir, "index.html");
const serveFrontend = existsSync(indexPath);

if (!process.env.ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is not set");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const root = new Hono();
root.route("/api", api);

if (serveFrontend) {
  root.use("*", async (c, next) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      await next();
      return;
    }
    return serveStatic({ root: "./dist" })(c, next);
  });
  root.get("*", async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      return c.notFound();
    }
    const fileName = c.req.path.split("/").pop() ?? "";
    if (fileName.includes(".")) {
      return c.notFound();
    }
    const html = await readFile(indexPath, "utf8");
    return c.html(html);
  });
}

const server = serve({ fetch: root.fetch, port, hostname }, (info) => {
  const origin = `http://${info.address}:${info.port}`;
  console.log(`API ${origin}/api`);
  if (serveFrontend) {
    console.log(`Web ${origin}`);
  }
});

void startBot()
  .then(() => startMaxBot())
  .then(() => {
    startDailyReportReminders();
  })
  .catch((err) => {
    console.error("Failed to start bots", err);
    startDailyReportReminders();
  });

void ensureCurrentWeekPeriod(db).catch((err) => {
  console.error("Failed to open the current week", err);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal}: shutting down`);
  stopDailyReportReminders();
  await stopBot();
  await stopMaxBot();
  await db.$disconnect();
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
