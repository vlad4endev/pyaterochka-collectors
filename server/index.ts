import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app";
import { startBot } from "./bot";

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API http://localhost:${info.port}`);
});

void startBot().catch((err) => {
  console.error("Failed to start Telegram bot", err);
});
